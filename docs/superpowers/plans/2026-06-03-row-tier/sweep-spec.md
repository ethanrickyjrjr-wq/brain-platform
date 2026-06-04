# Grade-Config Sweep — spec (plan phase P2, Track A on-ramp)

**Filed:** 2026-06-04 · **Status:** design — greenlit; mechanical pass sub-agent-scopable once §1 lands · **Parent:** `README.md` (P2) + `HANDOFF.md` (Track A)
**Origin:** LB plan-review (2026-06-04, two rounds), grounded against `refinery/vocab/loader.mts` + `refinery/lib/predictions-log.mts`.

> Design doc, not a status board. The sweep's _output_ is a regenerable data artifact (§5), never a hand-maintained markdown checkbox board (RULE 2 — the rotting-status-board failure). Adjudications land in the `checks` ledger.

---

## 0. Purpose

One mechanical pass over the whole vocabulary that partitions every metric slug into **exactly one** bucket, producing the three-column ledger the row tier and the flywheel both stand on:

1. **row vs brain** — row-tier candidate vs prediction target. _(R1 — the final call is an Opus semantic decision; the sweep emits **candidates** only.)_
2. **moat-fuel backlog** — slugs ungradeable **only** for a missing polarity (the cheapest predictions to unlock).
3. **backtestable inventory** — `gradeable ∩ vintage-clean` (joined from `docs/littlebird-notes/2026-06-04.md`).

The sweep does **not** decide row-vs-brain, does **not** rewrite any polarity, does **not** widen the corpus, and does **not** define Track B's predictor.

---

## 1. Code-writes (two, both in `loader.mts`, coupled)

`resolveGradeConfig` (`loader.mts:220`) **short-circuits** — it returns the _first_ failing gate as `reason`. Wrong for bucketing: a slug failing two gates reports only the first, so reason-string branching double-counts. It also has a **hole**: the polarity gate checks only `=== "none"` (`loader.mts:268`), so an **out-of-enum** value (`"neutral"`, `"higher_is_bearish"`) passes as "declared" and can reach `gradeable:true` with a garbage polarity.

### 1a. Tighten the polarity gate to enum-membership (CATCH 2)

Change `loader.mts:268` from `direction_polarity === "none"` to **membership in `{higher_is_bullish, lower_is_bullish}`**, with two distinct reasons:

- absent / `"none"` → `reason: "no direction_polarity declared"`
- present but ∉ enum → `reason: "invalid direction_polarity '<raw>' (not in enum)"`

This closes finding (c) **at the runtime source** (the grading path `deriveGradeFields` reads, `predictions-log.mts:124`), consistent with the existing fail-safe design ("an unknown / polarity-less / non-numeric / qualitative slug returns `gradeable:false`").

- **Blast radius is live-inert today — three slugs, one functional flip.** The tighten touches exactly the three out-of-enum slugs in the corpus: (1) `licenses_cbc_share_swfl` (`"neutral"`) is the **only `gradeable:true → false` flip**, and its pipeline is **not running** — no live prediction path touches it; (2) `dbpr_notices_abt_90d` and (3) `dbpr_releases_abt_90d` (both `"higher_is_bearish"`) were **already `false`** (window-blocked), so the tighten changes only their _reason_ string, not their gradeability. No fixed total-count assertion — the enum-scan test (not a magic number) is what guards against a fourth slug creeping in. Safe to ship now.
- **Pin goes green on tighten, not on audit.** Once tightened, an invalid-polarity slug is `gradeable:false` **and** `gateVector` not-all-green → both sides agree → the §3 pin is green the same commit. The directional audit (§4) is **decoupled** — it re-homes the slug, it does not gate the pin. Never ship the pin red.
- Extend the Step-0 test `refinery/vocab/grade-config-polarity.test.mts` with one enum-rejection case.

### 1b. Add `gateVector` (no short-circuit)

A pure function **inside `loader.mts`** (where `CATEGORY_WINDOW_DAYS` (102), `VALUE_TYPE_BUCKET` (128), `conceptForSlug` (189) already live — all unexported, so co-locating avoids exporting internals or refactoring `resolveGradeConfig`). Export it.

```ts
export type PolarityState = "valid_directional" | "none" | "invalid";

export interface GateVector {
  slug: string;
  concept_id: string | null;
  registered: boolean; // conceptForSlug(vocab, slug) !== null
  polarity_state: PolarityState;
  //  valid_directional ⇔ raw ∈ {higher_is_bullish, lower_is_bullish}
  //  none              ⇔ raw absent or === "none"
  //  invalid           ⇔ raw present but ∉ DirectionPolarity enum
  window_ok: boolean; // (g.window_days ?? CATEGORY_WINDOW_DAYS[category]) != null
  numeric_ok: boolean; // epsilon != null && grade_basis != null (slug or VALUE_TYPE_BUCKET)
  // raw values carried for the ledger / audit:
  raw_polarity: string | null;
  category: string | null;
  value_type: string | null;
  window_days: number | null;
}
```

