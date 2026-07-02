// Candidate ↔ existing-entity matching, update policy, review-queue routing,
// rejected-key skipping and the 14-day stale sweep. Mutates the in-memory
// documents and records one audit entry per mutation through the store.

import crypto from 'node:crypto';
import { CATEGORY_KEYS, DANCE_KEYS } from './extract.js';
import { nowIso } from './store.js';

export const AUTO_APPLY_THRESHOLD = 0.7;
export const QUEUE_THRESHOLD = 0.4;
export const STALE_DAYS = 14;

// scalar policy: replace when different, never blank, respects locked_fields
// (days_of_week and organizer follow it too — §7)
const UPDATABLE_FIELDS = [
  'name', 'description', 'lat', 'lng', 'address', 'city', 'country',
  'schedule', 'days_of_week', 'start_date', 'end_date', 'images', 'organizer',
];

// ---------- matching primitives ----------

export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function slugify(name) {
  return normalizeName(name).replace(/\s+/g, '-') || 'unnamed';
}

// Sørensen–Dice bigram similarity on normalized names, 0..1
export function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const bigrams = (s) => {
    const map = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
  };
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let overlap = 0;
  let sizeA = 0;
  let sizeB = 0;
  for (const n of ba.values()) sizeA += n;
  for (const n of bb.values()) sizeB += n;
  for (const [bg, n] of ba) overlap += Math.min(n, bb.get(bg) || 0);
  return sizeA + sizeB === 0 ? 0 : (2 * overlap) / (sizeA + sizeB);
}

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export function sourceLabelFor(candidate) {
  const ctx = candidate.context || {};
  if (ctx.kind === 'discovery') return 'scraper:search';
  const domain = domainOf(ctx.url);
  return domain ? `scraper:site:${domain}` : 'scraper:search';
}

export function candidateKey(candidate) {
  const domain =
    domainOf(candidate.socials?.website) || domainOf(candidate.context?.url) || 'unknown';
  return `${normalizeName(candidate.name)}|${domain}`;
}

function entityDomains(entity) {
  const domains = new Set();
  const site = domainOf(entity.socials?.website);
  if (site) domains.add(site);
  for (const src of entity.sources || []) {
    const d = domainOf(src.url);
    if (d) domains.add(d);
  }
  return domains;
}

function candidateDomains(candidate) {
  const domains = new Set();
  for (const url of [candidate.socials?.website, candidate.context?.url]) {
    const d = domainOf(url);
    if (d) domains.add(d);
  }
  // candidates extracted from a listing page share that page's domain with
  // every other event on it — it carries no identity signal (rule 2)
  if (candidate.context?.listing) {
    const listingDomain = domainOf(candidate.context.url);
    if (listingDomain) domains.delete(listingDomain);
  }
  return domains;
}

// Match order (§7): (source, ref) → website domain + name sim ≥0.6 → name sim ≥0.85 + <300m
export function findMatch(candidate, entities) {
  const label = sourceLabelFor(candidate);
  const ref = slugify(candidate.name);

  for (const entity of entities) {
    if ((entity.sources || []).some((s) => s.source === label && s.ref === ref)) {
      return { entity, rule: 'source+ref' };
    }
  }

  const cDomains = candidateDomains(candidate);
  for (const entity of entities) {
    const eDomains = entityDomains(entity);
    const shared = [...cDomains].some((d) => eDomains.has(d));
    if (shared && nameSimilarity(candidate.name, entity.name) >= 0.6) {
      return { entity, rule: 'domain+name' };
    }
  }

  if (candidate.lat != null && candidate.lng != null) {
    for (const entity of entities) {
      if (entity.lat == null || entity.lng == null) continue;
      if (nameSimilarity(candidate.name, entity.name) < 0.85) continue;
      if (distanceMeters(candidate.lat, candidate.lng, entity.lat, entity.lng) < 300) {
        return { entity, rule: 'name+distance' };
      }
    }
  }
  return null;
}

// ---------- update policy ----------

function isEmpty(value) {
  return (
    value == null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
  );
}

function valuesEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// music/artists merge as union by normalized name (§7)
export function unionByName(existing, incoming) {
  const out = (existing || []).slice();
  const seen = new Set(out.map((item) => normalizeName(item?.name)).filter(Boolean));
  for (const item of incoming || []) {
    const key = normalizeName(item?.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Apply candidate onto entity per the §7 update policy. Mutates entity.
 * Never blanks a non-empty field, never touches locked_fields, categories = union.
 * @returns changes object in the §5 audit shape (empty when nothing changed)
 */
export function applyUpdatePolicy(entity, candidate) {
  const locked = new Set(entity.locked_fields || []);
  const changes = {};

  for (const field of UPDATABLE_FIELDS) {
    if (locked.has(field)) continue;
    const next = candidate[field];
    if (isEmpty(next)) continue; // never blank a non-empty field
    if (valuesEqual(entity[field], next)) continue;
    changes[field] = { old: entity[field] ?? null, new: next };
    entity[field] = next;
  }

  if (!locked.has('categories') && Array.isArray(candidate.categories)) {
    const merged = [
      ...new Set([...(entity.categories || []), ...candidate.categories]),
    ].filter((c) => CATEGORY_KEYS.includes(c));
    // fixed display order
    merged.sort((a, b) => CATEGORY_KEYS.indexOf(a) - CATEGORY_KEYS.indexOf(b));
    if (!valuesEqual(entity.categories, merged) && merged.length > 0) {
      changes.categories = { old: entity.categories, new: merged };
      entity.categories = merged;
    }
  }

  // dances merge as union in fixed order (§7)
  if (!locked.has('dances') && Array.isArray(candidate.dances)) {
    const merged = [
      ...new Set([...(entity.dances || []), ...candidate.dances]),
    ].filter((d) => DANCE_KEYS.includes(d));
    merged.sort((a, b) => DANCE_KEYS.indexOf(a) - DANCE_KEYS.indexOf(b));
    if (!valuesEqual(entity.dances, merged) && merged.length > 0) {
      changes.dances = { old: entity.dances ?? [], new: merged };
      entity.dances = merged;
    }
  }

  for (const field of ['music', 'artists']) {
    if (locked.has(field)) continue;
    if (!Array.isArray(candidate[field]) || candidate[field].length === 0) continue;
    const merged = unionByName(entity[field], candidate[field]);
    if (!valuesEqual(entity[field], merged)) {
      changes[field] = { old: entity[field] ?? [], new: merged };
      entity[field] = merged;
    }
  }

  if (!locked.has('socials') && candidate.socials && typeof candidate.socials === 'object') {
    const mergedSocials = { ...(entity.socials || {}) };
    let socialsChanged = false;
    for (const [key, value] of Object.entries(candidate.socials)) {
      if (isEmpty(value)) continue;
      if (mergedSocials[key] === value) continue;
      mergedSocials[key] = value;
      socialsChanged = true;
    }
    if (socialsChanged) {
      changes.socials = { old: entity.socials || {}, new: mergedSocials };
      entity.socials = mergedSocials;
    }
  }

  return changes;
}

function touchSource(entity, candidate, now) {
  const label = sourceLabelFor(candidate);
  const ref = slugify(candidate.name);
  const url = candidate.context?.url || null;
  let entry = (entity.sources || []).find((s) => s.source === label && (s.ref === ref || s.url === url));
  if (entry) {
    entry.last_seen = now;
    if (url && !entry.url) entry.url = url;
  } else {
    entity.sources = entity.sources || [];
    entity.sources.push({ source: label, ref, url, first_seen: now, last_seen: now });
  }
}

function newEntityFromCandidate(candidate, now) {
  const label = sourceLabelFor(candidate);
  return {
    id: crypto.randomUUID(),
    name: candidate.name,
    dances: (candidate.dances || []).filter((d) => DANCE_KEYS.includes(d)),
    categories: (candidate.categories || []).filter((c) => CATEGORY_KEYS.includes(c)),
    description: candidate.description || '',
    lat: candidate.lat ?? null,
    lng: candidate.lng ?? null,
    address: candidate.address ?? null,
    city: candidate.city ?? null,
    country: candidate.country ?? null,
    schedule: candidate.schedule ?? null,
    days_of_week: candidate.days_of_week || [],
    start_date: candidate.start_date ?? null,
    end_date: candidate.end_date ?? null,
    images: candidate.images || [],
    socials: candidate.socials || {},
    organizer: candidate.organizer ?? null,
    music: candidate.music || [],
    artists: candidate.artists || [],
    status: 'active',
    locked_fields: [],
    sources: [
      {
        source: label,
        ref: slugify(candidate.name),
        url: candidate.context?.url || null,
        first_seen: now,
        last_seen: now,
      },
    ],
    created_at: now,
    updated_at: now,
  };
}

function queueCandidate(queue, candidate, reasons, now) {
  const key = candidateKey(candidate);
  const { context, confidence, reasons: extractReasons, ...fields } = candidate;
  const existing = queue.items.find((item) => item.key === key);
  if (existing) {
    existing.last_seen = now;
    if (confidence > existing.confidence) {
      existing.candidate = fields;
      existing.confidence = confidence;
      existing.reasons = reasons;
      existing.context = { url: context?.url || null, query: context?.query || null };
    }
    return 'bumped';
  }
  queue.items.push({
    key,
    candidate: fields,
    confidence,
    reasons,
    context: { url: context?.url || null, query: context?.query || null },
    first_seen: now,
    last_seen: now,
  });
  return 'queued';
}

// ---------- run merge ----------

/**
 * @param {object} args {doc, queue, rejected, candidates, store, actor, now}
 * @returns {{created, updated, refreshed, queued, dropped, rejectedSkipped, restored, mutations: []}}
 */
export function runMerge({ doc, queue, rejected, candidates, store, actor, now = nowIso() }) {
  const stats = {
    created: 0, updated: 0, refreshed: 0, queued: 0,
    dropped: 0, rejectedSkipped: 0, restored: 0,
    mutations: [],
  };
  const rejectedKeys = new Set((rejected.items || []).map((item) => item.key));

  for (const candidate of candidates) {
    if (!candidate.name) {
      stats.dropped += 1;
      continue;
    }
    if (rejectedKeys.has(candidateKey(candidate))) {
      stats.rejectedSkipped += 1;
      continue;
    }
    if (candidate.confidence < QUEUE_THRESHOLD) {
      stats.dropped += 1;
      continue;
    }

    const match = findMatch(candidate, doc.entities);
    const context = {
      url: candidate.context?.url || null,
      query: candidate.context?.query || null,
    };
    const source = sourceLabelFor(candidate);

    if (match) {
      const { entity } = match;
      touchSource(entity, candidate, now);
      if (candidate.confidence >= AUTO_APPLY_THRESHOLD) {
        const changes = applyUpdatePolicy(entity, candidate);
        if (entity.status === 'archived') {
          entity.status = 'active';
          entity.updated_at = now;
          stats.restored += 1;
          stats.mutations.push({ action: 'restore', entity });
          store.audit({
            action: 'restore', entityId: entity.id, entityName: entity.name,
            source, actor,
            changes: { status: { old: 'archived', new: 'active' } },
            context,
          });
        }
        if (Object.keys(changes).length > 0) {
          entity.updated_at = now;
          stats.updated += 1;
          stats.mutations.push({ action: 'update', entity, changes });
          store.audit({
            action: 'update', entityId: entity.id, entityName: entity.name,
            source, actor, changes, context,
          });
        } else {
          stats.refreshed += 1; // sighting only — last_seen bumped, no field change
        }
      } else {
        stats.refreshed += 1; // known entity re-seen with low confidence
      }
      continue;
    }

    // no match — new entity, queue item, or drop
    const problems = [];
    if (candidate.lat == null || candidate.lng == null) problems.push('no coordinates');
    if (!candidate.categories || candidate.categories.length === 0) problems.push('no category detected');
    if (!candidate.dances || candidate.dances.length === 0) problems.push('dance unclear');

    if (candidate.confidence >= AUTO_APPLY_THRESHOLD && problems.length === 0) {
      const entity = newEntityFromCandidate(candidate, now);
      doc.entities.push(entity);
      stats.created += 1;
      stats.mutations.push({ action: 'create', entity });
      store.audit({
        action: 'create', entityId: entity.id, entityName: entity.name,
        source, actor,
        changes: {
          name: { old: null, new: entity.name },
          categories: { old: null, new: entity.categories },
        },
        context,
      });
    } else {
      const reasons = [...(candidate.reasons || []), ...problems];
      const outcome = queueCandidate(queue, candidate, reasons, now);
      stats.queued += outcome === 'queued' ? 1 : 0;
      if (outcome === 'bumped') stats.refreshed += 1;
    }
  }

  return stats;
}

/**
 * Archive active entities whose sources are ALL scraper:* and ALL stale (§7.6).
 * Entities with any manual/seed source are never auto-archived.
 */
export function staleSweep({ doc, store, actor, now = nowIso(), staleDays = STALE_DAYS }) {
  const cutoff = Date.parse(now) - staleDays * 24 * 60 * 60 * 1000;
  const stats = { archived: 0, mutations: [] };

  for (const entity of doc.entities) {
    if (entity.status !== 'active') continue;
    const sources = entity.sources || [];
    if (sources.length === 0) continue;
    const allScraper = sources.every((s) => String(s.source).startsWith('scraper:'));
    if (!allScraper) continue;
    const allStale = sources.every((s) => {
      const seen = Date.parse(s.last_seen || s.first_seen || '');
      // missing/unparseable timestamps are NOT stale — corrupt data must
      // never silently archive an entity
      return Number.isFinite(seen) && seen < cutoff;
    });
    if (!allStale) continue;

    entity.status = 'archived';
    entity.updated_at = now;
    stats.archived += 1;
    stats.mutations.push({ action: 'archive', entity });
    store.audit({
      action: 'archive', entityId: entity.id, entityName: entity.name,
      source: sources[0].source, actor,
      changes: { status: { old: 'active', new: 'archived' } },
      context: { reason: `all scraper sources stale > ${staleDays} days` },
    });
  }
  return stats;
}
