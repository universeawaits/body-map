// Orchestrator: plan → fetch → extract → geocode → merge → stale sweep →
// persist → report. See CONTRACT.md §7 for the binding pipeline description.
//
// Flags:
//   --dry-run        full pipeline, prints planned mutations, writes NOTHING
//   --query "…"      run one ad-hoc search query end-to-end
//   --url <page>     extract a single page and print the candidates
//   --no-search      curated sources + refresh only
//   --max-pages N    override the page cap
//   --actor <name>   audit actor override

import fs from 'node:fs';
import { PATHS } from './paths.js';
import { fetchPage } from './fetcher.js';
import { duckduckgo } from './search/duckduckgo.js';
import { planUrls } from './crawl.js';
import { extractCandidates, DANCE_KEYS } from './extract.js';
import { geocodeCandidates } from './geocode.js';
import { runMerge, staleSweep } from './merge.js';
import { createStore, defaultActor, nowIso } from './store.js';

function parseArgs(argv) {
  const flags = {
    dryRun: false, noSearch: false, query: null, url: null,
    maxPages: null, actor: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--dry-run': flags.dryRun = true; break;
      case '--no-search': flags.noSearch = true; break;
      case '--query': flags.query = argv[++i]; break;
      case '--url': flags.url = argv[++i]; break;
      case '--max-pages': flags.maxPages = Number(argv[++i]); break;
      case '--actor': flags.actor = argv[++i]; break;
      default:
        console.error(`Unknown flag: ${arg}`);
        process.exit(2);
    }
  }
  if (flags.maxPages != null && (!Number.isInteger(flags.maxPages) || flags.maxPages < 1)) {
    console.error('--max-pages expects a positive integer');
    process.exit(2);
  }
  if (flags.query === undefined || flags.url === undefined) {
    console.error('--query/--url expect a value');
    process.exit(2);
  }
  return flags;
}

