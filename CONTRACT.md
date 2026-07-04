# Body Map — Build Contract (v5: month-select, popup carousel + hero redesign, map bounds)

Binding spec for every agent working on this repo. When a file and this contract
disagree, the contract wins. Repo root: `/Users/universeawaits/body-map`.
This v5 describes the TARGET end state; the v4 base build is already on disk —
phase-4 agents modify it in place. v4 added: a glass/transparent topbar overlay,
full interface (UI chrome) translation into 11 languages, icon-style popup
social links, and a local-only (never CI) pipeline for translating scraped
entity content — see §10. v5 adds: whole-month date-strip selection, a
redesigned popup (hero photo header, no organizer row, one-line artist rows,
prev/next carousel for co-located multi-entity pins, wider card), and map
zoom/pan bounds that keep the view from drifting into tile-less blank space.
All interface copy is British English (`en-GB` locale, British spellings in
source strings and comments — e.g. "centre", not "center").

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
animated gradient of those colors. Clicking a pin opens a popup — a hero photo
header, social links, description, who plays the music, and the artists
involved — with a prev/next carousel when the pin covers several entities.
The interface follows the Ф (phi) design language: warm paper, warm
ink, one ink-blue accent, Newsreader + Hanken Grotesk + IBM Plex Mono.
The dataset is a JSON file committed to the repo; a search-driven scraper
(GitHub Actions, weekly on Fridays) discovers and refreshes entities per
dance, commits the changes, and every create/update/archive/restore/delete
carries an audit entry with its source.

## 2. Architecture

| Piece | Where | How |
|---|---|---|
| Frontend | GitHub Pages (or any static host) | static files in `web/`, no build step, no keys; Leaflet 1.9.4 + OSM tiles |
| Data | `web/data/entities.json` in the repo | served statically; git history versions every change |
| Ops data | `data/` in the repo | audit log (JSONL), review queue, rejected list, geocode cache |
| Scraper | GitHub Actions | `.github/workflows/scrape.yml`, cron `0 10 * * 5` (Fridays 12:00 Berlin/CEST), Node 20, commits data changes with `GITHUB_TOKEN` |

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
  index.html                    Leaflet 1.9.4 (unpkg, SRI) + tokens.css/style.css + glass topbar (tabs, lang + dance
                                switcher, date strip) + map — no wordmark (see §6)
  package.json                  {"type":"module","private":true}
  css/tokens.css                NEW — the Ф design tokens, copied VERBATIM (see §6)
  css/style.css                 consumes ONLY tokens; raw hexes allowed ONLY for --cat-* pin colors and the
                                topbar's translucent-glass rgba() overlay states (see §6)
  js/config.js                  DATA_URL, tile URL + attribution, map defaults
  js/categories.js              category/dance KEYS + colors + fixed order — single source (labels moved to i18n.js)
  js/i18n.js                    NEW (v4, §10) — 11-language UI-chrome translation tables + lang resolution helpers
  js/logic.js                   PURE helpers (no DOM/Leaflet): grouping, colors, escaping, URL check,
                                date matching, date-strip model, weekday math, lang-aware labels/dates (§10)
  js/data.js                    fetch entities.json
  js/map.js                     Leaflet init, teardrop markers, popups (icon-style social links, §6)
  js/ui.js                      tab bar + date strip + dance switcher + language switcher (§10)
  js/main.js                    bootstrap, theme (prefers-color-scheme → data-theme), hash/localStorage (dance + lang)
  data/entities.json            dataset (sample entries per §5 until the scraper takes over)
