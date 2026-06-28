# Handoff — Build (almost) ANY chart + proactive "Chart Ideas"

**Date:** 2026-06-28
**Owner:** Ricky (build this in parallel while the focus-system build runs).
**Status:** HANDOFF — code-grounded, ready to build. Supersedes the stale framing in
`docs/superpowers/plans/charts-dynamic-capability.md` (it says "4 hardcoded fixture intents" — the live
code already does far more; see Current State).
**Check:** `generic_chart_capability` (open).

---

## The goal in one line

Make the system able to build **(almost) any chart a user could want**, from real audited data, with
the no-invention moat fully intact — and surface chartable options **proactively** so users who never
think to ask still get charts. Two layers: **the engine** (build any shape from real data) and **the
discovery surface** (Chart Ideas chips). The engine is the centerpiece; Chart Ideas sits on top of it.

---

## THE ENGINE — my way of building all charts

The existing custom-chart engine (`lib/assistant/compose-chart.ts`) already has the RIGHT spine, and
it's the thing to extend — do NOT rewrite it. Its moat is structural: the model is handed a **DATA
MENU** of real points (each with a stable id, real entity label, real metric, real value, all from
audited brain outputs); the model returns **point ids + a shape and NOTHING numeric**; our code reads
each selected point's `(entity, value)` straight from the menu and assembles the cells. A number can
never land under the wrong entity/metric because the number and its label travel together from one
source. `lintChartBlock` is the belt-and-suspenders check that every plotted number traces to a real
source.

Today that engine only knows **two shapes (`bar`, `table`)** and a **flat point** (entity, metric,
value). To build *any* chart, extend it along **three axes** — shape, data structure, and data
source — without ever letting the model write a number.

### Axis 1 — SHAPE vocabulary (the main gap)
`composeChartFromRequest`'s forced tool (`RECORD_CHART_TOOL`, compose-chart.ts:199) offers
`chart_type: ["bar","table"]`. Expand the enum and add a pure assembler per shape (sibling of
`buildHeldChartBlock`, compose-chart.ts:338 — the one place the moat lives, unit-tested directly):

| Shape | Data it needs | Renderer frame (already exists / build) |
|---|---|---|
| `bar` / `grouped-bar` | 1+ metrics per entity | `bar-table` / `HBarChart` ✅ |
| `table` | any | `ChartBlockFrame` ✅ |
| `line` / `area` | a value across a **period axis** (time series) | `ZHVIAreaChartFrame` ✅ (generalize beyond zhvi) |
| `scatter` | **x,y pair** per entity (two metrics) | scatter frame ✅ (generalize beyond corridor cap×vac) |
| `composition` / `stacked` | parts that sum to a whole | build a generalized composition frame (port flood-exposure pattern, **not** flood-specific) |
| `donut` | parts of a whole | build DonutCard frame |
| `radial` / `seasonal` | a cyclic index series | `SeasonalRadialChart` ✅ (wire to data) |
| `ranked-delta` | value + its own YoY/period delta | `bindRankedDeltaSpec` ✅ |

The renderer (`refinery/validate/chart-block-lint.mts` ChartBlock `chart_type: "bar"|"area"|"scatter"|"table"`
+ `components/charts/registry/`) **already supports more shapes than the producer emits** — so most of
this work is **producer-side** (enum + assembler + `frame_id` mapping), not rendering.

### Axis 2 — DATA STRUCTURE in the menu (so non-bar shapes are even expressible)
`buildMenu` (compose-chart.ts:104) emits flat `MenuPoint{entity, metric, value, unit}`. Line/scatter/
composition can't be expressed against flat points. Extend the menu to carry the structure the new
shapes need, still one audited value per point:
- **period axis** for time series: add optional `period` (ISO date / "2026-Q1") to `MenuPoint`, sourced
  from time-series `detail_tables`. A `line`/`area` selection = a set of points sharing one metric+entity
  across periods.
- **x,y pairing** for scatter: let the model select **two metrics for the same entity** (the menu already
  groups by brain; expose entity grouping so "corridor X: cap_rate=p12, vacancy=p37" is selectable as a
  pair). Assembler emits `[entity, x, y]` rows.
- **part-of-whole** for composition/donut: mark points that are components of a labeled total.
- **cross-brain joins:** the menu already pulls `master` + `resolveReachTargets` (multiple brains). To
  chart "metric A (brain X) vs metric B (brain Y)" for the same entities, align selected points by
  entity label in the assembler. No new fetch — the points are already in the menu.

### Axis 3 — DATA SOURCE (already built — keep, it's the four-lane moat)
A chart whose number we don't hold is NOT a dead end. compose-chart already layers four lanes, all
moat-safe and cited/verified:
1. **held** — audited brain points (the menu).
2. **web** — `external_points` → `fillExternalPoint` → `web_search_20250305`, verified verbatim + cited
   (compose-chart.ts:599). Covers SWFL primaries we don't hold AND peer/context figures.
3. **upload** — `upload_points`, verified verbatim against the user's doc text (compose-chart.ts:593).
4. **user** — `user_points`, figures the user stated, footnoted "Provided by you" (compose-chart.ts:612).
Keep all four. For time series, web gap-fill should be able to return a **series** of points, not just one.

