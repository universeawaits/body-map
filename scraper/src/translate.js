// Local-only translation pipeline for entity description/schedule text (§10).
// Never invoked from CI — the export/import round-trip goes through the
// user's own AI subscription by hand. Detection (data/translations-queue.json)
// is produced by src/index.js's translations-queue-diff step; this CLI only
// reads/writes it.
//
//   node src/translate.js queue
//   node src/translate.js export --out path/to/batch.md [--lang de] [--limit N]
//   node src/translate.js import --file path/to/batch.md

import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PATHS } from './paths.js';
import { createStore, nowIso } from './store.js';

// §10: interface languages. EN is the source language for entity content —
// it never needs a queue item or an export block of its own.
export const LANG_CODES = ['EN', 'DE', 'ES', 'PT', 'IT', 'RU', 'UK', 'ZH', 'JA', 'KO', 'FR'];
export const TARGET_LANGS = LANG_CODES.filter((l) => l !== 'EN');

// 'summary' (§11) supersedes 'description' once an entity has one — see the
// skip in updateTranslationsQueue below.
export const TRANSLATABLE_FIELDS = ['description', 'schedule', 'summary'];

export function sha256(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

// description/schedule are plain strings; summary (§11) is a leaf object
// {text, source_hash, generated_at} like a translations entry — normalize
// either shape to plain text so hashing/staleness works the same for all
// three fields instead of hashing "[object Object]" for summary.
export function sourceTextOf(entity, field) {
  const raw = entity?.[field];
  return raw && typeof raw === 'object' ? raw.text ?? '' : raw ?? '';
}

// Diff active entities' description/schedule against entity.translations and
// rebuild the translations queue in place: upsert an item per (entity, field)
// still missing/stale in any target language, drop items that are now fully
// translated or whose entity no longer exists / went inactive. Used by both
// src/index.js (after every scrape) and this CLI's callers/tests.
export function updateTranslationsQueue({ doc, queue, now }) {
  const priorByKey = new Map(queue.items.map((item) => [`${item.entity_id}|${item.field}`, item]));
  const nextItems = [];

  for (const entity of doc.entities) {
    if (entity.status !== 'active') continue;
    for (const field of TRANSLATABLE_FIELDS) {
      // Once an entity has an AI-polished summary, its raw description is
      // superseded — never shown again (map.js prefers summary), so don't
      // spend translation effort on text nobody will see.
      if (field === 'description' && entity.summary?.text) continue;
      const text = sourceTextOf(entity, field);
      if (!text || !String(text).trim()) continue;
      const hash = sha256(text);
      const missing = TARGET_LANGS.some((lang) => entity.translations?.[lang]?.[field]?.source_hash !== hash);
      if (!missing) continue;
      const prior = priorByKey.get(`${entity.id}|${field}`);
      nextItems.push({
        entity_id: entity.id,
        entity_name: entity.name,
        field,
        source_text: text,
        source_hash: hash,
        first_seen: prior?.first_seen || now,
        last_seen: now,
      });
    }
  }

  const stats = { pending: nextItems.length, delta: nextItems.length - queue.items.length };
  queue.items = nextItems;
  return stats;
}

const HEADING_RE = /^###\s+(.+?)\s+·\s+(.+?)\s+·\s+(.+?)\s*$/;

function formatBlock(item, lang) {
  return (
    `### ${item.entity_id} · ${item.field} · ${lang}\n\n` +
    '```\n' + String(item.source_text ?? '').replace(/\s+$/, '') + '\n```\n\n' +
    '> translation:\n\n'
  );
}

// Parses the exact shape formatBlock() emits, back into
// [{entityId, field, lang, sourceText, translatedText}, …].
export function parseImportFile(content) {
  const lines = String(content ?? '').split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const heading = lines[i].match(HEADING_RE);
    if (!heading) {
      i += 1;
      continue;
    }
    const [, entityId, field, lang] = heading;
    i += 1;
    const bodyLines = [];
    while (i < lines.length && !HEADING_RE.test(lines[i])) {
      bodyLines.push(lines[i]);
      i += 1;
    }
    const body = bodyLines.join('\n');
    const fence = body.match(/```\n([\s\S]*?)\n```/);
    const sourceText = fence ? fence[1] : '';
    const marker = '> translation:';
    const markerIdx = body.indexOf(marker);
    const translatedText = markerIdx === -1 ? '' : body.slice(markerIdx + marker.length).trim();
    blocks.push({ entityId, field, lang, sourceText, translatedText });
  }
  return blocks;
}

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

