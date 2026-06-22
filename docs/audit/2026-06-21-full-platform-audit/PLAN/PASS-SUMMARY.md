# PASS-SUMMARY — references + extend pass (2026-06-22)

**What was asked:** go through the build plan **build-by-build**, reference the two corpora —
`../../2026-06-21-crawl4ai-live/` (crawl4ai tool-usage) and `../../2026-06-21-best-practices-research/`
(how to build/operate what we build) — for **every** build, confirm each build is correct, then **add the
extra builds** the best-practices REPORT demands and fold in what needs to change. Do **not** re-scope what
the prior session already verified (`../../2026-06-21-crawl4ai-live/VERIFICATION.md`).

**How:** one read-only-then-surgical agent per build (28 agents, disjoint files, parallel). Each did ONE
targeted anchor re-confirmation against the live repo (no broad re-audit), folded in the relevant
VERIFICATION delta only if the prose hadn't already, appended a `## References` section mapping the build to
specific pages in both folders, and added a short `## Best-practice fold-in` where the REPORT strengthens the
call. The 7 new builds were authored probe-first (RULE 0.5) in the existing house style, Vendor-First where a
dlt / Anthropic-API surface is touched.

---

## The gap this pass closed
The original 21 builds were authored from `NOTES.md` + `STEP7-FINAL-REPORT.md` (crawl4ai-live) +
`../../2026-06-21-supercrawl4ai/BRIEF.md`. **The best-practices REPORT was never folded in**, and the builds
cited only the *summary* docs — not the granular `round1|2|3/` pages. So: (a) per-build references to both
folders at page granularity, and (b) Phase 7 = the REPORT fix-list items the plan omitted.

## Builds 01–21 — verdict
**All 21 confirmed correct** (anchor re-verified live; no correctness reversal needed — the VERIFICATION
deltas were already baked in). Each now carries `## References` + a `## Best-practice fold-in`. Highlights:

| Build | Anchor re-confirmed | Reference / fold-in added |
|---|---|---|
| 01 news_swfl date→text | `pipeline.py:12-14` data_type:text | → build 22 (schema_contract is the durable complement to the one-off ALTER) |
| 02 rebuild reason echo | `cli.mts :459/:470/:476` | SRE symptom≠cause; → build 28 (postmortem record) |
| 03 freshness-probe guard | tier-1 unguarded @273, tier-2 already guarded @219, main() @760 | → build 24 (freshness-as-ERROR SLA) |
| 04 classifier + log tail | `cron-run.mjs:22` 30-line tail + SCHEMA_DRIFT | alert-on-signal; → build 28 |
| 05 sources⇆input_brains | `packs.mts:389` invariant, `dag.mts:49` | V-2 (30 not 31); derive-don't-mirror (declarative deps) |
| 06 page_timeout | `extract_client.py:195` 480000ms | → build 26 (strict:true removes the fence-strip) |
| 07 shared-client free-wins | RateLimiter @208-213, UndetectedAdapter @65-76 | 7 crawl4ai-live pages (dispatcher/hooks/fit_markdown) · *flag: prose `~`line-anchors slightly off, left as-is (labelled approximate)* |
| 08 collapse GHA installs | 4 bare patchright + 4 missing-doctor | VERIFICATION ⭐ (crawl4ai-setup installs both) + `CRAWL4AI_MODE=api` caveat |
| 09 requirements-probe slim | probe/rebuild ymls still install full tree | q-uv-pip-compile; slim ONLY probe jobs |
| 10 dbpr js settle | `pipeline.py:48+57` blind delay | wait_for js: polls-until-true |
| 11 crexi under-capture | `crexi_listings/extract.py` [:28000] L83 etc. | virtual-scroll/scan_full_page/XHR; → build 26 |
| 12 crexi proxy | `crawl4ai_client.py` proxy unwired + LANDMINE | proxy_config per-request recommended |
| 13 dbpr result.tables | Qlik positional walk; no fetch_tables yet | table-extraction zero-LLM; → build 26 fallback |
| 14 news crawl rework | `fetcher.py` bare crawler, 10×4≈40 | V-4 cap; deterministic-first bias to Option B |
| 15 graphify links/edges | `graphify-app-nodes.mjs:515/517` split | Lineage pillar |
| 16 retire orphan generators | both .py present, 0 non-audit callers | eliminate-toil |
| 17 brain-vocabulary meta | 277/304/mojibake | (internal cosmetic) |
| 18 stale-docs sweep | route.ts:3-4, grounded-answer 4 dangling, build-queue, NOTES count | V-8/V-9/V-12 + the NOTES §3 31→30 fix lands here |
| 19 cadence hygiene | 3 dead ODD entries + floors=1 | Volume pillar; → build 24 |
| 20 charts on conv path | `conversation-path.ts:96-100` INTERIM note | V-10 chartless gap; → build 27 (cite source rows) |
| 21 supercrawl4ai disposition | built, 0 prod importers | lean-delete after 07/11/12/13 adopt the caps natively |