### Axis 4 — SHAPE SELECTION (auto-pick the right chart — "because AI is smart")
A small classifier decides the shape when the user didn't dictate one:
- **Deterministic first:** does the matched data have a period axis? → offer `line`. Two metrics per
  entity? → `scatter`. Parts-of-whole? → `composition`. One metric across entities? → `bar`. (~The
  `classifyChartIntent` the stale plan sketched, but driven by the menu's actual structure, not keywords.)
- **LLM-assisted only for ambiguity** (forced tool, `TRIAGE_MODEL`): given the question + the menu's
  available metrics/structure (labels only, NOT the numbers), pick `shape` + which metric(s). Still no
  numbers from the model.

### Axis 5 — NEVER SILENT (graceful fallback)
Today a no-match returns `null` → text, no chart, no message (`chart-for-question.ts:124`, the plan's
"Current Fallback Behavior" TODO). Replace with: when we can't build the exact ask, return the **Chart
Ideas** ("I can't build that one yet — here's what I *can* chart for this:") so there's always an option.

### The moat invariant (true across ALL of the above — do not break it)
The model **selects point ids + a shape**; our code reads `(entity, value, period)` from the source
point and assembles the cells; `lintChartBlock` confirms every plotted number traces to held / web-cited
/ upload-verified / user-stated. **The model never writes a chart number.** Every new shape/assembler
must preserve this — unit-test each assembler the way `buildHeldChartBlock` is tested.

---

## THE DISCOVERY SURFACE — proactive "Chart Ideas"

So users who won't type "chart median price for these 3 ZIPs" still get charts — and so an unbuildable
request always has alternatives. A "Chart Ideas" section, its own block **below the prompt chips**:
- **Data-backed chips:** for each chartable brain/metric/shape in scope, a one-click chip that fires the
  exact phrasing the engine honors. Only emit a chip whose producer actually returns a chart (no dead
  chips — `chartChipForMetric` already does this guard for rent/vacancy/zhvi; extend to all shapes/brains).
- **AI-suggested chips:** a cheap forced-tool call (given the menu's metric labels, not numbers) proposes
  2–3 chart IDEAS that *combine or complete* the held data ("vacancy vs asking rent", "home value vs
  permits over time"). Model proposes the idea; the engine builds it from real numbers.

### Where it attaches (extend existing seams — don't rebuild)
- Logic: `lib/highlighter/suggestions.ts` (`chartChipForMetric`, `suggestionsForMetric`) + its verbatim
  twin `refinery/stages/4-output.mts` (`suggestionsForMetric`, precomputed into
  `BrainOutputMetric.suggestions`). Change BOTH or neither.
- UI: `components/briefcase/BriefcaseChat.tsx` / `BriefcasePanel.tsx` (chat) and the highlighter popups
  (`components/highlighter/HighlightPopup.tsx`) on `app/r/**` pages.
- Chart frame emit: SSE `chart` frame (`lib/assistant/sse.ts:23`) — same render path in popup/dock.

---

## Current state (verified in code 2026-06-28 — NOT memory)

Live conversation path (`lib/assistant/conversation-path.ts:63-64`):
`composeChartFromRequest(...) ?? buildChartForQuestion(...)`. Charts also on email (`lib/email/build-doc.ts:70`)
and report (`lib/assistant/report-path.ts:116`) paths.
- `composeChartFromRequest` — user-directed; held + web + upload + user; **bar|table only**.
- `buildChartForQuestion` — auto: ranked-delta → 4 rich pre-wired shapes (`buildChartForIntent`:
  area zhvi, scatter corridor, bar rent/vacancy/vitals/flood) → **generic any-brain bar** (every
  chartable brain, `frame_id "bar-table"`).
- Renderer already supports `bar|area|scatter|table` + frames `ZHVIAreaChartFrame`, `ChartBlockFrame`,
  `SeasonalRadialChart`, `HBarChart`, `CorridorRentChart`. **Bottleneck = producer, not renderer.**

The three reasons it *feels* like "we can't": (1) non-bar shapes only for ~4 pre-wired topics; (2) silent
`null` fallback; (3) data must be a structured `key_metric`/`detail_table` cell (or web/upload/user-fillable).

---

## Suggested build order
1. Extend `MenuPoint`/`buildMenu` with `period` + entity-pair exposure (Axis 2).
2. Add `line`/`area` + `scatter` to the enum + assemblers + `frame_id` mapping; generalize the
   `ZHVIAreaChartFrame` and scatter frame beyond their hardcoded topics (Axis 1).
3. Add the deterministic shape classifier; LLM only for ambiguity (Axis 4).
4. Replace silent `null` with Chart Ideas fallback (Axis 5).
5. Build Chart Ideas (data-backed first, then AI-suggested) — discovery surface.
6. Add composition/donut/radial frames + assemblers (Axis 1 remainder; port the 5 UI-kit visuals as
   generalized frames).
7. Cross-brain join in the assembler (Axis 2) + web-series gap-fill (Axis 3).

## Definition of done
- `composeChartFromRequest` emits at least `line/area` + `scatter` in addition to `bar/table`, from
  arbitrary held data, on the live conversation path (a non-pre-wired topic produces a non-bar chart).
- A "Chart Ideas" section shows real, clickable, buildable chips (data-backed + AI-suggested).
- An unbuildable request yields options, never silence.
- Every plotted number traces to a real source; `lintChartBlock` green; the moat invariant holds.
- `generic_chart_capability` check closed with live proof.

## Anti-patterns
- Don't rewrite `compose-chart.ts` — extend its menu + enum + assemblers.
- Don't let the model write chart numbers — it selects ids + shape, and ideates chips. Never cells.
- Don't emit a chip whose producer returns null (dead chips erode trust).
- Don't trust `charts-dynamic-capability.md`'s "4 fixtures" claim — stale; this doc is current.
