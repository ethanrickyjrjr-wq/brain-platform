# Pivoted Views Pattern — Build Plan (folder index)

**Created:** 2026-06-12 · **Status:** APPROVED for execution (docs-only at this point — no view, migration, GRANT, cron, or cutover has run) · **Branch:** main
**Spec:** `docs/superpowers/specs/2026-06-12-pivoted-views-pattern-design.md` (corrected by §01 — read §00 first)
**Full adjudication + provenance:** `00-ADJUDICATION.md`

## What this is

The approved spec moves derived math (YoY %, pivots) out of TypeScript brain packs into `data_lake.<brain>_pivoted` SQL views, consumed by a public `/charts` page, the brain packs (parity-gated cutover), and an R&D side-master (deferred). This folder is the **build**, decomposed into ordered, model-tagged sections. Every claim here was audited against code (RULE 3 C1) across three review rounds; the corrections that came out of that audit are in §00.

**Verdict:** correct path for the flywheel, with corrections. The views + `/charts` are flywheel-**neutral** plumbing (consistency, cheaper rebuilds). The only flywheel-**positive** piece is the gated `view_vintages` capture (§08) — ZHVI/ZORI publish no vintages, so as-of capture is the only way they become backtestable.

## How to use this folder

Each `NN-*.md` is a self-contained build brief: a **model tag** (Opus/Sonnet), its **dependency gates**, and a **verification block**. Execute in dependency order. Opus is assigned wherever a silent mistake corrupts data with no error (SQL correctness, parity epsilon, cutover, vintage PIT); Sonnet where the work follows a proven pattern over a small surface.

## Master sequence — model · dependencies · parallelism

| § | File | Model | Hard gate (cannot start before) | Parallel with | Blocks |
|---|---|---|---|---|---|
| 00 | `00-ADJUDICATION.md` | — (read first) | — | — | — |
| 01 | `01-spec-corrections.md` | **Opus** | — | all (doc-only) | execution against the wrong-brain spec |
| 02 | `02-zhvi-views.md` | **Opus** | raw `zhvi_swfl` exists ✓ | 01, 07, 08a | 03, 04, 06-cutover, 08-capture |
| 03 | `03-charts-page.md` | **Sonnet** | 02 (display view live) | 04, 06-DDL, 07 | — |
| 04 | `04-gate-a-parity.md` | **Opus** | 02 (brain view live) | 03, 06-DDL, 07 | 05 |
| 05 | `05-gate-b-cutover.md` | **Opus** | **04 clean ×3 cycles** | 06-other-DDL, 07 | — |
| 06 | `06-additional-views.md` | **Sonnet** (+Opus spot-check) | 02 (DDL); 04 harness; **consumer brain live** | 03, 05, 07 | 08-capture (zori) |
| 07 | `07-freshness-view-liveness.md` | **Sonnet** | — (code); 02 (green check) | **everything** | — |
| 08 | `08-view-vintages-GATED.md` | **Opus** | 08a: — · 08b: greenlight+views · **08c: ≥~9mo real history** | 08a ∥ 1-7 | flywheel backtest (after 08c) |
| 99 | `99-slug-coverage-and-risk-register.md` | — (reference) | — | all | — |

**Serial spine: 02 → 04 → 05.** Everything else hangs off it in parallel.

### Ordering constraints (read these)

- **§01 first.** The spec still names `housing-swfl` as the ZHVI/ZORI consumer — it is not (that's the Redfin brain). The real consumers are `home-values-swfl` (ZHVI) and `rentals-swfl` (ZORI). Nobody executes against the original spec until §01 lands.
- **GATE A timing.** §04 is **3 full rebuild cycles**; on a nightly cadence the §05 cutover lands **≥3 days** after the views go live. Plan a multi-day cutover, not a same-day flip.
- **"Can §08 run while 1-7 go?"** — **§07 yes, fully parallel** (code independent; only its green check waits on a view). **§08 splits three ways:** §08a (table migration, capture script, cron, `SourceTag` type, *unwired* reader) is inert and parallel with 1-7; §08b (turn capture on) waits on greenlight + the views; **§08c (the `EXCLUDED→BACKTESTABLE` flip — the one non-inert part) waits on ~9 months of real captured vintages** and reports N + a capture-start caveat. The flag-flip never rides in the code half.

## Standing constraints (every section)

- **R1** views emit pure math only — no direction/labels (`trend='bullish'`); the pack decides what a number means.
- **R2** `GRANT SELECT … ; NOTIFY pgrst, 'reload schema';` after every `CREATE OR REPLACE VIEW`, **verified via a live PostgREST read, not psql.** Default grant = `service_role` only (the `/charts` page is server-side; confirmed via the `app/embed/charts` sibling). `anon` only if a client-side reader is ever added.
- **R4** citations branch on `env.source` (live vs fixture); never hardcode a `data_lake.*` path string.
- **R5** master reads brain OUTPUTS only — never raw tables, never `/charts`, never a view it doesn't own.
- **GATE A** cutover parity, machine-diffed, 3 cycles. **GATE B** null-view = loud failure, never a silent empty metric.
- **No-invention / freshness** unchanged — the system cannot emit a number finer than it holds; freshness token quoted on first response.
- **Side-master** is deferred, not dropped — a later phase, correctly absent here.
