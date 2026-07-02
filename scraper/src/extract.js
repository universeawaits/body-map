// Page → candidate entities. JSON-LD (Event, DanceEvent, Organization,
// LocalBusiness, Place) is the primary signal; multilingual keyword heuristics
// are the fallback. Every candidate carries a confidence score (§7 rubric),
// human-readable reasons, a dance classification (context dance from the §8
// config + page keywords), weekday recurrence, and music/organizer/artists
// extracted from JSON-LD performer/organizer or text heuristics.

import * as cheerio from 'cheerio';

export const CATEGORY_KEYS = ['social', 'marathon', 'festival', 'class'];

const CATEGORY_PATTERNS = {
  social: [
    /\bmilongas?\b/i, /\bpr[aá]cticas?\b/i,
    /\bsocials?\b(?!\s+media)/i, // salsa-world "social(s)" — not "social media"
  ],
  marathon: [/\bmarath?ons?\b/i, /\bmarat[oó]n(?:es)?\b/i, /\bencuentros?\b/i],
  festival: [
    /\bfestivals?\b/i, /\bfestivales\b/i,
    /\bcongress(?:es)?\b/i, /\bcongresos?\b/i, /\bcongr[eè]s\b/i,
  ],
  class: [
    /\bclass(?:es)?\b/i, /\bclases?\b/i, /\bkurse?\b/i, /\bcours\b/i,
    /\bescuelas?\b/i, /\bschools?\b/i, /\blessons?\b/i, /\bworkshops?\b/i,
    /\btaller(?:es)?\b/i,
  ],
};

export const DANCE_KEYS = ['tango', 'salsa', 'bachata', 'kizomba'];

// "son" alone is the Spanish copula ("las milongas son…") — require the genre
// form to avoid tagging every Spanish page as salsa.
const DANCE_PATTERNS = {
  tango: [/\btangos?\b/i, /\bmilongas?\b/i, /\bencuentros?\b/i, /\bpr[aá]cticas?\b/i],
  salsa: [/\bsalsas?\b/i, /\btimba\b/i, /\bruedas?\b/i, /\bson\s+(?:cubano|montuno)\b/i, /\bmambo\b/i],
  bachata: [/\bbachatas?\b/i, /\bsensual\b/i],
  kizomba: [/\bkizomba\b/i, /\burban\s?kiz\b/i, /\bsemba\b/i, /\btarraxinhas?\b/i],
};

export function detectDances(text) {
  const found = [];
  for (const key of DANCE_KEYS) {
    if (DANCE_PATTERNS[key].some((re) => re.test(String(text)))) found.push(key);
  }
  return found;
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  januar: 1, februar: 2, märz: 3, mai: 5, juni: 6, juli: 7, oktober: 10,
  dezember: 12,
};
const MONTH_RE = Object.keys(MONTHS).join('|');

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function truncate(text, max = 500) {
  const t = clean(text);
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function isoDate(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function makeDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // month-aware check ("31 February" must not survive): round-trip through
  // Date.UTC and reject when the calendar rolled the input over
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function absoluteUrl(href, base) {
  // guard: new URL(undefined, base) would resolve the literal string
  // "undefined" against base instead of failing
  if (typeof href !== 'string' || !href) return null;
  try {
    const u = new URL(href, base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

export function detectCategories(text, emphasizedText = '') {
  const categories = [];
  let strong = false;
  for (const key of CATEGORY_KEYS) {
    const patterns = CATEGORY_PATTERNS[key];
    const inEmphasis = patterns.some((re) => re.test(emphasizedText));
    const bodyHits = patterns.reduce(
      (n, re) => n + (String(text).match(new RegExp(re.source, 'gi')) || []).length,
      0
    );
    if (inEmphasis || bodyHits > 0) {
      categories.push(key);
      if (inEmphasis || bodyHits >= 3) strong = true;
    }
  }
  return { categories, strong };
}

export function parseDatesFromText(text) {
  // ISO range or single ISO date
  const isoAll = [...String(text).matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)];
  if (isoAll.length >= 1) {
    const dates = isoAll
      .map((m) => makeDate(+m[1], +m[2], +m[3]))
      .filter(Boolean)
      .sort();
    if (dates.length) {
      return { start: dates[0], end: dates.length > 1 ? dates[dates.length - 1] : null };
    }
  }
  // "12-15 March 2026" / "12–15 marzo 2026"
  let m = String(text).match(
    new RegExp(`\\b(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})(?:\\.|th|st|nd|rd)?\\s+(?:of\\s+)?(${MONTH_RE})\\s+(20\\d{2})\\b`, 'i')
  );
  if (m) {
    const month = MONTHS[m[3].toLowerCase()];
    return { start: makeDate(+m[4], month, +m[1]), end: makeDate(+m[4], month, +m[2]) };
  }
  // "March 12-15, 2026"
  m = String(text).match(
    new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2}),?\\s*(20\\d{2})\\b`, 'i')
  );
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    return { start: makeDate(+m[4], month, +m[2]), end: makeDate(+m[4], month, +m[3]) };
  }
  // "15 March 2026"
  m = String(text).match(
    new RegExp(`\\b(\\d{1,2})(?:\\.|th|st|nd|rd)?\\s+(?:of\\s+)?(${MONTH_RE})\\s+(20\\d{2})\\b`, 'i')
  );
  if (m) {
    return { start: makeDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]), end: null };
  }
  // "March 15, 2026"
  m = String(text).match(new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2}),?\\s*(20\\d{2})\\b`, 'i'));
  if (m) {
    return { start: makeDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]), end: null };
  }
  return { start: null, end: null };
}

