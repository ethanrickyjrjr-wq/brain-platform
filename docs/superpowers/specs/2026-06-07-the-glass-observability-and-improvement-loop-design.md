# The Glass — see the data flow, the calls, and how we're getting better

**Date:** 2026-06-07
**Status:** DESIGN / HANDOFF (for Sonnet to build; Ricky reviews the decision tables when home)
**Companion to:** the flywheel bootstrap plan (`docs/superpowers/plans/2026-06-07-flywheel-bootstrap-grades-from-history.md`)
and its explainer + review-knobs files. This is the **window** onto that work — the flywheel makes the grades, The Glass lets you _see_ them.

---

## What you asked for (your words → what this builds)

> "where does all the data go that we bring in or save? how do we see or check what is happening is correct?
> … not everything, just macro and some micro and then, mainly, the answers we came up with and why or what it
> will be put up against next … so we can constantly be improving … if we need certain data to make it better for
> some grades, we need to go out and get it … auto-updating data targets as we learn … maybe some graph of how
> we are getting better? I like visuals."

That's **one page, four panes.** Call it **The Glass** (a glass floor over the whole pipeline — you look down and see water → brains → calls → grades, without reading any code).

| Your ask                                        | The pane that answers it                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Where does the data go?                         | **Pane 1 — The Flow** (sources → lake → brains → master, macro with click-into-micro) |
| The answers we came up with + why + what's next | **Pane 2 — The Calls** (each call, its basis, its falsifier, its grade-by date)       |
| A graph of how we're getting better             | **Pane 3 — The Scoreboard** (skill-vs-naive and calibration over time)                |
| Go get data when it'll help a grade             | **Pane 4 — The Shopping List** (auto-updating data targets, ranked by payoff)         |

---

## The big idea, in one screen

```
┌───────────────────────────────────────────────────────────────────────┐
│  THE GLASS                          freshness: SWFL-7421-v72-20260607   │
├──────────────────────────────┬────────────────────────────────────────┤
│  ① THE FLOW   (macro)         │  ② THE CALLS                           │
│                               │                                        │
│  18 sources ──► lake (Tier 2) │  "Lee unemployment drifts up through   │
│      │            41 tables   │   Q3 IF permits keep softening"        │
│      ▼                        │   basis: permits −12% • conf 0.62      │
│  15 brains ──► master         │   falsifier: permits flat-or-up by Aug │
│      │  (click any → micro)   │   graded against: Aug LAUS release ──► │
│      ▼                        │  ──────────────────────────────────── │
│  1 master call/day            │  [▸ 23 open calls · 4 due this month]  │
├──────────────────────────────┼────────────────────────────────────────┤
│  ③ THE SCOREBOARD             │  ④ THE SHOPPING LIST                   │
│   skill vs naive ↗ (N=118)    │   data we should go get, ranked:       │
│   ▁▂▂▃▄▄▅  +0.14 over coin-   │   1. Collier permits  (low N: 11)      │
│   flip                        │   2. rent vintages    (excluded—can't  │
│   calibration: 0.8 band hits  │      grade ZORI honestly yet)          │
│   76% (N=29)  ●—● on the line │   3. tourism TDT      (pending ingest) │
└──────────────────────────────┴────────────────────────────────────────┘
```

Every number on the page carries its **N** and the **freshness token**, per the rules of engagement. No bare percentages anywhere.

---

## What already exists (so Sonnet EXTENDS, never rebuilds)

The grading engine is built and live. The Glass is a **read layer** over it. Confirmed surfaces:

