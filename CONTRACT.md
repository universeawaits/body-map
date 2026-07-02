# Body Map — Build Contract (v3: multi-dance, date filter, rich popups, Ф design language)

Binding spec for every agent working on this repo. When a file and this contract
disagree, the contract wins. Repo root: `/Users/universeawaits/body-map`.
This v3 describes the TARGET end state; the v2 base build is already on disk —
phase-2 agents modify it in place.

## 0. Hard guardrails — read first

- **Zero external services, zero API keys.** No Google Maps, no Facebook, no
  Supabase, no paid or account-gated API anywhere. The only infrastructure is
  the GitHub repo itself (Pages + Actions) — and the app must also run fully
  locally from static files.
- The only network calls the system makes: OpenStreetMap tiles + Google Fonts
  CSS/woff2 (from the browser; keyless CDNs), DuckDuckGo HTML search + public
  web pages + Nominatim geocoding (from the scraper) — all polite,
  rate-limited, with a descriptive User-Agent.
- No credentials or secrets exist in this project at all. GitHub Actions uses
  only the automatic `GITHUB_TOKEN`.
- Never run anything against remote services beyond the polite public-web
  fetches above.

## 1. Product

Single-page web app ("Body Map"): a full-screen map (Leaflet + OpenStreetMap)
of social-dance entities across FOUR DANCES — tango, salsa, bachata, kizomba —
in four categories: socials (milongas), marathons, festivals, classes. A
floating circle button top-left switches the active dance (single-select
dropdown). A tab bar on top offers multi-select category tabs; under it, a
horizontal date strip (day chips, month by month) allows multi-date filtering.
Pins are Google-style teardrops taking the color of their category; when one
location carries several active categories, the pin shows a fast flowing
animated gradient of those colors. Clicking a pin opens a popup with photos,
social links, description, who plays the music, the organizer, and the artists
involved. The interface follows the Ф (phi) design language: warm paper, warm
ink, one ink-blue accent, Newsreader + Hanken Grotesk + IBM Plex Mono.
The dataset is a JSON file committed to the repo; a search-driven scraper
(GitHub Actions, every 2 days) discovers and refreshes entities per dance,
commits the changes, and every create/update/archive/restore/delete carries an
audit entry with its source.

## 2. Architecture

| Piece | Where | How |
|---|---|---|
| Frontend | GitHub Pages (or any static host) | static files in `web/`, no build step, no keys; Leaflet 1.9.4 + OSM tiles |
| Data | `web/data/entities.json` in the repo | served statically; git history versions every change |
| Ops data | `data/` in the repo | audit log (JSONL), review queue, rejected list, geocode cache |
| Scraper | GitHub Actions | `.github/workflows/scrape.yml`, cron every 2 days, Node 20, commits data changes with `GITHUB_TOKEN` |

**Workflow-chaining gotcha (handled in the base build):** pushes made with the
automatic `GITHUB_TOKEN` do NOT trigger `on: push` workflows. `deploy.yml`
declares `workflow_call` (in addition to `push` on `main` — EVERY push to main
deploys, no paths filter, phi-style — and `workflow_dispatch`), and `scrape.yml`
invokes it as a second job (`uses: ./.github/workflows/deploy.yml`) when the
scrape committed changes; caller job permissions: `pages: write, id-token:
write, contents: read`. Concurrency group `deploy-web`,
`cancel-in-progress: true`.

## 3. Repo layout & phase-2 ownership

