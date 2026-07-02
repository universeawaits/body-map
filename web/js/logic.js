// PURE helpers — no DOM, no Leaflet. Node-testable.
// Grouping, effective colors, HTML escaping, URL scheme checking, labels,
// date matching, date-strip month model, weekday math, dance resolution.

import {
  CATEGORIES,
  CATEGORY_BY_KEY,
  DANCE_BY_KEY,
  DANCE_KEYS,
  DEFAULT_DANCE,
} from './categories.js';

/**
 * Escape a string for safe interpolation into HTML text content.
 * EVERY dynamic string (scraped content!) must pass through this.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Escape a string for safe interpolation into a quoted HTML attribute.
 * (Same character set as escapeHtml; kept as a named helper so call
 * sites document intent.)
 */
export function escapeAttr(value) {
  return escapeHtml(value);
}

/**
 * Return the URL if it uses an allowed scheme (http, https, mailto),
 * otherwise null. Blocks javascript:, data:, vbscript:, etc. from
 * scraped content.
 */
export function safeUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:/i.test(trimmed)) return trimmed;
  return null;
}

// --- labels ------------------------------------------------------------------

/** Display label of a dance key ('tango' → 'Tango'); '' for unknown keys. */
export function danceLabel(key) {
  return DANCE_BY_KEY[key]?.label ?? '';
}

/**
 * Dance-aware display label of a category key: 'social' reads "Milongas"
 * when the active dance is tango and "Socials" otherwise; all other
 * category labels are constant.
 */
export function categoryLabel(key, dance) {
  const category = CATEGORY_BY_KEY[key];
  if (!category) return '';
  return category.labels[dance] ?? category.labels.default;
}

/**
 * Resolve the active dance at load time: URL hash value wins over the
 * localStorage value wins over the default. Unknown keys are ignored.
 */
export function resolveDance(hashDance, storedDance) {
  if (DANCE_KEYS.includes(hashDance)) return hashDance;
  if (DANCE_KEYS.includes(storedDance)) return storedDance;
  return DEFAULT_DANCE;
}

