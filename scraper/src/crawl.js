// URL planning: curated sources → known-entity refresh → new discovery,
// deduplicated, blocklist-filtered, capped at max_pages_per_run with
// priority curated > refresh > discovery.

export const DEFAULT_MAX_PAGES = 200;

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

export function isBlocked(url, blocklist = []) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return blocklist.some((blocked) => {
    const b = String(blocked).toLowerCase();
    return host === b || host.endsWith('.' + b);
  });
}

// `cities` is either a flat array (legacy) or an object keyed by country name
// to an array of its cities (§8 v3) — flatten either shape to one plain list.
export function flattenCities(cities) {
  if (Array.isArray(cities)) return cities;
  if (cities && typeof cities === 'object') return Object.values(cities).flat();
  return [];
}

// §8 v3 per-dance schema: queries.dances[dance] = {templates, standing_queries};
// cities/max_*/domain_blocklist stay top-level. Every query carries its dance
// so extraction gets the context dance (§7).
export function buildQueryList(queries, adHocQuery = null) {
  if (adHocQuery) return [{ query: adHocQuery, dance: null, city: null }];
  if (!queries || typeof queries.dances !== 'object' || queries.dances === null) return [];
  const list = [];
  const seen = new Set();
  const cities = flattenCities(queries.cities);
  const push = (query, dance, city = null) => {
    if (!query || seen.has(query)) return;
    seen.add(query);
    list.push({ query, dance, city });
  };
  for (const [dance, plan] of Object.entries(queries.dances)) {
    for (const template of plan?.templates || []) {
      if (template.includes('{city}')) {
        for (const city of cities) push(template.replaceAll('{city}', city), dance, city);
      } else {
        push(template, dance);
      }
    }
    for (const standing of plan?.standing_queries || []) push(standing, dance);
  }
  return list;
}

// Round-robin merge by dance (one query per dance in turn, each dance's own
// template/standing_queries/city order preserved) so any contiguous slice of
// the rotated list samples every dance roughly evenly. Without this, once the
// full list is large, a rotation window can sit entirely inside one dance's
// block for a very long time before reaching the others.
export function interleaveByDance(queryList) {
  const groups = new Map();
  for (const item of queryList) {
    const key = item.dance ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const lists = [...groups.values()];
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}

// Slices `list` at `offset` (wrapping around) instead of always starting at
// index 0, so repeated runs eventually cycle through the whole list rather
// than the same front portion winning the shared page-cap every time.
export function rotateQueryList(list, offset) {
  if (!Array.isArray(list) || list.length === 0) return list;
  const start = ((offset % list.length) + list.length) % list.length;
  return list.slice(start).concat(list.slice(0, start));
}

/**
 * @param {object} args
 *   sources    parsed sources.json (array) or null
 *   queries    parsed queries.json (object) or null
 *   entities   existing entities array
 *   provider   search provider {name, search(query, {maxResults})}
 *   flags      {noSearch, query, maxPages, sourcesOnly}
 *   crawlState {discovery_offset} or null — persisted rotation cursor (§7);
 *              ad-hoc --query/--url runs never read or advance it
 * @returns {Promise<{plan: Array<{url, kind, sourceName?, query?, dances?}>, searchStats: {queries, results, blocked}, nextDiscoveryOffset: number}>}
 */
export async function planUrls({ sources, queries, entities, provider, flags = {}, crawlState = null, log = console }) {
  const maxPages = flags.maxPages ?? queries?.max_pages_per_run ?? DEFAULT_MAX_PAGES;
  const plan = [];
  const seen = new Set();
  const searchStats = { queries: 0, results: 0, blocked: 0 };
  let nextDiscoveryOffset = crawlState?.discovery_offset ?? 0;

  const add = (url, meta) => {
    const norm = normalizeUrl(url);
    if (!norm || seen.has(norm)) return false;
    if (plan.length >= maxPages) return false;
    seen.add(norm);
    plan.push({ url: norm, ...meta });
    return true;
  };

  // (a) curated sources — skipped in ad-hoc --query runs
  if (!flags.query) {
    for (const source of sources || []) {
      if (!source?.enabled || !source?.url) continue;
      add(source.url, {
        kind: 'source',
        sourceName: source.name || source.url,
        sourceType: source.type || null,
        categoriesHint: source.categories_hint || [],
        dances: Array.isArray(source.dances) ? source.dances : [],
      });
    }
  }

  // (b) refresh: every distinct source URL of existing scraper-sourced entities
  if (!flags.query) {
    for (const entity of entities || []) {
      for (const src of entity.sources || []) {
        if (String(src.source).startsWith('scraper:') && src.url) {
          add(src.url, { kind: 'refresh' });
        }
      }
    }
  }

  // (c) discovery via search
  if (!flags.noSearch && plan.length < maxPages) {
    const fullQueryList = buildQueryList(queries, flags.query);
    const maxResults = queries?.max_results_per_query ?? 8;
    const blocklist = queries?.domain_blocklist || [];
    // Ad-hoc --query/--url runs are a single synthetic query (buildQueryList
    // already short-circuits to a length-1 list) — they bypass the shared
    // rotation cursor entirely rather than reading or advancing it, since
    // consuming shared state for a one-off manual query would be surprising.
    const offset = flags.query ? 0 : (crawlState?.discovery_offset ?? 0);
    const queryList = flags.query ? fullQueryList : rotateQueryList(interleaveByDance(fullQueryList), offset);
    for (const { query, dance } of queryList) {
      if (plan.length >= maxPages) break;
      searchStats.queries += 1;
      let results = [];
      try {
        results = await provider.search(query, { maxResults });
      } catch (err) {
        log.warn(`[search] "${query}" failed: ${err.message || err}`);
        continue;
      }
      for (const result of results) {
        if (isBlocked(result.url, blocklist)) {
          searchStats.blocked += 1;
          continue;
        }
        const meta = { kind: 'discovery', query, title: result.title, dances: dance ? [dance] : [] };
        if (add(result.url, meta)) {
          searchStats.results += 1;
        }
      }
    }
    // Advance by queries attempted this run (not results found) — self-
    // corrects as the refresh pool (which grows over the project's life)
    // eats more of the shared page cap and leaves discovery a shrinking,
    // variable slice each run.
    if (!flags.query && fullQueryList.length > 0) {
      nextDiscoveryOffset = (offset + searchStats.queries) % fullQueryList.length;
    }
  }

  return { plan, searchStats, nextDiscoveryOffset };
}
