// Read/write for entities.json, review-queue.json, rejected.json,
// geocode-cache.json and the JSONL audit log. Every mutation persisted through
// this module carries an audit entry (§5 shape). All writes are skipped when
// the store is created with {dryRun: true}.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PATHS } from './paths.js';

export const ENTITY_KEY_ORDER = [
  'id', 'name', 'dances', 'categories', 'description', 'lat', 'lng',
  'address', 'city', 'country', 'schedule', 'days_of_week',
  'start_date', 'end_date', 'images', 'socials',
  'organizer', 'music', 'artists', 'status', 'locked_fields', 'sources',
  'created_at', 'updated_at',
];

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function defaultActor() {
  if (process.env.GITHUB_ACTIONS === 'true') return 'github-actions';
  return process.env.USER || os.userInfo().username || 'unknown';
}

// Serialize an entity with a stable key order so diffs stay minimal.
export function orderEntity(entity) {
  const out = {};
  for (const key of ENTITY_KEY_ORDER) {
    out[key] = entity[key] !== undefined ? entity[key] : null;
  }
  if (out.dances === null) out.dances = [];
  if (out.categories === null) out.categories = [];
  if (out.days_of_week === null) out.days_of_week = [];
  if (out.images === null) out.images = [];
  if (out.socials === null) out.socials = {};
  if (out.music === null) out.music = [];
  if (out.artists === null) out.artists = [];
  if (out.locked_fields === null) out.locked_fields = [];
  if (out.sources === null) out.sources = [];
  // keep any unexpected extra keys rather than silently dropping data
  for (const key of Object.keys(entity)) {
    if (!(key in out)) out[key] = entity[key];
  }
  return out;
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return structuredClone(fallback);
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return structuredClone(fallback);
  return JSON.parse(raw);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

// True when serializing `value` (which still carries the OLD `generated`
// stamp) would reproduce the file byte-for-byte — i.e. the run changed
// nothing. Skipping the write in that case keeps `generated` stable, so no-op
// scheduled runs produce no commit and no redeploy (scrape.yml's
// `changed=false` branch).
function unchangedOnDisk(file, value) {
  if (!fs.existsSync(file)) return false;
  return fs.readFileSync(file, 'utf8') === JSON.stringify(value, null, 2) + '\n';
}

/**
 * @param {object} paths  file locations (defaults to repo paths from paths.js)
 * @param {object} opts   {dryRun}
 */
export function createStore(paths = PATHS, { dryRun = false } = {}) {
  const pendingAudit = [];

  const store = {
    paths,
    dryRun,

    loadEntitiesDoc() {
      return readJson(paths.entities, {
        schema_version: 2,
        generated: null,
        entities: [],
      });
    },

    loadReviewQueue() {
      return readJson(paths.reviewQueue, { generated: null, items: [] });
    },

    loadRejected() {
      return readJson(paths.rejected, { items: [] });
    },

    loadGeocodeCache() {
      return readJson(paths.geocodeCache, {});
    },

    saveEntitiesDoc(doc) {
      if (dryRun) return;
      const out = {
        schema_version: doc.schema_version ?? 2,
        generated: doc.generated ?? null,
        entities: doc.entities.map(orderEntity),
      };
      if (unchangedOnDisk(paths.entities, out)) return;
      out.generated = nowIso();
      writeJson(paths.entities, out);
    },

    saveReviewQueue(queue) {
      if (dryRun) return;
      const out = {
        generated: queue.generated ?? null,
        items: queue.items,
      };
      if (unchangedOnDisk(paths.reviewQueue, out)) return;
      out.generated = nowIso();
      writeJson(paths.reviewQueue, out);
    },

    saveRejected(rejected) {
      if (dryRun) return;
      writeJson(paths.rejected, { items: rejected.items });
    },

    saveGeocodeCache(cache) {
      if (dryRun) return;
      writeJson(paths.geocodeCache, cache);
    },

    /**
     * Build a §5-shaped audit entry and queue it for the next flush.
     * Call once per mutation (create/update/archive/restore/delete/approve/reject).
     */
    audit({ action, entityId = null, entityName = null, source, actor, changes = {}, context = {} }) {
      const entry = {
        ts: nowIso(),
        action,
        entity_id: entityId,
        entity_name: entityName,
        source,
        actor: actor || defaultActor(),
        changes,
        context,
      };
      pendingAudit.push(entry);
      return entry;
    },

    pendingAuditEntries() {
      return pendingAudit.slice();
    },

    flushAudit() {
      if (dryRun || pendingAudit.length === 0) {
        const out = pendingAudit.slice();
        pendingAudit.length = 0;
        return out;
      }
      fs.mkdirSync(path.dirname(paths.auditLog), { recursive: true });
      const lines = pendingAudit.map((e) => JSON.stringify(e)).join('\n') + '\n';
      fs.appendFileSync(paths.auditLog, lines);
      const out = pendingAudit.slice();
      pendingAudit.length = 0;
      return out;
    },
  };

  return store;
}
