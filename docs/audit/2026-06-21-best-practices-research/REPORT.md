# How to build/operate what we built — authoritative answers vs. what we shipped

**Date:** 2026-06-21. crawl4ai was sent out to the **WEB** 3 times (29/30 pages OK) to find the
**authoritative best practices for the things we actually build** — a daily data-ingestion engine, an
LLM brain-synthesis pipeline, and an AI web app — with the questions driven by **what keeps breaking in
our session logs** (schema drift, DAG drift, cron failures with no root, dependency fragility, stale
data). Every answer is a live capture under `round1|2|3/`, cited by file. No opinions.

---

## THE HEADLINE — "a root for everything that breaks every day"

**Authoritative answer (Google SRE):**
- **Symptom ≠ cause.** *"The what's-broken indicates the symptom; the why indicates a cause."* A **root
  cause** = *"a defect that, if repaired, instills confidence this event won't happen again in the same
  way."* (round1 `rootcause-sre-monitoring`)
- **Blameless postmortem** = the record: a real root + action items + an owned bug at the right priority,
  reviewed ("No Postmortem Left Unreviewed"), kept in **a repository for trend analysis** across incidents.
  There's a standard **template** with metadata fields. (round1 `rootcause-sre-postmortem-culture`; round3 `q-sre-postmortem-example`)
- **Alert on signal, not noise.** Alert only on an event that *"consumes a large fraction of the error
  budget."* *"You could receive 144 alerts/day, act on none, and still meet the SLO."* (round2 `rootcause-sre-monitoring-workbook`)
- **Eliminate toil by automating the FIX, not the forgetting.** (round2 `rootcause-sre-eliminating-toil`)

**What we built:** `docs/cron-rebuild-failures.md` auto-captures every cron failure with Root Cause =
`_auto-captured; pending triage_`, then **auto-flips to RESOLVED on the next green run** (`log-cron-incident.yml`).
`cron-run.mjs fetchLogTail` reads a **30-line tail**; `classify-cron-failure.mjs` buckets unknowns as
**UNKNOWN**.

**Verdict: ❌ this is the SRE anti-pattern, exactly inverted.** We log the **symptom**, alert on **every**
failure (max noise, zero precision), and **automate the forgetting** (auto-resolve) — so the **cause is
never written down**. To "have a root," do what SRE does:
1. Make each cron **echo its own real failure reason** before exit (daily-rebuild → the `_build-report.json`
   master reason; the probe → which table/key). Stop relying on a 30-line tail + UNKNOWN bucket.
2. Turn the ledger into a **real postmortem record** (root + action item + owner) for the *recurring* classes,
   not a self-healing symptom log. Keep it for trend analysis (we already have repeat classes: schema drift,
   DAG drift, secret-not-wired, lockfile drift, flaky test).
3. Alert only on **significant** events (a real HOLD, a stale master past TTL), not every transient blip.

---

## THE THREE THINGS THAT ACTUALLY BREAK — authoritative fix for each

| Our recurring break (session logs) | Real root | Authoritative best-practice answer (cited) | What we do | Verdict |
|---|---|---|---|---|
| **Schema drift on load** — `news_swfl published_date` `DatatypeMismatch: date vs character varying`, every run | the live column is `date`, the pipeline now sends text, dlt never ALTERs | **dlt schema contracts**: `data_type:"evolve"` → dlt makes a **variant column** (`<col>__v_text`), no crash; or `"freeze"` → a clean `DataValidationError` **with full context** via `PipelineStepFailed`. Plus `load_info...schema_update` → Slack alert on every column change. (round1 `data-dlt-schema-contracts`, `data-dlt-schema-evolution`) | no schema_contract on any pipeline → raw psycopg crash | ❌ we have neither the contract nor the alert |
| **Destructive `replace` wipes good data on a bad/empty pull** | blind `write_disposition="replace"` | **dlt `merge` on a `primary_key`** is the idempotent upsert; `replace` is the dangerous one. For a clean reset use **`refresh="drop_data"`** (TRUNCATE + reset cursor) — not hand-run SQL. (round2 `data-dlt-merge-incremental`; round3 `q-dlt-pipeline-refresh`) | we use `replace` + a custom non-null guard hook (Gate 4) | ⚠️ we band-aid with a guard; `merge` is the native idempotent answer |
| **master deterministic HOLD** — a brain in `sources[]` but not `input_brains[]`/built | DAG drift; the resolver only walks `input_brains` | **declarative asset dependencies** — the DAG is derived from the assets, not maintained in two lists that can drift (Dagster: deps are part of the asset definition). (round3 `q-dagster-asset-dependencies`) | two hand-maintained lists (`sources[]` + `input_brains[]`) with no invariant | ❌ no gate verifies the two mirror → recurring HOLD |

---

## DATA OBSERVABILITY — the framework we're missing pieces of

**Authoritative (Monte Carlo "5 pillars"):** Freshness · **Quality** · Volume · Schema · **Lineage**
(round3 `q-data-observability-pillars`). **dbt source freshness** = declarative per-source SLA:
`freshness: {warn_after:{count,period}, error_after:{count,period}}` + `loaded_at_field` (round2
`data-dbt-source-freshness`). **dbt tests** = value-level data quality gates (`not_null`, `unique`,
`accepted_values`, severity `warn|error`) (round2 `data-dbt-tests`). **Data contracts** =
schema+quality+SLA as a versioned artifact (round2 `data-contract-spec`).