.github/workflows/deploy.yml    base build, already phi-style — do not change
supabase — DOES NOT EXIST; never reintroduce
scraper/                        ← SCRAPER agent (src/**), RESEARCH agent (config/**)
  src/…                         as base build; phase-2 deltas in §7; phase-3 translation pipeline in §10
  src/translate.js              NEW (v4, §10) — local-only CLI: queue / export / import entity translations
  config/queries.json           per-dance search plan (§8 v2 schema)
  config/sources.json           curated sites with dance context (§8)
docs/search-plan.md             ← RESEARCH agent
docs/i18n-plan.md               NEW (v4) — the translation workflow as a living doc (§10)
data/                           audit log / review queue / rejected / geocode cache / translations queue (§10)
.github/workflows/scrape.yml    base build; git-adds data/translations-queue.json (detection only — §10)
README.md                       ← DOCS agent (update for v4)
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
  "translations": {                                       ★ v4 (§10) — {} until translated
    "DE": {"description": {"text": "…", "source_hash": "sha256…", "translated_at": "…"}}
  },
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
- `translations` (★ v4, §10): keyed by one of the 10 non-English language
  codes, each holding a subset of `{description, schedule}` — the only two
  prose fields worth translating. Never populated for proper nouns (`name`,
  `city`, `country`, `organizer`/`artist` names, `address`) — those render
  verbatim in every language. Each leaf is `{text, source_hash, translated_at}`;
  `source_hash` is a sha256 of the English source text at translation time, so
  a later scraper edit to `description`/`schedule` is detected as stale
  (queued for re-translation) rather than silently showing outdated text next
  to updated English. Populated only by `scraper/src/translate.js import`,
  never by the scraper's own merge step.
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
- Chrome specs (v4): top bar is a **glass overlay floating over the full-bleed
  map** — `position: absolute` over `#map`, `rgba(36,34,28,.30)` background,
  `backdrop-filter: blur(18px) saturate(1.15)`, no hairline border (a soft
  blurred drop shadow marks its bottom edge instead). **No wordmark** — the
  source ships none in the topbar; do not reintroduce "Body Map" as an `<h1>`.
  Tabs/day-chips/today-pill/dance-switcher/lang-switcher all render as
  translucent white-on-glass controls (`rgba(255,255,255,.14–.80)` states)
  rather than the opaque `--surface`/`--line` tokens — those opaque tokens are
  reserved for the map-level UI (popups, corner chip, Leaflet controls), which
  is unaffected. Category color still appears only as the tab dot. Popups:
  `--surface`, `--r-lg`, `--shadow-3`, `--line` hairline; entity name in
  Newsreader `--h4` (either plain, or overlaid on a hero photo — see §6
  Popup); description serif `--prose` scaled ~15px; section labels (Music /
  Artists) as uppercase eyebrows, translated per §10; social links are
  **icon-only 34×34 circular buttons** (`aria-label`/`title` carry the
  platform name), not text pills. "data updated" chip (translated per §10) +
  attribution: `--caption`, `--ink-3`.

### Behavior

- **Zero configuration**: works immediately when served statically.
- **Dance switcher** (v4: moved in-flow): circular glass button at the right
  end of the topbar row (was: floating top-left over the map in v3), shows the
  active dance's initial letter, translated per §10; click opens a dropdown
  (translucent dark glass, role=menu, aria-expanded, Esc/click-outside closes)
  listing the four dances (translated labels); selected row highlighted +
  inline-SVG check. Single-select. Precedence at load: URL hash `#dance=<key>`
  → localStorage `bodymap.dance` → `tango`. Switching updates hash +
  localStorage, re-renders pins, re-resolves the `social` tab label, updates
  counts.
- **Language switcher** (v4, §10): globe-icon + language-code glass button
  immediately left of the dance switcher; dropdown lists all 11 languages by
  native + English name. Precedence at load: URL hash `#lang=<code>` →
  localStorage `bodymap.lang` → `EN`. Switching re-renders every translated
  chrome element live (tabs, dance names, "Today" pill, date-strip weekday/
  month labels, open popups) without touching `dance`/date-filter state.
- **Tabs** (`ui.js`): one pill per category in fixed order — color dot, dance-
  AND lang-aware label (§10), live count of visible entities; multi-select
  (`aria-pressed`), all selected on load; every toggle re-renders pins.
- **Date strip** (under the tabs, same top-bar block): horizontally scrollable
  strip of day chips — weekday abbreviation over day number, ≥40px tap
  targets; sticky "Mon YYYY" month separator chips (year always visible),
  with a solid-ish glass backing (`rgba(20,19,15,.62)`, not fully transparent)
  so day chips scrolling underneath the sticky label never show through it.
  The strip spans **2020-01-01 through 2028-12-31** (full years 2020–2028,
  past included). Initial view is scrolled so TODAY sits at the left edge;
  months render lazily in BOTH directions as the user scrolls (windowed
  rendering; when prepending past months, anchor the scroll position so the
  view does not jump). A small "Today" pill next to the strip jumps back to
  today; today's chip is outlined. Click toggles a chip (multi-select,
  `aria-pressed`). **Month select** (v5): the month label is itself a button —
  clicking it selects every day in that month at once (or clears them, if the
  whole month is already selected); the label's own `aria-pressed` reflects
  whether all of its days are currently selected, kept in sync on every
  individual day toggle too. When ≥1 date selected, a sticky "N dates ✕" clear
  pill appears at the left edge. Every toggle re-renders pins + counts.
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
- **Popup** (maxWidth ≈ 400, up from 340 in v4 to fit the wider hero/artist
  layout) shows **one entity at a time** — a co-located group with several
  entities gets a **prev/next carousel** instead of v4's stacked sections with
  hairline dividers: a nav strip (‹ count › ) at the very top of the card,
  only rendered when the group has >1 entity; clicking prev/next toggles which
  `.popup-entity` section is `hidden` and calls Leaflet's `popup.update()` so
  the popup resizes/repositions for the new content. Wired in `map.js`'s
  `popupopen` handler (`wireCarouselNav`) since it needs the live popup DOM,
  not the HTML string passed to `bindPopup`.
  Per entity: a **hero photo header** if the entity has ≥1 image — the first
  valid image bleeds edge-to-edge across the card's full width (negative
  margins cancel the card's own padding), with the entity name overlaid at
  the bottom on a frosted glass plate (`backdrop-filter: blur(14px)`, a
  `radial-gradient` alpha mask so the plate's own edges fade out softly
  rather than reading as a hard-edged chip). Only the very first thing in the
  card (no nav strip above it) gets its top corners rounded to match the
  card; otherwise a plain heading (name only, no photo) is used — **no
  organizer row** (dropped in v5; `entity.organizer` is still scraped/stored,
  just not displayed). Then: category chips (dot + dance- AND lang-aware
  label), schedule or date range (locale-formatted per §10; entity
  `description`/`schedule` text itself stays English unless a §10
  `translations` entry exists for the active language), **Music row** (names
  + type badge dj/orchestra/band — badge text translated, names verbatim —
  linked when url), **Artists block** (one compact row per artist: 32px photo
  thumb — lazy, hidden on error — name and role share a single line, role as
  a muted inline suffix rather than a second line, truncating with an ellipsis
  rather than wrapping; video link as a small icon-button opening in a new
  tab with rel=noopener), then **icon-only social link buttons** (34×34
  circular, Website / Facebook / Instagram / Email — omit missing;
  `aria-label`/`title` translated). The old up-to-3 square image thumbnails
  are gone — only the hero uses a photo now. **Every dynamic string goes
  through the logic.js escape helper; every URL through the scheme check
  (http/https/mailto only).** Popups near the top of the viewport get extra
  `autoPanPaddingTopLeft` (topbar height + margin) so Leaflet's own autopan
  clears the glass topbar in the common case; `map.js`'s `popupopen` handler
  re-measures after open and issues a corrective `panBy` for the cases
  Leaflet's own padding under-corrects (very tall popups on short viewports),
  but only if the correction is smaller than one viewport height — a larger
  computed deficit means a bad measurement (e.g. mid-zoom), not a real
  overlap, so it's skipped rather than flinging the view somewhere absurd.
- **Map bounds** (v5): `minZoom: 2` (`config.js`'s `MIN_ZOOM`) on both the map
  and the tile layer, plus `maxBounds: [[-90,-180],[90,180]]` with
  `maxBoundsViscosity: 1.0` on the map. Below that zoom the world is smaller
  than the viewport, and without bounds, panning/zooming out revealed blank
  space past the map's real edges — tinted near-black by `--surface-sunken`
  in dark theme (`#14130F`), which read as a broken black background. Fixed
  at the source (map can no longer reach that state) rather than patched by
  recolouring the sunken token.
- First load: fitBounds to visible pins (fallback: centre of Europe, zoom 4).
  Corner chip shows "data updated <generated date>" (translated per §10,
  including correct one/few/many/other pluralization for the date-strip's
  "N dates" clear pill via `Intl.PluralRules`). Responsive: tabs and date
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
- **Translations-queue diff (v4, §10)**: new step between the stale sweep and
  persist — rebuilds `data/translations-queue.json` from every active
  entity's `description`/`schedule` vs. its `translations` field. Read-only
  detection; the actual translation CLI (`scraper/src/translate.js`) is
  local-only and never runs here — see §10 for the full workflow.

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

## 10. Internationalization (v4)

Two independent efforts — do not conflate them.

**A. Interface (UI chrome) — fully translated, client-side, no data-schema
involvement.** 11 languages: EN (default), DE, ES (Latin America), PT, IT, RU,
UK, ZH, JA, KO, FR. `web/js/i18n.js` exports `UI[langCode]` (chrome strings:
`today`, `music`, `organizedBy`, `artists`, `from`, `until`, `links{…}`,
`dances{…}`, `cats{…}` — the last dance-aware exactly like the v3 `social`
label), `ROLES[langCode]` (artist role vocab: teacher/performer), and
`MTYPES[langCode]` (music-credit type vocab: dj/orchestra/band), plus
`LANG_META`/`LANG_CODES`/`resolveLang`/`parseLangHash`. Weekday/month/date
formatting is derived per-locale via `Intl` in `logic.js` (`buildMonthModel`,
`formatDate` take a `locale` param; `scheduleLabel` takes a `lang` param) —
never hand-translated tables for dates. Active language persists in
`localStorage` under `bodymap.lang`, with URL hash `#lang=<code>` taking
precedence at load (same precedence pattern as `bodymap.dance`/`#dance=`).
**Entity content itself (name, description, schedule, address, city,
country, organizer/artist names) is NOT part of this effort** — those are
scraped strings, not UI chrome, and stay in their original (scraped)
language unless a translation exists per part B. The date-strip's "N dates"
clear-pill (`UI[lang].dateCount`, selected via `Intl.PluralRules` — RU/UK
carry the full one/few/many/other Slavic plural set, others one/other or a
single invariant form for languages without number-based plurals) and the
corner "data updated <date>" chip (`UI[lang].dataUpdated`) are both fully
translated, matching every other piece of UI chrome.

**B. Entity content — local-only, human-in-the-loop, never CI.** After every
scraper run, `scraper/src/index.js` diffs every active entity's `description`/
`schedule` against `entity.translations[<lang>][<field>].source_hash` for all
10 non-English languages, and rebuilds `data/translations-queue.json` (one
queue item per entity+field still missing/stale in ≥1 language). This
diff step commits via the normal `scrape.yml` job (the queue file is added to
its `git add` list alongside the other `data/*.json` ops files) — detection
is automated because it's read-only analysis, not translation. Translating is
**always manual and local**: `cd scraper && node src/translate.js queue`
lists pending items; `node src/translate.js export --out batch.md [--lang XX]
[--limit N]` writes a markdown file (one fenced source-text block + a blank
`> translation:` placeholder per item×language) meant to be pasted into the
user's own separate AI subscription and back; `node src/translate.js import
--file batch.md` parses the filled-in file, verifies each block's source text
still matches the entity's current field (via sha256 — a stale match is
skipped with a warning telling you to re-export), merges accepted
translations into `entity.translations[lang][field]`, and audits each touched
entity. **This CLI must never be added to `.github/workflows/scrape.yml` or
any other CI step** — the whole point is that translation goes through a
human's own AI account, not a key baked into this repo (see §0's zero-API-key
guardrail — `translate.js` doesn't violate it only because it makes zero
network/API calls itself). `docs/i18n-plan.md` is the living document for
this workflow's iteration (coverage per language, quality notes, backlog),
following `docs/search-plan.md`'s conventions.