```
web/                            ← FRONTEND agent (all of it)
  index.html                    Leaflet 1.9.4 (unpkg, SRI) + tokens.css/style.css + dance button + tabs + date strip + map
  package.json                  {"type":"module","private":true}
  css/tokens.css                NEW — the Ф design tokens, copied VERBATIM (see §6)
  css/style.css                 consumes ONLY tokens; raw hexes allowed ONLY for --cat-* pin colors
  js/config.js                  DATA_URL, tile URL + attribution, map defaults
  js/categories.js              category keys/labels(dance-aware)/colors + dance keys/labels — single source
  js/logic.js                   PURE helpers (no DOM/Leaflet): grouping, colors, escaping, URL check,
                                date matching, date-strip model, weekday math
  js/data.js                    fetch entities.json
  js/map.js                     Leaflet init, teardrop markers, popups
  js/ui.js                      tab bar + date strip + dance switcher
  js/main.js                    bootstrap, theme (prefers-color-scheme → data-theme), hash/localStorage
  data/entities.json            dataset (sample entries per §5 until the scraper takes over)
.github/workflows/deploy.yml    base build, already phi-style — do not change
supabase — DOES NOT EXIST; never reintroduce
scraper/                        ← SCRAPER agent (src/**), RESEARCH agent (config/**)
  src/…                         as base build; phase-2 deltas in §7
  config/queries.json           per-dance search plan (§8 v2 schema)
  config/sources.json           curated sites with dance context (§8)
docs/search-plan.md             ← RESEARCH agent
data/                           audit log / review queue / rejected / geocode cache (unchanged)
.github/workflows/scrape.yml    base build — unchanged in phase 2
README.md                       ← DOCS agent (update for v3)
```

## 4. Dances & categories

Dances — fixed order and keys: `tango`, `salsa`, `bachata`, `kizomba`.
Labels: Tango, Salsa, Bachata, Kizomba. Single-select in the UI (default
`tango`); an entity may belong to several (`dances` array).

Categories — the key `milonga` is RENAMED to `social` everywhere (code, CSS
vars, data, scraper keywords). Colors are unchanged. Display label of `social`
is dance-aware; all other labels constant:

| key | label (tango) | label (other dances) | color |
|---|---|---|---|
| `social` | Milongas | Socials | `#F2B134` warm yellow |
| `marathon` | Marathons | Marathons | `#7A1E2B` bordeaux |
| `festival` | Festivals | Festivals | `#6F2DA8` grape purple |
| `class` | Classes | Classes | `#2B5FD9` marrakesh (cobalt) blue |

Fixed display order: social, marathon, festival, class. Hexes are defined
exactly twice: `web/js/categories.js` (JS source of truth) and CSS custom
properties `--cat-social` … `--cat-class` in `style.css`. Nothing else
hardcodes them. **Category colors appear ONLY on pins and on the small color
dots in tabs and popup chips — nowhere else** (see §6 design language).

## 5. Data shape

`web/data/entities.json`:

```json
{ "schema_version": 2, "generated": "2026-07-02T00:00:00Z", "entities": [ … ] }
```

Entity (v3 — new fields marked ★):

```json
{
  "id": "uuid",
  "name": "La Viruta",
  "dances": ["tango"],                                   ★ non-empty ⊆ four dance keys
  "categories": ["social", "class"],
  "description": "Plain text. May come from scraping — ALWAYS HTML-escape before rendering.",
  "lat": -34.5885, "lng": -58.4303,
  "address": "Armenia 1366", "city": "Buenos Aires", "country": "Argentina",
  "schedule": "Wed-Sun from 23:30",
  "days_of_week": ["wed", "thu", "fri", "sat", "sun"],   ★ ⊆ [mon..sun], weekly recurrence
  "start_date": null, "end_date": null,
  "images": ["https://picsum.photos/seed/laviruta-1/400/300"],
  "socials": {"website": "…", "facebook": "…", "instagram": "…", "email": "…"},
  "organizer": {"name": "…", "url": "…"},                ★ null or object with at least name
  "music": [{"name": "DJ …", "type": "dj", "url": "…"}], ★ type ∈ dj|orchestra|band
  "artists": [{"name": "…", "role": "teacher", "photo": "…", "video": "…", "url": "…"}], ★
  "status": "active",
  "locked_fields": [],
  "sources": [{"source": "seed", "ref": "la-viruta", "url": null,
               "first_seen": "2026-07-02T00:00:00Z", "last_seen": "2026-07-02T00:00:00Z"}],
  "created_at": "2026-07-02T00:00:00Z", "updated_at": "2026-07-02T00:00:00Z"
}
```

