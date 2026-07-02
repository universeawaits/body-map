// Manual CRUD, review-queue approval and field locking. Every action appends
// an audit entry (source: manual, actor from --actor or $USER). See §7.
//
//   node src/admin.js list [--city X] [--category Y] [--dance D] [--status Z]
//   node src/admin.js show    --id <uuid>
//   node src/admin.js add     --json path/to/entity.json
//   node src/admin.js update  --id <uuid> --json path/to/patch.json
//   node src/admin.js archive --id <uuid>
//   node src/admin.js restore --id <uuid>
//   node src/admin.js delete  --id <uuid>            # confirms unless --yes
//   node src/admin.js queue
//   node src/admin.js approve --index N [--categories a,b] [--dances a,b]
//   node src/admin.js reject  --index N --reason "…"
//   node src/admin.js lock    --id <uuid> --fields name,description
//   node src/admin.js unlock  --id <uuid> --fields description

import fs from 'node:fs';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { PATHS } from './paths.js';
import { createStore, defaultActor, nowIso } from './store.js';
import { CATEGORY_KEYS, DANCE_KEYS, DAY_KEYS } from './extract.js';
import { slugify, candidateKey } from './merge.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--yes') opts.yes = true;
    else if (arg.startsWith('--')) opts[arg.slice(2)] = rest[++i];
    else opts._.push(arg);
  }
  return { command, opts };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function findEntity(doc, id) {
  const entity = doc.entities.find((e) => e.id === id);
  if (!entity) fail(`No entity with id ${id}`);
  return entity;
}

