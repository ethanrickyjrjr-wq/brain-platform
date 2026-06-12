# §04 — GATE A parity harness

**Model:** Opus (silent-shift detection; epsilon at display precision, slug-set + detail_table equality, the median recompute — a thin diff would miss the exact failures this gate exists for)
**Gate:** §02 (brain-input view `zhvi_zip_latest` live). **Parallel with:** §03, §06-DDL, §07. **Blocks:** §05.

## Why

Before flipping `home-values-swfl` from "computes per-ZIP YoY itself" to "reads the view," prove the two produce the same numbers — across **3 full rebuild cycles**, **machine-diffed, never eyeballed**. A silent value shift at cutover looks like "working" (both paths emit a number, no error) but moves the live figure — and, because `refined_at` is wall-clock, it injects a forward methodology seam into the graded `metric_observations` series. GATE A clean is the *only* thing that makes that seam invisible (see §00, FLAG 4).

## What the harness does

Build a comparison (a test/script, not a feature flag) that, for the same raw data, computes both:
- **View path:** read `data_lake.zhvi_zip_latest` rows.
- **Pack path:** the current `buildZipSnapshot` output (`home-values-swfl.mts:117-142`).

Then diff **four parts**, scoped to the pack's **24-month read window** (`zhvi-source.mts` `monthsBack=24` — don't flag months the pack never saw):

1. **Per-ZIP `home_value_latest`** at **±0.5** and **per-ZIP `value_yoy_pct`** at **±0.005**. Epsilon = *half the last displayed place* (dollars round to 0 dp → ½·1 = 0.5; YoY rounds to 2 dp → ½·0.01 = 0.005). Needed because Postgres `ROUND` (half-away-from-zero) and JS `toFixed` (banker's-ish) differ in the last ULP. **Not** exact-match; **not** a blanket 1e-4.
2. **Regional median recompute:** take the view's per-ZIP rows, recompute `regional_median_yoy_pct` with the *same* median-over-finite-YoY logic (`buildSnapshot:162-170`), and confirm it equals the live pack's value. This is the headline number `classifyPolarity` keys on — a small shift can cross a band (2.9→3.1% neutral→bullish).
3. **Emitted-slug-SET equality:** the set of `home_value_*_zip_*` slugs the pack would emit is data-dependent (top-3 heating + top-3 cooling, `:349-387`). A sub-epsilon tie can flip top-N membership and silently change *which* slugs exist. Assert the sets are identical, not just the values for shared slugs.
4. **detail_table cell stability:** the `home_values_by_zip` table's cell names + values must be byte-stable — downstream `investor-zip-swfl` reads `home_value_zhvi` from it via the thin pipe (§00, FLAG 2). Diff cell names AND values.

Plus the **equivalence test** from §02 (drifted / gapped / two-rows-in-window) as a standing unit test — it pins the `MAX`-within-window selection rule.

## Pass condition (hard gate for §05)

All four parts + the equivalence test green across **3 full rebuild cycles**. A deliberately perturbed ZIP must turn it red (prove the harness bites). Only then may §05 flip.

## Verification

- The harness reports per-part pass/fail with the offending ZIP(s) on failure.
- Inject a 1-cent perturbation into one ZIP's view value → part 1 stays green (within epsilon), but a perturbation large enough to flip a top-N rank → part 3 goes red. Confirms the slug-set check is live.
- Run it 3 cycles (or 3 forced rebuilds); record the diffs.
