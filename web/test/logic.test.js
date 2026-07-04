// Node assertion suite for the PURE helpers in js/logic.js.
// Run: node web/test/logic.test.js (no framework, plain node:assert).

import assert from 'node:assert/strict';
import {
  escapeHtml,
  escapeAttr,
  safeUrl,
  danceLabel,
  categoryLabel,
  resolveDance,
  parseDanceHash,
  weekdayOf,
  matchesDates,
  monthKeyOf,
  addMonths,
  clampMonth,
  buildMonthModel,
  STRIP_START_MONTH,
  STRIP_END_MONTH,
  groupKey,
  isVisible,
  groupEntities,
  effectiveCategoryKeys,
  effectiveColors,
  pinBackground,
  categoryCounts,
  orderedCategories,
  formatDate,
  scheduleLabel,
} from '../js/logic.js';
import { CATEGORIES, DANCE_KEYS } from '../js/categories.js';
import { resolveLang, parseLangHash, LANG_CODES } from '../js/i18n.js';

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

function filter({ dance = 'tango', categories, dates = [] } = {}) {
  return {
    dance,
    categories: new Set(categories ?? CATEGORIES.map((c) => c.key)),
    dates: new Set(dates),
  };
}

function entity(overrides = {}) {
  return {
    name: 'X',
    status: 'active',
    lat: 52.5,
    lng: 13.4,
    dances: ['tango'],
    categories: ['social'],
    days_of_week: [],
    start_date: null,
    end_date: null,
    ...overrides,
  };
}

// --- escaping ------------------------------------------------------------------

ok('escapeHtml neutralizes markup and quotes', () => {
  assert.equal(
    escapeHtml('<img src=x onerror="pwn()">&\'quote\''),
    '&lt;img src=x onerror=&quot;pwn()&quot;&gt;&amp;&#39;quote&#39;'
  );
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeAttr('"><script>'), '&quot;&gt;&lt;script&gt;');
});

ok('safeUrl allows http/https/mailto only', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('http://example.com'), 'http://example.com');
  assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(safeUrl('  https://x.y  '), 'https://x.y');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,x'), null);
  assert.equal(safeUrl('vbscript:x'), null);
  assert.equal(safeUrl(''), null);
  assert.equal(safeUrl(42), null);
});

// --- labels & dance resolution ----------------------------------------------------

ok('dance keys and labels', () => {
  assert.deepEqual(DANCE_KEYS, ['tango', 'salsa', 'bachata', 'kizomba']);
  assert.equal(danceLabel('tango'), 'Tango');
  assert.equal(danceLabel('kizomba'), 'Kizomba');
  assert.equal(danceLabel('foxtrot'), '');
});

ok('social label is dance-aware, others constant', () => {
  assert.equal(categoryLabel('social', 'tango'), 'Milongas');
  assert.equal(categoryLabel('social', 'salsa'), 'Socials');
  assert.equal(categoryLabel('social', 'bachata'), 'Socials');
  assert.equal(categoryLabel('social', 'kizomba'), 'Socials');
  for (const dance of DANCE_KEYS) {
    assert.equal(categoryLabel('marathon', dance), 'Marathons');
    assert.equal(categoryLabel('festival', dance), 'Festivals');
    assert.equal(categoryLabel('class', dance), 'Classes');
  }
  assert.equal(categoryLabel('nope', 'tango'), '');
});

ok('category key is social (milonga renamed), fixed order kept', () => {
  assert.deepEqual(
    CATEGORIES.map((c) => c.key),
    ['social', 'marathon', 'festival', 'class']
  );
});

ok('resolveDance precedence: hash > localStorage > tango', () => {
  assert.equal(resolveDance('salsa', 'kizomba'), 'salsa');
  assert.equal(resolveDance(null, 'kizomba'), 'kizomba');
  assert.equal(resolveDance(null, null), 'tango');
  assert.equal(resolveDance('polka', 'waltz'), 'tango');
  assert.equal(resolveDance('polka', 'bachata'), 'bachata');
});

ok('parseDanceHash', () => {
  assert.equal(parseDanceHash('#dance=salsa'), 'salsa');
  assert.equal(parseDanceHash('dance=tango'), 'tango');
  assert.equal(parseDanceHash('#foo=1&dance=kizomba'), 'kizomba');
  assert.equal(parseDanceHash('#other'), null);
  assert.equal(parseDanceHash(''), null);
  assert.equal(parseDanceHash(null), null);
});

