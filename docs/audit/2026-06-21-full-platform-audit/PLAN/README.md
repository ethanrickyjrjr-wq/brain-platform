# BUILD PLAN — 2026-06-21 full-platform audit → executable, ordered, parallelized

**Written 2026-06-22.** This folder is the **build plan** that operationalizes the 2026-06-21 audit. It
consolidates three source docs into one ordered, model-tagged, parallel-grouped sequence:

- `../NOTES.md` — the platform audit + P0–P3 TODOs (cron roots, brain factory, website, graphify, ingest).
- `../../2026-06-21-crawl4ai-live/STEP7-FINAL-REPORT.md` — the crawl4ai usage reference + fix list.
- `../../2026-06-21-supercrawl4ai/BRIEF.md` — the 26-capability crawl4ai enhancement plan (probe-gated #6–#11).

Every fact in those docs was **independently re-verified** before this plan was written — an 8-cluster
read-only pass (one agent per claim-cluster, fresh `file:line` evidence) plus two Vendor-First checks
(the installed `crawl4ai` package source + live PyPI). Full record + correction table:
**`../../2026-06-21-crawl4ai-live/VERIFICATION.md`**. The audit held up: ~40 claims, the great majority
**CONFIRMED verbatim**. The corrections that change a build are baked into the build files below.

---

## 2026-06-22 — references + extend pass (what this folder now carries)

This plan was re-checked **build-by-build** against the two reference corpora and extended:
- **Every build 01–21** now carries a `## References` section mapping it to the specific pages in
  `../../2026-06-21-crawl4ai-live/` (the crawl4ai tool-usage reference) and
  `../../2026-06-21-best-practices-research/` (how to build/operate what we build), plus a short
  `## Best-practice fold-in` note where the REPORT strengthens the recommendation. All 21 load-bearing
  anchors were **targeted-re-confirmed against the live repo**; no build needed a correctness reversal (the
  `VERIFICATION.md` deltas were already baked in — the pass confirmed they are, and added the missing
  best-practices layer the builds were authored without).
- **Phase 7 (builds 22–28) is NEW** — the `../../2026-06-21-best-practices-research/REPORT.md` fix-list items
  the original 21-build plan **omitted**: dlt `schema_contract`, `merge`-vs-`replace`, freshness-as-ERROR
  SLA, value tests + schema detector, Structured Outputs `strict:true`, Citations API, cron→postmortem
  record. Setup + sequencing + guardrails: `phase-7-best-practices-hardening/_CONTRACT.md`.
- Builds **22/23/26/27 are Vendor-First** (dlt + Anthropic API surfaces) — each WebFetches the live vendor
  docs at build time (the round captures are pointers, not authority). Builds **22–25** are RULE 3 C2-framed:
  per-pipeline / opt-in extensions of an existing seam, **never** a new mandatory global gate.
- Full record of this pass: `PASS-SUMMARY.md`.

---

## ⚠️ The one correction that changes a recommendation (read before building 08)

`STEP7` and `BRIEF.md` **contradict each other** on whether `crawl4ai-setup` installs Patchright:
- STEP7: it DOES → collapse installs to it.
- BRIEF.md #6: it "strips patchright" → don't standardize on it.

**Resolved in STEP7's favor, with package-source proof.** Installed `crawl4ai/install.py`
`post_install()` → `install_playwright()` runs **both** `playwright install --with-deps --force chromium`
(install.py:98-107) **and** `patchright install --with-deps --force chromium` (install.py:126-135);
line 124 logs the exact string `"Installing Patchright browsers for undetected mode..."`. PyPI confirms
`patchright>=1.49.0` + `playwright>=1.49.0` are hard deps and 0.9.0 is current latest. So **the collapse
(build 08) is safe and stricter** than the current GHA spellings (the live `patchright install chromium`
step omits `--with-deps`). **One caveat baked into build 08:** `crawl4ai-setup` skips browser installs
entirely if `CRAWL4AI_MODE=api` is set (install.py:52-57) — keep that env var unset on crawl jobs.

---

## How to read this folder

```
PLAN/
  README.md                         ← you are here (map + build order + conflict matrix)
  phase-1-stop-the-reds/            ← do FIRST. The daily flappers + record-the-cause.
    _CONTRACT.md                    ← shared string contracts (so the run-together builds don't collide)
    run-together/                   ← builds 01–04 run AT THE SAME TIME (disjoint files)
    SOLO-05-*.md                    ← run ALONE (module-load gate; verify in isolation)
  phase-2-crawl-correctness/        ← build-now crawl4ai fixes (NO live probe needed)
    _CONTRACT.md
    run-together/                   ← builds 06–10 run together (disjoint files)
  phase-3-probe-first-upgrades/     ← each gated on a LIVE browser/GHA probe; SEQUENCED, not parallel
    SOLO-11..SOLO-14
  phase-4-hygiene/
    run-together/                   ← builds 15–19 run together
  phase-5-app-charts/               ← independent subsystem; can run parallel to EVERYTHING
    SOLO-20
  phase-6-decisions/
    SOLO-21                         ← after its prerequisites land
  phase-7-best-practices-hardening/ ← NEW (2026-06-22): the best-practices REPORT items the plan had omitted
    _CONTRACT.md                    ← tracks + sequencing + the RULE 3 C2 / Vendor-First guardrails
    data-reliability/               ← 22 schema_contract · 23 merge-vs-replace · 24 freshness-ERROR · 25 value-tests+schema-detector
    ai-layer/                       ← 26 strict:true structured outputs · 27 citations + retract
    ops/                            ← 28 cron → postmortem record
```

- **A `run-together/` subfolder = a parallel-safe group.** Every build in it touches a disjoint file set,
  so N agents can run them concurrently. The `_CONTRACT.md` pins any shared string/behavior so they don't drift.
- **A `SOLO-*` file = run that build by itself.** Either it's a module-load gate whose failure would break
  every concurrent build's verification (05), or it shares a file with another build and must be sequenced
  (11/12/13 serialize on `crawl4ai_client.py`; 13 also waits on 10's dbpr file), or it's a probe-gated /
  no-invention-sensitive build that deserves an isolated verification (11, 13, 14, 20, 21).
- **Numeric prefix = build order.** Lower first. Phases are ordered by dependency + risk-payoff.

## Model legend — why Opus vs Sonnet on each build

- **Opus** — cross-cutting, high blast-radius (shared client / module-load gate), output-shape or
  no-invention-sensitive, or requires live judgment (probe interpretation, brain-output parity). 7 builds
  (+5 in Phase 7 → **12 Opus** across all 28).
- **Sonnet** — single-file, well-specified, mechanical, low blast-radius. The fix is already pinned in the
  build file; execution is the work, not the design. 14 builds (+2 in Phase 7 → **16 Sonnet** across all 28).

Every build's FIRST step is **probe-first** (RULE 0.5: open the actual files before editing — line numbers
here are anchors, not gospel). Every build ends at a **verification gate** (the "Done when" line). **Do not
push without operator confirmation** (standing operator decree): commit, show the log, ask.

---

## Master build order

| # | Build | Model | Owns (file(s)) | Depends on | Parallel group | Live probe? |
|---|---|---|---|---|---|---|
| 01 | news_swfl `published_date` ALTER `date→text` | Sonnet | `data_lake.news_swfl*` migration (+ `pipelines/news_swfl/pipeline.py` if needed) | — | P1-run-together | — |
| 02 | daily-rebuild diagnosis echo | Sonnet | `refinery/cli.mts` (~470–476) | — | P1-run-together | — |
| 03 | freshness-probe guard (tier-1 + `main` except) | Sonnet | `ingest/scripts/check_freshness.py` | — | P1-run-together | — |
| 04 | classifier rules + widen log tail | Sonnet | `.github/scripts/classify-cron-failure.mjs`, `.github/scripts/lib/cron-run.mjs` | — | P1-run-together | — |
| 05 | master `sources[]`⇆`input_brains[]` load-time invariant | **Opus** | `refinery/config/packs.mts` | — | **SOLO** | — |
| 06 | extract_client page_timeout unit fix + chunk-overlap | Sonnet | `ingest/lib/extract_client.py` | — | P2-run-together | — |
| 07 | shared-client free-wins (jitter/monitor/stream/`after_goto`/fit_markdown) | **Opus** | `ingest/lib/crawl4ai_client.py` | — | P2-run-together (byte-identical defaults) | — |
| 08 | collapse + harden GHA installs (`crawl4ai-setup`+doctor ×11) | Sonnet | the 11 crawl `*.yml` | — | P2-run-together | — |
| 09 | `requirements-probe.txt` slim install for probe/gate jobs | Sonnet | new `ingest/requirements-probe.txt`, `freshness-probe-daily.yml`, `daily-rebuild.yml` | — | P2-run-together | — |
| 10 | dbpr_sirs `js:` row-count settle (replace `delay_after=16`) | Sonnet | `ingest/pipelines/dbpr_sirs/pipeline.py` | — | P2-run-together | — |
| 11 | Crexi under-capture overhaul (virtual-scroll / scan_full_page, drop `[:28000]`) | **Opus** | `ingest/pipelines/crexi_listings/extract.py` | 06, 07 | **SOLO** | **YES — P0a virtualized-vs-accumulating + P0b GHA-IP** |
| 12 | Crexi proxy wiring (default-off `CRAWL4AI_PROXY`) | Sonnet | `ingest/lib/crawl4ai_client.py` | 07 | **SOLO** (shares client w/ 07) | **YES — live Crexi proxy probe** |
| 13 | dbpr_sirs `result.tables` (zero-LLM) + `fetch_tables()` helper | **Opus** | `ingest/pipelines/dbpr_sirs/pipeline.py`, `ingest/lib/crawl4ai_client.py` | 10, 07 | **SOLO** (shares dbpr + client) | **YES — does the Qlik grid emit a real `<table>`?** |
| 14 | news_swfl crawl rework (Option A BestFirst flag / Option B shared-client migrate) | **Opus** | `ingest/pipelines/news_swfl/` (`fetcher.py` / new `adaptive_fetcher.py`) | 01 | **SOLO** | **YES — local yield/precision battle-test** |
| 15 | graphify `links[]`/`edges[]` fix + resync | Sonnet | `scripts/graphify-app-nodes.mjs` | — | P4-run-together | — |
| 16 | retire 2 orphaned graphify python generators | Sonnet | `scripts/graphify/build-graph.py`, `export-ops-graph.py` | — | P4-run-together | — |
| 17 | `brain-vocabulary.json` meta fix (214→277, slug_index, mojibake) | Sonnet | `refinery/vocab/brain-vocabulary.json` | — | P4-run-together | — |
| 18 | stale-docs sweep (converse "deleted", in-process-only landmine, 4→5 stages) | Sonnet | `_AUDIT_AND_ROADMAP/build-queue.md`, `app/api/assistant/route.ts`, `lib/grounded-answer.ts`, `SESSION_LOG.md`, `../NOTES.md`, `crawl4ai_client.py` docstring | — | P4-run-together | — |
| 19 | cadence-registry hygiene (retire dead CRE-broker ODD + rebaseline `expected_rows_min`) | Sonnet | `ingest/cadence_registry.yaml` (+ dead pipeline dirs/ymls) | — | P4-run-together | — |
| 20 | charts on the conversation path (Phase 3A) | **Opus** | `lib/assistant/conversation-path.ts`, shared chart util, `lib/grounded-answer.ts` | — | **SOLO** (independent track; run anytime) | — |
| 21 | supercrawl4ai disposition (delete vs keep — its caps now adopted natively) | **Opus** | decision doc; possibly `ingest/lib/supercrawl4ai.py` + bench + test | 11, 13 | **SOLO** | — |
| — | **PHASE 7 — best-practices hardening (NEW 2026-06-22; run after the Phase-1 reds are green)** | | | | | |
| 22 | dlt `schema_contract` (evolve/freeze + `schema_update` alert) | **Opus** | per-pipeline `pipeline.py` dlt config (start news_swfl) | 01 | **SOLO** (data-reliability) | — · vendor: dlt |
| 23 | dlt `merge`+`primary_key` / `refresh="drop_data"` vs blind `replace` | **Opus** | per-pipeline `resources.py` `write_disposition` (FEMA excluded — no stable key) | Gate 4 | **SOLO** (data-reliability) | — · vendor: dlt |
| 24 | freshness as an **SLA that can ERROR** (`warn_after`/`error_after`) | Sonnet | `ingest/scripts/check_freshness.py`, `ingest/cadence_registry.yaml` | 03, 19 | **SOLO** (data-reliability) | — |
| 25 | value-level data tests (Quality) + column-type-change detector (Schema) | **Opus** | new probe/test files (extends the view-liveness probe seam) | 22, 24, 04 | **SOLO** (data-reliability) | — |
| 26 | Structured Outputs `strict:true` (kill hand-rolled fence-stripping) | **Opus** | `ingest/lib/extract_client.py`, `crexi_listings/extract.py` (refinery JSON.parse OUT of scope) | 06, 11 | **SOLO** (ai-layer) | — · vendor: Anthropic API |
| 27 | Citations API + retract-if-no-quote on conversation path | **Opus** | `lib/assistant/conversation-path.ts`, `lib/grounded-answer.ts` | 20 | **SOLO** (ai-layer) | — · vendor: Anthropic API |
| 28 | cron ledger → postmortem record; alert on significant only | Sonnet | `docs/cron-rebuild-failures.md` + `log-cron-incident`/`ledger-flap`/`classify` `.mjs` | 02, 04 | **SOLO** (ops) | — |

## File-conflict matrix (why the SOLO builds can't parallelize)

- **`ingest/lib/crawl4ai_client.py`**: builds **07 → 12 → 13** all touch it. 07 lands first (additive,
  default-off), then 12 (proxy), then 13's `fetch_tables()` helper. Never run two of these at once.
- **`ingest/pipelines/dbpr_sirs/pipeline.py`**: builds **10 → 13**. 10's `js:` settle swap first; 13's
  `result.tables` rewrite second (it changes the extraction path and must verify `condo-sirs-swfl` parity).
- **`ingest/pipelines/crexi_listings/extract.py`**: build **11** only — but it consumes 06's chunker and
  07's additive `step()` params, so it runs after Phase 2.
- **`ingest/pipelines/news_swfl/`**: build **01** (schema) before **14** (crawl rework).
- Everything else owns a disjoint file → safe to parallelize within its `run-together/` group.
- **Phase 7 (best-practices hardening) serialization** — full detail in `phase-7-best-practices-hardening/_CONTRACT.md`:
  **22** runs after **01** (may touch the same `news_swfl/pipeline.py`); **24** runs after **03 + 19** (shares
  `check_freshness.py` + `cadence_registry.yaml`); **26** runs after **06** and coordinates with **11** (the
  duplicate crexi fence logic in `crexi_listings/extract.py`); **27** runs after **20** (shares
  `conversation-path.ts` + `grounded-answer.ts`); **28** runs after **02 + 04**. **23** (per-pipeline
  `resources.py`) and **25** (new test files) are largely independent. **22/23/26/27 are Vendor-First** —
  each WebFetches the live dlt / Anthropic docs at build time.

## The probe-first gates (do NOT skip — from `BRIEF.md`, verified-correct)

Phase 3 builds are gated on **live** probes because their outcome is unknowable from the desk:
1. **Crexi grid: virtualized vs accumulating** (build 11 P0a) → picks `VirtualScrollConfig` (Branch A) vs
   `scan_full_page` (Branch B). The wrong branch silently captures nothing extra.
2. **Can a GHA datacenter ASN reach Crexi at all?** (builds 11 P0b / 12 / 13) — Crexi actively blocks
   datacenter IPs; **Accela's GHA-IP clearance does NOT generalize** (BLS LAUS + Census QuickFacts both
   403'd a datacenter fetch this audit). If a runner returns zero, 11/12/13 collapse to "needs residential
   egress / self-hosted runner" and the code fix is moot. **Run the Crexi `workflow_dispatch --dry-run`
   GHA-IP probe before investing in 11/12/13** — it's the single highest-leverage next move.
3. **Does the dbpr_sirs Qlik grid emit a real `<table>`?** (build 13) — if it's `<div>`-rendered,
   `result.tables` won't see it and the hand-walked parser stays.
4. **news BestFirst yield/precision vs the ~40-cap baseline** (build 14) — mandatory local battle-test
   before adopting; revert to Option B (simple shared-client migrate) if it underperforms.

## Execution protocol (per build)

1. One build = one session. Open the build file; do its **probe-first** step (read the cited files).
2. Honor `RULE 3.5` brainstorm where the build says so (most carry a short design step).
3. Make the change; run the build's **Done-when** verification gate; show the diff.
4. Update the `checks` ledger (`scripts/check.mjs`) + `SESSION_LOG.md` per `RULE 2`; **ask before push.**
5. For `run-together/` groups: dispatch them as parallel agents (or sequential sessions) — they will not
   collide. Read the group's `_CONTRACT.md` first so shared strings line up.