function readJsonFile(file) {
  if (!file) fail('--json <file> is required');
  if (!fs.existsSync(file)) fail(`File not found: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`${file} is not valid JSON: ${err.message}`);
  }
}

function validateCategories(categories) {
  if (!Array.isArray(categories) || categories.length === 0) {
    fail(`"categories" must be a non-empty array of: ${CATEGORY_KEYS.join(', ')}`);
  }
  for (const c of categories) {
    if (!CATEGORY_KEYS.includes(c)) fail(`Unknown category "${c}" (allowed: ${CATEGORY_KEYS.join(', ')})`);
  }
}

// §7: entity validation — dances non-empty ⊆ the four dance keys
function validateDances(dances) {
  if (!Array.isArray(dances) || dances.length === 0) {
    fail(`"dances" must be a non-empty array of: ${DANCE_KEYS.join(', ')}`);
  }
  for (const d of dances) {
    if (!DANCE_KEYS.includes(d)) fail(`Unknown dance "${d}" (allowed: ${DANCE_KEYS.join(', ')})`);
  }
}

function validateDaysOfWeek(days) {
  if (!Array.isArray(days)) fail(`"days_of_week" must be an array of: ${DAY_KEYS.join(', ')}`);
  for (const d of days) {
    if (!DAY_KEYS.includes(d)) fail(`Unknown weekday "${d}" (allowed: ${DAY_KEYS.join(', ')})`);
  }
}

function entityLine(e) {
  return `${e.id}  [${e.status}]  ${e.name}  ` +
    `(${(e.dances || []).join('+') || '—'}; ${(e.categories || []).join(', ')})  ${e.city || '—'}`;
}

function diffChanges(before, after, fields) {
  const changes = {};
  for (const field of fields) {
    const a = JSON.stringify(before[field] ?? null);
    const b = JSON.stringify(after[field] ?? null);
    if (a !== b) changes[field] = { old: before[field] ?? null, new: after[field] ?? null };
  }
  return changes;
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} (y/N) `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

const ENTITY_FIELDS = [
  'name', 'dances', 'categories', 'description', 'lat', 'lng', 'address', 'city',
  'country', 'schedule', 'days_of_week', 'start_date', 'end_date', 'images',
  'socials', 'organizer', 'music', 'artists', 'status', 'locked_fields',
];

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  const actor = opts.actor || defaultActor();
  const store = createStore(PATHS);
  const doc = store.loadEntitiesDoc();
  const now = nowIso();

  switch (command) {
    case 'list': {
      let list = doc.entities;
      if (opts.city) list = list.filter((e) => (e.city || '').toLowerCase() === opts.city.toLowerCase());
      if (opts.category) list = list.filter((e) => (e.categories || []).includes(opts.category));
      if (opts.dance) list = list.filter((e) => (e.dances || []).includes(opts.dance));
      if (opts.status) list = list.filter((e) => e.status === opts.status);
      for (const e of list) console.log(entityLine(e));
      console.log(`${list.length} entit${list.length === 1 ? 'y' : 'ies'}`);
      return;
    }

    case 'show': {
      const entity = findEntity(doc, opts.id || fail('--id is required'));
      console.log(JSON.stringify(entity, null, 2));
      return;
    }

    case 'add': {
      const input = readJsonFile(opts.json);
      if (!input.name) fail('"name" is required');
      validateDances(input.dances);
      validateCategories(input.categories);
      if (input.days_of_week !== undefined) validateDaysOfWeek(input.days_of_week);
      const entity = {
        id: crypto.randomUUID(),
        name: input.name,
        dances: input.dances,
        categories: input.categories,
        description: input.description || '',
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        schedule: input.schedule ?? null,
        days_of_week: input.days_of_week || [],
        start_date: input.start_date ?? null,
        end_date: input.end_date ?? null,
        images: input.images || [],
        socials: input.socials || {},
        organizer: input.organizer ?? null,
        music: input.music || [],
        artists: input.artists || [],
        status: input.status || 'active',
        locked_fields: input.locked_fields || [],
        sources: [
          { source: 'manual', ref: slugify(input.name), url: input.url || null, first_seen: now, last_seen: now },
        ],
        created_at: now,
        updated_at: now,
      };
      doc.entities.push(entity);
      store.audit({
        action: 'create', entityId: entity.id, entityName: entity.name,
        source: 'manual', actor,
        changes: { name: { old: null, new: entity.name }, categories: { old: null, new: entity.categories } },
        context: {},
      });
      store.saveEntitiesDoc(doc);
      store.flushAudit();
      console.log(`Created ${entity.id}  ${entity.name}`);
      return;
    }

    case 'update': {
      const entity = findEntity(doc, opts.id || fail('--id is required'));
      const patch = readJsonFile(opts.json);
      if (patch.categories !== undefined) validateCategories(patch.categories);
      if (patch.dances !== undefined) validateDances(patch.dances);
      if (patch.days_of_week !== undefined) validateDaysOfWeek(patch.days_of_week);
      const before = structuredClone(entity);
      for (const field of ENTITY_FIELDS) {
        if (patch[field] !== undefined) entity[field] = patch[field];
      }
      const changes = diffChanges(before, entity, ENTITY_FIELDS);
      if (Object.keys(changes).length === 0) {
        console.log('Nothing changed.');
        return;
      }
      entity.updated_at = now;
      store.audit({
        action: 'update', entityId: entity.id, entityName: entity.name,
        source: 'manual', actor, changes, context: {},
      });
      store.saveEntitiesDoc(doc);
      store.flushAudit();
      console.log(`Updated ${entity.id}: ${Object.keys(changes).join(', ')}`);
      return;
    }

    case 'archive':
    case 'restore': {
      const entity = findEntity(doc, opts.id || fail('--id is required'));
      const target = command === 'archive' ? 'archived' : 'active';
      if (entity.status === target) {
        console.log(`Already ${target}.`);
        return;
      }
      const old = entity.status;
      entity.status = target;
      entity.updated_at = now;
      store.audit({
        action: command, entityId: entity.id, entityName: entity.name,
        source: 'manual', actor,
        changes: { status: { old, new: target } }, context: {},
      });
      store.saveEntitiesDoc(doc);
      store.flushAudit();
      console.log(`${command === 'archive' ? 'Archived' : 'Restored'} ${entity.name}`);
      return;
    }

    case 'delete': {
      const entity = findEntity(doc, opts.id || fail('--id is required'));
      if (!opts.yes && !(await confirm(`Delete "${entity.name}" (${entity.id}) permanently?`))) {
        console.log('Aborted.');
        return;
      }
      doc.entities = doc.entities.filter((e) => e.id !== entity.id);
      store.audit({
        action: 'delete', entityId: entity.id, entityName: entity.name,
        source: 'manual', actor,
        changes: { status: { old: entity.status, new: null } }, context: {},
      });
      store.saveEntitiesDoc(doc);
      store.flushAudit();
      console.log(`Deleted ${entity.name}`);
      return;
    }

    case 'queue': {
      const queue = store.loadReviewQueue();
      if (queue.items.length === 0) {
        console.log('Review queue is empty.');
        return;
      }
      queue.items.forEach((item, index) => {
        console.log(
          `[${index}] ${item.candidate?.name || '?'}  confidence ${item.confidence}\n` +
          `     dances: ${(item.candidate?.dances || []).join(', ') || '—'}  ` +
          `categories: ${(item.candidate?.categories || []).join(', ') || '—'}  ` +
          `city: ${item.candidate?.city || '—'}\n` +
          `     url: ${item.context?.url || '—'}\n` +
          `     reasons: ${(item.reasons || []).join('; ')}\n` +
          `     first seen ${item.first_seen}, last seen ${item.last_seen}`
        );
      });
      return;
    }

    case 'approve': {
      const queue = store.loadReviewQueue();
      const index = Number(opts.index);
      const item = queue.items[index];
      if (!item) fail(`No queue item at index ${opts.index}`);
      const c = item.candidate || {};
      if (!c.name) fail('Queue item has no candidate name');
      // items queued with "no category detected" need a human-supplied one
      if (opts.categories) {
        c.categories = opts.categories.split(',').map((s) => s.trim()).filter(Boolean);
      }
      validateCategories(c.categories);
      // items queued with "dance unclear" need human-supplied dances
      if (opts.dances) {
        c.dances = opts.dances.split(',').map((s) => s.trim()).filter(Boolean);
      }
      validateDances(c.dances);
      const sourceLabel = item.context?.query
        ? 'scraper:search'
        : `scraper:site:${(() => { try { return new URL(item.context?.url).hostname.replace(/^www\./, ''); } catch { return 'unknown'; } })()}`;
      const entity = {
        id: crypto.randomUUID(),
        name: c.name,
        dances: c.dances,
        categories: c.categories,
        description: c.description || '',
        lat: c.lat ?? null,
        lng: c.lng ?? null,
        address: c.address ?? null,
        city: c.city ?? null,
        country: c.country ?? null,
        schedule: c.schedule ?? null,
        days_of_week: c.days_of_week || [],
        start_date: c.start_date ?? null,
        end_date: c.end_date ?? null,
        images: c.images || [],
        socials: c.socials || {},
        organizer: c.organizer ?? null,
        music: c.music || [],
        artists: c.artists || [],
        status: 'active',
        locked_fields: [],
        sources: [
          {
            source: sourceLabel, ref: slugify(c.name), url: item.context?.url || null,
            first_seen: item.first_seen || now, last_seen: now,
          },
        ],
        created_at: now,
        updated_at: now,
      };
      doc.entities.push(entity);
      queue.items.splice(index, 1);
      store.audit({
        action: 'approve', entityId: entity.id, entityName: entity.name,
        source: 'manual', actor,
        changes: { status: { old: null, new: 'active' } },
        context: item.context || {},
      });
      store.saveEntitiesDoc(doc);
      store.saveReviewQueue(queue);
      store.flushAudit();
      console.log(`Approved → ${entity.id}  ${entity.name}`);
      return;
    }

    case 'reject': {
      const queue = store.loadReviewQueue();
      const index = Number(opts.index);
      const item = queue.items[index];
      if (!item) fail(`No queue item at index ${opts.index}`);
      if (!opts.reason) fail('--reason is required');
      const rejected = store.loadRejected();
      const key = item.key || candidateKey({ ...item.candidate, context: item.context });
      if (!rejected.items.some((r) => r.key === key)) {
        rejected.items.push({ key, reason: opts.reason, ts: now });
      }
      queue.items.splice(index, 1);
      store.audit({
        action: 'reject', entityId: null, entityName: item.candidate?.name || null,
        source: 'manual', actor,
        changes: {},
        context: { ...(item.context || {}), reason: opts.reason },
      });
      store.saveReviewQueue(queue);
      store.saveRejected(rejected);
      store.flushAudit();
      console.log(`Rejected "${item.candidate?.name}" (key: ${key})`);
      return;
    }

    case 'lock':
    case 'unlock': {
      const entity = findEntity(doc, opts.id || fail('--id is required'));
      if (!opts.fields) fail('--fields a,b,c is required');
      const fields = opts.fields.split(',').map((f) => f.trim()).filter(Boolean);
      const old = entity.locked_fields || [];
      const next = command === 'lock'
        ? [...new Set([...old, ...fields])]
        : old.filter((f) => !fields.includes(f));
      if (JSON.stringify(old) === JSON.stringify(next)) {
        console.log('Nothing changed.');
        return;
      }
      entity.locked_fields = next;
      entity.updated_at = now;
      store.audit({
        action: 'update', entityId: entity.id, entityName: entity.name,
        source: 'manual', actor,
        changes: { locked_fields: { old, new: next } }, context: {},
      });
      store.saveEntitiesDoc(doc);
      store.flushAudit();
      console.log(`locked_fields: [${next.join(', ')}]`);
      return;
    }

    default:
      console.error(
        'Usage: node src/admin.js <list|show|add|update|archive|restore|delete|queue|approve|reject|lock|unlock> [options]'
      );
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
