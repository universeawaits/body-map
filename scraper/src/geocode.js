// Nominatim geocoding with a persistent, committed cache (data/geocode-cache.json).
// Only candidates that have an address but no coordinates are geocoded.
// ≥1.1s between requests per the Nominatim usage policy. Misses are cached too
// (lat/lng null) so we never re-hammer the same failing address.

import { USER_AGENT } from './fetcher.js';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const SPACING_MS = 1100;
const TIMEOUT_MS = 15000;

let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeAddressKey(candidate) {
  return [candidate.address, candidate.city, candidate.country]
    .filter(Boolean)
    .join(', ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function queryNominatim(query) {
  const wait = lastRequestAt + SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const url = `${ENDPOINT}?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return { miss: true };
    const hit = rows[0];
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { miss: true };
    return { lat, lng, display: hit.display_name || null };
  } catch (err) {
    return { error: err.name === 'AbortError' ? 'timeout' : String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fill lat/lng on candidates in place, using and updating the cache.
 * @returns {{queried: number, hits: number, misses: number, errors: number, cacheDirty: boolean}}
 */
export async function geocodeCandidates(candidates, cache, { log = console } = {}) {
  const stats = { queried: 0, hits: 0, misses: 0, errors: 0, cacheDirty: false };
  for (const candidate of candidates) {
    if (candidate.lat != null && candidate.lng != null) continue;
    if (!candidate.address) continue;
    const key = normalizeAddressKey(candidate);
    if (!key) continue;

    let entry = cache[key];
    if (!entry) {
      stats.queried += 1;
      const result = await queryNominatim(key);
      if (result.error) {
        stats.errors += 1;
        log.warn(`[geocode] "${key}": ${result.error} (not cached)`);
        continue; // transient — do not cache errors
      }
      entry = {
        lat: result.miss ? null : result.lat,
        lng: result.miss ? null : result.lng,
        display: result.miss ? null : result.display,
        ts: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      cache[key] = entry;
      stats.cacheDirty = true;
    }

    if (entry.lat != null && entry.lng != null) {
      candidate.lat = entry.lat;
      candidate.lng = entry.lng;
      stats.hits += 1;
    } else {
      stats.misses += 1;
    }
  }
  return stats;
}
