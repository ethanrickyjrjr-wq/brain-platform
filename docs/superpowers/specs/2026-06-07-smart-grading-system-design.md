# Smart grading system — backtest corpus + live gradeable yield

**Date:** 2026-06-07
**Status:** §2 SHIPPED · §6-B SHIPPED · §6-A A1–A3 SHIPPED + runtime-verified (A4/A5 = §3/§4 integration)
**Scope:** The Glass §2 (flywheel backtest) + §6 (lift live gradeable-call yield). Companion to
`2026-06-07-the-glass-build-decomposition.md` and the flywheel-bootstrap plan.

The moat is a **scored history of falsifiable directional calls** (THE-GOAL). Two halves feed it:
the **retrodicted** corpus (backtest, internal tuning fuel only) and the **live** corpus (the public
moat). This doc covers both and the one honesty rule that governs them: **never manufacture a bet to
look gradeable.**

---

## §2 — Flywheel backtest engine (SHIPPED)

Turns the decision function from N≈1 (Ian demo) to N=144 over the only point-in-time-honest series
we hold: **ALFRED LAUS** vintaged unemployment (Lee `FLLEEC7URN`, Collier `FLCOLL0URN`).

**What shipped**

- `docs/sql/20260607_backtest_grades.sql` — `public.backtest_grades` (pinned contract + audit cols,
  idempotent on `(slug, as_of_date, grade_method)`, `grade_method` CHECK-pinned to `'retrodicted'`,
  `GRANT … service_role` only). Applied to the live DB; PostgREST reloaded.
- `refinery/lib/backtest/grid.mts` — pure PIT/grade math (15 unit tests). Reuses
  `computeBacktestCall` + `computeDirection`; only **selects** point-in-time values and **maps** the
  verdict.
- `refinery/tools/flywheel-backtest.mts` — the as-of grid harness (DuckDB over the pinned ALFRED
  parquet → grid → skill + calibration → idempotent upsert). `--dry-run`, `--snapshot`, `--lookback`,
  `--step-months`.
- **144 retrodicted grades written** (Lee 71, Collier 73 — clears ≥30/slug, ≥100 total).

**First read (honest):** system 42.0% vs persistence-null 48.6% → **lift −6.5pp**. A simple 6-month-
trend rule does **not** beat last-quarter carry-forward on a strongly-persistent series. This is the
plan's anticipated legitimate outcome ("not beating naive → the call logic needs work before
weighting does"), **not** a failure. Calibration table is produced per confidence band.

**Two correctness lessons baked in (they also govern the LIVE system, §6-A below):**

1. **Initial-vintage PIT discipline.** The decision (as-of + prior) reads only the *as-first-reported*
   value gated by `realtime_start ≤ as_of` — never a later BLS revision. The outcome is read the same
   way (`≤ window_end`). Tested by the look-ahead guard in `grid.test.mts`.
2. **Non-overlapping windows.** The first pass used a monthly grid (step 30d) with a 90d window; the
   persistence baseline then peeked 60d past the as-of date and lift came out −28pp — an *artifact*.
   Fix: **grid step ≥ window** (quarterly) so the naive baseline can't see the future. **Skill is
   measured as lift over a persistence null, never raw accuracy.**

**Excluded (logged, never silently dropped):** LeePA sale-velocity (`leepa_parcels` keeps only the
latest qualified sale per parcel → a yearly grid undercounts older years; NOT PIT-honest as a grid —
the Ian demo's N=1 use was an accepted one-off caveat), Lee permits (immutable issue-date but the
vocab slug has no grade block + thin window), ZORI / Census ACS / BLS QCEW / TDT (revised or
fixture-only).

**Re-run:** `bun refinery/tools/flywheel-backtest.mts` (write) or `--dry-run`. Idempotent.

---

## §6 — Lift live gradeable-call yield

**Why it matters:** the *live* graded record is the only number we may ever quote publicly
(retrodicted grades are tuning fuel, never marketing). Today only ~6 of 40 master predictions were
ever gradeable; the rest are `mixed` (ungradeable by definition) or cite a non-gradeable driver. The
highest-leverage non-UI work is raising the **honest** live gradeable rate.

### The two leaks (audited against live code)

