# Confidence Calibration — Lane 1A Hard Cutover, 2026-05-18

> **Scope:** before/after delta for every brain in PACKS after the headline
> `confidence` formula switched from the legacy multiplicative cap
> (`self × avg(upstream_confidences) × freshness`) to the trust-tier-weighted
> mean across both direct sources AND upstream brains (`Σ(value × tier_score)
/ Σ(tier_score) × freshness`).
>
> The legacy multiplicative number survives as the `joint_integrity`
> diagnostic field on `BrainOutput`. Two further diagnostics ship in the same
> commit: `confidence_dispersion` (population stddev across upstream
> confidences) and `chain_depth` (max DAG hops to a leaf input).
>
> Plan reference: `~/.claude/plans/cosmic-rolling-brook.md` Lane 1A, locked
> delta-table structure section.

## Methodology

- **Source mode:** `REFINERY_SOURCE=fixture` — deterministic, no network. All
  12 packs rebuilt via `bun refinery/cli.mts master --force --no-strict`,
  which walks the full DAG in topo order.
- **`before_*`:** captured from the previously-committed `brains/{id}.md`
  files at HEAD, rendered under the legacy multiplicative formula.
- **`after_*`:** captured from the rebuilt `brains/{id}.md` files after the
  cutover.
- **`input_hash`:** SHA-256 of `(formula_version + sorted(input_brain_ids) +
sorted(source_id:Ttier))`, first 12 hex chars. `formula_version` is held
  constant ("trust-tier-weighted-mean-v1") across before/after so a stable
  hash means "same DAG inputs, same source tiers — any Δ is the formula
  alone."
- **`build_id`:** the brain's `freshness_token` (deterministic per
  `version + refined_at`). `before_build_id != after_build_id` proves a fresh
  run actually happened; `before_build_id == after_build_id` would mean
  "code didn't run" and any Δ would be uninterpretable.

## Delta table

| brain_id             | before_conf | after_conf | Δ     | input_hash   | before_build_id        | after_build_id         | dominant_driver                                                               |
| -------------------- | ----------- | ---------- | ----- | ------------ | ---------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| franchise-outcomes   | 1.00        | 1.00       | +0.00 | 0911cc2fa10c | SWFL-7421-v20-20260517 | SWFL-7421-v21-20260518 | leaf brain, single T1 source — math equivalent                                |
| cre-swfl             | 0.80        | 0.80       | +0.00 | 7231f2d2d9ec | SWFL-7421-v18-20260517 | SWFL-7421-v19-20260518 | leaf brain, single T2 source — math equivalent                                |
| macro-us             | 1.00        | 1.00       | +0.00 | cf0510dd6d74 | SWFL-7421-v1-20260517  | SWFL-7421-v2-20260518  | leaf brain, single T1 source — math equivalent                                |
| macro-florida        | 1.00        | 1.00       | +0.00 | c6cab5a30dfa | SWFL-7421-v4-20260517  | SWFL-7421-v5-20260518  | upstream (macro-us) at 1.0; weighted-mean and Π collapse to the same value    |
| macro-swfl           | 1.00        | 1.00       | +0.00 | 40795c5bdbf5 | SWFL-7421-v15-20260517 | SWFL-7421-v16-20260518 | full upstream chain at 1.0 — no policy delta to surface                       |
| env-swfl             | 1.00        | 1.00       | +0.00 | efeaf026fe0a | SWFL-7421-v7-20260518  | SWFL-7421-v8-20260518  | leaf brain; multi-source but all sources at the same tier                     |
| tourism-tdt          | 1.00        | 1.00       | +0.00 | 5cd7eca4bf32 | SWFL-7421-v7-20260517  | SWFL-7421-v8-20260518  | leaf brain, single T1 source                                                  |
| sector-credit-swfl   | 1.00        | 1.00       | +0.00 | 47c160a6204d | SWFL-7421-v11-20260517 | SWFL-7421-v12-20260518 | 3 upstreams all at 1.0 confidence — both formulas yield 1.0                   |
| traffic-swfl         | 0.80        | 0.80       | +0.00 | 8e3866e35532 | (no token captured)    | SWFL-7421-v2-20260518  | leaf brain, single T2 source                                                  |
| properties-lee-value | 0.90        | 0.91       | +0.01 | 5e807157d965 | SWFL-7421-v3-20260518  | SWFL-7421-v4-20260518  | T1 + T2 source mix — weighted mean upweights the T1 source vs flat-avg tier   |
| logistics-swfl       | 1.00        | 1.00       | +0.00 | 6232e3cd169c | SWFL-7421-v1-20260517  | SWFL-7421-v2-20260518  | leaf brain, T1 source                                                         |
| master               | 0.95        | 0.96       | +0.01 | 50d032880ddb | SWFL-7421-v39-20260518 | SWFL-7421-v40-20260518 | 11 upstreams (mostly 1.0, two at 0.8); weighted mean smoother than legacy `Π` |