// --- weekday math (UTC from the string — no timezone drift) -------------------------

ok('weekdayOf computes UTC weekdays from YYYY-MM-DD strings', () => {
  assert.equal(weekdayOf('2026-07-02'), 'thu');
  assert.equal(weekdayOf('2026-07-06'), 'mon');
  assert.equal(weekdayOf('2024-02-29'), 'thu'); // leap day
  assert.equal(weekdayOf('2020-01-01'), 'wed');
  assert.equal(weekdayOf('2028-12-31'), 'sun');
});

// --- date matching --------------------------------------------------------------------

ok('matchesDates: no dates selected → everything matches', () => {
  assert.equal(matchesDates(entity(), []), true);
  assert.equal(matchesDates(entity(), new Set()), true);
  assert.equal(matchesDates(entity(), null), true);
});

ok('matchesDates: date ranges (marathons/festivals)', () => {
  const fest = entity({ start_date: '2026-08-19', end_date: '2026-09-01' });
  assert.equal(matchesDates(fest, ['2026-08-19']), true); // first day
  assert.equal(matchesDates(fest, ['2026-09-01']), true); // last day
  assert.equal(matchesDates(fest, ['2026-08-25']), true); // inside
  assert.equal(matchesDates(fest, ['2026-08-18']), false); // day before
  assert.equal(matchesDates(fest, ['2026-09-02']), false); // day after
  assert.equal(matchesDates(fest, ['2026-08-18', '2026-08-19']), true); // ANY
});

ok('matchesDates: end_date null falls back to start_date (single day)', () => {
  const single = entity({ start_date: '2026-10-09', end_date: null });
  assert.equal(matchesDates(single, ['2026-10-09']), true);
  assert.equal(matchesDates(single, ['2026-10-10']), false);
});

ok('matchesDates: start_date null falls back to end_date (end-only entity)', () => {
  const endOnly = entity({ start_date: null, end_date: '2026-10-09' });
  assert.equal(matchesDates(endOnly, ['2026-10-09']), true);
  assert.equal(matchesDates(endOnly, ['2026-10-08']), false);
  assert.equal(matchesDates(endOnly, ['2026-10-10']), false);
  assert.equal(matchesDates(endOnly, []), true);
});

ok('matchesDates: weekly recurrence via days_of_week', () => {
  const weekly = entity({ days_of_week: ['wed', 'sat'] });
  assert.equal(matchesDates(weekly, ['2026-07-01']), true); // a Wednesday
  assert.equal(matchesDates(weekly, ['2026-07-04']), true); // a Saturday
  assert.equal(matchesDates(weekly, ['2026-07-02']), false); // a Thursday
  assert.equal(matchesDates(weekly, ['2026-07-02', '2026-07-04']), true);
});

ok('matchesDates: no date info at all → hidden while filter active', () => {
  const dateless = entity();
  assert.equal(matchesDates(dateless, ['2026-07-02']), false);
  assert.equal(matchesDates(dateless, []), true);
});

// --- date strip model -------------------------------------------------------------------

ok('strip spans full years 2020–2028', () => {
  assert.equal(STRIP_START_MONTH, '2020-01');
  assert.equal(STRIP_END_MONTH, '2028-12');
  assert.equal(clampMonth('2019-06'), '2020-01');
  assert.equal(clampMonth('2031-02'), '2028-12');
  assert.equal(clampMonth('2026-07'), '2026-07');
});

ok('month key arithmetic', () => {
  assert.equal(monthKeyOf('2026-07-02'), '2026-07');
  assert.equal(addMonths('2026-07', 1), '2026-08');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-07', -18), '2025-01');
});

ok('buildMonthModel generates labeled day chips', () => {
  const jul = buildMonthModel('2026-07');
  assert.equal(jul.key, '2026-07');
  assert.equal(jul.label, 'Jul 2026'); // year always visible
  assert.equal(jul.days.length, 31);
  assert.deepEqual(jul.days[0], {
    iso: '2026-07-01',
    day: 1,
    weekday: 'wed',
    weekdayLabel: 'Wed',
  });
  assert.equal(jul.days.at(-1).iso, '2026-07-31');

  assert.equal(buildMonthModel('2024-02').days.length, 29); // leap year
  assert.equal(buildMonthModel('2026-02').days.length, 28);
  assert.equal(buildMonthModel('2026-01').label, 'Jan 2026');
});