Each boolean is evaluated **independently** — no early return. ~20 lines + unit test. Both 1a and 1b are grading-layer changes → ship as one commit with **Opus diff-review** (RULE 1: not doc-only).

---

## 2. Bucket assignment — total, disjoint truth table (CATCH 1)

`gateVector` has 4 axes: `registered` ×2 · `polarity_state` ×3 · `window_ok` ×2 · `numeric_ok` ×2 = **24 combos**. Assignment is by **strict precedence (first match wins)**, which makes the function total and disjoint by construction:

> **unregistered ▸ invalid-polarity ▸ row-candidate (`!numeric`) ▸ gradeable ▸ moat-fuel ▸ needs-window**

Precedence rationale for multi-false cases:

- **unregistered dominates everything** — with no concept, polarity/window/numeric are uncomputable.
- **invalid-polarity dominates non-numeric** — a polarity token (even garbage) is author _intent-to-grade_; intent-to-grade on a non-numeric slug is a contradiction that needs a human, not an auto-route to row.
- **non-numeric (row) dominates gradeable/moat-fuel/needs-window** — a non-numeric metric can _never_ be a prediction target regardless of polarity/window, so it resolves before those are considered. **This is the step that kills the first-failing-gate double-count.**

### The 24 combos

`registered = false` (12 combos): polarity/window/numeric are **N/A** (uncomputable without a concept) → all collapse to **`unregistered`**. Not independently reachable; listed as one row.

