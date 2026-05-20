# Ground-Truth Sync

> Generated: 2026-05-20 08:43:18 UTC
> Source: `npm run roadmap:sync`
> **LB: read this file, not chat memory, for current repo state.**

---

## Last 15 Commits

```
f70fb84 docs(v3-spec): flood-veto → flood-barrier-mode-1 (add_caveat, per-ZIP predicate)
640b270 docs(plans): preserve 2026-05-19 LittleBird CRE corridor expansion plan
367d627 refactor(env-swfl): flood-veto → flood-barrier-mode-1 modifier cascade (Group C)
ef23adc fix(faf5-source): citation — single model vintage qualifier, FAF modeled estimates disclaimer
5894e83 fix(faf5-fixture): reshape fixture to thin schema (tons, value_m, zone_name, commodity_name, year)
2dd5673 fix(faf5-fixture): convert to top-level array format + add year=2024 field for multi-year source compat
f1bd20d feat(faf5-source): multi-year UNION 2020-2024 — YoY fragments for logistics-swfl
b01ad4c feat(faf5): year-partitioned backfill 2020-2024 — melt wide-format to thin Parquet per year
318f7fb feat(env-swfl): per-ZIP AAL × barrier-island classification (Group B)
8c2a9b4 chore(ci): sync bun.lock + migrate node:test → bun:test
d4336ba refactor(env-swfl): strip 3 phantom hydrology metrics; keep Caloosahatchee stage
bd9fb13 feat(consumption-contract): v2.1 analyst amendment — license §Speculation
e677f89 feat(env-swfl): swfl-geo lib + flood-restructure plan
faf548b fix(brains): branch citation strings on env.source to surface fixture provenance
2c80a71 fix(roadmap-sync): redirect Notion push to dedicated Latest Sync page
```

## Working Tree Status

```
M docs/littlebird-notes/latest-sync.md
 M docs/roadmap-status.md
?? .claude/settings.local.json
?? docs/superpowers/plans/2026-05-20-faf5-historical-backfill.md
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