- `categories`: non-empty subset of the four keys (`social|marathon|festival|class`).
  `start_date`/`end_date` (ISO dates) for marathons/festivals, null otherwise.
  `days_of_week` for weekly recurring entities (socials/classes), else `[]`.
  `images`: URL strings, first is cover. `socials`: all keys optional.
  `organizer` null or `{name, url?}`; `music`/`artists` arrays (may be empty);
  all URLs http(s) only, `photo` is an image URL, `video` a page/video URL.
- `sources[].source` values: `seed`, `manual`, `scraper:search`,
  `scraper:site:<domain>`. `locked_fields`: field names the scraper must never
  overwrite (set via admin CLI).
- Sample dataset (until the scraper takes over): 24–28 entries — keep/upgrade
  the existing 15 tango entries (add `dances:["tango"]`, `days_of_week` for
  weeklies, `organizer`/`music`/`artists` on most, rename category key) and add
  9–12 realistic salsa/bachata/kizomba entries (socials, festivals/congresses,
  classes; cities like Cali, Havana, Santo Domingo, Lisbon, Paris, London, NYC).
  Every description ends "(sample data)"; ≥2 entries share identical lat/lng;
  ≥2 entries have 2+ categories; ≥1 entry has 2+ dances (e.g. a salsa+bachata
  school); marathons/festivals get concrete dates SPREAD ACROSS 2020–2028 —
  a few past editions (2020–2025), several 2026, a few 2027–2028 — so the full
  date-strip range shows results; fixed ISO timestamps.

`data/audit-log.jsonl`, `data/review-queue.json`, `data/rejected.json`,
`data/geocode-cache.json`: unchanged from base build (see git history of this
file for the full shapes; audit entry = one JSON line with ts / action ∈
create|update|archive|restore|delete|approve|reject / entity_id / entity_name /
source / actor / changes {field:{old,new}} / context {url, query}).

## 6. Frontend

### Design language — the Ф (phi) tokens

- `web/css/tokens.css` — copied VERBATIM from the session scratchpad file
  `phi-tokens.css` (adopted from the Ф Design System: warm paper `#FBF9F4`,
  ink text scale, hairlines, ink-blue accent `#29487B`, Newsreader / Hanken
  Grotesk / IBM Plex Mono via one Google Fonts import, 4px spacing scale,
  crisp radii, hairline-first shadows, restrained motion, full
  `[data-theme="dark"]` block).
- `style.css` consumes ONLY tokens (no raw hexes except the four `--cat-*`).
- `main.js` sets `data-theme` from `prefers-color-scheme` and re-listens for
  changes. Map tiles stay standard OSM in both themes.
- Rules: sentence case everywhere, no emoji in UI, icons are inline-SVG
  Lucide-style line icons. The flowing gradient on pins is the ONE sanctioned
  exception to phi's no-gradients rule.
- Chrome specs: top bar `--paper` bg + `--line` bottom hairline; "Body Map"
  wordmark in Newsreader (`--h3`). Tabs: pill chips — `--surface` + `--line`
  hairline + sans `--body`; hover `--surface-hover`; selected `--accent-soft`
  bg with `--accent` text/border; the category color appears only as the dot.
  Date chips: same language; selected = `--accent` bg / `--accent-ink` text;
  today outlined `--line-strong`; month separators as uppercase eyebrow labels
  (`--label` + `--label-track`, `--ink-3`). Popups: `--surface`, `--r-lg`,
  `--shadow-3`, `--line` hairline; entity name in Newsreader `--h4`;
  description serif `--prose` scaled ~15px; section labels (Music /
  Organized by / Artists) as uppercase eyebrows; link buttons as small
  hairline pills. "data updated" chip + attribution: `--caption`, `--ink-3`.