| Surface                           | What it holds                                                                                               | File / object                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `predictions` table               | one row per master refine — conclusion, confidence, window, gradeable_slug, baseline_value, window_end_date | `docs/sql/20260517_predictions_outcomes.sql`, `…20260531_grading_loop.sql` |
| `metric_observations` table       | every numeric key_metric, per brain, per refine, stamped with the **data vintage**                          | `refinery/lib/metric-observations-log.mts`                                 |
| `outcomes` table                  | numeric verdict — observed_value, direction_correct, error, `grade_method` (`machine`), grade_config        | `docs/sql/20260517…`, `…20260601…`                                         |
| `grade_prediction()` RPC          | atomic write-once verdict (INSERT outcome + flip prediction to `graded`)                                    | `docs/sql/20260601_grade_predictions.sql`                                  |
| **`grade_accuracy_by_slug` VIEW** | direction-hit rate per slug **with N** — already `GRANT … TO anon`                                          | same file (line 75) — a dashboard can read this **directly, today**        |
| the grader                        | resolves window-end value, grades deterministically                                                         | `refinery/grade/grade-predictions.mts`                                     |
| `confidence_calibration` table    | the separate "was the confidence honest?" loop                                                              | `…20260516…`                                                               |
| cadence registry                  | every pipeline + its schedule (for Pane 1's source list)                                                    | `ingest/cadence_registry.yaml`                                             |
| lake views (MCP)                  | `list_views` / `describe_view` over Tier-2 tables                                                           | `mcp__lake__*`                                                             |

**Implication for the build:** Panes 2 and 3 are mostly _SQL + charting over tables that already exist._ The genuinely new code is (a) Pane 1's lineage assembly, and (b) Pane 4's data-target generator. Don't re-pour the foundation.

---

## The four panes

### ① The Flow — where the data goes (macro, with click-into-micro)

A left-to-right lineage strip, three tiers deep, collapsed by default:

- **Macro (always shown):** `N sources → N lake tables → N brains → 1 master call/day`, each a live count.
- **Micro (click any node):** click a brain → its inputs (which lake tables / upstream brains feed it), its last refine time, its freshness state (green/amber/red), the slugs it emits. Click a source → its cadence, last successful pull, row count, last-ingest provenance.
- Source of truth: `cadence_registry.yaml` for sources, the brain DAG (`refinery/lib/dag.mts` / pack `upstream` declarations) for the brain→brain edges, `metric_observations` for "what each brain last emitted."

YAGNI: this is **not** a full graph-viz. It's a three-column strip with expandable rows. A drawn DAG is a later nice-to-have, not v1.

### ② The Calls — the answers, the why, the what's-next

The heart of the page, and the part you most asked for. One card per **open call**, newest first:

- **The call** — the master's conditional claim, in plain English (`condition → then_direction`).
- **Why** — the basis metrics it stands on (`basis` + `basis_refs`), each a real number with its source.
- **Confidence** — the deterministic number (never LLM-set), shown as a bar.
- **The falsifier** — the one thing that would prove it wrong (already a required field on every claim).
- **Graded against next** — the `prediction_window` resolved to a concrete date + which data release settles it (e.g. "Aug 2026 LAUS release"). This is the "what it will be put up against" you asked for.
- **Status chip** — `open` · `due soon` · `graded ✓/✗`.

Reads: `predictions` joined to the master's `ConditionalClaim` payload; `outcomes` for the ones already graded. A closed call flips its card to show **call vs reality** side by side — the receipt.

### ③ The Scoreboard — how we're getting better (the visual)

Two charts, both honest, both N-stamped:

1. **Skill vs naive, over time** — are our calls beating the dumb baseline ("it'll stay the same")? A rising line is the moat forming. Reads `computeSkillScore` output over the grade corpus, bucketed by month. Y-axis = skill score above coin-flip/persistence (your call — see DECISION 2).
2. **Calibration** — when we say "80% sure," are we right ~80% of the time? A reliability curve: stated confidence (x) vs actual hit-rate (y), the diagonal = perfect. Reads `grade_accuracy_by_slug` + a confidence-bucketed view.

**The honesty rule that governs this pane (non-negotiable):** the seed numbers come from _retrodicted_ grades (the flywheel backtest). They are tagged and **never shown as a public accuracy number** — this page is internal. The day a number goes on a marketing page, it comes only from **live** `outcomes`, never retrodicted. Pane 3 shows both, **labeled**, so you always know which is which.

### ④ The Shopping List — auto-updating data targets (the novel piece)

This is the "go get data when it'll help a grade" loop, made automatic. A ranked list of **data we should acquire next**, regenerated nightly, each row carrying _why it would help a grade_:

| Trigger                 | What it means                                                           | Example                                                              |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Low N**               | a slug we grade but barely have a sample for                            | "Collier permits — only 11 graded calls; need ≥30 to trust it"       |
| **Low skill**           | a slug whose calls aren't beating naive                                 | "tourism call no better than persistence — wrong/missing input?"     |
| **Excluded-but-wanted** | a signal we _can't grade honestly yet_ because we don't retain vintages | "ZORI rent — start archiving vintages and it graduates to gradeable" |
| **Pending ingest**      | data we've scoped but haven't wired                                     | "TDT collections — self-ingest still pending"                        |
| **Stale source**        | a source feeding live calls that's past its cadence                     | "FDOT traffic 90 days stale — calls leaning on it are decaying"      |

Mechanism (the new code): a nightly job reads the calibration/grade views + cadence registry, applies the trigger thresholds (DECISION 4), and **upserts rows into a new `data_targets` table** (idempotent on the target key, so it self-updates — resolved targets drop off as N climbs or a source un-stales). The Glass just renders that table, ranked by payoff. **"Auto-updating as we learn"** = the job re-derives the list every night from the latest grades, so the list _is_ the system noticing where it's weak.

---

## The auto-update loop, end to end

```
nightly grade run ──► outcomes / grade_accuracy_by_slug
        │
        ▼
data-target generator  (new: reads grades + cadence_registry, applies thresholds)
        │
        ▼
data_targets table  (upsert; resolved targets auto-drop)
        │
        ▼
Pane ④ renders ranked list ──► you/Tariq go acquire the top item
        │
        ▼
new data lands ──► more graded calls ──► N climbs / skill moves ──► target resolves
```

That's the flywheel you described: the system watches its own grades, tells us what to go buy, we buy it, the grades improve, the list re-ranks. No human has to notice the gap — the page surfaces it.

---

## DECISIONS FOR RICKY (mark these up when home — strike / change / add)

Same as the flywheel knobs file: everything below is a proposal, not locked.

### DECISION 1 — Where does The Glass live?

| Option                                                                                        | Pros                                                                                  | Cons                                                                                        | Your call |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------- |
| **A — page in `swfldatagulf-ops`** (the existing dashboard, next to `/littlebird`) (proposed) | Where you already go to "see what's happening"; ops PAT + Supabase read already wired | Cross-repo read of brain-platform's Supabase (already granted to `anon` for the grade view) |           |
| B — new route in `brain-platform` (`/glass`, internal-only)                                   | Same repo as the data; zero cross-repo                                                | Splits "where I look" across two apps                                                       |           |

### DECISION 2 — The "getting better" graph: what's on the Y-axis?

| Option                               | Reads as                                                         | Your call |
| ------------------------------------ | ---------------------------------------------------------------- | --------- |
| **A — skill above naive** (proposed) | "we beat a coin flip by +0.14" — the honest moat number          |           |
| B — raw hit-rate %                   | "we're right 64% of the time" — simpler, but flatters easy calls |           |
| C — both, toggle                     | more complete, more to build                                     |           |

### DECISION 3 — How deep does Pane 1 (The Flow) go in v1?

| Option                                                            | Your call |
| ----------------------------------------------------------------- | --------- |
| **A — three-column strip, click-to-expand rows** (proposed, lean) |           |
| B — full drawn DAG graph (prettier, much more build)              |           |

### DECISION 4 — Shopping-list trigger thresholds (when a target appears)

| Trigger             | Proposed threshold                                                          | Your call |
| ------------------- | --------------------------------------------------------------------------- | --------- |
| Low N               | slug has < **30** graded calls                                              |           |
| Low skill           | slug not beating naive (skill ≤ **0**) over N ≥ 15                          |           |
| Stale source        | past **2×** its cadence interval                                            |           |
| Excluded-but-wanted | any ⛔ slug from the flywheel knobs file, listed permanently until vintaged |           |

### DECISION 5 — Build order (what Sonnet does first)

| Step | What                                                             | Note                            |
| ---- | ---------------------------------------------------------------- | ------------------------------- |
| 1    | Pane ② The Calls (reads tables that exist)                       | fastest visible win             |
| 2    | Pane ③ Scoreboard (reads `grade_accuracy_by_slug` + skill score) | the graph you want              |
| 3    | `data_targets` table + nightly generator                         | the new code                    |
| 4    | Pane ④ Shopping List (renders `data_targets`)                    |                                 |
| 5    | Pane ① The Flow (lineage strip)                                  | most new assembly, least urgent |

### Parking lot (notes for when you're home)

-
-
- ***

## Guardrails (carried from the flywheel plan — break one and the page lies)

1. **Retrodicted ≠ live.** Pane 3 labels every number as backtest-seed or live. They never blend into one figure.
2. **No public accuracy number off retrodicted grades.** The Glass is internal. A marketing % comes only from live `outcomes`.
3. **Always N.** Every percentage on the page shows its sample size. "76% (N=29)", never "76%".
4. **Freshness token quoted once**, top of page, verbatim.
5. **No invented numbers.** Every cell traces to a row in a real table; a gap renders as "not enough data yet," never a guess.

## Out of scope (YAGNI for v1)

- Re-running the full master LLM against historical snapshots (that's deferred Goal 9; The Glass reads grades, doesn't regenerate them).
- A public-facing version. Internal first.
- Drawn DAG graph (DECISION 3 keeps it a strip for now).
- Editing data targets by hand in the UI — they're auto-derived; hand-curation can come later if the auto list isn't enough.

---

## Hand-off note to Sonnet

Start at **DECISION 5 step 1** only after Ricky has marked up the decision tables — Decisions 1 (repo) and 2 (Y-axis) change the scaffolding, so don't scaffold before they're answered. Everything you read from is in the "What already exists" table; the only genuinely new persistence is the `data_targets` table (mirror the idempotent-migration pattern in `docs/sql/20260601_grade_predictions.sql` — `CREATE … IF NOT EXISTS`, `GRANT … TO service_role`/`anon`, run via psycopg3 per CLAUDE.md RULE 1, verify row count). File the open obligations as `checks` rows, not markers in this doc (RULE 2).