/** Extract the dance key from a '#dance=<key>' hash; null when absent. */
export function parseDanceHash(hash) {
  const match = /(?:^|[#&])dance=([a-z]+)/.exec(String(hash ?? ''));
  return match ? match[1] : null;
}

// --- weekday math & date matching (UTC from the string; no TZ drift) ---------

export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const WEEKDAY_LABELS = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Weekday key ('mon'…'sun') of a 'YYYY-MM-DD' string, computed in UTC. */
export function weekdayOf(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return WEEKDAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * Date filter predicate. No dates selected → true. Otherwise true iff ANY
 * selected date d falls within [start_date, end_date || start_date] OR
 * days_of_week contains d's weekday. Entities with neither dates nor
 * recurrence are hidden while a date filter is active.
 * @param {object} entity
 * @param {Iterable<string>} selectedDates - 'YYYY-MM-DD' strings
 */
export function matchesDates(entity, selectedDates) {
  const dates = [...(selectedDates ?? [])];
  if (!dates.length) return true;
  // A missing endpoint falls back to the other one, so an end-only entity
  // ("Until <date>") still matches on that date instead of never matching.
  const start = entity.start_date || entity.end_date || null;
  const end = entity.end_date || entity.start_date || null;
  const days = Array.isArray(entity.days_of_week) ? entity.days_of_week : [];
  if (!start && !days.length) return false;
  return dates.some(
    (d) => (start && d >= start && d <= end) || days.includes(weekdayOf(d))
  );
}

// --- date strip model ---------------------------------------------------------

// The strip spans full years 2020–2028, past included.
export const STRIP_START_MONTH = '2020-01';
export const STRIP_END_MONTH = '2028-12';

/** 'YYYY-MM' month key of a 'YYYY-MM-DD' date. */
export function monthKeyOf(iso) {
  return String(iso).slice(0, 7);
}

/** Add (or subtract) whole months to a 'YYYY-MM' key. */
export function addMonths(monthKey, delta) {
  const [y, m] = String(monthKey).split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** Clamp a 'YYYY-MM' key into the strip's 2020-01 … 2028-12 range. */
export function clampMonth(monthKey) {
  if (monthKey < STRIP_START_MONTH) return STRIP_START_MONTH;
  if (monthKey > STRIP_END_MONTH) return STRIP_END_MONTH;
  return monthKey;
}

/**
 * Model of one strip month: sticky separator label ("Jul 2026") plus one
 * chip per day with weekday abbreviation, day number and ISO date.
 * @returns {{key: string, label: string,
 *            days: Array<{iso: string, day: number,
 *                         weekday: string, weekdayLabel: string}>}}
 */
export function buildMonthModel(monthKey) {
  const [y, m] = String(monthKey).split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = [];
  for (let day = 1; day <= count; day += 1) {
    const iso = `${monthKey}-${String(day).padStart(2, '0')}`;
    const weekday = weekdayOf(iso);
    days.push({ iso, day, weekday, weekdayLabel: WEEKDAY_LABELS[weekday] });
  }
  return { key: monthKey, label: `${MONTH_LABELS[m - 1]} ${y}`, days };
}

// --- visibility & grouping -----------------------------------------------------

/** Group key: 4-decimal lat/lng (~11 m) so co-located entities share a pin. */
export function groupKey(lat, lng) {
  return lat.toFixed(4) + ',' + lng.toFixed(4);
}

/**
 * The v3 visibility formula: an entity is visible ⇔ it is active AND has
 * finite coordinates AND dances include the active dance AND it carries at
 * least one selected category AND it matches the selected dates.
 * @param {object} entity
 * @param {{dance: string, categories: Set<string>,
 *          dates: Iterable<string>}} filter
 */
export function isVisible(entity, filter) {
  if (!entity || entity.status !== 'active') return false;
  if (!Number.isFinite(entity.lat) || !Number.isFinite(entity.lng)) return false;
  if (!Array.isArray(entity.dances) || !entity.dances.includes(filter.dance)) {
    return false;
  }
  if (!Array.isArray(entity.categories)) return false;
  if (!entity.categories.some((c) => filter.categories.has(c))) return false;
  return matchesDates(entity, filter.dates);
}

/**
 * Group visible entities by 4-decimal coordinates.
 * Empty groups never exist (only visible entities are grouped).
 * @returns {Array<{key: string, lat: number, lng: number, entities: object[]}>}
 */
export function groupEntities(entities, filter) {
  const groups = new Map();
  for (const entity of entities || []) {
    if (!isVisible(entity, filter)) continue;
    const key = groupKey(entity.lat, entity.lng);
    let group = groups.get(key);
    if (!group) {
      group = { key, lat: entity.lat, lng: entity.lng, entities: [] };
      groups.set(key, group);
    }
    group.entities.push(entity);
  }
  return [...groups.values()];
}

/**
 * Effective category keys of a group: union of (entity.categories ∩ selected)
 * across the group's entities, in fixed category order.
 */
export function effectiveCategoryKeys(group, selected) {
  const present = new Set();
  for (const entity of group.entities) {
    for (const key of entity.categories || []) {
      if (selected.has(key)) present.add(key);
    }
  }
  return CATEGORIES.filter((c) => present.has(c.key)).map((c) => c.key);
}

/** Effective colors of a group, in fixed category order. */
export function effectiveColors(group, selected) {
  const byKey = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.color]));
  return effectiveCategoryKeys(group, selected).map((key) => byKey[key]);
}

/**
 * CSS background for a pin: solid color for one, flowing gradient
 * (first color repeated at the end so the animation loops smoothly)
 * for two or more.
 */
export function pinBackground(colors) {
  if (!colors.length) return 'transparent';
  if (colors.length === 1) return colors[0];
  return `linear-gradient(120deg, ${[...colors, colors[0]].join(', ')})`;
}

/**
 * Per-category counts of currently visible entities (an entity counts
 * toward every category it carries), for the live tab counters. Counts
 * reflect the FULL filter: dance, categories and dates.
 * @returns {Record<string, number>}
 */
export function categoryCounts(entities, filter) {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0]));
  for (const entity of entities || []) {
    if (!isVisible(entity, filter)) continue;
    for (const key of entity.categories) {
      if (key in counts) counts[key] += 1;
    }
  }
  return counts;
}

/** Sort an entity's categories into the fixed display order. */
export function orderedCategories(keys) {
  const wanted = new Set(keys || []);
  return CATEGORIES.filter((c) => wanted.has(c.key)).map((c) => c.key);
}

/** "12 Aug 2026" from an ISO date, UTC; falls back to the raw string. */
export function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Schedule string if present, else the start/end date range, else ''. */
export function scheduleLabel(entity) {
  if (entity.schedule) return entity.schedule;
  const start = entity.start_date;
  const end = entity.end_date;
  if (start && end) {
    return start === end
      ? formatDate(start)
      : `${formatDate(start)} – ${formatDate(end)}`;
  }
  if (start) return `From ${formatDate(start)}`;
  if (end) return `Until ${formatDate(end)}`;
  return '';
}
