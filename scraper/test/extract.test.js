// Node assertion suite for the pure text-parsing helpers in src/extract.js.
// Run: node test/extract.test.js (from scraper/; plain node:assert).

import assert from 'node:assert/strict';
import { parseDaysOfWeek, parseDatesFromText, findPricing } from '../src/extract.js';

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

ok('findPricing: currency symbol + amount, with and without a range', () => {
  assert.deepEqual(findPricing('Entry is €10, €15 after midnight'), { text: '€10', currency: 'EUR' });
  assert.deepEqual(findPricing('Tickets €10-15 on the door'), { text: '€10-15', currency: 'EUR' });
  assert.deepEqual(findPricing('Admission £5.50'), { text: '£5.50', currency: 'GBP' });
});

ok('findPricing: "$" is captured as text but currency stays null (ambiguous symbol)', () => {
  assert.deepEqual(findPricing('Cover charge $20'), { text: '$20', currency: null });
});

ok('findPricing: ISO currency code is unambiguous, unlike a bare symbol', () => {
  assert.deepEqual(findPricing('Price: 15 EUR at the door'), { text: '15 EUR', currency: 'EUR' });
  assert.deepEqual(findPricing('10-15 usd'), { text: '10-15 usd', currency: 'USD' });
});

ok('findPricing: multilingual "free entry" phrasing, no currency', () => {
  assert.deepEqual(findPricing('Free entry all night'), { text: 'Free entry', currency: null });
  assert.deepEqual(findPricing('Eintritt frei für alle'), { text: 'Eintritt frei', currency: null });
  assert.deepEqual(findPricing('Entrada libre'), { text: 'Entrada libre', currency: null });
});

ok('findPricing: no match returns bare null, never a null-filled object', () => {
  assert.equal(findPricing('Come dance with us on Saturday night'), null);
  assert.equal(findPricing(''), null);
});

console.log(`\n${passed} assertion groups passed`);
