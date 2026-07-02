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

// §8 v2 per-dance schema: queries.dances[dance] = {templates, standing_queries};
// cities/max_*/domain_blocklist stay top-level. Every query carries its dance
// so extraction gets the context dance (§7).
export function buildQueryList(queries, adHocQuery = null) {
  if (adHocQuery) return [{ query: adHocQuery, dance: null }];
  if (!queries || typeof queries.dances !== 'object' || queries.dances === null) return [];
  const list = [];
  const seen = new Set();
  const cities = queries.cities || [];
  const push = (query, dance) => {
    if (!query || seen.has(query)) return;
    seen.add(query);
    list.push({ query, dance });
  };
  for (const [dance, plan] of Object.entries(queries.dances)) {
    for (const template of plan?.templates || []) {
      if (template.includes('{city}')) {
        for (const city of cities) push(template.replaceAll('{city}', city), dance);
      } else {
        push(template, dance);
      }
    }
    for (const standing of plan?.standing_queries || []) push(standing, dance);
  }
  return list;
}

/**
 * @param {object} args
 *   sources    parsed sources.json (array) or null
 *   queries    parsed queries.json (object) or null
 *   entities   existing entities array
 *   provider   search provider {name, search(query, {maxResults})}
 *   flags      {noSearch, query, maxPages, sourcesOnly}
 * @returns {Promise<{plan: Array<{url, kind, sourceName?, query?, dances?}>, searchStats: {queries, results, blocked}}>}
 */
export async function planUrls({ sources, queries, entities, provider, flags = {}, log = console }) {
  const maxPages = flags.maxPages ?? queries?.max_pages_per_run ?? DEFAULT_MAX_PAGES;
  const plan = [];
  const seen = new Set();
  const searchStats = { queries: 0, results: 0, blocked: 0 };

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
    const queryList = buildQueryList(queries, flags.query);
    const maxResults = queries?.max_results_per_query ?? 8;
    const blocklist = queries?.domain_blocklist || [];
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
  }

  return { plan, searchStats };
}