// --- visibility: active AND dance AND category AND date ----------------------------------

ok('isVisible: dance filtering', () => {
  const e = entity({ dances: ['tango'] });
  assert.equal(isVisible(e, filter({ dance: 'tango' })), true);
  assert.equal(isVisible(e, filter({ dance: 'salsa' })), false);
  const both = entity({ dances: ['salsa', 'bachata'] });
  assert.equal(isVisible(both, filter({ dance: 'salsa' })), true);
  assert.equal(isVisible(both, filter({ dance: 'bachata' })), true);
  assert.equal(isVisible(both, filter({ dance: 'tango' })), false);
  assert.equal(isVisible(entity({ dances: [] }), filter()), false);
  assert.equal(isVisible(entity({ dances: undefined }), filter()), false);
});

ok('isVisible: status, coordinates, categories', () => {
  assert.equal(isVisible(entity({ status: 'archived' }), filter()), false);
  assert.equal(isVisible(entity({ lat: NaN }), filter()), false);
  assert.equal(isVisible(entity(), filter({ categories: ['marathon'] })), false);
  assert.equal(isVisible(entity(), filter({ categories: ['social'] })), true);
});

ok('isVisible: the full AND formula includes dates', () => {
  const weekly = entity({ days_of_week: ['sat'] });
  assert.equal(isVisible(weekly, filter({ dates: ['2026-07-04'] })), true);
  assert.equal(isVisible(weekly, filter({ dates: ['2026-07-02'] })), false);
  const dateless = entity();
  assert.equal(isVisible(dateless, filter({ dates: ['2026-07-04'] })), false);
  assert.equal(isVisible(dateless, filter()), true);
});

// --- grouping & pin colors (teardrop-independent pure helpers) -----------------------------

ok('groupKey uses 4 decimals', () => {
  assert.equal(groupKey(-34.58853, -58.43031), '-34.5885,-58.4303');
});

ok('groupEntities groups co-located visible entities', () => {
  const a = entity({ name: 'A', lat: 38.7071, lng: -9.1449 });
  const b = entity({ name: 'B', lat: 38.7071, lng: -9.1449, categories: ['class'] });
  const c = entity({ name: 'C', lat: 51.5, lng: 0, dances: ['salsa'] });
  const groups = groupEntities([a, b, c], filter({ dance: 'tango' }));
  assert.equal(groups.length, 1); // C fails the dance filter
  assert.equal(groups[0].entities.length, 2);
});

ok('effective colors follow fixed category order and selection', () => {
  const a = entity({ categories: ['class'] });
  const b = entity({ categories: ['social'] });
  const group = { entities: [a, b] };
  const all = new Set(['social', 'marathon', 'festival', 'class']);
  assert.deepEqual(effectiveCategoryKeys(group, all), ['social', 'class']);
  assert.deepEqual(effectiveColors(group, all), ['#F2B134', '#2B5FD9']);
  assert.deepEqual(effectiveColors(group, new Set(['class'])), ['#2B5FD9']);
});

ok('pinBackground: solid for one, looping gradient for many', () => {
  assert.equal(pinBackground([]), 'transparent');
  assert.equal(pinBackground(['#F2B134']), '#F2B134');
  assert.equal(
    pinBackground(['#F2B134', '#2B5FD9']),
    'linear-gradient(120deg, #F2B134, #2B5FD9, #F2B134)'
  );
});

// --- counts, ordering, formatting -------------------------------------------------------------

ok('categoryCounts reflect the full filter (dance + categories + dates)', () => {
  const entities = [
    entity({ categories: ['social', 'class'], days_of_week: ['wed'] }),
    entity({ categories: ['festival'], start_date: '2026-08-01', end_date: '2026-08-03' }),
    entity({ categories: ['social'], dances: ['salsa'], days_of_week: ['wed'] }),
  ];
  const none = categoryCounts(entities, filter({ dance: 'tango' }));
  assert.deepEqual(none, { social: 1, marathon: 0, festival: 1, class: 1 });
  const wed = categoryCounts(entities, filter({ dance: 'tango', dates: ['2026-07-01'] }));
  assert.deepEqual(wed, { social: 1, marathon: 0, festival: 0, class: 1 });
  const salsa = categoryCounts(entities, filter({ dance: 'salsa' }));
  assert.deepEqual(salsa, { social: 1, marathon: 0, festival: 0, class: 0 });
});

