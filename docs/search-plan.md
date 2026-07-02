# Search Plan — how Body Map discovers dance entities (v3, per-dance)

This is the living document for the discovery pipeline. The two files it governs
are `scraper/config/queries.json` (what we search for, per dance) and
`scraper/config/sources.json` (which sites we crawl directly, with dance
context). Edit them, test with the CLI, and record decisions here. When in
doubt, `CONTRACT.md` wins.

## 1. How discovery works end to end

Body Map covers four dances — `tango`, `salsa`, `bachata`, `kizomba` — and
every crawl/search context carries a `dance`. Every scraper run (GitHub
Actions, ~every 2 days, or `npm start` locally) plans URLs from three pools,
in strict priority order, capped at `max_pages_per_run` (200):

1. **Curated sources** — every `enabled: true` entry in `sources.json`. Each
   entry declares `dances` (context passed to extraction) and a
   `categories_hint`. These are hand-picked aggregator/calendar pages we trust
   to be dense in entities of their dance(s).
2. **Refresh** — every distinct `sources[].url` already attached to
   scraper-sourced entities in `web/data/entities.json`, so known entities get
   their `last_seen` bumped (or eventually get archived after 14 days unseen).
3. **Discovery** — DuckDuckGo HTML search over the per-dance query plan in
   `queries.json`:
   - for each dance, every template in `dances.<dance>.templates` × every city
     in the shared `cities` list (`"salsa social {city}"` → `"salsa social
     Cali"` …), plus
   - every `standing_queries` entry as-is (year-scoped event hunting per
     dance).
   Results are deduplicated, filtered against `domain_blocklist`, and truncated
   to `max_results_per_query` (8) per query. The search context's dance seeds
   the candidate's `dances`; page keywords may add more (tango/milonga/
   encuentro/práctica; salsa/timba/rueda/son/mambo; bachata/sensual;
   kizomba/urban kiz/semba/tarraxinha). Candidates whose dance cannot be
   resolved land in the review queue with reason "dance unclear".

Each planned URL is then fetched politely (descriptive UA, 2s per-host delay,
robots.txt honored) and passed to the extractor:

- **JSON-LD first** (`Event`, `DanceEvent`, `Organization`, `LocalBusiness`,
  `Place`) — highest-quality signal; also feeds `organizer` (from
  `Event.organizer`), `artists` (Person performers) and `music` (MusicGroup
  performers, DJ heuristics).
- **Heuristics fallback** — h1/title, address regexes, date parsing, weekday
  recurrence (`days_of_week`, multilingual day names), multilingual category
  keywords (milonga → `social`, social, congress → `festival`, maratón,
  encuentro, festival, clase/Kurs/cours, práctica, workshop, weekender …).

Every candidate gets a **confidence score 0–1** (JSON-LD name +0.5, address or
coords +0.2, strong category keyword +0.15, parsed dates +0.1, images/socials
+0.1, performer/organizer found +0.05; heuristics-only pages cap at 0.65 unless
name+address+category are all present). Candidates with an address but no
coordinates are geocoded via Nominatim (cached, committed cache). Then the
merge step:

| confidence | outcome |
|---|---|
| ≥ 0.7 | auto-applied: new entity created, or matched entity updated (never blanks fields, never touches `locked_fields`; `dances`/`music`/`artists` merge as union) |
| 0.4 – 0.7 | pushed to `data/review-queue.json` for human approval |
| < 0.4 | dropped (counted in the run summary) |

Candidates matching a key in `data/rejected.json` are never re-proposed.
Every mutation lands in `data/audit-log.jsonl` with its source URL/query.

## 2. Rationale of the current query set

### Templates (6 per dance)

Phrased the way a human actually googles, one or two per category. The v2
tango set is preserved verbatim; the three new dances mirror its shape with
scene-correct vocabulary:

- **tango** — `milonga {city}` / `milongas in {city}` (socials),
  `tango classes {city}` / `argentine tango lessons {city}` ("argentine"
  disambiguates from ballroom), `tango marathon {city}`,
  `tango festival {city} 2026`.
- **salsa** — `salsa social {city}` / `salsa night {city}` /
  `where to dance salsa in {city}` (the three dominant phrasings for socials
  and club nights), `salsa classes {city}`, `salsa congress {city}`
  (the salsa world says "congress" where tango says "festival"; the extractor
  maps congress → `festival`), `salsa festival {city} 2026`.
