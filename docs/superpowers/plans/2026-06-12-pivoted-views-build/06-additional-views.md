# §06 — Additional views (runbook)

**Model:** Sonnet for the mechanical repetition, **Opus spot-check on each new view's YoY/grain** (the math is where the trap lives).
**Gate:** §02 (pattern) for the DDL; §04 (proven harness) for each cutover; **consuming brain must be live (FLAG 3)**. **Parallel with:** §03, §05, §07. **Blocks:** §08-capture (needs the zori view).

## The runbook (per series)

1. Identify the raw table + the per-record derived math (pure aggregation only — R1).
2. Write the two views (display + brain-input), reusing §02's faithful-tolerance YoY where a YoY is needed.
3. `GRANT SELECT … TO service_role; NOTIFY pgrst, 'reload schema';` — verify via a **live PostgREST read**.
4. Run the §04 GATE A harness for that brain (3 cycles) before any cutover.
5. Define GATE B null behavior in the pack before removing self-compute.

## Hard gate before any series gets a brain-input view (FLAG 3)

**A view may claim brain slugs only if its consuming brain is live AND emitting those slugs on a real data path.** Otherwise the view is **display-only** and must not be wired to a non-live brain (that would be Tier-2 derived output with no consumer — a brain-first-ingest-gate violation).

## Series, in priority order

| Series | Brain | Status / gate |
|---|---|---|
| **ZORI** | `rentals-swfl` | **Next after ZHVI.** Live; byte-identical lookback → harness transfers verbatim. Full cutover. Its view feeds §08 capture. |
| **LAUS** | `macro-swfl` | Live. **Display/consistency only** — LAUS already has ALFRED vintages, so no capture value; low urgency. |
| **OEWS** | `labor-demand-swfl` | Live but **ANNUAL** cadence → low-value view (changes once a year). Confirm-live, note cadence. |
| **TDT** | `tourism-tdt` | **GATED — not confirmed live-emitting** (no `metric:` literals; TDT self-ingest migration/backfill pending). Do NOT build a brain-input view until the brain emits live. Display-only at most. No capture (fixture-only + backtest-EXCLUDED). |
| **Rainfall** | `env-swfl` | Live (`env_rainfall_swfl_annual_in`). Annual aggregate + seasonal deviation. Confirm the exact slug set at build; env-swfl's flood slugs are unrelated and untouched. |

## Verification (per series)

- Same as §02/§04/§05: row counts, live PostgREST read, equivalence test (incl. two-rows-in-window), GATE A 3 cycles, GATE B loud-null, OUTPUT contract stable, `--all` orphan check green.
- For any **display-only** view (non-live consumer): confirm it claims **no** brain slugs and creates no Tier-2-without-consumer drift.
