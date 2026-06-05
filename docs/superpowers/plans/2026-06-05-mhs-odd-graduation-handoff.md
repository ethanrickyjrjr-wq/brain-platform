# MHS → ODD Graduation — Build Handoff

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:executing-plans` (or
> `superpowers:subagent-driven-development`) to implement this task-by-task. Steps use
> checkbox (`- [ ]`) syntax. **Brain pack OUTPUT-shape / key_metrics-math changes need an
> Opus diff-review before push (CLAUDE.md RULE 1).**

**Status:** READY TO BUILD — operator decisions locked, drift checks cleared, source-aware foundation shipped (2026-06-05, Opus 4.8 session).
**Origin:** the MHS (Maxwell, Hendry & Simmons) 2026 CRE Data Book — the **first live Operation Dumbo Drop graduation** (manual PDF → lake).
**Recipe internals (authoritative):** `docs/littlebird-notes/2026-06-05.md` (CT's geometry/extraction spec — Bonita regression, dual-signal absorption sign, 3-recipe schema). **This file does NOT re-spec the extraction — it carries the locked decisions, the verified constraints, the ODD scaffold, and the owner split.**
**Trackers:** checks `odd_scaffold_ready`, `ian_retrodiction_demo`. ODD standard: `docs/superpowers/plans/2026-06-05-operation-dumbo-drop.md`.

---

## 0. Locked operator decisions (do not re-litigate)

| #     | Decision         | Locked value                                                                                                                                                                                   | Build consequence                                                                                                                                                                                                   |
| ----- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Period-stamp     | **Option C — period supplied at ingest, never read from the PDF.** Implemented in the DDL as `prior_12mo_ending` (DATE) + `prior_12mo_ending_source` (the inference's provenance + falsifier). | **Reject any absorption row with `prior_12mo_ending = NULL`.** The column is nullable (point-in-time vacancy/rent rows don't need it); the no-NULL rule is enforced **on absorption rows specifically**, at ingest. |
| **2** | Charlotte County | **Include ONLY as a Charlotte-FIPS / Charlotte-geo slug. NEVER fold into Lee/Collier** (geometry-space mixing forbidden). Else exclude.                                                        | New canonical slug mapped to Charlotte County FIPS (12015) — own geo. Not a CRE-submarket alias of any Lee/Collier corridor.                                                                                        |
| **3** | MHS cadence      | **ANNUAL** — verified Vendor-First via `mhsappraisal.com/market-trends-2026` (2026 Data Book, published **2026-03-13**; 403 on auto-fetch → a true ODD source).                                | `prior_12mo` windows are **NON-OVERLAPPING** year-over-year. `cadence_days: 365`. The internal "QTD 2026" / "Prior 12 Months" labels are snapshots _inside_ an annual book, not a quarterly cadence.                |

---

## ✅ Shipped this session (the source-aware foundation — build on top, do not redo)

1. **`source_name` in the DDL** (`docs/sql/20260605_marketbeat_swfl_mhs_extension.sql`) — `TEXT NOT NULL DEFAULT 'cw_marketbeat'`. The ODD seam-4 provenance tag **and** the dedup discriminator. (DDL committed to the repo; **not yet applied to the live DB** — table is dormant; apply on graduation.)
2. **Collision-winner rule NAMED** (closes drift #2): on identical `(submarket, period)`, **`mhs_databook` WINS** (geometry-confirmed + per-field verified); `cw_marketbeat` fills only where MHS has no row.
3. **Two cadence entries** in `ingest/cadence_registry.yaml` (`not_yet_running:`, both `parked`): `marketbeat_swfl` → `source_name: cw_marketbeat` (90d), and **new `mhs_databook`** → `source_name: mhs_databook` (365d). One table, two cadences, each scoped by `source_name`.
4. **Source-aware freshness probe** (`ingest/scripts/check_freshness.py`) — `check_tier2_entry` + `check_volume_entry` now filter `WHERE source_name = %s` when the entry sets it, so a recent `cw_marketbeat` write can't mask `mhs_databook` staleness (req #3 "break silently" trap). New test `test_tier2_source_name_scopes_freshness_query`.

---

## 1. Drift checks — VERIFIED this session

- **#1 — Ian outcome resolver is price-free. ✅ CONFIRMED.** `refinery/packs/properties-lee-value.mts:106-162` computes sale-velocity from `sales_count` per `sale_year` (z-score on counts; `velocityCurrentPer1k`); SOH-gap uses assessed values. The parcels query (`buildLeepaSource`, line 182) selects `folioid, just_value, taxable_value, cap_difference, last_sale_date, use_code` — **`last_sale_amount` is NOT selected and never enters velocity math** (latent `ParcelRaw` type field only, line 58). **CONSTRAINT:** the Ian resolver reuses this count/date path — **NEVER read `last_sale_amount`.**
- **#2 — MHS↔C&W double-count. ✅ CLOSED.** `cre-swfl.mts` reads `marketbeatSwflSource` as one row per submarket per latest verified quarter with **no cross-source dedup**. Closed by: `source_name` committed in DDL (the discriminator) + the named collision rule (MHS wins). **CONSTRAINT for the build:** `cre-swfl` must dedupe by `(submarket, period)` preferring `source_name='mhs_databook'` before any median. (Row-retention model = open item **O5**.)
- **#3 — Same-PR consumer rule satisfiable. ✅.** `refinery/packs/{cre-swfl,permits-swfl,rentals-swfl}.mts` all exist. Each recipe ships ingest + the consuming pack edit in the **same PR**.
- **#4 — skill-baseline denominator cited. ✅ DONE.** `refinery/lib/backtest/skill-baseline.mts` cites the persistence-null lift methodology (row-tier `HANDOFF.md` item 2) + check `flywheel_backtest_decision_function`. Tests 29/29.

**Ledger correction (do not re-split):** `b5d92e2` is **one revert unit** — `refinery/lib/backtest/` + COND 1/2 polarity + `brain-vocabulary.json`/`loader.mts`/`grade-config-polarity.test.mts`.

---

## 2. The ODD scaffold — 5 seams per recipe (source-aware from day one)

**Table layout is grain-specific — NOT one table for all three:**

| Recipe        | Grain        | Target table                                         | source_name    | Co-tenant?                        |
| ------------- | ------------ | ---------------------------------------------------- | -------------- | --------------------------------- |
| CRE-submarket | submarket    | **extend `data_lake.marketbeat_swfl`** (DDL shipped) | `mhs_databook` | YES — shares with `cw_marketbeat` |
| Permits       | jurisdiction | **new table** (own DDL)                              | `mhs_databook` | no (MHS-only for now)             |
| Multi-Family  | county       | **new table** (own DDL)                              | `mhs_databook` | no (MHS-only for now)             |

The five seams (mirror the shipped `marketbeat_swfl` / `mhs_databook` pattern):

1. **Empty-tolerant consumer** — pack tolerates zero rows (cre-swfl already does; replicate for permits-swfl + rentals-swfl). Ships green before any drop.
2. **Parked cadence entry** under `not_yet_running: / parked: true`, **probe-excluded**, with `source_name` set (the CRE one — `mhs_databook` → `marketbeat_swfl` — is already shipped; permits + MF add sibling entries for their own tables when built).
3. **Tier-1 cold target first** — manual drop lands as Tier-1 Parquet; promotion to Tier-2 only with the consuming pack (same PR).
4. **Provenance** — every row carries **`source_name`** (the shipped DDL column) + `report_label` + `prior_12mo_ending_source` + `source_url`. (Backtest-layer `source_tag` stays the 3-value union `lake_tier1 | odd_extract | fixture`; row-origin identity lives in `source_name`.)
5. **Idempotent merge + correct `freshness_column`** — `merge` + `primary_key`; `freshness_column: _ingested_at` (the marketbeat trap — NOT `inserted_at`).

**Per-field verification (new, CRE table):** the DDL adds `verified_vacancy` / `verified_rents` / `verified_absorption`, superseding the all-or-nothing `verified` gate (legacy `verified` retained for the n8n C&W writer). **`cre-swfl.mts` + `marketbeat-swfl-source.mts` must move off `verified = true` to per-field gating** for MHS rows.

**Window logic keys off `source_name` (req #3):** `cw_marketbeat` rows → quarterly windows; `mhs_databook` rows → annual, non-overlapping `prior_12mo` windows. A recipe that assumes one cadence per table will mis-window the co-tenant silently.

---

## 3. Build tasks — owner split (Sonnet builds · Opus reviews · Opus+operator decides)

### Recipe 1 — CRE-submarket → `cre-swfl` (build first)

- [ ] **(Sonnet, per CT's `littlebird-notes/2026-06-05.md`)** Geometry extractor — header-match → col-7 absorption, **dual-signal negative (parens + color-canary)**, Bonita regression fix first, Lely=0, period via Option C (reject NULL absorption). _Runs where `drop/mhs-market-trends-2026.pdf` + `_build_geometry.py` live — not on `main`._
- [ ] **(Sonnet)** Writer stamps `source_name='mhs_databook'`, `report_label`, `prior_12mo_ending` (+ `_source`), per-field `verified_*`. Idempotent merge.
- [ ] **(Sonnet build + Opus diff-review — RULE 1)** Wire MHS into `cre-swfl.mts`: **(submarket, period) dedup preferring `mhs_databook`** (the named rule) + move to per-field verification. Changes median math → Opus review mandatory.
- [ ] **(Sonnet)** Charlotte FIPS-only slug (decision #2) in the submarket→canonical map; tests.
- [x] **O5 RESOLVED — retain-both.** DDL widened: `UNIQUE (submarket, quarter, source_name)`; `id = source_name||'_'||submarket||'_'||quarter`. **n8n C&W writer must be updated to the new id format before the first write** (otherwise a same-(submarket,quarter) C&W row will PK-collide with any future MHS row).

### Recipe 2 — Permits → `permits-swfl` (own PR)

- [ ] **(Sonnet)** New permits DDL (jurisdiction grain) + `source_name` + Tier-1 target + parked cadence entry (`mhs_databook` → permits table).
- [ ] **(Sonnet)** Separate **jurisdiction→canonical-place crosswalk** (NOT the CRE submarket table) — Unincorporated Lee/Collier/Charlotte, Cape Coral, Naples, Marco Island, Punta Gorda, **Town of Fort Myers Beach**. Stamp `calendar_year=2025`.
- [ ] **(Sonnet + Opus review if OUTPUT changes)** Empty-tolerant wiring into `permits-swfl.mts`.

### Recipe 3 — Multi-Family → `rentals-swfl` (own PR, last)

- [ ] **(Opus+operator)** Confirm `rentals-swfl` is the MF consumer + resolve MF period ("QTD 2026" underdetermined → Option C).
- [ ] **(Sonnet)** County-grain DDL + `source_name` + Tier-1 target + parked cadence entry + empty-tolerant wiring (+ Opus review on OUTPUT change).

### Independent — resilience (Sonnet, any time)

- [ ] **(Sonnet)** `freeze_watchdog_parse_error_hardening` — `master_is_stale()` returns False on parse error → fail-loud on unparseable master frontmatter (pattern: `f9ae300`).

---

## 4. Ian retrodiction demo (`ian_retrodiction_demo`) — OPUS, standalone

- **Owner: Opus** (the scope tripwire is easy to trip).
- Run the **already-shipped** `computeBacktestCall` (`refinery/lib/backtest/decision-fn.mts`) on **ONE** event (Hurricane Ian). N≈1-2 — **illustrative demo, NOT moat proof; does NOT lift the Track-B HOLD.**
- **Outcomes = TDT collections + LeePA sale-velocity/volume ONLY.** Sale-velocity reuses the price-free `properties-lee-value` count path (drift #1) — **NEVER `last_sale_amount`.**
- As-of inputs: ALFRED LAUS initial vintages (real cron, **clean Tier-1 — not ODD**; keep `source_tag="lake_tier1"` intact).
- **TRIPWIRE — STOP if it grows into:** a reusable harness, a generalized event-manifest, or a generalized vintage-resolver. Held scope (`row_tier_build_remaining`).

---

## 5. Open items (need operator or the PDF-env)

- **O1 — LeePA `last_sale_amount` NULL-state discrepancy.** Operator states 100% NULL; memory `leepa-no-sale-price` says "VERIFIED POPULATED 2026-06-04." **Moot for the demo** (velocity never reads it). Needs a live DB count to reconcile the memory. → memory hygiene.
- **O3 — Exact data cutoff inside the 2026 PDF** (the value to infer for `prior_12mo_ending`). Page shows publish 2026-03-13; data cutoff needs eyes-on-PDF (CT's Copilot check). Option C covers it operationally.
- **O4 — Extraction lives in the PDF env.** `drop/mhs-market-trends-2026.pdf` + `_build_geometry.py` are NOT on `main`. Geometry runs where the PDF lives; the repo-side ODD scaffold ships here ahead of the drop.
- **O3 — Exact data cutoff inside the 2026 PDF** (the value to confirm for `prior_12mo_ending`). Currently inferred as `2026-03-31` (URL `/2026/03/` + "QTD 2026" title; stored in `prior_12mo_ending_source`). Until LittleBird item C is confirmed from the MHS website, MHS `quarter = '2026-Q1'` is tentative — derived as `to_char(prior_12mo_ending, 'YYYY-"Q"Q')`. If confirmed date shifts, update the writer's period stamp; no structural migration needed.
- **O4 — Extraction lives in the PDF env.** `drop/mhs-market-trends-2026.pdf` + `_build_geometry.py` are NOT on `main`. Geometry runs where the PDF lives; the repo-side ODD scaffold ships here ahead of the drop.

> **O2 (was: source-precedence) — RESOLVED:** MHS wins. Folded into the named collision rule above.
> **O5 (was: row-retention) — RESOLVED:** retain-both. `UNIQUE (submarket, quarter, source_name)` shipped in DDL. See §3 Recipe 1 note for n8n writer update requirement.
