# Enrichment Plan — how Body Map polishes entity summaries (v6)

This is the living document for entity-summary enrichment. It governs
`scraper/src/enrich.js` and `data/enrichment-queue.json` — the manual,
local-only pipeline that turns a raw scraped `description` into a clean,
AI-polished `entity.summary`. Edit this doc as the pipeline evolves. When in
doubt, `CONTRACT.md` §11 wins.

## 1. How it works end to end

Scraped `description` text is whatever the source page happened to publish —
sometimes a tidy sentence, often a run-on paste of a Facebook-style
announcement (exclamation marks, disclaimers, unrelated logistics). Rather
than showing that raw text on the popup card, `entity.summary` holds a short,
clean replacement — produced the same human-in-the-loop way
`translate.js` produces translations (`CONTRACT.md` §10-B), for the same
reason: there's no acceptable automated AI-API call within this project's
zero-external-services guardrail (`CONTRACT.md` §0).

1. Every scraper run (CI or local), a pipeline step diffs every active
   entity's `description` against `entity.summary.source_hash` and rewrites
   `data/enrichment-queue.json` to hold exactly the entities still missing a
   summary, or whose existing summary has gone stale (description re-scraped
   since). This is pure detection — read the dataset, write the queue — so
   it's safe to run in CI and commits automatically (`scrape.yml`'s `git add`
   list includes the queue file).
2. Locally, the maintainer runs `node src/enrich.js queue` to see what's
   pending, `export --out batch.md [--limit N]` to get a markdown batch (an
   instructional header, then a fenced source-text block + a blank
   `> summary:` placeholder per entity), pastes it into their own separate AI
   chat, pastes the replies back in place, and runs `import --file batch.md`.
3. `import` re-hashes each entity's *current* `description` and compares it
   to the hash implied by the block's fenced source text. A mismatch means
   the entity was re-scraped or hand-edited since export — that block is
   skipped with a "stale, re-export" warning rather than silently attaching a
   summary to text it no longer matches. A blank `> summary:` is also
   skipped. Accepted summaries are merged into `entity.summary = {text,
   source_hash, generated_at}`, one audit entry is recorded per touched
   entity (`source: enrich-import, actor: local`), and the queue is pruned of
   anything now fully enriched.

**Hard rule: nothing in this pipeline ever calls an AI API from code in this
repo.** `scraper/src/enrich.js` is never referenced by
`.github/workflows/scrape.yml` or any other CI step — only the detection
step (§1.1) runs there. If this rule is ever revisited, it needs an explicit
`CONTRACT.md` §0/§11 update first, not a quiet workflow edit.

## 2. The prompt template

`export`'s output always starts with this instructional header (kept here in
sync with `enrich.js`'s `PROMPT_HEADER` constant, so the wording only needs
maintaining in one conceptual place even though it necessarily exists twice):

```
# Body Map — entity summary enrichment
#
# For each block below, replace the text after "> summary:" with a clean,
# factual 1-2 sentence English summary of the event or venue, based only on
# the raw scraped text in the fenced code block. Keep proper nouns (names,
# places, DJ/artist names) verbatim; do not invent details not present in
# the source text; do not translate — English stays the source language,
# the existing translation pipeline (translate.js) handles other languages
# from here.
#
# When done, run: node src/enrich.js import --file <this file>
```

If this wording changes, update both places in the same commit.

## 3. Interaction with the translation pipeline

`entity.summary` is a peer of `description`/`schedule` in
`translate.js`'s `TRANSLATABLE_FIELDS` — once an entity has a summary, it
gets translated into all 10 non-English languages exactly like `description`
always has, via the existing §10-B workflow. Two consequences:

- `summary`'s leaf shape (`{text, source_hash, generated_at}`) differs from
  `description`/`schedule`'s plain strings; `translate.js`'s
  `sourceTextOf(entity, field)` normalizes both shapes to plain text before
  hashing, so staleness detection works identically for all three fields.
- Once `entity.summary` exists, the now-superseded `description` is skipped
  by the translations-queue diff (`updateTranslationsQueue`) — no point
  spending a translation pass on raw text the popup card never shows again.
  This means enriching an entity can *shrink* the translations queue even
  though it's a separate pipeline.

## 4. What's NOT enriched (and why)

- **Everything except `description`.** `schedule`, `address`, `pricing`,
  proper nouns (`name`, `city`, `country`, `organizer`/`artist` names) are
  already structured or already concise — there's nothing for a prose
  summary to clean up. Enrichment is deliberately narrow: one messy field,
  one polished replacement.
- **Proper nouns inside the summary itself** — the prompt template explicitly
  asks for names/places/DJ names verbatim, same reasoning as
  `docs/i18n-plan.md` §3.

## 5. Change log / open items

- **2026-07-04** — v6 initial cut: `enrich.js` built mirroring
  `translate.js`'s CLI/queue/markdown-round-trip conventions exactly, adapted
  for a single field/single source-language (no per-language fan-out);
  `entity.summary` wired into `map.js`'s popup (summary beats description,
  translated-summary beats translated-description) and into `translate.js`'s
  `TRANSLATABLE_FIELDS` via the `sourceTextOf` normalizing helper.
- **Open:** no entities have been enriched yet (this ships the pipeline, not
  a completed pass over the dataset) — run `node src/enrich.js queue` after
  the next scrape to see real candidates; whether short venue/class
  descriptions (already concise) should be excluded from the queue entirely
  rather than round-tripped through AI for a near-identical result; coverage
  tracking once enrichment has run over enough of the dataset to be
  meaningful.