const ADDRESS_PATTERNS = [
  // "1366 Armenia Street" / "12 Main St."
  /\b\d{1,4}\s+[A-ZÀ-Þ][\w'’.-]*(?:\s+[A-Za-zÀ-ž'’.-]+){0,3}\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Square|Sq\.?)\b/,
  // "Torstraße 123", "Müllerstr. 12", "Bergmannstrasse 5"
  /\b[A-ZÀ-Þ][\wäöüß'’.-]*(?:straße|strasse|str\.|gasse|weg|platz|allee|damm|ring|ufer)\s+\d{1,4}[a-z]?\b/i,
  // "Calle Corrientes 348", "Av. Scalabrini Ortiz 1331", "Rue de la Roquette 23", "Via Roma 15"
  /\b(?:Calle|Av\.?|Avenida|Avda\.?|Rua|Via|Viale|Rue|Carrer|Passeig|Ulica|ул\.?)\s+[A-ZÀ-Þ][\w'’. -]{2,40}?\s+\d{1,5}\b/i,
  // Argentine style "Armenia 1366" (capitalized word(s) + 3-5 digit number)
  /\b[A-ZÀ-Þ][a-zà-ž'’.]+(?:\s+[A-ZÀ-Þ][a-zà-ž'’.]+){0,2}\s+\d{3,5}\b/,
];

export function findAddress(text) {
  for (const re of ADDRESS_PATTERNS) {
    const m = String(text).match(re);
    if (m) return clean(m[0]);
  }
  return null;
}

const WEEKDAYS =
  'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|' +
  'lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|' +
  'montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|' +
  'lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|' +
  'luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica';

function findSchedule(text) {
  const re = new RegExp(
    `\\b(?:every\\s+)?(?:${WEEKDAYS})(?:\\s*[-–—/&,+]\\s*(?:${WEEKDAYS}))*[^.\\n<>]{0,60}?\\d{1,2}[:.h]\\d{2}[^.\\n<>]{0,30}`,
    'i'
  );
  const m = String(text).match(re);
  return m ? clean(m[0]).slice(0, 120) : null;
}