- **bachata** — `bachata social {city}` / `bachata night {city}`,
  `bachata classes {city}`, `bachata congress {city}`,
  `bachata weekender {city}` (the scene's marathon-like format),
  `bachata festival {city} 2026`.
- **kizomba** — `kizomba social {city}` / `kizomba party {city}` /
  `urban kiz party {city}` (the scene split its naming: Angolan kizomba vs
  urban kiz — both phrasings are needed), `kizomba classes {city}`,
  `kizomba weekender {city}`, `kizomba festival {city} 2026`.

Note on the `marathon` category: only tango has a true marathon/encuentro
circuit. For the other dances the nearest formats are weekenders and
intensives; expect most non-tango event discoveries to classify as `festival`
or `social`, and that is correct.

4 dances × 6 templates × 35 cities = 840 city queries plus 36 standing queries
— far above the 200-page cap on purpose: the crawl planner's priority order
and cap do the budgeting, so curated sources and refreshes are never starved
by discovery. (Open item: planner-side rotation of the discovery slice so all
queries get their turn across runs.)

### Cities (35, shared across dances)

The 25 v2 tango cities are preserved, plus 10 added for the new scenes:

- **Salsa heartland:** Cali (world salsa capital), Havana, San Juan (the
  original salsa congress), Miami, Mexico City, Los Angeles.
- **Bachata:** Santo Domingo (birthplace), Madrid (Europe's biggest
  salsa/bachata hub — also strong salsa).
- **Kizomba:** Luanda (birthplace), with the diaspora hubs Lisbon, Paris and
  London already on the list.
- **General Latin scenes:** Toronto.

The single shared list is deliberate: most of these cities have scenes in
several dances (Lisbon has tango and kizomba; NYC has all four), and low-yield
combinations (kizomba Rosario …) simply return few results — they waste one
search, not fetch budget. Cities are ASCII-normalized ("Sao Paulo",
"Medellin") because DuckDuckGo treats accented and unaccented forms
equivalently and ASCII keeps URL-encoding trivial.

### Standing queries (36 across the four dances)

City templates miss events announced without a city association or held in
small towns. Standing queries hunt those directly, and per the contract they
now span **2026–2028** — the bulk target 2026 (densest announcements), a
2027 tier catches early announcers, and a thin 2028 tier catches the big
congresses that publish 2+ years out. The v2 tango set is preserved and
extended with 2027/2028 entries. Flagship anchors are included per dance
(Buenos Aires tango festival, world salsa festival Cali, Puerto Rico salsa
congress). **Yearly chore: each January, shift the year tiers forward**
(candidate improvement: a `{year}`/`{next_year}` token in the scraper).

### Domain blocklist (24)

Three families (unchanged reasoning), plus latin-scene additions:

- **Login-walled / scrape-hostile socials** — facebook, instagram, tiktok,
  twitter/x, linkedin, vk, whatsapp, t.me/telegram.me, meetup, classpass
  (added: class listings behind login, dominates "salsa classes {city}"
  results).
- **Video/audio platforms** — youtube, youtu.be, spotify.
- **Junk-for-our-purposes** — pinterest, tripadvisor, reddit, quora, yelp,
  groupon, plus added: allevents.in and 10times.com (aggregator-of-aggregators
  with scraped, duplicated, often mislocated latin events — they flood
  salsa/bachata searches and produce sub-0.4 candidates) and feverup.com
  (JS-only ticketing shell).

Deliberately NOT blocked: eventbrite (public event pages with schema.org
JSON-LD — many bachata/salsa socials publish there), wikipedia, tangopolix,
kizzcalendar/salsanewyork (client-side but harmless; see sources notes).

## 3. Curated sources — what and why

All URLs verified responding on 2026-07-02 (see per-entry notes in
`sources.json` for structure details). Every entry now carries `dances`.

**Tango (12 entries, unchanged from v2 apart from the `dances` field and the
milonga → social rename in `categories_hint`):** Hoy Milonga (BA, Berlin),
Tangocat 2026, DanceUS tango worldwide (Event JSON-LD), Tango Kalender,
London Milongas, Milongas Berlin, European Encuentro Calendar, Milongas-in;
disabled: Tangopolix, TangoFestivals.net (client-side lists),
tangomarathons.com (HTTP 418 WAF).

**Salsa / bachata (new):**

| source | role | extraction quality |
|---|---|---|
| Latin Dance Calendar `/festivals/style/salsa/` + `/style/bachata/` | worldwide festival catalogue per style | server-rendered ~1 MB lists, ~455 detail-page anchors; heuristics on list, crawl for detail |
| DanceUS latin/salsa congresses worldwide | worldwide congress directory | **schema.org Event JSON-LD** — best-in-class |
| DanceUS London + Paris city calendars | city socials/classes | **Event JSON-LD** (27 / 11 events); more cities surface via discovery |
| Salsa Vida `/guides/festivals/` | worldwide festivals + per-city guides under `/guides/` | server-rendered WordPress, no JSON-LD, heuristics |
| London Salsa Events | London weekly socials | **36 Event JSON-LD with Place/PostalAddress/Offers** |
| go&dance `/en/festivals` | salsa/bachata/kizomba festivals (Spain-centric, worldwide) | ItemList JSON-LD + server-rendered `/en/event/<slug>` detail pages |
| FindBachata `/festivals` | 418+ bachata festivals, 37 countries | fully server-rendered, month-grouped cards, `/events/<slug>` anchors |

**Kizomba (new):**

| source | role | extraction quality |
|---|---|---|
| Kizomba Embassy events calendar | daily-updated worldwide festival calendar | WP Event Manager, server-rendered h3 per event |
| Latin Dance Calendar `/festivals/style/kizomba/` | worldwide festival catalogue | same engine as the salsa/bachata style pages |
| Where To Dance Salsa `/festivals/kizomba/` | ~105 kizomba festivals 2026 | Astro static, fully server-rendered h3 cards + detail anchors |
| Danceplace kizomba 2026 | worldwide event listing | server-rendered, 230 `/index/` detail anchors; **year-pinned URL — bump each January** |

Disabled but kept on file (do not delete — the notes explain why):
**kizzcalendar.com** (TOAST UI client-side calendar) and **salsanewyork.com**
(Vue SPA) render nothing for cheerio; **kizomba-world.com** was evaluated and
EXCLUDED entirely (HTTP 403 bot block — re-check occasionally, it is a decent
festival directory if it ever opens up).

Known gaps: no crawlable **Asia-wide** aggregator for any dance (coverage
rides on the Asian cities in the query plan); no dedicated crawlable listing
found for **Havana / Cali / Santo Domingo socials** — those scenes announce on
Facebook/WhatsApp, which we cannot and will not crawl, so coverage there
depends on the city queries surfacing venue and school websites. Finding
either is a standing to-do.

## 4. The refinement loop (you + this document)

Discovery quality is iterated, not designed once. The loop:

1. **Edit** `scraper/config/queries.json` (add a city, sharpen a template,
   add a standing query — all per dance now — or grow the blocklist) or
   `sources.json` (new aggregator with its `dances` context, toggle
   `enabled`).
2. **Test without writing anything** (all commands from `scraper/`):

   ```bash
   npm run dry-run                          # full pipeline, prints planned mutations, writes NOTHING
   node src/index.js --query "kizomba party Lisbon"   # one ad-hoc query end-to-end
   node src/index.js --url https://example.com/salsa-social   # extract one page, print candidates
   node src/index.js --no-search            # curated sources + refresh only
   node src/index.js --max-pages 20         # small-budget run
   ```

   `--url` is the main tool for tuning extraction against a specific site;
   `--query` is the main tool for judging whether a template earns its keep.
3. **Inspect** `data/review-queue.json` — every item carries its confidence,
   reasons (including "dance unclear"), and source URL/query, which tells you
   *which* query or source produced it.
4. **Approve / reject** with the admin CLI (from `scraper/`):

   ```bash
   node src/admin.js queue                          # print queue with indexes
   node src/admin.js approve --index 3              # promote item 3 to an entity
   node src/admin.js reject  --index 5 --reason "zouk studio, none of our dances"
   node src/admin.js list    --dance kizomba        # audit per-dance coverage
   node src/admin.js lock    --id <uuid> --fields name,description   # stop scraper overwrites
   ```

   Rejects are remembered in `data/rejected.json` — the scraper never
   re-proposes them, so rejecting aggressively is cheap and safe.
5. **Record** what changed and why in this file (section 5), so query/source
   decisions stay explainable.

Heuristics for the loop:

- A template that mostly fills the review queue with <0.5-confidence noise
  should be sharpened (add the dance name, add the year) or dropped.
- Watch cross-dance pollution: "salsa night" pages often list bachata and
  kizomba rooms too — that is what multi-dance `dances` arrays are for; only
  reject when the page is about none of our four dances (zouk-only, west
  coast swing …).
- A domain that repeatedly produces rejected candidates belongs in
  `domain_blocklist`.
- A site that repeatedly produces *good* review-queue items belongs in
  `sources.json` as a curated source (verify it responds, set its `dances`,
  and note its structure).
- After the scraper auto-applies a wrong value on a hand-curated entity,
  `lock` the affected fields rather than fighting the merge policy.

## 5. Change log / open items

- **2026-07-02** — initial plan (v2, tango only): 6 templates, 25 cities,
  10 standing queries, 20 blocked domains, 12 sources (9 enabled, 3 disabled
  with reasons).
- **2026-07-02** — v3 per-dance rewrite: queries.json moved to the
  `dances.<dance>.{templates,standing_queries}` schema (tango set preserved
  verbatim, standing queries extended to 2026–2028); salsa/bachata/kizomba
  template + standing-query sets added; cities 25 → 35 (Cali, Havana,
  Santo Domingo, San Juan, Miami, Madrid, Los Angeles, Mexico City, Toronto,
  Luanda); blocklist 20 → 24 (allevents.in, 10times.com, classpass.com,
  feverup.com); sources.json entries gained `dances` and the
  `categories_hint` milonga → social rename; 15 sources added (13 enabled,
  2 disabled: kizzcalendar, salsanewyork), all curl-verified 2026-07-02.
- **Open:** yearly bump of year tiers in standing queries and of the
  Danceplace year-pinned URL (or implement a `{year}` token); planner-side
  rotation of the oversized discovery pool; find a crawlable Asia-wide
  aggregator (any dance) and crawlable socials listings for Havana / Cali /
  Santo Domingo; re-check tangomarathons.com (418), kizomba-world.com (403),
  tangofestivals.net / kizzcalendar / salsanewyork (client-side rendering)
  occasionally.
