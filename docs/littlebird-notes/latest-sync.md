# Ground-Truth Sync

> Generated: 2026-05-19 17:56:03 UTC
> Source: `npm run roadmap:sync`
> **LB: read this file, not chat memory, for current repo state.**

---

## Last 15 Commits

```
e751eb7 feat(notes): notes:sync script — reality-dump for LittleBird
98babd2 feat(brains): live renders — properties-lee-value v10 + master v46
9ee892e fix(leepa): factory fn to avoid dlt dataclass mutable-default error
bc263ab fix(tier1-inventory): replace dlt write with direct psycopg2 insert
e1722a5 fix(leepa): chunked merge writes to survive Supabase pooler
3025553 feat(logistics-swfl): v10 live Cold Lane render — 253,486K tons $124,972M (FAF5.7.1 Parquet)
f1efbac chore(ingest): add _run_tombstone.py — drops FAF5 tombstone tables + seeds _tier1_inventory
fce5517 fix(tier1-inventory): fresh pipeline per write + non-fatal pointer + null-row cleanup SQL
303cf02 chore: gitignore ephemeral directories and update docs for Cold Lane
7e198d4 feat(ingest/faf5): Cold Lane migration — FAF5 to S3 Parquet + DuckDB source rewrite
23f27b9 feat(refinery/packs): hurricane-tracks-fl — first cross-tier brain (HURDAT2 × NFIP)
4579edb feat(refinery/sources): makeDuckDBSource cross-tier connector + 6-concept hurricane vocab
25e6561 feat(ingest/hurdat2): NOAA NHC HURDAT2 Florida-filter pipeline → Tier 1 Parquet
86a3e3d feat(refinery/env): SUPABASE_PG_* surface + requirePgEnv() for cross-tier DuckDB
d60813c test(usgs/duckdb): integration tests for pipeline.run() with mocked HTTP
```

## Working Tree Status

```
M docs/roadmap-status.md
 M package.json
 M refinery/tools/roadmap-sync.mts
 D scripts/sync-notes.mts
?? .claude/scheduled_tasks.lock
?? ingest/leepa_ingest.log
?? ingest/leepa_ingest_err.log
```

## Plans Directory (`~/.claude/plans/`) — newest first

  need-to-plan-this-humble-falcon.md
  done-committed-as-712a9f4-drifting-crayon.md
  wave-2e-stale-upstream-cascade.md
  wave-2c-alpha-rigid-sections.md
  wave-2d-beta-branch-module.md
  wave-2d-alpha-new-pack.md
  wave-2c-beta-conditional-sections.md
  cosmic-rolling-brook.md
  run-over-this-plan-imperative-dusk.md
  shimmering-moseying-elephant.md
  leepa-kind-of-a-ancient-duckling.md
  we-need-to-plan-eager-whale.md
  any-way-to-improve-purrfect-church.md
  architecture-spec-review-lazy-peach.md
  what-is-the-synchronous-snail.md
  doing-our-checks-and-modular-octopus.md
  p3-vs-p5-next-priority.md
  swift-wibbling-reef.md
  file-is-at-docs-arsenal-master-stack-md-snug-fox.md
  using-some-articles-we-squishy-melody.md
  piped-seeking-backus.md
  piped-seeking-backus-agent-aa3538ef6dd3afcb6.md
  piped-seeking-backus-agent-a260111c2fcae912a.md
  we-are-making-sure-pure-beaver.md
  we-need-to-lay-swift-unicorn.md
  swfl-intelligence-lake-hidden-swan.md
  splendid-sparking-willow.md
  1-fetch-the-notion-witty-steele.md
  not-building-here-just-eventual-adleman.md
  read-over-notion-recent-humming-plum.md
  moonlit-sprouting-catmull.md

## In-Repo Session Docs (`docs/sessions/`) — newest first

  cosmic-rolling-brook-v2-shipped.md

## In-Repo Handoffs (`docs/handoffs/`) — newest first

  2026-05-19-storm-history-swfl-replan.md

## Defined Ingest Pipelines

```
  ingest:cbp                       → cd ingest && python -m pipelines.census_cbp.pipeline
  ingest:fema                      → cd ingest && python -m pipelines.fema.pipeline
  ingest:leepa                     → cd ingest && python -m pipelines.leepa.pipeline
  ingest:fdot                      → cd ingest && python -m pipelines.fdot.pipeline
  ingest:all                       → npm run ingest:fema && npm run ingest:leepa && npm run ingest:fdot && npm run ingest:cbp
  ingest:storm-history-swfl        → python -m ingest.duckdb_pipelines.storm_history_swfl.pipeline
```