## Phase 7 — extra builds 22–28 (NEW)
1:1 transcriptions of `REPORT.md`'s fix list the plan had omitted. Setup/sequencing/guardrails in
`phase-7-best-practices-hardening/_CONTRACT.md`.

| # | Build | Model | From REPORT | Notable scoping found during authoring |
|---|---|---|---|---|
| 22 | dlt `schema_contract` (evolve/freeze + `schema_update` alert) | Opus | P0#1 / row 1 | `fema/pipeline.py` swallows failures in a bare `except` → contract is *more* valuable there |
| 23 | dlt `merge`/`refresh` vs blind `replace` | Opus | P1#6 / row 2 | **FEMA excluded** — its `id` regenerates each refresh → no stable key → `replace` stays correct (BIBLE §0.2 r5) |
| 24 | freshness as an SLA that can ERROR | Sonnet | P2#7 | opt-in `freshness_sla:` per registry entry; ungated sources stay exit-0 (build 03's contract preserved) |
| 25 | value tests (Quality) + schema detector (Schema) | Opus | P2#8 | extends the `check_freshness.py` view-liveness probe seam; runner has only `DESTINATION__POSTGRES__CREDENTIALS` |
| 26 | Structured Outputs `strict:true` | Opus | P3#10 | **refinery/** JSON.parse is OUT of scope (it parses our deterministic fences, not LLM output); only the 2 `ingest/` LLM copies |
| 27 | Citations API + retract-if-no-quote | Opus | P3#11 | Citations API + Structured Outputs are mutually **400-incompatible** — relevant to build 26 |
| 28 | cron ledger → postmortem record | Sonnet | HEADLINE#2 / P1#5 | wires existing `chronicFlappers()` + suppresses TRANSIENT-class noise; no new gate |

**Guardrails baked in:** builds 22–25 are RULE 3 C2 — per-pipeline / opt-in extensions of an existing seam,
**not** a new mandatory global gate (the "Source Contract as spine" bundled-governance design stays rejected).
Builds 22/23/26/27 are Vendor-First — each agent **WebFetched the live dlt / Anthropic docs in-session**
during authoring (dlt 1.28.1 schema-contract + incremental-loading; Anthropic structured-outputs +
citations) and the specs require re-confirming verbatim at build time.

## Not done / left for execution (by design)
- These are **specs**, not executed builds. The repo files they describe are unchanged; each build carries
  its own probe-first + RULE 3.5 brainstorm step for execution time.
- The one open flag: build 07's prose uses `~`approximate line anchors that are a few lines off the live
  file — labelled approximate, structure matches, left as-is (editing would guess the author's numbering).
- **NOT pushed / not committed.** Operator decree: stop after the work, show the diff, ask. A concurrent
  session was live in this tree during the pass; every edit was Read-immediately-before-Write and confined to
  the disjoint owned file, so nothing of theirs was clobbered.

## Files changed in this pass
- 21 build files: `+## References` and `+## Best-practice fold-in`.
- 7 new build files under `phase-7-best-practices-hardening/{data-reliability,ai-layer,ops}/`.
- `phase-7-best-practices-hardening/_CONTRACT.md` (new), `README.md` (master table + folder map + matrix +
  legend counts + this pass's changelog), `PASS-SUMMARY.md` (this file).