### Behavior

- **Zero configuration**: works immediately when served statically.
- **Dance switcher**: floating circular button top-left over the map
  (`--surface`, `--line-strong` border, `--shadow-1`), shows the active
  dance's initial letter; click opens a dropdown (`--surface`, `--r-md`,
  `--shadow-2`; role=menu, aria-expanded, Esc/click-outside closes) listing
  the four dances; selected row `--accent-soft` + inline-SVG check.
  Single-select. Precedence at load: URL hash `#dance=<key>` → localStorage
  `bodymap.dance` → `tango`. Switching updates hash + localStorage, re-renders
  pins, re-resolves the `social` tab label, updates counts.
- **Tabs** (`ui.js`): one pill per category in fixed order — color dot, dance-
  aware label, live count of visible entities; multi-select (`aria-pressed`),
  all selected on load; every toggle re-renders pins.
- **Date strip** (under the tabs, same top-bar block): horizontally scrollable
  strip of day chips — weekday abbreviation over day number, ≥40px tap
  targets; sticky "Mon YYYY" month separator chips (year always visible). The
  strip spans **2020-01-01 through 2028-12-31** (full years 2020–2028, past
  included). Initial view is scrolled so TODAY sits at the left edge; months
  render lazily in BOTH directions as the user scrolls (windowed rendering;
  when prepending past months, anchor the scroll position so the view does not
  jump). A small "Today" pill next to the strip jumps back to today; today's
  chip is outlined. Click toggles a chip (multi-select, `aria-pressed`). When
  ≥1 selected, a sticky "N dates ✕" clear pill appears at the left edge.
  Every toggle re-renders pins + counts.
- **Visibility** (pure, `logic.js`): entity visible ⇔ `status === 'active'`
  AND `dances` includes the active dance AND (categories ∩ selected ≠ ∅) AND
  `matchesDates(entity, selectedDates)` where: no dates selected → true;
  otherwise true iff ANY selected date d falls within
  [start_date, end_date || start_date] OR `days_of_week` contains d's weekday.
  Entities with neither dates nor recurrence are hidden while a date filter is
  active. Weekday math from the 'YYYY-MM-DD' string via UTC (no TZ drift).
- **Grouping**: by `lat.toFixed(4) + ',' + lng.toFixed(4)` over visible
  entities; empty groups hidden.
- **Pin**: `L.marker` with `L.divIcon` — Google-style TEARDROP (rounded head
  ~34px tapering to a point via rounded-square rotated -45°,
  `border-radius: 50% 50% 50% 0`), **no border/outline**; soft drop shadow
  only. Tip anchors exactly on the lat/lng; popup opens above the head; hover
  scale ≈1.12 with transform-origin at the tip. Effective colors = union of
  (entity.categories ∩ selected) across the group in fixed order; one color →
  solid; two+ → `linear-gradient(120deg, c1, …, c1)`, `background-size: 300%
  300%`, background-position keyframes 0%→100%, duration `--pin-flow-duration:
  1.2s`, linear infinite — FAST flow. Count badge (>1 entity) top-right of the
  head, counter-rotated to read upright.
- **Popup** (maxWidth ≈ 340) per entity in the group: name (serif), category
  chips (dot + dance-aware label), schedule or date range, description
  (clamped ~4 lines), **Music row** (names + type badge dj/orchestra/band,
  linked when url), **Organized by row** (name, linked), **Artists block**
  (compact cards: 40px photo thumb — lazy, hidden on error — name, role,
  video link as small icon-button opening in a new tab with rel=noopener),
  then up to 3 images (72px thumbs, lazy, hidden on error), social link pills
  (Website / Facebook / Instagram / Email — omit missing). Multiple entities →
  stacked sections with hairline dividers. **Every dynamic string goes through
  the logic.js escape helper; every URL through the scheme check
  (http/https/mailto only).**