// ---------- weekday recurrence (§7) ----------

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// token → day index (0 = mon … 6 = sun); en/es/de/fr/it names + abbreviations
const SAFE_DAY_TOKENS = [
  ['monday', 0], ['lunes', 0], ['lun', 0], ['montag', 0], ['lundi', 0], ['lunedì', 0], ['lunedi', 0],
  ['tuesday', 1], ['tues', 1], ['tue', 1], ['martes', 1], ['dienstag', 1], ['mardi', 1], ['martedì', 1], ['martedi', 1],
  ['wednesday', 2], ['wed', 2], ['miércoles', 2], ['miercoles', 2], ['mié', 2], ['mie', 2], ['mittwoch', 2],
  ['mercredi', 2], ['mercoledì', 2], ['mercoledi', 2],
  ['thursday', 3], ['thurs', 3], ['thur', 3], ['thu', 3], ['jueves', 3], ['jue', 3], ['donnerstag', 3],
  ['jeudi', 3], ['giovedì', 3], ['giovedi', 3], ['gio', 3],
  ['friday', 4], ['fri', 4], ['viernes', 4], ['freitag', 4], ['vendredi', 4], ['venerdì', 4], ['venerdi', 4], ['ven', 4],
  ['saturday', 5], ['sat', 5], ['sábado', 5], ['sabado', 5], ['sáb', 5], ['sab', 5], ['samstag', 5],
  ['sonnabend', 5], ['samedi', 5], ['sabato', 5],
  ['sunday', 6], ['sun', 6], ['domingo', 6], ['dom', 6], ['sonntag', 6], ['dimanche', 6], ['domenica', 6],
];
// Ambiguous tokens ("mon" is the French possessive, "mar" ≈ March,
// "vie"/"mer" are French words, "sam" a name, German two-letter abbreviations
// collide with prose) only count inside a range, a day list, or directly
// before a time.
const GUARDED_DAY_TOKENS = [
  ['mon', 0], ['mar', 1], ['vie', 4], ['mer', 2], ['sam', 5], ['dim', 6],
  ['mo', 0], ['di', 1], ['mi', 2], ['do', 3], ['fr', 4], ['sa', 5], ['so', 6],
];

const DAY_INDEX = new Map([...SAFE_DAY_TOKENS, ...GUARDED_DAY_TOKENS]);
const byLength = (a, b) => b.length - a.length;
const SAFE_ALT = SAFE_DAY_TOKENS.map(([t]) => t).sort(byLength).join('|');
const ALL_ALT = [...SAFE_DAY_TOKENS, ...GUARDED_DAY_TOKENS].map(([t]) => t).sort(byLength).join('|');
const GUARDED_ALT = GUARDED_DAY_TOKENS.map(([t]) => t).sort(byLength).join('|');

// \b mis-handles accented finals (lunedì) — use letter lookarounds instead
const NB = '(?<![\\p{L}])';
const NE = '(?![\\p{L}])';
// Weekly socials are usually announced in the plural ("Saturdays from 22:30",
// "sábados y domingos") — allow an optional plural 's' after full day names.
// GUARDED_TIME_RE deliberately stays singular: guarded abbreviations never
// pluralize, and "5 mars 20:00" (French date) must not read as Tuesday.
const DAY_RANGE_RE = new RegExp(
  `${NB}(${ALL_ALT})s?\\.?(?:\\s*[-–—]\\s*|\\s+(?:to|bis|au|al|a)\\s+)(${ALL_ALT})s?\\.?${NE}`, 'giu'
);
const DAY_LIST_RE = new RegExp(
  `${NB}(?:(?:${ALL_ALT})s?\\.?(?:\\s*[,/&+]\\s*|\\s+(?:and|y|e|et|ed|und|o|oder|ou)\\s+))+(?:${ALL_ALT})s?\\.?${NE}`, 'giu'
);
const DAY_TOKEN_RE = new RegExp(`${NB}(${ALL_ALT})s?${NE}`, 'giu');
const SAFE_DAY_RE = new RegExp(`${NB}(${SAFE_ALT})s?${NE}`, 'giu');
const GUARDED_TIME_RE = new RegExp(`${NB}(${GUARDED_ALT})\\.?\\s*\\d{1,2}[:.h]\\d{2}`, 'giu');

/**
 * Parse a weekly recurrence out of schedule/description text.
 * Multilingual day names and abbreviations (en/es/de/fr/it); ranges like
 * "Wed-Sun" / "lun-vie" / "Mo–Fr" are expanded (wrapping across the week).
 * @returns subset of DAY_KEYS in fixed mon..sun order
 */
export function parseDaysOfWeek(text) {
  const s = String(text || '');
  if (!s) return [];
  const found = new Set();
  const dayOf = (token) => DAY_INDEX.get(String(token).toLowerCase());

  for (const m of s.matchAll(DAY_RANGE_RE)) {
    const from = dayOf(m[1]);
    const to = dayOf(m[2]);
    if (from == null || to == null) continue;
    for (let i = from; ; i = (i + 1) % 7) {
      found.add(i);
      if (i === to) break;
    }
  }
  for (const m of s.matchAll(DAY_LIST_RE)) {
    for (const t of m[0].matchAll(DAY_TOKEN_RE)) {
      const d = dayOf(t[1]);
      if (d != null) found.add(d);
    }
  }
  for (const m of s.matchAll(SAFE_DAY_RE)) {
    const d = dayOf(m[1]);
    if (d != null) found.add(d);
  }
  for (const m of s.matchAll(GUARDED_TIME_RE)) {
    const d = dayOf(m[1]);
    if (d != null) found.add(d);
  }
  return [...found].sort((a, b) => a - b).map((i) => DAY_KEYS[i]);
}

