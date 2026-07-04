# i18n Plan — how Body Map translates its interface and its data (v4)

This is the living document for internationalization. It governs two
independent, differently-shaped efforts: the always-on interface translation
(`web/js/i18n.js`) and the manual, local-only entity-content translation
pipeline (`scraper/src/translate.js`, `data/translations-queue.json`). Edit
this doc as either evolves. When in doubt, `CONTRACT.md` §10 wins.

## 1. Interface translation — how it works end to end

`web/js/i18n.js` is the single source of truth for UI chrome strings across
11 languages (EN default, DE, ES, PT, IT, RU, UK, ZH, JA, KO, FR): the "Today"
pill, dance names, dance-aware category labels (`social` → Milongas/Socials,
same pattern as the base language), popup section eyebrows (Music/Organized
by/Artists), the "From"/"Until" schedule words, social-link names, and the
artist-role (teacher/performer) and music-type (dj/orchestra/band)
vocabularies. Weekday/month/date formatting is never hand-translated — it's
derived per-locale via `Intl.DateTimeFormat`/`toLocaleDateString` in
`logic.js` (`buildMonthModel(monthKey, locale)`, `formatDate(iso, locale)`),
keyed off each language's `locale` field in `i18n.js`.

Active language resolves at load exactly like the dance switcher: URL hash
`#lang=<code>` → `localStorage.bodymap.lang` → `EN`. Switching languages
re-renders every translated chrome element live (tabs, dance switcher, date
strip, open popups) without touching the dance or date-filter selection.

**Deliberately out of scope for this table**: entity content (name,
description, schedule, address, city, country, organizer/artist names) —
those are scraped strings, not UI chrome, and are covered by §2 below
instead.

## 2. Entity-content translation — the local pipeline

Unlike the interface, entity `description`/`schedule` text can't be
hand-translated once and forgotten — it's scraped, changes over time, and
there's no acceptable automated-translation API within this project's
zero-external-services guardrail (`CONTRACT.md` §0). So translation is a
human-in-the-loop loop, gated behind the maintainer's own AI subscription,
run locally:

1. Every scraper run (CI or local), a new pipeline step diffs every active
   entity's `description`/`schedule` against `entity.translations[lang]
   [field].source_hash` for the 10 non-English languages, and rewrites
   `data/translations-queue.json` to hold exactly the (entity, field) pairs
   still missing or stale in ≥1 language. This is pure detection — read the
   dataset, write the queue — so it's safe to run in CI and does commit
   automatically (`scrape.yml`'s `git add` list includes the queue file).
2. Locally, the maintainer runs `node src/translate.js queue` to see what's
   pending, `export --out batch.md [--lang XX] [--limit N]` to get a
   markdown batch (fenced source text + a blank `> translation:` placeholder
   per item×language), pastes it into their own separate AI chat, pastes the
   replies back in place, and runs `import --file batch.md`.
3. `import` re-hashes each entity's *current* field value and compares it to
   the hash implied by the block's fenced source text. A mismatch means the
   entity changed since export (re-scraped, hand-edited) — that block is
   skipped with a "stale, re-export" warning rather than silently attaching a
   translation to text it no longer matches. A blank `> translation:` is
   also skipped. Accepted translations are merged into
   `entity.translations[lang][field] = {text, source_hash, translated_at}`,
   one audit entry is recorded per touched entity (`source: translate-import,
   actor: local`), and the queue is pruned of anything now fully translated.

**Hard rule: nothing in this pipeline ever calls a translation/AI API from
code in this repo.** `scraper/src/translate.js` is never referenced by
`.github/workflows/scrape.yml` or any other CI step — only the detection
step (§2.1) runs there. If this rule is ever revisited, it needs an explicit
`CONTRACT.md` §0/§10 update first, not a quiet workflow edit.

## 3. What's NOT translated (and why)

- **Proper nouns** — entity `name`, `city`, `country`, `address`,
  `organizer.name`, `artists[].name`, `music[].name` always render verbatim,
  in every language. These are scraped facts, not prose; mistranslating a
  venue or DJ's name would be actively wrong, not helpful.
## 4. Change log / open items

- **2026-07-03** — v4 initial cut: `i18n.js` authored for all 11 languages
  (ported from the linked Claude Design System's UI-kit mock, which already
  had complete, reviewed translations for this exact chrome); glass topbar +
  icon-style popup social links ported alongside since they shipped together
  in the same design pass; local translation pipeline
  (`translate.js`/`translations-queue.json`) built fresh — no prior art to
  port, since the mock's language switcher only ever translated its own
  bundled demo data, not a real scraped dataset. All 45 (28 description + 17
  schedule) fields in the live sample dataset translated into all 10
  non-English languages via the pipeline and merged into `entities.json`.
- **2026-07-03** — closed the two v4 port gaps: the date-strip's "N dates"
  clear-pill now uses `UI[lang].dateCount` selected via `Intl.PluralRules`
  (RU/UK carry the full Slavic one/few/many/other set — verified `1 дата` /
  `2 даты` / `5 дат`; ZH/JA/KO use their single invariant form since those
  languages don't inflect for number); the corner "data updated" chip uses
  `UI[lang].dataUpdated`. Also hardened the topbar-overlap fix: `map.js`'s
  `popupopen` handler re-measures the popup against the topbar after Leaflet's
  own autopan settles and issues a corrective `panBy` for the residual case
  (very tall popup + short viewport) the padding option alone didn't catch —
  verified overlap-free on an 800px-tall viewport that previously failed.
- **Open:** whether `ES` should split into separate Spain/Latin-America
  variants if the userbase ever needs it (currently one `es-419` locale
  covers both); coverage tracking (what fraction of live entities have a
  full translation set per language) once the scraper has run enough cycles
  to populate `data/translations-queue.json` meaningfully; consider a
  `--all-langs` export mode that batches every pending language in one file
  instead of one `--lang` at a time, if the per-language loop proves tedious
  in practice.