| reg | polarity | window | numeric | → bucket                                |
| :-: | :------: | :----: | :-----: | --------------------------------------- |
|  F  |    \*    |   \*   |   \*    | **unregistered** (12 don't-care combos) |

`registered = true` (12 combos), every one reachable:

| #   | polarity | window | numeric | → bucket             | why (precedence)                                                      |
| --- | :------: | :----: | :-----: | -------------------- | --------------------------------------------------------------------- |
| 1   |  valid   |   T    |    T    | **gradeable**        | passes all gates                                                      |
| 2   |  valid   |   T    |    F    | **row-candidate**    | `!numeric` ▸ before gradeable                                         |
| 3   |  valid   |   F    |    T    | **needs-window**     | only window missing                                                   |
| 4   |  valid   |   F    |    F    | **row-candidate**    | `!numeric` ▸ before needs-window                                      |
| 5   |   none   |   T    |    T    | **moat-fuel**        | polarity is the _sole_ blocker                                        |
| 6   |   none   |   T    |    F    | **row-candidate**    | `!numeric` ▸ before moat-fuel                                         |
| 7   |   none   |   F    |    T    | **needs-window**     | window + polarity both missing; numeric ⇒ not row; window-lever named |
| 8   |   none   |   F    |    F    | **row-candidate**    | `!numeric` dominates                                                  |
| 9   | invalid  |   T    |    T    | **invalid-polarity** | invalid ▸ before all                                                  |
| 10  | invalid  |   T    |    F    | **invalid-polarity** | invalid ▸ before non-numeric                                          |
| 11  | invalid  |   F    |    T    | **invalid-polarity** | invalid ▸ before needs-window                                         |
| 12  | invalid  |   F    |    F    | **invalid-polarity** | invalid ▸ before non-numeric                                          |

Bucket tallies (reg=T): invalid-polarity 4 · row-candidate 4 · gradeable 1 · moat-fuel 1 · needs-window 2 = 12 ✓. **No combo maps to two buckets; every combo maps to one.**

Bucket dispositions:

| Bucket             | Disposition                                                                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unregistered`     | Defensive; expected empty for a vocab-sourced sweep. Non-empty = finding.                                                                                                                                                          |
| `invalid-polarity` | **FIX-OR-REMOVE via per-slug directional audit (§4).** One `checks` row per slug.                                                                                                                                                  |
| `row-candidate`    | Row tier. **R1 candidate — Opus confirms** (sweep does not decide row-vs-brain).                                                                                                                                                   |
| `gradeable`        | Prediction target → a brain. Feeds column 3 when also vintage-clean.                                                                                                                                                               |
| `moat-fuel`        | Declaring a **valid** polarity flips it to gradeable. Cheapest unlock. (= LB's "missing-polarity," scoped to polarity-is-sole-blocker.)                                                                                            |
| `needs-window`     | Blocked on a missing `CATEGORY_WINDOW_DAYS` entry, not polarity. Lever = add the category window, or it is not a target. Expected empty today (the `regulatory` dbpr slugs land in `invalid-polarity` first). Non-empty = finding. |

---

## 3. Cross-check (drift pin — green from the §1a commit)

Per slug the sweep also records `resolveGradeConfig(slug).gradeable` + `.reason`, and asserts the **total equivalence**:

```
gateVector.registered
  && gateVector.polarity_state === "valid_directional"
  && gateVector.window_ok
  && gateVector.numeric_ok
  ⇔  resolveGradeConfig(slug).gradeable
```

Before §1a this is **red** (invalid-polarity slugs return `gradeable:true` while `gateVector` is not-all-green). After §1a both sides reject invalid polarity → **green for all 24 combos**. The pin is shipped only with §1a in the same commit. A future regression in either function fails the pin.

---

## 4. The two named slug findings — do NOT auto-rewrite (COND 1/2)

Both ride in bucket `invalid-polarity`. Neither is a mechanical edit; each → a `checks` row for an **Opus per-slug directional audit**.

- **COND 1 — `higher_is_bearish`** (dbpr ABT slugs, `brain-vocabulary.json:3164,3179`). **Inversion trap — the one mapping that is safe is `higher_is_bearish → lower_is_bullish` ONLY, never `higher_is_bullish`.** Rising-is-bearish is monotonically equivalent to falling-is-bullish; collapsing it the other way silently inverts the metric (the cre-swfl polarity-inversion class). The §1a tighten does **not** auto-rewrite — it normalizes the out-of-enum token to `none` (ungradeable) and the **`raw_polarity` field on `GateVector` carries `"higher_is_bearish"` verbatim — that raw string IS the audit trail** the per-slug audit re-derives from. (A `GateVector` that dropped the raw token to a bare `polarity_state: "invalid"` would erase exactly the value the directional fix needs.) Fix = re-derive the correct polarity from the metric's economic meaning _for its consuming brain_ (is rising ABT-enforcement actually bearish?), then write `lower_is_bullish` if so — never the inverted token. Inert today (window-blocked), but the wrong token must not survive into a future where `regulatory` gets a window.
- **COND 2 — `"neutral"`** (`licenses_cbc_share_swfl`, `brain-vocabulary.json:2965`). Confirm intent **before** mapping to `none`: "no directional call" → `none` is correct; a real direction fat-fingered → mapping to `none` silently hides a gradeable slug. Per-slug judgment.

---

## 5. Output sink (OUTPUT-SINK GUARDRAIL)

Tool `refinery/tools/grade-config-sweep.mts` (run `bun refinery/tools/grade-config-sweep.mts`) emits a **regenerable JSON artifact** — committed for diffability, **never hand-edited**:

- default write path: `docs/superpowers/plans/2026-06-03-row-tier/sweep-output.json`
- per-slug records: full `GateVector` + `bucket` + `resolveGradeConfig.gradeable`/`reason` + `backtest_clean` (joined from the vintage audit; `null` for non-gradeable slugs)
- `summary`: count per bucket
- regenerate-and-diff is the review surface; any human-readable table is **generated from** this JSON, not maintained beside it.

**Adjudications are `checks` rows, not markdown markers:** one `checks` row per `invalid-polarity` slug (directional audit owed); the `row-candidate`/`gradeable` lists feed the R1 Opus pass, any contested call → a `checks` row.

---

## 6. Scope split

| Item                                                                                               | Tier                    | Notes                                                            |
| -------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| 1a tighten polarity gate to enum + extend Step-0 test                                              | 🔵→**Opus diff-review** | Behavior change, live-inert blast radius; pin green same commit. |
| 1b `gateVector` + unit test (in `loader.mts`)                                                      | 🔵→**Opus diff-review** | Additive; §1b is the contract.                                   |
| Sweep tool: vocab → `gateVector` + `resolveGradeConfig` → 24-combo table → JSON + summary + §3 pin | 🔵 / ⚪ mechanical      | §2–§5 fully specify it.                                          |
| Join `backtest_clean` from the vintage audit (the 11)                                              | ⚪                      | column 3.                                                        |
| Open `checks` rows for `invalid-polarity` slugs                                                    | ⚪ (sweep run does it)  | not pre-listed here.                                             |
| Row-vs-brain confirmation (R1)                                                                     | 🔴 Opus                 | reads the candidate lists.                                       |
| Per-slug directional audit (COND 1/2)                                                              | 🔴 Opus                 | economic re-derivation, never normalization.                     |
| Adversarial refutation of the row-tier spec (C1)                                                   | 🔴 second Opus          | after the sweep, before the schema is blessed.                   |

---

## 7. Hard boundaries (what this sweep is NOT)

- Does **not** decide row vs brain — emits candidates; R1 is an Opus call.
- Does **not** rewrite, normalize, or canonicalize any polarity token.
- Does **not** widen the corpus or touch `cadence_registry`.
- Output is **data + `checks`**, never a markdown status board.

**Track B is separately HELD** — out of this spec's scope. The backward-engine retrodiction harness must not be scoped until the decision-function + skill-baseline question is settled (`checks` key `flywheel_backtest_decision_function`). The sweep produces the _inventory_ Track B needs (column 3); it does not define Track B's predictor.
