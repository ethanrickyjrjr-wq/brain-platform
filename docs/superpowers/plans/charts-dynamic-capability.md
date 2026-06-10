# Dynamic Chart Capability — Future Paywall Add-On

**Status:** Backlog / not started. Tracked via check `generic_chart_capability`.

---

## The Problem

`buildChartForIntent` is a hard-coded keyword router: it maps 4 specific intents (asking-rent, vacancy, zhvi, corridor-scatter) to fixture data. Any question outside those 4 scopes gets **text only** — no chart, no fallback message. A user asking "compare franchise survival across corridors" or "show me the freight trend" gets a prose answer with zero visual, even when the data exists in a brain.

This is intentional for S2 (fixture-first, ship fast), but it does not scale.

---

## What "Generic" Means

Instead of pre-wiring intent → fixture → component, the system would:

1. **Classify the question** → determine chart type + data grain (corridor-level, ZIP-level, time-series, ranked list, etc.)
2. **Query the right brain** → fetch live data (not a fixture) for the specific scope the user asked about
3. **Pick the chart component** → match data shape to a renderer (bar, area, scatter, radial, composition, etc.)
4. **Emit the chart** → same SSE `chart` frame, same render path in popup/dock

The LLM never touches chart numbers — it classifies intent and selects component type; the data layer assembles the payload.

---

## Visuals UI Kit Inventory (design-complete, not yet ported)

From `SWFL-Visuals-UI-Kit.html` (6 standalone HTML charts, real SWFL data, plain SVG):

| # | Visual | Data source | Status |
|---|---|---|---|
| 01 | Corridor scatter — cap rate × vacancy | cre-swfl brain | ✅ covered (`CorridorMarketScatter.tsx`) |
| 02 | Franchise survival — 14 brands, 169 SBA loans, ranked bars | franchise-outcomes brain | ❌ not ported |
| 03 | Flood exposure — Lee SFHA + V/VE composition, 357× multiplier | env-swfl brain | ❌ not ported (operator: pattern reusable for non-flood domains) |
| 04 | Freight nowcast — FDOT z-score gauge, 9 segments, 90-day rolling | traffic-swfl brain | ❌ not ported |
| 05 | Seasonal radial — corridor seasonality index 0.10→0.88 | cre-swfl brain | ❌ not ported |
| 06 | Storm claims timeline — NFIP paid claims per named storm | env-swfl brain | ❌ not ported |

**Also from `SWFL-Charts-Code-Reference.html` (earlier design pass), not yet built:**
KPICard, StatRow, CompareTable, DonutCard, DotPlot, VerdictBars, SparkList, CorridorMap, CorridorDetail, CorridorTable, UpstreamSplit.

**Operator note:** The flood-exposure visual pattern (composition bars + magnitude callout) is valuable independent of flood data — port it as a reusable composition chart, not a flood-specific one.

---

## Why Paywall Makes Sense

- The current 4 wired scopes are free / part of the base product.
- Dynamic chart generation requires:
  - Live brain queries (not fixtures)
  - LLM classification step (token cost)
  - More chart components to build and maintain
- This is "chart on demand" — high-value, costs more to run, logical upsell.
- Fits the $39–79/mo paid tier alongside ZIP-drill and env-swfl flood AAL.

---

## Architecture Sketch (when ready to build)

```
user question
    ↓
classifyChartIntent(question) → { chartType, dataScope, grain }
    ↓
queryBrainForScope(dataScope, grain) → raw rows
    ↓
buildChartBlock(chartType, rows) → ChartResult
    ↓
emit SSE chart frame (same as today)
```

`classifyChartIntent` can be:
- A small deterministic classifier (keyword + data-type matching, ~50 rules)
- OR a forced-tool LLM call (more flexible, higher latency/cost)

Start with the deterministic classifier. Only escalate to LLM if coverage is < 60%.

---

## Build Order (when we get here)

1. Port the 5 unbuilt visuals from the UI kit as React components (no data wiring yet)
2. Wire each to its brain data source (live query, not fixture)
3. Add each to `buildChartForIntent` with a deterministic intent classifier
4. Gate the dynamic scopes behind auth + plan check
5. Add "request a chart" fallback message when intent is recognized but not yet wired

---

## Current Fallback Behavior

When `routeChart(question)` returns `null` (no wired scope):
- `buildChartForIntent` returns `null`
- `/api/converse` skips the SSE chart frame entirely
- User gets prose answer only — no chart, no "can't chart this" message

**TODO when scoping the paywall tier:** add a "I could show you a chart for this — available in [plan name]" response for recognized-but-gated intents.