// ---------- JSON-LD ----------

const JSONLD_TYPES = /(?:^|\b)(event|danceevent|organization|localbusiness|place)$/i;

function typeMatches(node) {
  const types = [].concat(node?.['@type'] || []);
  return types.some((t) => JSONLD_TYPES.test(String(t)) || /event$/i.test(String(t)));
}

function* walkJsonLd(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) yield* walkJsonLd(item);
    return;
  }
  if (typeMatches(node)) yield node;
  if (node['@graph']) yield* walkJsonLd(node['@graph']);
  if (node.itemListElement) {
    for (const el of [].concat(node.itemListElement)) {
      yield* walkJsonLd(el?.item || el);
    }
  }
  if (node.subEvent) yield* walkJsonLd(node.subEvent);
}

function jsonLdAddress(addr) {
  if (!addr) return {};
  if (typeof addr === 'string') return { address: clean(addr) };
  const a = Array.isArray(addr) ? addr[0] : addr;
  return {
    address: clean(a.streetAddress) || null,
    city: clean(a.addressLocality) || null,
    country: clean(typeof a.addressCountry === 'object' ? a.addressCountry?.name : a.addressCountry) || null,
  };
}

function jsonLdGeo(node) {
  // location may be a single Place or an array of Places
  const loc = Array.isArray(node?.location) ? node.location[0] : node?.location;
  const geo = node?.geo || loc?.geo;
  const lat = Number(geo?.latitude);
  const lng = Number(geo?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return { lat, lng };
  }
  return { lat: null, lng: null };
}

function jsonLdImages(node, baseUrl) {
  const images = [];
  for (const img of [].concat(node?.image || [])) {
    const src = typeof img === 'object' ? img?.url || img?.contentUrl : img;
    const abs = src && absoluteUrl(src, baseUrl);
    if (abs && !images.includes(abs)) images.push(abs);
    if (images.length >= 3) break;
  }
  return images;
}

function jsonLdSocials(node, baseUrl) {
  const socials = {};
  const site = typeof node?.url === 'string' ? absoluteUrl(node.url, baseUrl) : null;
  if (site) socials.website = site;
  for (const same of [].concat(node?.sameAs || [])) {
    const u = absoluteUrl(same, baseUrl);
    if (!u) continue;
    if (/facebook\.com/i.test(u) && !socials.facebook) socials.facebook = u;
    else if (/instagram\.com/i.test(u) && !socials.instagram) socials.instagram = u;
    else if (!socials.website) socials.website = u;
  }
  if (typeof node?.email === 'string' && node.email.includes('@')) {
    socials.email = node.email.replace(/^mailto:/i, '');
  }
  return socials;
}

// ---------- music / organizer / artists (§7) ----------

// §7 heuristic: "DJ Carlos", "TDJ Ana" (capitalized name follows)
const DJ_NAME_RE = /\b(T?DJ)\s+[A-ZÀ-Ž]/;
const TEACHER_RE = /\b(?:teacher|maestr[oa]s?|instructor(?:a|es)?|profesor(?:a|es)?|dance\s+teacher)\b/i;
// capitalized name chunk: "La Rubia", "Carlos Di Sarli" (case-sensitive)
const NAME_CHUNK = "[A-ZÀ-Ž][\\p{L}\\p{N}'’-]*";
// connectors longest-first — regex alternation is ordered ("de" must not shadow "del")
const NAME_CONNECTORS = 'della|delle|del|de|di|da|las|los|la|le|el|the|of|und|y|e|&';
const CAP_NAME_RE = new RegExp(`^${NAME_CHUNK}(?:\\s+${NAME_CHUNK}){0,2}`, 'u');
const ORG_NAME_RE = new RegExp(
  `^${NAME_CHUNK}(?:\\s+(?:(?:${NAME_CONNECTORS})(?![\\p{L}])|${NAME_CHUNK}))*`, 'u'
);
const DJ_TEXT_RE = new RegExp(`\\b(T?DJ)\\s+(${NAME_CHUNK}(?:\\s+${NAME_CHUNK}){0,2})`, 'gu');
const MUSICALIZA_RE = /\bmusicaliza(?:n|dor(?:a|es)?|ci[oó]n)?\b/gi;
const ORGANIZER_KEYWORD_RE =
  /\b(?:organized\s+by|organis(?:ed)?\s+by|organiza(?:d[oa])?(?:\s+por)?|organis[eé]e?\s+par|veranstaltet\s+von|organizzato\s+da)\b/i;

