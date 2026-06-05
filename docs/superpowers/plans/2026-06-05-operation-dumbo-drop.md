# Operation Dumbo Drop — the safe-add standard for manual / un-scrapable data

**Status:** STANDING DESIGN PRINCIPLE (2026-06-05). Source-agnostic mechanism; specific datasets TBD.
**Tracker:** check `odd_scaffold_ready` (open). **Canonical live example:** `marketbeat_swfl` (parked, graduation-ready).
**Locked by:** operator decree 2026-06-05 — _"build Operation Dumbo Drop into every build; most important that we have a way to ADD without messing things up."_

---

## What Operation Dumbo Drop (ODD) is

Some of the best SWFL data has **no machine-ingestable source**: it lives in rotating-URL PDFs (C&W / LSI CRE MarketBeat), paywalled reports, manual county portals, or hand-keyed spreadsheets. Auto-scrape is dead for these (the broker landing pages held no data — PR #41 deleted those pipelines). The answer is a **manual quarterly/periodic drop** — a human pulls the numbers and we ingest them deliberately.

ODD is **not a pipeline**. It's the **discipline that lets a manual drop land without breaking the nightly rebuild or contaminating clean signal.** The fear it kills: someone drops a quarter of CRE data and (a) the freshness probe goes red, (b) a half-built table fails the rebuild, or (c) ODD numbers silently blend into ALFRED-grade signal and inflate a brain's confidence.

## The rule for every build

> **Whenever a brain or dataset's authoritative source cannot be auto-ingested** (rotating URL, PDF, paywall, manual portal, hand-keyed), **ship the ODD-ready scaffold in the same PR as the brain.** Then the manual drop is a **zero-code graduation**, never a pipeline break.

This is **not** a gate on every build — most sources have a real cron and never touch ODD. It is mandatory **only for un-auto-ingestable sources**. For those, the scaffold below ships with the consuming brain.

## The five ODD-safe seams (EXTEND these — do not invent a new gate)

Per RULE 3 C2, ODD adds **no new mandatory pre-materialization gate**. It composes mechanisms we already enforce:

1. **Empty-tolerant consumer.** The brain reads its source and tolerates zero rows (the `cre-swfl` reads `marketbeatSwflSource`, returns clean-empty pattern). The brain ships and runs green **before any ODD data exists**; the data "lights up" when dropped. _Seam: pack source connector._

2. **Parked cadence entry.** The cadence block sits under `not_yet_running: / parked: true` in `ingest/cadence_registry.yaml` — **excluded from the freshness probe**, so a dormant/empty table can never fail the nightly. Graduation = move the block to `pipelines:`. _Seam: `cadence_registry.yaml`._ Canonical: `marketbeat_swfl` (lines ~451–462).

3. **Tier-1 cold layer first.** A manual drop lands as **Tier-1 Supabase Storage Parquet** (the speculative cold layer), NOT directly into Tier-2 `data_lake.*` that brains read live. Promotion to Tier-2 happens **only with the consuming brain's PackDefinition** (the brain-first ingest gate, Data Tier Policy rule 2). So a manual drop **cannot silently change a live `/api/b/*` response.** _Seam: tier policy + brain-first gate._

4. **Provenance tag — `source_tag: "odd_extract"`.** Every manually-extracted value is tagged at the fragment/row level so downstream can **filter or caveat** it, never blend it blind. Already shipped for the backtest (`refinery/lib/backtest/` — `odd_extract` rides `AsOfInput → BacktestCall → ScoredCall → SkillScore`, with a clean `lake_tier1_accuracy` beside the blended number so contamination is structurally visible). **Generalize this:** any ODD ingest stamps a provenance column (`source_tag` / `_ingested_at` / `source_url`) so a brain can report "X from authoritative auto-feed, Y from manual drop — needs review" (Data Provenance + Discrepancy Reporting rules). _Seam: provenance columns + display contract._

5. **Idempotent merge + correct `freshness_column`.** The manual ingest writes with `merge` + `primary_key` so re-running a drop **never duplicates**. The DDL's freshness column must match the cadence entry (`_ingested_at` vs the default `inserted_at` — the `dbpr_sirs_submissions` / `marketbeat_swfl` trap). Keeps the probe honest post-graduation. _Seam: dlt write disposition + DDL._

## The graduation checklist (when a real drop is ready)

For an already-scaffolded dataset (e.g. `marketbeat_swfl`), shipping a quarter of data is:

1. Run the manual/CLI ingest → writes Tier-1 Parquet (idempotent merge).
2. Promote to Tier-2 only if the consuming brain's PackDefinition reads it (it already does — that was the scaffold).
3. **Move the `parked:` block to `pipelines:`** in `cadence_registry.yaml`. No other code change.
4. Verify row count + freshness probe green; `expected_rows_min` floor lands.
5. Brain auto-wires (it was empty-tolerant; now it has rows). Stamp `source_tag`/provenance on the rows.

**That's it — the scaffold did the hard part at brain-build time.** This is the whole point of building ODD into every (un-auto-ingestable) build: the drop is mechanical, reversible, and probe-safe.

## What we do NOT know yet (plan-as-best-we-can)

- **Where the data comes from per dataset.** Source discovery is per-vertical and ongoing. `marketbeat_swfl` source is confirmed (C&W / LSI quarterly PDFs, Q3 2026). Others (manual permit batches, paywalled tourism, hand-keyed broker comps) are TBD. **The mechanism above is source-agnostic** — it works regardless of where the bytes come from.
- **Cadence per source.** Default assumption quarterly; set `cadence_days` + `tolerance_multiplier` per publisher when known. Until known, keep it `parked:` (probe-excluded).
- **Multi-source provenance.** `source_tag` is currently a 3-value union (`lake_tier1 | odd_extract | fixture`). If ODD spans several manual sources of differing reliability, widen the union (one-line + backfill) rather than collapsing them into one `odd_extract`.

## Enforcement (how this fires without a human relaying it)

A plan doc is not self-enforcing — a session won't sweep `plans/` on every build. So the rule is anchored on the surfaces a fresh session actually reads:

1. **CLAUDE.md anchor (shipped)** — the Brain Factory section names the **trigger surface** (`ingest/cadence_registry.yaml`, `ingest/pipelines/**`, `sweep-output.json`, a new un-auto-ingestable `refinery/packs/*` brain) and the scaffold. Read every session; authoritative.
2. **Ledger check `odd_scaffold_ready` (open)** — prints at every kickoff.
3. **Memory `project_operation-dumbo-drop-standard`** — auto-loaded read-first flag.
4. **Warn-only PostToolUse hook (PROPOSED, pending operator OK)** — `check-odd-surface.mjs` would fire a one-line nudge the instant an edit touches the trigger surface, exit 0 always (additive, never blocks — C2-clean, mirrors `check-project-path.mjs`). This is the only layer that fires _deterministically on the edit_ rather than relying on the session reading a list. Held until explicitly authorized (a new auto-running hook is self-modification).

## Follow-ups (not built here)

- Consider graduating this doc into `docs/standards/` once a second ODD dataset ships and the pattern is proven twice.
- If the warn-only hook is approved, consider widening it to assert (for any cadence entry tagged `odd_source: true`) that the consumer is empty-tolerant + a Tier-1 target exists. Still warn-only — a lint over the agent's own scaffolding, not a materialization gate (C2-clean).
