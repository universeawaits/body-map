// Node assertion suite for the pure helpers in src/enrich.js (hashing,
// enrichment-queue upsert/prune, export↔import markdown round-trip).
// Run: node test/enrich.test.js (from scraper/; plain node:assert).

import assert from 'node:assert/strict';
import { sha256, updateEnrichmentQueue, parseImportFile } from '../src/enrich.js';

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

ok('sha256: stable for the same text, differs for different text', () => {
  assert.equal(sha256('A weekly tango social.'), sha256('A weekly tango social.'));
  assert.notEqual(sha256('A weekly tango social.'), sha256('A weekly bachata social.'));
});

ok('updateEnrichmentQueue: adds a new item for an active entity with no summary yet', () => {
  const doc = {
    entities: [{ id: 'e1', name: 'La Milonga', status: 'active', description: 'A weekly tango social.', summary: null }],
  };
  const queue = { generated: null, items: [] };
  const stats = updateEnrichmentQueue({ doc, queue, now: '2026-01-01T00:00:00Z' });
  assert.equal(stats.pending, 1);
  assert.equal(queue.items[0].entity_id, 'e1');
  assert.equal(queue.items[0].source_hash, sha256('A weekly tango social.'));
  assert.equal(queue.items[0].first_seen, '2026-01-01T00:00:00Z');
});

ok('updateEnrichmentQueue: bumps last_seen but keeps first_seen on a repeat run', () => {
  const doc = {
    entities: [{ id: 'e1', name: 'La Milonga', status: 'active', description: 'A weekly tango social.', summary: null }],
  };
  const queue = {
    generated: null,
    items: [{
      entity_id: 'e1', entity_name: 'La Milonga',
      source_text: 'A weekly tango social.', source_hash: sha256('A weekly tango social.'),
      first_seen: '2025-01-01T00:00:00Z', last_seen: '2025-01-01T00:00:00Z',
    }],
  };
  const stats = updateEnrichmentQueue({ doc, queue, now: '2026-01-01T00:00:00Z' });
  assert.equal(stats.pending, 1);
  assert.equal(queue.items[0].first_seen, '2025-01-01T00:00:00Z');
  assert.equal(queue.items[0].last_seen, '2026-01-01T00:00:00Z');
});

ok('updateEnrichmentQueue: prunes an item once a fresh summary exists', () => {
  const text = 'A weekly tango social.';
  const doc = {
    entities: [{
      id: 'e1', name: 'La Milonga', status: 'active', description: text,
      summary: { text: 'A cosy weekly tango gathering.', source_hash: sha256(text), generated_at: '2026-01-01T00:00:00Z' },
    }],
  };
  const queue = {
    generated: null,
    items: [{
      entity_id: 'e1', entity_name: 'La Milonga',
      source_text: text, source_hash: sha256(text),
      first_seen: '2025-01-01T00:00:00Z', last_seen: '2025-06-01T00:00:00Z',
    }],
  };
  const stats = updateEnrichmentQueue({ doc, queue, now: '2026-01-01T00:00:00Z' });
  assert.equal(stats.pending, 0);
  assert.equal(queue.items.length, 0);
});

ok('updateEnrichmentQueue: a stale summary (description re-scraped since) is re-queued', () => {
  const doc = {
    entities: [{
      id: 'e1', name: 'La Milonga', status: 'active', description: 'A weekly tango social — new address.',
      summary: { text: 'Old summary.', source_hash: sha256('A weekly tango social.'), generated_at: '2025-01-01T00:00:00Z' },
    }],
  };
  const queue = { generated: null, items: [] };
  const stats = updateEnrichmentQueue({ doc, queue, now: '2026-01-01T00:00:00Z' });
  assert.equal(stats.pending, 1);
  assert.equal(queue.items[0].source_hash, sha256('A weekly tango social — new address.'));
});

ok('updateEnrichmentQueue: drops items for entities that are archived or gone', () => {
  const doc = { entities: [{ id: 'e1', name: 'Gone', status: 'archived', description: 'Text.', summary: null }] };
  const queue = {
    generated: null,
    items: [{
      entity_id: 'e1', entity_name: 'Gone',
      source_text: 'Text.', source_hash: sha256('Text.'),
      first_seen: '2025-01-01T00:00:00Z', last_seen: '2025-01-01T00:00:00Z',
    }, {
      entity_id: 'e2', entity_name: 'Deleted',
      source_text: 'Other.', source_hash: sha256('Other.'),
      first_seen: '2025-01-01T00:00:00Z', last_seen: '2025-01-01T00:00:00Z',
    }],
  };
  const stats = updateEnrichmentQueue({ doc, queue, now: '2026-01-01T00:00:00Z' });
  assert.equal(stats.pending, 0);
  assert.equal(queue.items.length, 0);
});

ok('export/import markdown round-trip: one block parses back exactly', () => {
  const item = {
    entity_id: 'abc-123',
    entity_name: 'La Milonga',
    source_text: 'milonga every saturday 22:30 old town venue lots of tandas',
  };
  const block =
    `### ${item.entity_id} · ${item.entity_name}\n\n` +
    '```\n' + item.source_text + '\n```\n\n' +
    '> summary:\n\nA traditional Saturday-night milonga in the old town.\n';

  const parsed = parseImportFile(block);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].entityId, item.entity_id);
  assert.equal(parsed[0].entityName, item.entity_name);
  assert.equal(parsed[0].sourceText, item.source_text);
  assert.equal(parsed[0].summaryText, 'A traditional Saturday-night milonga in the old town.');
});

ok('export/import markdown round-trip: multiple blocks parse independently', () => {
  const md =
    '### id-1 · La Milonga\n\n```\nHello world\n```\n\n> summary:\n\nA short summary.\n\n' +
    '### id-2 · El Beso\n\n```\nOther text\n```\n\n> summary:\n\nAnother summary.\n';
  const parsed = parseImportFile(md);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].entityId, 'id-1');
  assert.equal(parsed[0].summaryText, 'A short summary.');
  assert.equal(parsed[1].entityId, 'id-2');
  assert.equal(parsed[1].summaryText, 'Another summary.');
});

ok('import validation: a block whose source text no longer matches current entity text is stale', () => {
  const currentText = 'A weekly tango social — now with a new address.';
  const blockSourceText = 'A weekly tango social.';
  assert.notEqual(sha256(currentText), sha256(blockSourceText));
});

ok('import validation: a blank summary is treated as not provided', () => {
  const md = '### id-1 · La Milonga\n\n```\nHello world\n```\n\n> summary:\n\n   \n';
  const parsed = parseImportFile(md);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].summaryText.trim(), '');
});

console.log(`\n${passed} assertion groups passed`);