1. **Mixed synthesis** — `voteDirection` returns `mixed` when agreement < 0.60 →
   `predicted_direction = null` → ungradeable. **This is correct and stays.** A mixed read is a true
   read; lowering the threshold (**approach C**) manufactures bets and is **rejected** — the hard
   honesty line.
   - **Approach C′ — "neutral abstains from the denominator" — ALSO REJECTED (tried + reverted, da0a79d, 2026-06-09).**
     A parallel session changed `agreement_ratio` to `winner / (bullish + bearish)`, dropping neutral weight, so the
     opinionated minority alone decides direction. Audit + adversarial web pass (RULE 3 C1) both refuted it:
     - **It manufactures conviction from near-silence.** Its own locked-in test asserts that a single magnitude-0.1
       bearish whisper, amid an otherwise-neutral lake, yields a *confident* master "bearish" (`agreement_ratio > 0.6`).
       It also eliminates `neutral` as a possible synthesized read (only survives the all-zero case).
     - **The canonical directional-consensus method does the opposite.** The ISM PMI **diffusion index** —
       the standard for turning up/same/down sector signals into one directional read — *includes* the "same"
       (neutral) responses at **0.5 weight**, centered at 50; it never drops them
       (https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/pmi/ ;
       https://www.economy.com/united-states/ism-purchasing-managers-index). Dropping neutral swings the read on the
       minority — the exact failure above.
     - **Calibration evidence cuts the same way.** Professional forecasters are systematically *over-precise*
       (53% stated confidence, 23% correct — https://online.ucpress.edu/collabra/article/10/1/92953/200113); forcing
       directional calls from thin signal amplifies the dominant bias. Forecast-combination work (Timmermann) finds
       simple **inclusive** averaging robustly hard to beat; selectively dropping members underperforms.
     - **Decision:** neutral **stays in the denominator**. The honest path to more gradeable calls is **§6-A**
       (per-slug leaf predictions, attributed to the leaf), *not* loosening master's vote. If a future change wants
       PMI-style treatment, the correct form is neutral at a *fractional* weight toward "no change," not a full drop —
       and it must update this block, not silently re-flip the code.
2. **Non-gradeable anchor** — for a *directional* read, `composeConditionalThesis` cited the dominant
   upstream's `key_metrics[0]`. `deriveGradeFields` grades the **first numeric basis_ref** and (by
   design) does **not** skip to a later gradeable one — so if `key_metrics[0]` had no grade block, the
   whole directional call was needlessly ungradeable.

### §6-B — Gradeable-anchor selection (SHIPPED)

`composeConditionalThesis` now takes an injected `gradeConfigFor` resolver and anchors directional
(and neutral) claims on the dominant's **first gradeable, non-contradicting** driver slug:

1. first **gradeable + aligned** numeric driver (author order) → the checkable anchor;
2. else a **non-gradeable** numeric driver → row is honestly *ungradeable*, never mis-graded;
3. else (only contradicting gradeable slugs) → cite `brain_id` alone → ungradeable.

A sign-basis slug whose own value direction **opposes** the claim is skipped — never anchor a bullish
claim on a bearish-signed driver (that would grade the claim backwards and poison calibration). The
change touches **which already-emitted driver is cited as checkable**; it never changes a claim's
direction (no manufactured bet). The resolver is injected so `synth.mts` stays free of vocab I/O;
absent ⇒ exact prior behavior (zero regression — 49 synth tests green). Files:
`refinery/lib/synth.mts`, `refinery/packs/master.mts`.

**Effect is latent and honest:** the current live read is `mixed` (stays ungradeable); B lifts yield
on the next **directional** master refine. Integration-tested end-to-end (`composeConditionalThesis`
→ `deriveGradeFields` with the live resolver → `grade_status='gradeable'`).

### §6-A — Per-slug leaf prediction logging (A1–A3 SHIPPED + runtime-verified)

> **Build status (2026-06-07):** A1 (schema), A2 (pure deriver + cadence filter), A3 (cadence-guarded
> write wired into Stage 4 for every pack) are **shipped and runtime-verified** (a live smoke inserted
> a `kind='slug'` row, the existing grader picks it up on window close, then cleaned up). The live
> yield materializes on the next nightly refine. **A4** (calibration read consuming both `outcomes` +
> `backtest_grades`) and **A5** (`data_targets` falsifiability-gap trigger) are deliberately left as
> The Glass **§3 / §4** integration work, not duplicated here.

**The multiplier.** Master's top-line is one synthesized call and is *often* `mixed` by construction.
But each of the ~22 leaf brains holds clean directional reads on numeric slugs. Grading those —
attributed to the leaf — multiplies the honest gradeable corpus and **aligns the live universe with
§2's retrodicted one**.

**The substrate is already half-built:** `metric-observations-log.mts` already snapshots *every*
brain's numeric `key_metrics` to `metric_observations` (the grader's window-close value source). The
deterministic grader already resolves any slug. What's missing is logging the leaf **predictions**.

