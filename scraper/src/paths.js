// Repo-root-relative path resolution. Works from any CWD because everything
// is derived from this file's own location (scraper/src/paths.js → root is ../../).
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, '..', '..');

export const PATHS = {
  repoRoot: REPO_ROOT,
  entities: path.join(REPO_ROOT, 'web', 'data', 'entities.json'),
  auditLog: path.join(REPO_ROOT, 'data', 'audit-log.jsonl'),
  reviewQueue: path.join(REPO_ROOT, 'data', 'review-queue.json'),
  translationsQueue: path.join(REPO_ROOT, 'data', 'translations-queue.json'),
  rejected: path.join(REPO_ROOT, 'data', 'rejected.json'),
  geocodeCache: path.join(REPO_ROOT, 'data', 'geocode-cache.json'),
  queriesConfig: path.join(REPO_ROOT, 'scraper', 'config', 'queries.json'),
  sourcesConfig: path.join(REPO_ROOT, 'scraper', 'config', 'sources.json'),
};

export default PATHS;
