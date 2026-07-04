// Node assertion suite for the pure helpers in src/crawl.js (query-list
// building, per-country city flattening, dance interleaving, rotation).
// Run: node test/crawl.test.js (from scraper/; plain node:assert).

import assert from 'node:assert/strict';
import { buildQueryList, flattenCities, interleaveByDance, rotateQueryList, isBlocked } from '../src/crawl.js';

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

ok('flattenCities: passes a flat array through unchanged (legacy shape)', () => {
  assert.deepEqual(flattenCities(['Berlin', 'Paris']), ['Berlin', 'Paris']);
});

ok('flattenCities: flattens a per-country object (§8 v3 shape)', () => {
  assert.deepEqual(
    flattenCities({ Germany: ['Berlin'], France: ['Paris', 'Lyon'] }),
    ['Berlin', 'Paris', 'Lyon']
  );
});

ok('flattenCities: null/undefined/garbage all degrade to an empty list', () => {
  assert.deepEqual(flattenCities(null), []);
  assert.deepEqual(flattenCities(undefined), []);
  assert.deepEqual(flattenCities('nope'), []);
});

const QUERIES = {
  cities: { Testland: ['Alpha', 'Beta'] },
  domain_blocklist: ['facebook.com'],
  dances: {
    tango: { templates: ['tango {city}', 'no-city tango query'], standing_queries: ['tango standing'] },
    salsa: { templates: ['salsa {city}'], standing_queries: [] },
  },
};

ok('buildQueryList: expands {city} templates across every city, tags dance + city', () => {
  const list = buildQueryList(QUERIES);
  assert.deepEqual(list, [
    { query: 'tango Alpha', dance: 'tango', city: 'Alpha' },
    { query: 'tango Beta', dance: 'tango', city: 'Beta' },
    { query: 'no-city tango query', dance: 'tango', city: null },
    { query: 'tango standing', dance: 'tango', city: null },
    { query: 'salsa Alpha', dance: 'salsa', city: 'Alpha' },
    { query: 'salsa Beta', dance: 'salsa', city: 'Beta' },
  ]);
});

ok('buildQueryList: de-dupes identical query strings across dances', () => {
  const list = buildQueryList({
    cities: [],
    dances: {
      a: { templates: ['same query'], standing_queries: [] },
      b: { templates: ['same query'], standing_queries: [] },
    },
  });
  assert.equal(list.length, 1);
});

ok('buildQueryList: an ad-hoc query short-circuits, ignoring cities/dances entirely', () => {
  assert.deepEqual(buildQueryList(QUERIES, 'ad hoc query'), [
    { query: 'ad hoc query', dance: null, city: null },
  ]);
});

ok('buildQueryList: missing/malformed "dances" degrades to an empty list', () => {
  assert.deepEqual(buildQueryList(null), []);
  assert.deepEqual(buildQueryList({}), []);
  assert.deepEqual(buildQueryList({ dances: 'nope' }), []);
});

ok('interleaveByDance: round-robins across dances, preserving each dance\'s own order', () => {
  const list = [
    { query: 't1', dance: 'tango' },
    { query: 't2', dance: 'tango' },
    { query: 't3', dance: 'tango' },
    { query: 's1', dance: 'salsa' },
  ];
  assert.deepEqual(
    interleaveByDance(list).map((i) => i.query),
    ['t1', 's1', 't2', 't3']
  );
});

ok('interleaveByDance: empty input stays empty', () => {
  assert.deepEqual(interleaveByDance([]), []);
});

ok('rotateQueryList: offset 0 is a no-op', () => {
  assert.deepEqual(rotateQueryList([1, 2, 3], 0), [1, 2, 3]);
});

ok('rotateQueryList: wraps around at the list length', () => {
  assert.deepEqual(rotateQueryList([1, 2, 3, 4], 2), [3, 4, 1, 2]);
});

ok('rotateQueryList: an offset larger than the length still wraps correctly', () => {
  assert.deepEqual(rotateQueryList([1, 2, 3], 7), rotateQueryList([1, 2, 3], 1));
});

ok('rotateQueryList: a negative offset wraps backward correctly', () => {
  assert.deepEqual(rotateQueryList([1, 2, 3, 4], -1), [4, 1, 2, 3]);
});

ok('rotateQueryList: an empty list is returned unchanged regardless of offset', () => {
  assert.deepEqual(rotateQueryList([], 5), []);
});

ok('isBlocked: exact host match and subdomain match, case-insensitive', () => {
  assert.equal(isBlocked('https://Facebook.com/x', ['facebook.com']), true);
  assert.equal(isBlocked('https://m.facebook.com/x', ['facebook.com']), true);
  assert.equal(isBlocked('https://example.com/x', ['facebook.com']), false);
});

console.log(`\n${passed} assertion groups passed`);
