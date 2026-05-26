# Ground-Truth Sync

> Generated: 2026-05-26 01:17:02 UTC
> Source: `npm run roadmap:sync`
> **LB: read this file, not chat memory, for current repo state.**

---

## Last 15 Commits

```
f815c58 feat(cre): MarketBeat Flow 3 — per-submarket key_metrics in cre-swfl (#18)
2df58bc feat(gha): add cron wrappers for 6 dlt ingest pipelines
cf1c8d7 refactor: consolidate medianOf + numeric helpers into stats.mts
73b96ce feat(cre): MarketBeat submarket → corridor alias table
93b778b feat(ingest): firecrawl pipelines as GitHub Actions cron (#17)
73ff704 fix(waitlist): lazy-init Resend client to unblock Vercel build (#16)
b2fa78e feat(cre-swfl): firecrawl pipeline skeleton — MarketBeat source + broker narrative consumer + n8n workflow drafts (#15)
b9fa5f9 feat(macro-swfl): ship BLS LAUS county ingest + wire real key_metrics (#14)
ecc7d0f feat: provenance page, permits-swfl ingest fix, fixture tfctr alignment (#13)
48b955f fix(fdot): correct yearx column name and county casing; switch freight filter to tfctr >= 5%
833293c feat(legal): add terms of service page at /terms
7150e6a fix(fdot): column year_ renamed to year in Supabase — alias in select
8b9958c fix(triage): batch fragments 50 at a time to avoid token overflow
8caf6f1 fix(mcp): ban internal brain IDs and routing logic from tool responses
44da9df fix(report): white background on report page, remove dark mode override
```

## Working Tree Status

```
M docs/roadmap-status.md
```

## Plans Directory (`~/.claude/plans/`) — newest first

  update-yourself-on-everything-glistening-riddle.md
  plan-this-out-2-shiny-harbor.md
  make-sure-this-plan-melodic-barto.md
  audit-improve-make-suggestions-giggly-waterfall.md
  plan-it-out-so-misty-dusk.md
  macro-swfl-bls-nifty-peach.md
  plan-this-out-for-sleepy-candle.md
  permits-swfl-rippling-marble.md
  cheerful-jumping-quail.md
  pushed-to-origin-main-glistening-cascade.md
  need-to-plan-this-abundant-gadget.md
  gleaming-gliding-turing.md
  glowing-knitting-donut.md
  everything-should-be-updated-hazy-swan.md
  job-review-and-rustling-gadget.md
  have-a-meeting-tomorrow-declarative-locket.md
  plan-it-lucky-gizmo.md
  let-s-plan-this-out-declarative-conway.md
  go-through-these-ideas-lazy-dahl.md
  plan-next-steps-on-structured-badger.md
  right-now-we-need-noble-quasar.md
  are-we-all-rippling-gosling.md
  confirm-that-resolveslug-generic-crab.md
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
  ingest:redfin-swfl               → python -m ingest.duckdb_pipelines.redfin_swfl.pipeline
  ingest:zori-swfl:tier1           → python -m ingest.duckdb_pipelines.zori_swfl.pipeline
  ingest:zori-swfl:tier2           → python -m ingest.pipelines.zori_swfl.pipeline
  ingest:zori-swfl                 → npm run ingest:zori-swfl:tier1 && npm run ingest:zori-swfl:tier2
```
