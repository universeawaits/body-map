// Polite fetch wrapper: descriptive User-Agent, per-host min delay, timeout,
// size cap, minimal robots.txt Disallow support (fail-open).

export const USER_AGENT =
  'body-map-scraper/1.0 (+https://github.com/universeawaits/body-map)';

const PER_HOST_DELAY_MS = 2000;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const lastRequestByHost = new Map();
const robotsByHost = new Map(); // host → array of disallow regexes, or null = allow all

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function politeWait(host) {
  const last = lastRequestByHost.get(host) || 0;
  const wait = last + PER_HOST_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestByHost.set(host, Date.now());
}

// Minimal robots.txt parser: only `User-agent: *` groups, only Disallow lines.
// Patterns support `*` wildcard and `$` end anchor. Anything unparseable → allow.
function parseRobots(text) {
  const rules = [];
  let inStarGroup = false;
  let groupHasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (groupHasAgent) {
        // new group starts
        inStarGroup = value === '*';
        groupHasAgent = false;
      } else {
        inStarGroup = inStarGroup || value === '*';
      }
    } else {
      groupHasAgent = true;
      if (field === 'disallow' && inStarGroup && value) {
        const anchored = value.endsWith('$');
        const pattern = anchored ? value.slice(0, -1) : value;
        const source =
          '^' +
          pattern
            .split('*')
            .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*') +
          (anchored ? '$' : '');
        try {
          rules.push(new RegExp(source));
        } catch {
          // ignore bad pattern
        }
      }
    }
  }
  return rules;
}

async function robotsAllows(url) {
  const u = new URL(url);
  const host = u.host;
  if (!robotsByHost.has(host)) {
    let rules = null; // null = allow everything (fail-open)
    try {
      await politeWait(host);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(`${u.protocol}//${host}/robots.txt`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text();
        rules = parseRobots(text);
      }
      // non-2xx (404 etc.) → fail-open
    } catch {
      // network/timeout errors → fail-open
    }
    robotsByHost.set(host, rules);
  }
  const rules = robotsByHost.get(host);
  if (!rules) return true;
  const target = u.pathname + u.search;
  return !rules.some((re) => re.test(target));
}

async function readCapped(res) {
  const lengthHeader = Number(res.headers.get('content-length') || 0);
  if (lengthHeader > MAX_BYTES) {
    throw new Error(`response too large (${lengthHeader} bytes)`);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`response too large (>${MAX_BYTES} bytes)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Fetch a page politely.
 * @returns {Promise<{ok: boolean, status?: number, url: string, body?: string,
 *                    contentType?: string, error?: string, skipped?: string}>}
 */
export async function fetchPage(url, { skipRobots = false } = {}) {
  // Redirects are followed manually so that EVERY hop — which may land on a
  // different host — gets its own robots.txt check and per-host polite delay.
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let parsed;
      try {
        parsed = new URL(current);
      } catch {
        return { ok: false, url: current, error: 'invalid URL' };
      }
      if (!/^https?:$/.test(parsed.protocol)) {
        return { ok: false, url: current, error: 'unsupported protocol' };
      }
      if (!skipRobots && !(await robotsAllows(current))) {
        return { ok: false, url: current, skipped: 'robots.txt disallow' };
      }
      await politeWait(parsed.host);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(current, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          },
          signal: controller.signal,
          redirect: 'manual',
        });
        if (REDIRECT_STATUSES.has(res.status)) {
          const location = res.headers.get('location');
          if (res.body) await res.body.cancel().catch(() => {});
          if (!location) {
            return { ok: false, status: res.status, url: current, error: `HTTP ${res.status} without Location` };
          }
          current = new URL(location, current).href;
          continue;
        }
        if (!res.ok) {
          return { ok: false, status: res.status, url: current, error: `HTTP ${res.status}` };
        }
        const body = await readCapped(res);
        return {
          ok: true,
          status: res.status,
          url: current,
          body,
          contentType: res.headers.get('content-type') || '',
        };
      } finally {
        clearTimeout(timer);
      }
    }
    return { ok: false, url: current, error: `too many redirects (>${MAX_REDIRECTS})` };
  } catch (err) {
    const msg = err.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : String(err.message || err);
    return { ok: false, url: current, error: msg };
  }
}