// Config files are owned by the RESEARCH builder (CONTRACT.md §8).
// Missing or still v1-shaped (mid-rewrite) → clear message, continue degraded;
// otherwise malformed → hard error. Validators return null when fine, or
// {degrade: msg} / {fatal: msg}.
function loadConfig(file, { validate, describe }) {
  if (!fs.existsSync(file)) {
    console.warn(`[config] ${file} is missing — ${describe} disabled. ` +
      'This file is owned by the RESEARCH builder (CONTRACT.md §8).');
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`[config] ${file} is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  const problem = validate(parsed);
  if (problem?.degrade) {
    console.warn(`[config] ${file} ${problem.degrade} — ${describe} disabled for this run.`);
    return null;
  }
  if (problem?.fatal) {
    console.error(`[config] ${file} is malformed: ${problem.fatal} (schema in CONTRACT.md §8)`);
    process.exit(1);
  }
  return parsed;
}

// §8 v2 per-dance schema: {cities, max_*, domain_blocklist, dances: {tango: {templates, standing_queries}, …}}
function validateQueries(q) {
  if (typeof q !== 'object' || q === null || Array.isArray(q)) return { fatal: 'expected an object' };
  if (q.dances === undefined) {
    if (Array.isArray(q.templates) || Array.isArray(q.standing_queries)) {
      return {
        degrade:
          'is still v1-shaped (top-level "templates"/"standing_queries", no "dances" object). ' +
          'The v3 scraper needs the per-dance §8 schema: ' +
          '{"dances": {"tango": {"templates": […], "standing_queries": […]}, …}}',
      };
    }
    return { fatal: 'missing the "dances" object (per-dance v2 schema)' };
  }
  if (typeof q.dances !== 'object' || q.dances === null || Array.isArray(q.dances)) {
    return { fatal: '"dances" must be an object keyed by dance' };
  }
  for (const [dance, plan] of Object.entries(q.dances)) {
    if (!DANCE_KEYS.includes(dance)) {
      return { fatal: `unknown dance "${dance}" (allowed: ${DANCE_KEYS.join(', ')})` };
    }
    if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) {
      return { fatal: `"dances.${dance}" must be an object` };
    }
    for (const key of ['templates', 'standing_queries']) {
      if (plan[key] !== undefined && !Array.isArray(plan[key])) {
        return { fatal: `"dances.${dance}.${key}" must be an array` };
      }
    }
  }
  for (const key of ['cities', 'domain_blocklist']) {
    if (q[key] !== undefined && !Array.isArray(q[key])) return { fatal: `"${key}" must be an array` };
  }
  for (const key of ['max_results_per_query', 'max_pages_per_run']) {
    if (q[key] !== undefined && !Number.isInteger(q[key])) return { fatal: `"${key}" must be an integer` };
  }
  return null;
}

function validateSources(s) {
  if (!Array.isArray(s)) return { fatal: 'expected an array' };
  for (const [i, entry] of s.entries()) {
    if (typeof entry !== 'object' || entry === null) return { fatal: `entry ${i} must be an object` };
    if (typeof entry.url !== 'string') return { fatal: `entry ${i} is missing a "url" string` };
    if (entry.dances !== undefined && !Array.isArray(entry.dances)) {
      return { fatal: `entry ${i}: "dances" must be an array of dance keys` };
    }
  }
  return null;
}

const AGGREGATE_SOURCE_TYPES = new Set(['listing', 'directory', 'calendar', 'aggregator', 'index']);

function contextLabel(item) {
  if (item.kind === 'source') return `source:${item.sourceName}`;
  if (item.kind === 'discovery') return `search:${item.query}`;
  return 'refresh';
}

async function runSingleUrl(flags) {
  console.log(`Extracting ${flags.url} …`);
  const page = await fetchPage(flags.url);
  if (!page.ok) {
    console.error(`Fetch failed: ${page.error || page.skipped}`);
    process.exit(1);
  }
  const candidates = extractCandidates(page.body, page.url);
  console.log(`${candidates.length} candidate(s):\n`);
  console.log(JSON.stringify(candidates, null, 2));
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.url) {
    await runSingleUrl(flags);
    return;
  }

  const actor = flags.actor || defaultActor();
  const store = createStore(PATHS, { dryRun: flags.dryRun });

  const queries = loadConfig(PATHS.queriesConfig, {
    validate: validateQueries, describe: 'discovery queries',
  });
  const sources = loadConfig(PATHS.sourcesConfig, {
    validate: validateSources, describe: 'curated sources',
  });

  const doc = store.loadEntitiesDoc();
  const queue = store.loadReviewQueue();
  const rejected = store.loadRejected();
  const geocodeCache = store.loadGeocodeCache();

  if (flags.dryRun) console.log('DRY RUN — nothing will be written.\n');

  // 1. plan
  const { plan, searchStats } = await planUrls({
    sources, queries, entities: doc.entities, provider: duckduckgo, flags,
  });
  console.log(
    `Planned ${plan.length} page(s) ` +
    `(curated: ${plan.filter((p) => p.kind === 'source').length}, ` +
    `refresh: ${plan.filter((p) => p.kind === 'refresh').length}, ` +
    `discovery: ${plan.filter((p) => p.kind === 'discovery').length}; ` +
    `${searchStats.queries} search quer${searchStats.queries === 1 ? 'y' : 'ies'}, ` +
    `${searchStats.blocked} blocklisted result(s))`
  );

  // 2+3. fetch + extract
  const perSource = new Map(); // label → {pages, ok, candidates}
  const candidates = [];
  let fetchOk = 0;
  let fetchErrors = 0;
  for (const item of plan) {
    const label = contextLabel(item);
    const bucket = perSource.get(label) || { pages: 0, ok: 0, candidates: 0 };
    bucket.pages += 1;
    const page = await fetchPage(item.url);
    if (!page.ok) {
      fetchErrors += 1;
      console.warn(`  ✗ ${item.url} — ${page.error || page.skipped}`);
      perSource.set(label, bucket);
      continue;
    }
    fetchOk += 1;
    bucket.ok += 1;
    // curated aggregate pages (many events on one page): their own
    // title/address describe the directory, never an entity
    const aggregate = AGGREGATE_SOURCE_TYPES.has(item.sourceType);
    let found = [];
    try {
      found = extractCandidates(page.body, page.url, {
        heuristicFallback: !aggregate,
        categoriesHint: item.categoriesHint || [],
        dances: item.dances || [],
      });
    } catch (err) {
      console.warn(`  ✗ ${item.url} — extraction failed: ${err.message}`);
    }
    // a page yielding several candidates is a listing — its own domain must
    // not be used as a matching signal for the events found on it
    const listing = found.length > 1 || aggregate;
    for (const candidate of found) {
      candidate.context = {
        url: page.url,
        query: item.query || null,
        kind: item.kind,
        sourceName: item.sourceName || null,
        listing,
      };
      candidates.push(candidate);
    }
    bucket.candidates += found.length;
    perSource.set(label, bucket);
  }

  // 4. geocode
  const geoStats = await geocodeCandidates(candidates, geocodeCache);

  // 5. merge
  const mergeStats = runMerge({ doc, queue, rejected, candidates, store, actor });

  // 6. stale sweep (full runs only — ad-hoc query runs stay scoped)
  const sweepStats = flags.query
    ? { archived: 0, mutations: [] }
    : staleSweep({ doc, store, actor });

  // 7. persist (no-ops when dry-run)
  const mutationCount =
    mergeStats.created + mergeStats.updated + mergeStats.restored + sweepStats.archived;
  if (!flags.dryRun) {
    store.saveEntitiesDoc(doc);
    store.saveReviewQueue(queue);
    store.saveGeocodeCache(geocodeCache);
    store.flushAudit();
  } else {
    const pending = store.pendingAuditEntries();
    if (pending.length > 0) {
      console.log('\nPlanned mutations (not written):');
      for (const entry of pending) {
        console.log(`  ${entry.action}  ${entry.entity_name}  ${JSON.stringify(entry.changes)}`);
      }
    }
    const queuedNames = queue.items.map((i) => i.candidate?.name).filter(Boolean);
    if (queuedNames.length > 0) {
      console.log(`Review queue would hold ${queuedNames.length} item(s).`);
    }
  }

  // 8. report
  console.log('\nPer-source summary:');
  for (const [label, bucket] of perSource) {
    console.log(`  ${label}: ${bucket.ok}/${bucket.pages} pages fetched, ${bucket.candidates} candidate(s)`);
  }
  console.log(
    `\nTotal: ${fetchOk}/${plan.length} pages fetched, ${candidates.length} candidates, ` +
    `${geoStats.queried} geocoded (${geoStats.hits} hits) — ` +
    `${mergeStats.created} created, ${mergeStats.updated} updated, ${mergeStats.restored} restored, ` +
    `${mergeStats.queued} queued, ${sweepStats.archived} archived, ${mergeStats.dropped} dropped, ` +
    `${mergeStats.rejectedSkipped} rejected-skipped, ${mergeStats.refreshed} refreshed sightings`
  );
  console.log(`Run finished at ${nowIso()}${flags.dryRun ? ' (dry run, nothing written)' : ''}`);

  // expose counts to the GitHub Actions workflow for the commit message
  if (process.env.GITHUB_OUTPUT && !flags.dryRun) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `created=${mergeStats.created}\nupdated=${mergeStats.updated}\n` +
      `archived=${sweepStats.archived}\nqueued=${mergeStats.queued}\n`
    );
  }

  // exit non-zero only if the whole run produced nothing but errors
  if (plan.length > 0 && fetchOk === 0 && fetchErrors > 0 && mutationCount === 0) {
    console.error('Every planned fetch failed and nothing was produced — exiting non-zero.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