- First load: fitBounds to visible pins (fallback: center Europe, zoom 4).
  Corner chip shows "data updated <generated date>". Responsive: tabs and date
  strip scroll horizontally on narrow screens.
- `logic.js` stays pure; extend the existing node assertion suite to cover
  date matching (ranges, weekdays, none-selected, no-date-info hiding), strip
  month generation, dance filtering, and label resolution.

## 7. Scraper (phase-2 deltas; everything else stays as the base build)

- **Dance dimension**: every crawl/search context carries a `dance` (from the
  §8 config). Extraction classifies candidate dances: start from the context
  dance; page keywords may add more (tango/milonga/encuentro/práctica;
  salsa/timba/rueda/son/mambo; bachata/sensual; kizomba/urban kiz/semba/
  tarraxinha). Candidates whose dance cannot be resolved → review queue with
  reason "dance unclear". `dances` merges as union. Category keyword `milonga`
  now maps to key `social` (keyword lists otherwise unchanged + salsa-world
  terms: social, congress → festival).
- **Weekday recurrence**: parse `days_of_week` from schedule/description text —
  multilingual day names/abbreviations (en, es, de, fr, it) and ranges
  ("Wed-Sun", "lun-vie") expanded. Normal update policy (replace when
  different, never blank, respects locked_fields).
- **Music / organizer / artists**: JSON-LD `Event.performer` → Person entries
  to `artists` (role performer unless obviously teacher), MusicGroup entries
  to `music` (type band unless name matches /orquesta|orchestra/i → orchestra);
  `Event.organizer` → `organizer {name, url}`. Heuristics: /\b(T?DJ)\s+[A-ZÀ-Ž]/
  and "musicaliza…" → music (type dj); "organized by / organiza / veranstaltet
  von / organisé par" → organizer. Confidence +0.05 when performer or organizer
  found (cap 1.0; rubric otherwise unchanged). `music`/`artists` merge as
  union by normalized name; `organizer` follows scalar never-blank policy.
- Category validation now checks `social|marathon|festival|class`; entity
  validation checks `dances` non-empty ⊆ the four dance keys.
- Admin CLI: `--json` patches already cover the new fields; `list` gains
  `--dance X` filter. Everything else unchanged.

## 8. Search plan (RESEARCH agent) — v2 per-dance schema

`scraper/config/queries.json`:

```json
{
  "cities": ["Buenos Aires", "Berlin", "Cali", "Havana", "Lisbon", "…"],
  "max_results_per_query": 8,
  "max_pages_per_run": 200,
  "domain_blocklist": ["facebook.com", "instagram.com", "…"],
  "dances": {
    "tango":   {"templates": ["milonga {city}", "…"], "standing_queries": ["…"]},
    "salsa":   {"templates": ["salsa social {city}", "salsa congress {city}"], "standing_queries": ["…"]},
    "bachata": {"templates": ["…"], "standing_queries": ["…"]},
    "kizomba": {"templates": ["…"], "standing_queries": ["…"]}
  }
}
```

`scraper/config/sources.json` — every entry gains `"dances": ["tango"]`
context. Preserve the existing verified tango sources; ADD researched, live,
verified sources for salsa, bachata, and kizomba (congress calendars, social
listings, festival directories — verify each URL responds before including).
Extend cities to cover the new scenes (Cali, Havana, Santo Domingo, San Juan,
Lisbon, Luanda-diaspora hubs like Paris/London, Miami, NYC). Templates: what a
human would actually google per dance and category; standing queries cover
current and upcoming years (2026–2028), not a single year. `docs/search-plan.md`:
update for the per-dance model and the refinement loop (edit → dry-run /
--query / --url → review queue → approve/reject via admin CLI).

## 9. Conventions

Plain JavaScript everywhere — no TypeScript, no transpilers, no frontend
dependencies, scraper dependency = cheerio only. Comments only where code
can't say it. All times UTC ISO-8601. No frameworks. Scraper paths stay
repo-root-relative via `src/paths.js`. Sentence case, no emoji, line icons.