// some sites emit placeholder nodes like {"@type":"PerformingGroup","name":"Organization"}
const PLACEHOLDER_NAME_RE =
  /^(?:organization|organizer|person|performer|performinggroup|musicgroup|event|place|tba|tbd|n\/a)$/i;

function jsonLdPersonName(p) {
  const name = clean(typeof p === 'string' ? p : p?.name);
  return PLACEHOLDER_NAME_RE.test(name) ? '' : name;
}

// Event.performer → Person entries to artists (role performer unless obviously
// teacher), MusicGroup entries to music (band, or orchestra when the name says
// so); DJ-named performers go to music with type dj.
function jsonLdPerformers(node, baseUrl) {
  const music = [];
  const artists = [];
  for (const perf of [].concat(node?.performer || [])) {
    const name = jsonLdPersonName(perf);
    if (!name || name.length > 120) continue;
    const url = typeof perf === 'object' ? absoluteUrl(perf.url, baseUrl) : null;
    const types = [].concat(perf?.['@type'] || []).map((t) => String(t).toLowerCase());
    if (types.includes('musicgroup')) {
      const type = /orquesta|orchestra/i.test(name) ? 'orchestra' : 'band';
      music.push({ name, type, ...(url ? { url } : {}) });
    } else if (DJ_NAME_RE.test(name)) {
      music.push({ name, type: 'dj', ...(url ? { url } : {}) });
    } else {
      const teacherish = TEACHER_RE.test(
        `${perf?.jobTitle || ''} ${perf?.description || ''} ${name}`
      );
      artists.push({ name, role: teacherish ? 'teacher' : 'performer', ...(url ? { url } : {}) });
    }
  }
  return { music, artists };
}

function jsonLdOrganizer(node, baseUrl) {
  const org = [].concat(node?.organizer || [])[0];
  const name = jsonLdPersonName(org);
  if (!name || name.length > 120) return null;
  const url = typeof org === 'object' ? absoluteUrl(org.url, baseUrl) : null;
  return url ? { name, url } : { name };
}

// Text heuristics (§7): "DJ X" / "musicaliza …" → music (type dj)
export function extractMusicFromText(text) {
  const s = String(text || '');
  const out = [];
  const push = (raw) => {
    const name = clean(raw);
    if (!name || name.length > 80) return;
    if (out.some((m) => m.name.toLowerCase() === name.toLowerCase())) return;
    out.push({ name, type: 'dj' });
  };
  for (const m of s.matchAll(DJ_TEXT_RE)) push(`${m[1]} ${m[2]}`);
  for (const m of s.matchAll(MUSICALIZA_RE)) {
    const after = s.slice(m.index + m[0].length).replace(/^[:\s]+(?:por\s+|by\s+)?/iu, '');
    const nm = after.match(CAP_NAME_RE);
    if (nm) push(nm[0]);
  }
  return out.slice(0, 6);
}

// "organized by / organiza / veranstaltet von / organisé par …" → organizer
export function extractOrganizerFromText(text) {
  const s = String(text || '');
  const kw = s.match(ORGANIZER_KEYWORD_RE);
  if (!kw) return null;
  const after = s.slice(kw.index + kw[0].length).replace(/^[:\s]+/, '');
  const m = after.match(ORG_NAME_RE);
  if (!m) return null;
  const name = clean(m[0])
    .replace(new RegExp(`\\s+(?:${NAME_CONNECTORS})$`, 'iu'), '')
    .replace(/[.,;:]+$/, '')
    .trim();
  return name && name.length <= 80 ? { name } : null;
}