ok('orderedCategories sorts into display order', () => {
  assert.deepEqual(orderedCategories(['class', 'social']), ['social', 'class']);
  assert.deepEqual(orderedCategories(['bogus']), []);
});

ok('formatDate and scheduleLabel', () => {
  assert.equal(formatDate('2026-08-19'), '19 Aug 2026');
  assert.equal(formatDate(null), '');
  assert.equal(scheduleLabel(entity({ schedule: 'Saturdays 22:00' })), 'Saturdays 22:00');
  // en-GB CLDR renders September as "Sep" or "Sept" depending on ICU version.
  assert.match(
    scheduleLabel(entity({ start_date: '2026-08-19', end_date: '2026-09-01' })),
    /^19 Aug 2026 – 1 Sept? 2026$/
  );
  assert.equal(scheduleLabel(entity({ start_date: '2026-08-19', end_date: '2026-08-19' })), '19 Aug 2026');
  assert.equal(scheduleLabel(entity()), '');
});

// --- i18n: lang-aware labels, locale-aware dates, lang resolution -----------------------

ok('danceLabel and categoryLabel are lang-aware', () => {
  assert.equal(danceLabel('tango', 'DE'), 'Tango');
  assert.equal(danceLabel('kizomba', 'FR'), 'Kizomba');
  assert.equal(danceLabel('foxtrot', 'DE'), '');
  assert.equal(categoryLabel('social', 'tango', 'DE'), 'Milongas');
  assert.equal(categoryLabel('social', 'salsa', 'ES'), 'Sociales');
  assert.equal(categoryLabel('class', 'tango', 'DE'), 'Kurse');
  assert.equal(categoryLabel('marathon', 'tango', 'RU'), 'Марафоны');
  // omitted lang defaults to English, same as before i18n existed
  assert.equal(danceLabel('tango'), 'Tango');
  assert.equal(categoryLabel('social', 'tango'), 'Milongas');
});

ok('LANG_CODES covers all 11 supported languages', () => {
  assert.deepEqual(LANG_CODES, [
    'EN', 'DE', 'ES', 'PT', 'IT', 'RU', 'UK', 'ZH', 'JA', 'KO', 'FR',
  ]);
});

ok('resolveLang precedence: hash > localStorage > EN', () => {
  assert.equal(resolveLang('de', 'fr'), 'DE');
  assert.equal(resolveLang(null, 'fr'), 'FR');
  assert.equal(resolveLang(null, null), 'EN');
  assert.equal(resolveLang('xx', 'yy'), 'EN');
  assert.equal(resolveLang('xx', 'ja'), 'JA');
});

ok('parseLangHash', () => {
  assert.equal(parseLangHash('#lang=de'), 'DE');
  assert.equal(parseLangHash('lang=fr'), 'FR');
  assert.equal(parseLangHash('#dance=tango&lang=ko'), 'KO');
  assert.equal(parseLangHash('#dance=tango'), null);
  assert.equal(parseLangHash(''), null);
  assert.equal(parseLangHash(null), null);
});

ok('buildMonthModel is locale-aware; default matches pre-i18n English output', () => {
  const jul = buildMonthModel('2026-07');
  assert.equal(jul.label, 'Jul 2026');
  assert.equal(jul.days[0].weekdayLabel, 'Wed');

  const julDe = buildMonthModel('2026-07', 'de');
  assert.match(julDe.label, /Juli 2026/);
  assert.equal(julDe.days[0].weekdayLabel, 'Mi'); // German short Wednesday
});

ok('formatDate and scheduleLabel are locale/lang-aware; defaults unchanged', () => {
  assert.equal(formatDate('2026-08-19', 'de'), '19. Aug. 2026');
  assert.equal(
    scheduleLabel(entity({ start_date: '2026-08-19' }), 'DE'),
    'Ab 19. Aug. 2026'
  );
  assert.equal(
    scheduleLabel(entity({ end_date: '2026-08-19' }), 'FR'),
    "Jusqu'au 19 août 2026"
  );
  // omitted lang defaults to English/en-GB, same as before i18n existed
  assert.equal(scheduleLabel(entity({ start_date: '2026-08-19' })), 'From 19 Aug 2026');
});

console.log(`\n${passed} assertions groups passed`);
