// Node assertion suite for the pure text-parsing helpers in src/extract.js.
// Run: node test/extract.test.js (from scraper/; plain node:assert).

import assert from 'node:assert/strict';
import { parseDaysOfWeek, parseDatesFromText } from '../src/extract.js';

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

ok('parseDaysOfWeek: plural day names (the common announcement form)', () => {
  assert.deepEqual(parseDaysOfWeek('Saturdays from 22:30'), ['sat']);
  assert.deepEqual(parseDaysOfWeek('Thursdays and Sundays from 18:00'), ['thu', 'sun']);
  assert.deepEqual(parseDaysOfWeek('Wednesdays 21:00-23:00'), ['wed']);
  assert.deepEqual(parseDaysOfWeek('sabados y domingos'), ['sat', 'sun']);
  assert.deepEqual(parseDaysOfWeek('los sábados 22:00'), ['sat']);
  assert.deepEqual(parseDaysOfWeek('lundis et mercredis'), ['mon', 'wed']);
  assert.deepEqual(parseDaysOfWeek('Mondays from 19:00'), ['mon']);
});

ok('parseDaysOfWeek: singular names, ranges and lists still resolve', () => {
  assert.deepEqual(parseDaysOfWeek('every Monday 20:00'), ['mon']);
  assert.deepEqual(parseDaysOfWeek('Wed-Sun from 23:30'), ['wed', 'thu', 'fri', 'sat', 'sun']);
  assert.deepEqual(parseDaysOfWeek('Mon-Fri'), ['mon', 'tue', 'wed', 'thu', 'fri']);
  assert.deepEqual(parseDaysOfWeek('Mon, Wed 20:00'), ['mon', 'wed']);
  assert.deepEqual(parseDaysOfWeek('Mon 20:00'), ['mon']);
  assert.deepEqual(parseDaysOfWeek('lun-vie 19:00'), ['mon', 'tue', 'wed', 'thu', 'fri']);
});

ok('parseDaysOfWeek: guarded tokens need range/list/time context', () => {
  // French possessive "mon" must not add Monday ("mon" is guarded)
  assert.deepEqual(parseDaysOfWeek('Rejoignez mon cours de tango le jeudi'), ['thu']);
  // French date "5 mars 20:00" must not read as Tuesday ("mars" ≠ "mar")
  assert.deepEqual(parseDaysOfWeek('le 5 mars 20:00'), []);
  assert.deepEqual(parseDaysOfWeek(''), []);
  assert.deepEqual(parseDaysOfWeek(null), []);
});

ok('parseDatesFromText: month-aware validation rejects impossible dates', () => {
  assert.deepEqual(parseDatesFromText('29-31 February 2026'), { start: null, end: null });
  assert.deepEqual(parseDatesFromText('2026-02-31'), { start: null, end: null });
  assert.deepEqual(parseDatesFromText('27-29 February 2024'), {
    start: '2024-02-27',
    end: '2024-02-29', // 2024 is a leap year — the 29th is real
  });
  assert.deepEqual(parseDatesFromText('12-15 March 2026'), {
    start: '2026-03-12',
    end: '2026-03-15',
  });
});

console.log(`\n${passed} assertion groups passed`);