function candidateFromJsonLd(node, pageUrl, pageText) {
  const name = clean(node.name);
  if (!name || name.length > 200) return null;
  const place = node.location && typeof node.location === 'object'
    ? (Array.isArray(node.location) ? node.location[0] : node.location)
    : null;
  const addrSource = place?.address ? place : node;
  const { address = null, city = null, country = null } = jsonLdAddress(addrSource.address);
  const { lat, lng } = jsonLdGeo(node);
  const fullDescription = clean(node.description || '');
  const description = truncate(fullDescription);
  // categories from the candidate's own text first — page-level text only as a
  // fallback, so listing pages don't smear their keywords over every event
  let { categories, strong } = detectCategories(`${name} ${description}`, name);
  if (categories.length === 0) {
    ({ categories } = detectCategories(pageText.slice(0, 4000)));
    strong = false;
  }
  const { music, artists } = jsonLdPerformers(node, pageUrl);
  const organizer = jsonLdOrganizer(node, pageUrl) ||
    extractOrganizerFromText(fullDescription);
  return {
    name,
    categories,
    categoryStrong: strong,
    description,
    lat,
    lng,
    address,
    city: city || clean(place?.address?.addressLocality) || null,
    country,
    schedule: null,
    days_of_week: parseDaysOfWeek(fullDescription),
    start_date: isoDate(node.startDate),
    end_date: isoDate(node.endDate),
    images: jsonLdImages(node, pageUrl),
    socials: jsonLdSocials(node, pageUrl),
    organizer,
    music: music.length > 0 ? music : extractMusicFromText(`${name} ${fullDescription}`),
    artists,
    fromJsonLd: true,
  };
}

// ---------- heuristics ----------

function heuristicCandidate($, pageUrl, pageText) {
  const title = clean($('meta[property="og:title"]').attr('content')) ||
    clean($('h1').first().text()) ||
    clean($('title').first().text());
  const name = title.split(/\s+[|•·–—-]\s+/)[0].trim().slice(0, 120);
  if (!name) return null;

  const description =
    truncate($('meta[name="description"]').attr('content') || '') ||
    truncate($('meta[property="og:description"]').attr('content') || '') ||
    truncate(
      $('p')
        .map((_, el) => $(el).text())
        .get()
        .find((t) => clean(t).length > 80) || ''
    );

  const { categories, strong } = detectCategories(pageText, `${name} ${$('h1').text()} ${$('h2').text()}`);
  const dates = parseDatesFromText(pageText.slice(0, 8000));

  const images = [];
  const og = absoluteUrl($('meta[property="og:image"]').attr('content'), pageUrl);
  if (og) images.push(og);
  $('img[src]').each((_, el) => {
    if (images.length >= 3) return false;
    const abs = absoluteUrl($(el).attr('src'), pageUrl);
    if (abs && /\.(jpe?g|png|webp)(\?|$)/i.test(abs) && !images.includes(abs)) images.push(abs);
  });

  const socials = {};
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (/facebook\.com\//i.test(href) && !socials.facebook) socials.facebook = absoluteUrl(href, pageUrl);
    else if (/instagram\.com\//i.test(href) && !socials.instagram) socials.instagram = absoluteUrl(href, pageUrl);
    else if (/^mailto:/i.test(href) && !socials.email) socials.email = href.replace(/^mailto:/i, '').split('?')[0];
  });
  for (const key of Object.keys(socials)) if (!socials[key]) delete socials[key];
  const canonical = absoluteUrl($('link[rel="canonical"]').attr('href'), pageUrl) || pageUrl;
  socials.website = canonical;

  const schedule = findSchedule(pageText.slice(0, 12000));

  return {
    name,
    categories,
    categoryStrong: strong,
    description,
    lat: null,
    lng: null,
    address: findAddress(pageText.slice(0, 12000)),
    city: null,
    country: null,
    schedule,
    days_of_week: parseDaysOfWeek(`${schedule || ''} ${description || ''}`),
    start_date: dates.start,
    end_date: dates.end,
    images,
    socials,
    organizer: extractOrganizerFromText(pageText.slice(0, 12000)),
    music: extractMusicFromText(pageText.slice(0, 12000)),
    artists: [],
    fromJsonLd: false,
  };
}

// ---------- confidence (§7 rubric) ----------