function firstWords(text, n = 12) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const preview = words.slice(0, n).join(' ');
  return words.length > n ? `${preview}…` : preview;
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  const store = createStore(PATHS);

  switch (command) {
    case 'queue': {
      const queue = store.loadTranslationsQueue();
      if (queue.items.length === 0) {
        console.log('No pending translations.');
        return;
      }
      const doc = store.loadEntitiesDoc();
      const byId = new Map(doc.entities.map((e) => [e.id, e]));
      queue.items.forEach((item, index) => {
        const entity = byId.get(item.entity_id);
        const missing = TARGET_LANGS.filter(
          (lang) => entity?.translations?.[lang]?.[item.field]?.source_hash !== item.source_hash
        );
        console.log(
          `[${index}] ${item.entity_name}  field: ${item.field}\n` +
          `     missing: ${missing.join(', ') || '—'}\n` +
          `     text: ${firstWords(item.source_text)}\n` +
          `     first seen ${item.first_seen}, last seen ${item.last_seen}`
        );
      });
      console.log(`${queue.items.length} item(s) pending`);
      return;
    }

    case 'export': {
      if (!opts.out) fail('--out <file> is required');
      let langs = TARGET_LANGS;
      if (opts.lang) {
        const lang = opts.lang.toUpperCase();
        if (!TARGET_LANGS.includes(lang)) fail(`Unknown language "${opts.lang}" (allowed: ${TARGET_LANGS.join(', ')})`);
        langs = [lang];
      }
      let limit = null;
      if (opts.limit !== undefined) {
        limit = Number(opts.limit);
        if (!Number.isInteger(limit) || limit < 1) fail('--limit expects a positive integer');
      }

      const queue = store.loadTranslationsQueue();
      const doc = store.loadEntitiesDoc();
      const byId = new Map(doc.entities.map((e) => [e.id, e]));

      const blocks = [];
      outer:
      for (const item of queue.items) {
        const entity = byId.get(item.entity_id);
        for (const lang of langs) {
          const already = entity?.translations?.[lang]?.[item.field]?.source_hash === item.source_hash;
          if (already) continue;
          blocks.push(formatBlock(item, lang));
          if (limit != null && blocks.length >= limit) break outer;
        }
      }

      fs.writeFileSync(opts.out, blocks.join(''));
      console.log(`Wrote ${blocks.length} block(s) to ${opts.out}`);
      return;
    }

    case 'import': {
      if (!opts.file) fail('--file <file> is required');
      if (!fs.existsSync(opts.file)) fail(`File not found: ${opts.file}`);
      const parsed = parseImportFile(fs.readFileSync(opts.file, 'utf8'));

      const doc = store.loadEntitiesDoc();
      const queue = store.loadTranslationsQueue();
      const byId = new Map(doc.entities.map((e) => [e.id, e]));
      const now = nowIso();

      let merged = 0;
      let staleCount = 0;
      let blankCount = 0;
      const touched = new Map(); // entityId -> {entity, changes}

      for (const block of parsed) {
        const entity = byId.get(block.entityId);
        if (!entity) {
          console.warn(`skip ${block.entityId} · ${block.field} · ${block.lang}: entity not found`);
          continue;
        }
        const currentHash = sha256(sourceTextOf(entity, block.field));
        if (currentHash !== sha256(block.sourceText)) {
          console.warn(`${entity.name} · ${block.field} · ${block.lang}: stale, re-export`);
          staleCount += 1;
          continue;
        }
        if (!block.translatedText || !block.translatedText.trim()) {
          console.warn(`${entity.name} · ${block.field} · ${block.lang}: no translation provided`);
          blankCount += 1;
          continue;
        }

        entity.translations = entity.translations || {};
        entity.translations[block.lang] = entity.translations[block.lang] || {};
        const previous = entity.translations[block.lang][block.field]?.text ?? null;
        entity.translations[block.lang][block.field] = {
          text: block.translatedText,
          source_hash: currentHash,
          translated_at: now,
        };
        entity.updated_at = now;
        merged += 1;

        let bucket = touched.get(entity.id);
        if (!bucket) {
          bucket = { entity, changes: {} };
          touched.set(entity.id, bucket);
        }
        bucket.changes[`translations.${block.lang}.${block.field}`] = { old: previous, new: block.translatedText };
      }

      for (const { entity, changes } of touched.values()) {
        store.audit({
          action: 'update', entityId: entity.id, entityName: entity.name,
          source: 'translate-import', actor: 'local', changes, context: {},
        });
      }

      queue.items = queue.items.filter((item) => {
        const entity = byId.get(item.entity_id);
        if (!entity || entity.status !== 'active') return false;
        const hash = sha256(sourceTextOf(entity, item.field));
        return TARGET_LANGS.some((lang) => entity.translations?.[lang]?.[item.field]?.source_hash !== hash);
      });

      store.saveEntitiesDoc(doc);
      store.saveTranslationsQueue(queue);
      store.flushAudit();
      console.log(`Merged ${merged} translation(s), ${staleCount} skipped as stale, ${blankCount} skipped as blank`);
      return;
    }

    default:
      console.error('Usage: node src/translate.js <queue|export|import> [options]');
      process.exit(2);
  }
}

// Guarded (unlike admin.js/index.js) so translate.test.js can import the pure
// helpers above (sha256, parseImportFile, …) without running the CLI.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
