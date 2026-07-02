// DuckDuckGo HTML search provider.
// Interface: { name, async search(query, {maxResults}) → [{title, url, snippet}] }
//
// Endpoint: https://html.duckduckgo.com/html/?q=…
// Result markup: div.result > a.result__a (href is a //duckduckgo.com/l/?uddg=<encoded>
// redirect — decode the uddg param), snippet in .result__snippet.
// DDG serves an "anomaly" JS challenge page (HTTP 202) to flagged IPs; we detect
// it and return no results with a warning instead of failing the whole run.

import * as cheerio from 'cheerio';
import { USER_AGENT } from '../fetcher.js';

const ENDPOINT = 'https://html.duckduckgo.com/html/';
const QUERY_DELAY_MS = 3000;
const TIMEOUT_MS = 15000;

let lastQueryAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function decodeResultHref(href) {
  if (!href) return null;
  let abs = href;
  if (abs.startsWith('//')) abs = 'https:' + abs;
  try {
    const u = new URL(abs, ENDPOINT);
    if (u.pathname === '/l/' || u.pathname.startsWith('/l/')) {
      // searchParams.get() already percent-decodes once — decoding again
      // corrupts targets whose query strings contain %26/%23/%3F etc.
      const uddg = u.searchParams.get('uddg');
      if (uddg) {
        // same trust boundary as the direct-href branch below: only
        // http(s) targets may enter the crawl plan
        try {
          if (/^https?:$/.test(new URL(uddg).protocol)) return uddg;
        } catch {
          // not an absolute URL — fall through to null
        }
        return null;
      }
    }
    if (/^https?:$/.test(u.protocol)) return u.href;
  } catch {
    return null;
  }
  return null;
}

function looksLikeChallenge(status, body) {
  return (
    status === 202 ||
    body.includes('anomaly.js') ||
    body.includes('challenge-form') ||
    body.includes('anomaly-modal')
  );
}

export const duckduckgo = {
  name: 'duckduckgo',

  async search(query, { maxResults = 8 } = {}) {
    const wait = lastQueryAt + QUERY_DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastQueryAt = Date.now();

    const url = `${ENDPOINT}?q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let body;
    let status;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      status = res.status;
      body = await res.text();
    } catch (err) {
      console.warn(`[duckduckgo] "${query}": fetch failed — ${err.message || err}`);
      return [];
    } finally {
      clearTimeout(timer);
    }

    if (looksLikeChallenge(status, body)) {
      console.warn(
        `[duckduckgo] "${query}": got a bot challenge page (HTTP ${status}) — ` +
          'this IP is currently rate-limited/flagged by DuckDuckGo; returning no results'
      );
      return [];
    }

    const $ = cheerio.load(body);
    const results = [];
    const seen = new Set();
    $('div.result').each((_, el) => {
      if (results.length >= maxResults) return false;
      const $el = $(el);
      if ($el.hasClass('result--ad') || $el.find('.badge--ad').length) return;
      const link = $el.find('a.result__a').first();
      const realUrl = decodeResultHref(link.attr('href'));
      if (!realUrl || seen.has(realUrl)) return;
      seen.add(realUrl);
      results.push({
        title: link.text().trim(),
        url: realUrl,
        snippet: $el.find('.result__snippet').text().trim(),
      });
    });
    return results;
  },
};

export default duckduckgo;