| Pillar | Authoritative | What we have | Verdict |
|---|---|---|---|
| Freshness | dbt `warn_after`/`error_after` per source, can ERROR | `check_freshness.py` cadence×tolerance, **observability-only, never gates** | ⚠️ we have freshness but no WARN/ERROR SLA that can fail loud |
| Volume | row-count vs expected | `expected_rows_min` LOW_VOLUME (many floors = `1`) | ⚠️ present but floors are placeholders |
| Schema | detect added/removed/type-changed cols | view-liveness probe (GRANT 404s) only | ⚠️ partial — no column-type-change detector (the published_date class) |
| **Quality** | dbt value tests (`not_null`/`unique`/`accepted_values`) | **none on the lake** | ❌ missing |
| **Lineage** | column-level lineage / impact | none | ❌ missing |

---

## THE BRAINS / AI LAYER — where we're RIGHT (per the authoritative source)

| Dimension | Authoritative (Anthropic) | What we built | Verdict |
|---|---|---|---|
| Architecture | **Workflows** (LLMs in *predefined code paths*) beat agents for predictable tasks; add **programmatic gates** between chained steps; "start simple, deterministic-first." (round1 `brains-anthropic-effective-agents`) | the brain factory IS this: deterministic math, LLM narrative only, master has zero LLM in its output path, Stage-2.5 vocab gate + Stage-4 validators between steps | ✅ **VALIDATED — built right** |
| No-invention / grounding | allow "I don't know"; quote-first grounding; **cite a source per claim, retract if no supporting quote**; native **Citations API** returns `cited_text` per claim (round1 `brains-anthropic-reduce-hallucinations`; round3 `q-anthropic-citations`) | the payload-controls-context structural moat ("no source in payload → no claim") | ✅ aligned (arguably stronger: structural vs prompt) — ⚠️ could add the native Citations API + the "retract if no quote" self-check on the conversation path |
| JSON reliability | **Structured Outputs `strict:true`** — *guarantees* schema-valid JSON; GA on Opus 4.8 / Haiku 4.5 (round3 `q-anthropic-structured-output`) | brain factory + `extract()` hand-roll `json.loads` + fence-stripping (the crexi fragility) | ❌ **we hand-roll what the API now guarantees** — adopt `strict:true` structured outputs |

---

## DEPS / CI — the fragility multiplier

- **Authoritative:** pin minimal, reproducible deps per job (uv / pip-compile constraints) — round3 `q-uv-pip-compile`.
  Flaky tests = make the assertion deterministic (no `Date`/random) — round3 `q-flaky-tests`.
- **What we do:** every daily cron `pip install -r ingest/requirements.txt` = the **full ~100-pkg tree**
  (crawl4ai + playwright + patchright + litellm + scipy/shapely/trimesh/pymupdf + Chromium) even when a job
  needs only `psycopg`+`pyyaml`. `bun.lock` frozen-lockfile breakages. The `proposal-nonce` flaky test (6.5%/push).
- **Verdict:** ❌ no per-job minimal deps → every cron exposed to the heaviest pipeline's whole surface.

---

## THE FIX LIST (authoritative-backed)

**P0 — the three real daily breaks**
1. `news_swfl published_date`: add a **dlt `schema_contract={"data_type":"evolve"}`** (variant column, no crash)
   or `"freeze"` (clean contextual error), and/or ALTER the column. Stop the raw psycopg crash.
2. **daily-rebuild**: echo the `_build-report.json` master reason before `exit 1` (record the root).

**P1 — stop recurrence + record roots**
3. Guard `run_probe`/`check_tier1_entry` (honor "always exit 0").
4. master `sources[]`⇆`input_brains[]` load-time invariant (or derive one from the other — declarative deps).
5. Turn the cron ledger into a **postmortem record** for recurring classes (root + action + owner); widen the
   log tail; add classifier rules (DatatypeMismatch, deterministic HOLD); alert only on significant events.
6. Adopt **dlt `merge` + `primary_key`** (or refresh modes) instead of blind `replace`+guard where a stable key exists.

**P2 — observability + the missing pillars**
7. Make freshness an **SLA that can ERROR** (per-source `warn_after`/`error_after`), not observability-only.
8. Add **value-level data tests** (Quality pillar) on load-bearing lake tables; a column-type-change detector (Schema pillar).
9. **Minimal `requirements-probe.txt`** (`psycopg`+`pyyaml`) for probe/gate crons — removes the biggest daily-failure surface.

**P3 — AI layer hardening**
10. Adopt **Structured Outputs `strict:true`** for the brain-factory/extract JSON (kills hand-rolled fence-stripping).
11. Consider the native **Citations API** + "retract if no supporting quote" on the conversation path.

---

## Artifacts
- `round1/` (10) broad best practices · `round2/` (10) data-reliability + observability + root-cause + CI ·
  `round3/` (9) the specific recurring-failure questions. `index.json` in each. Harvester:
  `__scratch__/crawl4ai_web_research.py` (`round1|round2|round3`).
- The **crawl4ai-tool usage** reference (how to use crawl4ai itself) is the separate
  `docs/audit/2026-06-21-crawl4ai-live/` folder.
- The "what we built" map is `docs/audit/2026-06-21-full-platform-audit/NOTES.md`.