**Honest design (the smart part — not "log everything"):**

- **Self-directional slugs only.** Log a per-slug prediction only for **sign-basis gradeable** slugs
  (z-scores, YoY deltas, percent-changes) where `direction = computeDirection(value, 0, cfg)` is a
  deterministic read of the value's own sign × polarity. No borrowing a brain's overall direction →
  no invented attribution. Neutral (inside ε) → not a bet → skipped. (Delta-basis *level* slugs are
  skipped; their directional sibling slug carries the gradeable read.)
- **Non-overlap cadence (the §2 lesson, applied live).** Do **not** re-log a slug while an open
  prediction already covers an overlapping window — else a persistent z-score grades "hit" by
  autocorrelation every night and inflates apparent skill. Log a slug at most **once per its
  `window_days`** (a guard: skip if an open prediction for `(brain_id, slug)` has
  `window_end_date > now`). This is the live mirror of §2's "grid step ≥ window."
- **Skill = lift, not accuracy.** Report the leaf corpus the same way as §2 (`computeSkillScore`,
  lift over persistence), per-slug N stamped. Never a bare %.
- **Discriminator.** Add `prediction_kind TEXT NOT NULL DEFAULT 'synthesis'` to `predictions`
  (`'synthesis'` = master's top-line headline, `'slug'` = a leaf per-slug sub-call). Pane 2 shows the
  master headline with leaf sub-calls grouped/expandable; `grade_accuracy_by_slug` already dedups by
  `(slug, baseline, window_end)`. **Internal-ledger-only — changes no customer-facing answer.**

**Phased build (each its own commit, diff-reviewed before push):**

- **A1 — schema.** `prediction_kind` column (idempotent migration, default `'synthesis'` so existing
  rows are unchanged); index on `(brain_id, gradeable_slug, window_end_date)` for the cadence guard.
- **A2 — pure deriver.** `deriveSlugPredictions(brainOutput): PredictionRow[]` in `predictions-log.mts`
  — sign-basis gradeable slugs → directional rows, `prediction_kind='slug'`. Pure, unit-tested
  (mirrors `grid.buildGradedCall`'s honesty gates).
- **A3 — cadence-guarded write.** `logSlugPredictions(opts)` reads open `(brain_id, slug)` predictions
  and inserts only those whose window has lapsed; wired into Stage 4 **for every pack** (the
  master-only guard stays on the *synthesis* row).
- **A4 — read/calibrate.** Feed both `outcomes` (live) and `backtest_grades` (seed) into the
  skill/calibration read; keep `grade_method`/`prediction_kind` so live-only can stand alone once N is
  large. Ties into The Glass §3.
- **A5 — self-awareness (ties to §4 `data_targets`).** A "falsifiability gap" target when a
  brain/slug emits mostly ungradeable calls — the system noticing it isn't making bets.

---

## Honesty guardrails (govern both halves)

1. **Never manufacture a bet** — mixed/neutral stays ungradeable; B/A only make *already-made* reads
   checkable. (Approach C rejected.)
2. **Retrodicted ≠ live** — separate tables, `grade_method` pinned; a retrodicted % is never public.
3. **Skill = lift over a naive persistence null**, never raw accuracy. Non-overlapping windows.
4. **Report N with every number.**
5. **No look-ahead** — PIT discipline on the decision (backtest) and the cadence guard (live).

## Open checks filed (RULE 2)

- `flywheel_backtest_grades_corpus` — CLOSED (144 rows live, verified).
- `flywheel_calibration_read` — CLOSED (first lift + calibration read produced: lift −6.5pp, does not
  beat naive).
- `glass_section6_leaf_yield` — OPEN (build §6-A A1–A5 per this plan; B shipped).
- `row_tier_build_remaining` — its Track-B "held behind `flywheel_backtest_decision_function`" clause
  is reconciled: the decision function is settled and exercised at N=144; the HOLD is lifted.