Every row has `before_build_id != after_build_id` (or a fresh `after_build_id`
where `before` was unrecorded — `traffic-swfl`'s prior token was not surfaced
by the regex used to harvest the before-snapshot, but its before-confidence
0.80 is unambiguous from the committed `.md`). No "code didn't run" rows.

## Summary

- **Brains with `|Δ| > 0.10`:** **0**. The cutover is well within the noise
  floor — every move is at the second decimal place.
- **Brains crossing a qualitative boundary** (>0.7 → <0.7 or vice versa):
  **0**. No reviewer-eyes-required flags.
- **Brains that moved at all:** **2** (`properties-lee-value` +0.01, `master`
  +0.01). Both moved UP — the new weighted-mean is structurally less
  pessimistic than the legacy multiplicative cap when high-tier inputs are
  present.

## New diagnostic fields surfaced

The cutover ships three new `BrainOutput` top-level fields. Snapshot of the
post-rebuild values:

| brain_id             | joint_integrity | confidence_dispersion | chain_depth |
| -------------------- | --------------- | --------------------- | ----------- |
| franchise-outcomes   | 1.00            | 0.00                  | 0           |
| cre-swfl             | 1.00            | 0.00                  | 0           |
| macro-us             | 1.00            | 0.00                  | 0           |
| macro-florida        | 1.00            | 0.00                  | 1           |
| macro-swfl           | 1.00            | 0.00                  | 2           |
| env-swfl             | 1.00            | 0.00                  | 0           |
| tourism-tdt          | 1.00            | 0.00                  | 0           |
| sector-credit-swfl   | 1.00            | 0.00                  | 1           |
| traffic-swfl         | 1.00            | 0.00                  | 0           |
| properties-lee-value | 1.00            | 0.00                  | 0           |
| logistics-swfl       | 1.00            | 0.00                  | 0           |
| master               | 0.58            | 0.08                  | 3           |

**Reading the master row:**

- `joint_integrity = 0.58` is the legacy multiplicative cap — eleven
  upstream confidences multiplied together. Two of master's upstreams sit
  near 0.8 (`cre-swfl`, `traffic-swfl`); the product compounds. The headline
  0.96 reflects the trust-tier-weighted mean, which doesn't collapse on a
  single sub-1.0 input.
- `confidence_dispersion = 0.08` is the population stddev across upstream
  confidences — the upstream split is tight. Headline 0.96 with dispersion
  0.08 is a clean consensus; if dispersion were >0.20 a reader would want to
  inspect the upstream array before quoting the headline.
- `chain_depth = 3` reflects master's deepest path to a leaf: `master →
macro-swfl → macro-florida → macro-us` (3 hops).

## Confidence interpretation contract (downstream readers)

`confidence` is now the trust-tier-weighted-mean headline. Downstream Claude
sessions should quote it as the brain's published confidence. `joint_integrity`
is the conservative diagnostic — when it's materially below `confidence` (as
on master: 0.58 vs 0.96), there's a story worth surfacing in `caveats`.
`confidence_dispersion` answers "do my upstreams agree with each other?";
`chain_depth` answers "how many synthesis steps removed from primary data is
this conclusion?".

The legacy multiplicative cap is intentionally preserved as a diagnostic, not
deleted — a mathematically honest brain platform keeps both numbers in view
rather than picking one and burying the other.