export function scoreCandidate(candidate) {
  let confidence = 0;
  const reasons = [];
  if (candidate.fromJsonLd && candidate.name) {
    confidence += 0.5;
    reasons.push('JSON-LD with name (+0.5)');
  } else if (candidate.name) {
    confidence += 0.35;
    reasons.push('name from heuristics (+0.35)');
  }
  if (candidate.address || (candidate.lat != null && candidate.lng != null)) {
    confidence += 0.2;
    reasons.push('address or coordinates (+0.2)');
  }
  if (candidate.categories.length > 0 && candidate.categoryStrong) {
    confidence += 0.15;
    reasons.push('strong category keyword (+0.15)');
  } else if (candidate.categories.length > 0) {
    reasons.push('weak category keyword (+0)');
  } else {
    reasons.push('no category detected');
  }
  if (candidate.start_date || candidate.end_date) {
    confidence += 0.1;
    reasons.push('parsed dates (+0.1)');
  }
  if (candidate.images.length > 0 || Object.keys(candidate.socials).length > 0) {
    confidence += 0.1;
    reasons.push('images/socials (+0.1)');
  }
  if ((candidate.music || []).length > 0 || (candidate.artists || []).length > 0 || candidate.organizer) {
    confidence += 0.05;
    reasons.push('performer/organizer (+0.05)');
  }
  if (!candidate.fromJsonLd) {
    const complete = candidate.name && candidate.address && candidate.categories.length > 0;
    if (!complete && confidence > 0.65) {
      confidence = 0.65;
      reasons.push('heuristics-only cap 0.65');
    }
  }
  return { confidence: Math.min(1, Math.round(confidence * 100) / 100), reasons };
}

/**
 * @param {string} html
 * @param {string} pageUrl
 * @param {object} opts
 *   heuristicFallback  set false for curated listing pages — their own
 *                      title/address describe the directory, not an entity
 *   categoriesHint     categories to assume when keyword detection finds none
 *                      (from sources.json categories_hint; never scores +0.15)
 *   dances             context dances from the §8 config (crawl/search plan);
 *                      always included — page keywords may add more (§7)
 * @returns array of candidates with {…fields, confidence, reasons}
 */
export function extractCandidates(html, pageUrl, { heuristicFallback = true, categoriesHint = [], dances = [] } = {}) {
  const $ = cheerio.load(html);
  $('script:not([type="application/ld+json"]), style, noscript, svg').remove();
  const pageText = clean($('body').text());

  const candidates = [];
  const seenNames = new Set();

  $('script[type="application/ld+json"]').each((_, el) => {
    let parsed;
    try {
      parsed = JSON.parse($(el).text());
    } catch {
      return; // malformed JSON-LD block — ignore
    }
    for (const node of walkJsonLd(parsed)) {
      const candidate = candidateFromJsonLd(node, pageUrl, pageText);
      if (!candidate) continue;
      const key = candidate.name.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      candidates.push(candidate);
    }
  });

  if (candidates.length === 0 && heuristicFallback) {
    const candidate = heuristicCandidate($, pageUrl, pageText);
    if (candidate) candidates.push(candidate);
  }

  const contextDances = (dances || []).filter((d) => DANCE_KEYS.includes(d));

  return candidates.map((candidate) => {
    if (candidate.categories.length === 0 && categoriesHint.length > 0) {
      candidate.categories = categoriesHint.filter((c) => CATEGORY_KEYS.includes(c));
    }
    // dance classification (§7): start from the context dance, own-text
    // keywords add more; page-level text only as a fallback so listing pages
    // don't smear their dances over every event. Empty → "dance unclear"
    // review routing happens in merge.js.
    const resolved = new Set([
      ...contextDances,
      ...detectDances(`${candidate.name} ${candidate.description}`),
    ]);
    if (resolved.size === 0) {
      for (const d of detectDances(pageText.slice(0, 4000))) resolved.add(d);
    }
    candidate.dances = [...resolved].sort(
      (a, b) => DANCE_KEYS.indexOf(a) - DANCE_KEYS.indexOf(b)
    );
    // dates only make sense for marathons/festivals (§5)
    if (!candidate.categories.includes('marathon') && !candidate.categories.includes('festival')) {
      candidate.start_date = null;
      candidate.end_date = null;
    }
    // weekly recurrence only for socials/classes (§5)
    if (!candidate.categories.includes('social') && !candidate.categories.includes('class')) {
      candidate.days_of_week = [];
    }
    const { confidence, reasons } = scoreCandidate(candidate);
    const { fromJsonLd, categoryStrong, ...fields } = candidate;
    return { ...fields, confidence, reasons };
  });
}
