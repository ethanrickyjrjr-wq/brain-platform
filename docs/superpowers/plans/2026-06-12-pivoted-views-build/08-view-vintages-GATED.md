# §08 — `view_vintages` capture (in-house ALFRED) — ⛔ SEPARATE GREENLIGHT REQUIRED

> **DO NOT BUILD WITH §§01-07.** This is "step 2" — it requires its own explicit operator yes, beyond the plan approval. It adds a table, a permanent monthly cron, a capture script, and a new failure surface. It is the **only flywheel-positive** piece in this folder; everything else is consistency plumbing.

**Model:** Opus (PIT/look-ahead invariants; the gradeable flip must not fire on empty history)
**Scope:** capture **ZHVI + ZORI only** (the only non-vintaged, backtestable-in-principle series; LAUS has ALFRED, the rest are revised-aggregate/fixture/annual).

## Three phases — keep them separate (CATCH 1)

Registering a series as backtestable is **not inert** — it tells the flywheel to grade it. Splitting prevents grading on near-zero N.

### §08a — inert code/migration (∥ 1-7, no greenlight needed to *write*; no greenlight to *run* a capture)

- **Migration** `docs/sql/20260612_view_vintages.sql` (mirror `20260607_backtest_grades.sql` style): one generic long table
  ```sql
  CREATE TABLE IF NOT EXISTS data_lake.view_vintages (
    view_name   TEXT        NOT NULL,
    as_of       DATE        NOT NULL,   -- the actual capture run date, NEVER backdated
    period      TEXT        NOT NULL,   -- e.g. 'YYYY-MM'
    series_key  TEXT        NOT NULL,   -- the unpivoted column name
    value       DOUBLE PRECISION,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS view_vintages_uidx
    ON data_lake.view_vintages (view_name, as_of, period, series_key);
  CREATE INDEX IF NOT EXISTS view_vintages_pit_idx
    ON data_lake.view_vintages (view_name, as_of);
  GRANT INSERT, SELECT ON data_lake.view_vintages TO service_role;  -- append-only by grant (no UPDATE/DELETE)
  -- NOTIFY pgrst, 'reload schema';
  ```
- **Capture script** `ingest/scripts/capture_view_vintages.py`: a one-line opt-in registry of view names; generic `jsonb_each_text(to_jsonb(t))` unpivot so new view columns are auto-captured; **a non-numeric column = loud per-view failure** (a free R1 tripwire). `INSERT … ON CONFLICT DO NOTHING`. `as_of = CURRENT_DATE` (never backdated).
- **`SourceTag` type member** `"view_vintage"` added to the union (`refinery/lib/backtest/decision-fn.mts:29`) — a type only.
- **Backtest-reader plumbing, left UNWIRED:** a function that maps `view_vintages.as_of → realtime_start` into the existing `Vintage` shape (`grid.mts:28-33`); `initialVintages()`/`pitInitial()` untouched. Nothing registered as backtestable yet.

*This half writes rows but grades nothing. Safe alongside 1-7.*

### §08b — capture run (GATED: operator greenlight + the views exist)

- Cron `.github/workflows/view-vintages-monthly.yml`, **day 26** (template `zhvi-tier1-monthly.yml`). Safe: ZHVI ingests day 22, ZORI day 20 — a 4-6 day buffer; both are fixed monthly schedules, neither is ODD-fed (verified). **Failure-isolated from the nightly rebuild by construction;** failures land in the existing cron-incident machinery.
- Register `zhvi_pivoted` + the zori view (once §06-zori exists). Turn capture on. **Accumulates history; still grades nothing.**
- **The PIT clock starts at the first green run** — every missed month is unrecoverable (true for non-vintaged sources). That's the only real urgency.

### §08c — the `EXCLUDED → BACKTESTABLE` flip (GATED: ≥ ~9 months of real captured history)

- Add `BACKTESTABLE` entries for ZHVI/ZORI (`flywheel-backtest.mts:59-70`) and wire the reader. **Only after `view_vintages` actually holds ~lookback+window ≈ 9 months** of real captures.
- **Must report N + the capture-start caveat** at the flip. Flipping earlier = grading on near-zero N = phantom grades / ungrounded confidence (known burn class — §00, CATCH 1). **Never bundle this into §08a.**

## Verification

- **08a:** migration applies idempotently; `capture_view_vintages.py --dry-run` unpivots correctly; a non-numeric column fails loud; `tsc` clean with the new `SourceTag` member.
- **08b:** `workflow_dispatch --dry-run` then live; `SELECT count(*) FROM data_lake.view_vintages WHERE as_of = CURRENT_DATE` > 0; rerun same day → count unchanged (idempotent — `ON CONFLICT DO NOTHING`). A different-day rerun adds a second vintage for the period; the reader tolerates it (`pitInitial`).
- **08c:** the flip logs N and the capture-start caveat; backtest grades only appear after real history exists; never on empty/near-zero N.
