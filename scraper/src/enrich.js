// Local-only entity-summary enrichment pipeline (§11). Never invoked from CI
// — the export/import round-trip goes through the user's own AI subscription
// by hand, mirroring src/translate.js exactly. Detection
// (data/enrichment-queue.json) is produced by src/index.js's
// enrichment-queue-diff step; this CLI only reads/writes it.
//
//   node src/enrich.js queue
//   node src/enrich.js export --out path/to/batch.md [--limit N]
//   node src/enrich.js import --file path/to/batch.md

import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PATHS } from './paths.js';
import { createStore, nowIso } from './store.js';

export function sha256(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

// Diff active entities' description against entity.summary and rebuild the
// enrichment queue in place: upsert an item per entity whose description is
// missing a fresh summary, drop items now enriched or whose entity no longer
// exists / went inactive. Used by both src/index.js (after every scrape) and
// this CLI's callers/tests. Unlike translate.js's per-(entity,field,lang)
// queue, there's no fan-out dimension here — one field, one summary.
export function updateEnrichmentQueue({ doc, queue, now }) {
  const priorByKey = new Map(queue.items.map((item) => [item.entity_id, item]));
  const nextItems = [];

  for (const entity of doc.entities) {
    if (entity.status !== 'active') continue;
    const text = entity.description;
    if (!text || !String(text).trim()) continue;
    const hash = sha256(text);
    if (entity.summary?.source_hash === hash) continue; // already enriched and fresh
    const prior = priorByKey.get(entity.id);
    nextItems.push({
      entity_id: entity.id,
      entity_name: entity.name,
      source_text: text,
      source_hash: hash,
      first_seen: prior?.first_seen || now,
      last_seen: now,
    });
  }

  const stats = { pending: nextItems.length, delta: nextItems.length - queue.items.length };
  queue.items = nextItems;
  return stats;
}

const HEADING_RE = /^###\s+(.+?)\s+·\s+(.+?)\s*$/;

function formatBlock(item) {
  return (
    `### ${item.entity_id} · ${item.entity_name}\n\n` +
    '```\n' + String(item.source_text ?? '').replace(/\s+$/, '') + '\n```\n\n' +
    '> summary:\n\n'
  );
}

// Prepended once to an exported batch — summarization needs a style/length
// contract the way "translate to German" doesn't. Kept in sync with the
// worked example in docs/enrichment-plan.md.
const PROMPT_HEADER =
  '# Body Map — entity summary enrichment\n' +
  '#\n' +
  '# For each block below, replace the text after "> summary:" with a clean,\n' +
  '# factual 1-2 sentence English summary of the event or venue, based only on\n' +
  '# the raw scraped text in the fenced code block. Keep proper nouns (names,\n' +
  '# places, DJ/artist names) verbatim; do not invent details not present in\n' +
  '# the source text; do not translate — English stays the source language,\n' +
  '# the existing translation pipeline (translate.js) handles other languages\n' +
  '# from here.\n' +
  '#\n' +
  '# When done, run: node src/enrich.js import --file <this file>\n\n';

// Parses the exact shape formatBlock() emits, back into
// [{entityId, entityName, sourceText, summaryText}, …].
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
    const [, entityId, entityName] = heading;
    i += 1;
    const bodyLines = [];
    while (i < lines.length && !HEADING_RE.test(lines[i])) {
      bodyLines.push(lines[i]);
      i += 1;
    }
    const body = bodyLines.join('\n');
    const fence = body.match(/```\n([\s\S]*?)\n```/);
    const sourceText = fence ? fence[1] : '';
    const marker = '> summary:';
    const markerIdx = body.indexOf(marker);
    const summaryText = markerIdx === -1 ? '' : body.slice(markerIdx + marker.length).trim();
    blocks.push({ entityId, entityName, sourceText, summaryText });
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
      const queue = store.loadEnrichmentQueue();
      if (queue.items.length === 0) {
        console.log('No pending enrichments.');
        return;
      }
      queue.items.forEach((item, index) => {
        console.log(
          `[${index}] ${item.entity_name}\n` +
          `     text: ${firstWords(item.source_text)}\n` +
          `     first seen ${item.first_seen}, last seen ${item.last_seen}`
        );
      });
      console.log(`${queue.items.length} item(s) pending`);
      return;
    }

    case 'export': {
      if (!opts.out) fail('--out <file> is required');
      let limit = null;
      if (opts.limit !== undefined) {
        limit = Number(opts.limit);
        if (!Number.isInteger(limit) || limit < 1) fail('--limit expects a positive integer');
      }

      const queue = store.loadEnrichmentQueue();
      const items = limit != null ? queue.items.slice(0, limit) : queue.items;
      const blocks = items.map(formatBlock);

      fs.writeFileSync(opts.out, PROMPT_HEADER + blocks.join(''));
      console.log(`Wrote ${blocks.length} block(s) to ${opts.out}`);
      return;
    }

    case 'import': {
      if (!opts.file) fail('--file <file> is required');
      if (!fs.existsSync(opts.file)) fail(`File not found: ${opts.file}`);
      const parsed = parseImportFile(fs.readFileSync(opts.file, 'utf8'));

      const doc = store.loadEntitiesDoc();
      const queue = store.loadEnrichmentQueue();
      const byId = new Map(doc.entities.map((e) => [e.id, e]));
      const now = nowIso();

      let merged = 0;
      let staleCount = 0;
      let blankCount = 0;
      const touched = new Map(); // entityId -> {entity, changes}

      for (const block of parsed) {
        const entity = byId.get(block.entityId);
        if (!entity) {
          console.warn(`skip ${block.entityId}: entity not found`);
          continue;
        }
        const currentHash = sha256(entity.description);
        if (currentHash !== sha256(block.sourceText)) {
          console.warn(`${entity.name}: stale, re-export`);
          staleCount += 1;
          continue;
        }
        if (!block.summaryText || !block.summaryText.trim()) {
          console.warn(`${entity.name}: no summary provided`);
          blankCount += 1;
          continue;
        }

        const previous = entity.summary?.text ?? null;
        entity.summary = { text: block.summaryText, source_hash: currentHash, generated_at: now };
        entity.updated_at = now;
        merged += 1;

        touched.set(entity.id, { entity, changes: { summary: { old: previous, new: block.summaryText } } });
      }

      for (const { entity, changes } of touched.values()) {
        store.audit({
          action: 'update', entityId: entity.id, entityName: entity.name,
          source: 'enrich-import', actor: 'local', changes, context: {},
        });
      }

      queue.items = queue.items.filter((item) => {
        const entity = byId.get(item.entity_id);
        if (!entity || entity.status !== 'active') return false;
        return entity.summary?.source_hash !== sha256(entity.description);
      });

      store.saveEntitiesDoc(doc);
      store.saveEnrichmentQueue(queue);
      store.flushAudit();
      console.log(`Merged ${merged} summary(ies), ${staleCount} skipped as stale, ${blankCount} skipped as blank`);
      return;
    }

    default:
      console.error('Usage: node src/enrich.js <queue|export|import> [options]');
      process.exit(2);
  }
}

// Guarded (unlike admin.js/index.js) so enrich.test.js can import the pure
// helpers above (sha256, parseImportFile, …) without running the CLI.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
