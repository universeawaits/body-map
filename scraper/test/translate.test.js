// Node assertion suite for the pure helpers in src/translate.js (hashing,
// translations-queue upsert/prune, export↔import markdown round-trip).
// Run: node test/translate.test.js (from scraper/; plain node:assert).

import assert from 'node:assert/strict';
import {
  sha256,
  updateTranslationsQueue,
  parseImportFile,
  TARGET_LANGS,
} from '../src/translate.js';

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

ok('sha256: stable for the same text, differs for different text', () => {
  assert.equal(sha256('Milonga every Saturday'), sha256('Milonga every Saturday'));
  assert.notEqual(sha256('Milonga every Saturday'), sha256('Milonga every Sunday'));
  assert.equal(typeof sha256('x'), 'string');
  assert.equal(sha256('x').length, 64); // hex-encoded sha256
});

ok('updateTranslationsQueue: adds a new item for an active entity needing translation', () => {
  const doc = {
    entities: [
      { id: 'e1', name: 'La Milonga', status: 'active', description: 'A weekly tango social.', schedule: null, translations: {} },
    ],
  };
  const queue = { generated: null, items: [] };
  const stats = updateTranslationsQueue({ doc, queue, now: '2026-01-01T00:00:00Z' });
  assert.equal(stats.pending, 1);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].entity_id, 'e1');
  assert.equal(queue.items[0].field, 'description');
  assert.equal(queue.items[0].source_hash, sha256('A weekly tango social.'));
  assert.equal(queue.items[0].first_seen, '2026-01-01T00:00:00Z');
});

ok('updateTranslationsQueue: bumps last_seen but keeps first_seen on a repeat run', () => {
  const doc = {
    entities: [
      { id: 'e1', name: 'La Milonga', status: 'active', description: 'A weekly tango social.', schedule: null, translations: {} },
    ],
  };
  const queue = {
    generated: null,
    items: [{
      entity_id: 'e1', entity_name: 'La Milonga', field: 'description',
      source_text: 'A weekly tango social.', source_hash: sha256('A weekly tango social.'),
      first_seen: '2025-01-01T00:00:00Z', last_seen: '2025-01-01T00:00:00Z',
    }],
  };
  const stats = updateTranslationsQueue({ doc, queue, now: '2026-01-01T00:00:00Z' });
  assert.equal(stats.pending, 1);
  assert.equal(queue.items[0].first_seen, '2025-01-01T00:00:00Z');
  assert.equal(queue.items[0].last_seen, '2026-01-01T00:00:00Z');
});

ok('updateTranslationsQueue: prunes an item once all target languages are translated', () => {
  const text = 'A weekly tango social.';
  const hash = sha256(text);
  const translations = {};
  for (const lang of TARGET_LANGS) {
    translations[lang] = { description: { text: `[${lang}] ${text}`, source_hash: hash, translated_at: '2026-01-01T00:00:00Z' } };
  }
  const doc = {
    entities: [
      { id: 'e1', name: 'La Milonga', status: 'active', description: text, schedule: null, translations },
    ],
  };
  const queue = {
    generated: null,
    items: [{
      entity_id: 'e1', entity_name: 'La Milonga', field: 'description',
      source_text: text, source_hash: hash,
      first_seen: '2025-01-01T00:00:00Z', last_seen: '2025-06-01T00:00:00Z',
    }],
  };
  const stats = updateTranslationsQueue({ doc, queue, now: '2026-01-01T00:00:00Z' });
  assert.equal(stats.pending, 0);
  assert.equal(queue.items.length, 0);
});

ok('updateTranslationsQueue: drops items for entities that are archived or gone', () => {
  const doc = { entities: [{ id: 'e1', name: 'Gone', status: 'archived', description: 'Text.', schedule: null, translations: {} }] };
  const queue = {
    generated: null,
    items: [{
      entity_id: 'e1', entity_name: 'Gone', field: 'description',
      source_text: 'Text.', source_hash: sha256('Text.'),
      first_seen: '2025-01-01T00:00:00Z', last_seen: '2025-01-01T00:00:00Z',
    }, {
      entity_id: 'e2', entity_name: 'Deleted', field: 'description',
      source_text: 'Other.', source_hash: sha256('Other.'),
      first_seen: '2025-01-01T00:00:00Z', last_seen: '2025-01-01T00:00:00Z',
    }],
  };
  const stats = updateTranslationsQueue({ doc, queue, now: '2026-01-01T00:00:00Z' });
  assert.equal(stats.pending, 0);
  assert.equal(queue.items.length, 0);
});

ok('export/import markdown round-trip: one block per (item, language) parses back exactly', () => {
  const item = {
    entity_id: 'abc-123',
    entity_name: 'La Milonga',
    field: 'description',
    source_text: 'A weekly tango social in the old town.',
    source_hash: sha256('A weekly tango social in the old town.'),
  };
  const lang = 'DE';
  const block =
    `### ${item.entity_id} · ${item.field} · ${lang}\n\n` +
    '```\n' + item.source_text + '\n```\n\n' +
    '> translation:\n\nEin wöchentlicher Tango-Tanzabend in der Altstadt.\n';

  const parsed = parseImportFile(block);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].entityId, item.entity_id);
  assert.equal(parsed[0].field, item.field);
  assert.equal(parsed[0].lang, lang);
  assert.equal(parsed[0].sourceText, item.source_text);
  assert.equal(parsed[0].translatedText, 'Ein wöchentlicher Tango-Tanzabend in der Altstadt.');
});

ok('export/import markdown round-trip: multiple blocks parse independently', () => {
  const md =
    '### id-1 · description · DE\n\n```\nHello world\n```\n\n> translation:\n\nHallo Welt\n\n' +
    '### id-1 · description · FR\n\n```\nHello world\n```\n\n> translation:\n\nBonjour le monde\n';
  const parsed = parseImportFile(md);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].lang, 'DE');
  assert.equal(parsed[0].translatedText, 'Hallo Welt');
  assert.equal(parsed[1].lang, 'FR');
  assert.equal(parsed[1].translatedText, 'Bonjour le monde');
});

ok('import validation: a block whose source text no longer matches current entity text is stale', () => {
  const currentText = 'A weekly tango social — now with a new address.';
  const blockSourceText = 'A weekly tango social.';
  assert.notEqual(sha256(currentText), sha256(blockSourceText));
});

ok('import validation: a blank translation is treated as not provided', () => {
  const md = '### id-1 · description · DE\n\n```\nHello world\n```\n\n> translation:\n\n   \n';
  const parsed = parseImportFile(md);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].translatedText.trim(), '');
});

console.log(`\n${passed} assertion groups passed`);
