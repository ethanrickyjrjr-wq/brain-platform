# NOTE — recharts `width(-1)/height(-1)` warnings during `next build` — ✅ RESOLVED 2026-06-22

**Status: FIXED.** `bunx next build` → exit 0, TypeScript ✓, 51/51 static pages, **0** `width(-1)/height(-1)`
warnings (was 8). Fix = a one-prop `initialDimension` seed on every `ResponsiveContainer`. Kept as a
reference because the gotcha will recur on any new chart.

## Corrected diagnosis (the first pass under-scoped this)
The warning is **not** the two `height="100%"` containers — it is **every recharts v3 `<ResponsiveContainer>`
rendered during Next static prerender**, regardless of its height prop (numeric or `%`). recharts **3.8.1**
defaults `initialDimension={"width":-1,"height":-1}` (see `node_modules/recharts/types/component/
ResponsiveContainer.d.ts:30-37`). During static prerender there is no `ResizeObserver`, so the container
can't measure its parent and renders with that `-1/-1` default → the warning fires. **`minHeight` does NOT
suppress it** (a measurement-based warning, not a style floor) — that was the failed first attempt.

## The fix (applied)
Pass a positive `initialDimension={{ width, height }}` seed. It overrides the `-1/-1` default → **no warning**,
and the chart now renders in the SSR HTML at the seed size; the `ResizeObserver` takes over on mount, so
`width="100%"` / responsive parents still drive the real size. **Prop-only, no client-gate, responsiveness
intact.** Applied to all 7 sites across 5 files:
- `components/charts/ZHVIAreaChart.tsx:261` — `{ width: 800, height: 280 }`
- `components/charts/SeasonalRadialChart.tsx:69` — `{ width: 600, height: 300 }`
- `components/charts/ChartBlockView.tsx:130,183` — `{ width: 800, height }` (uses the `height` prop)
- `components/charts/registry/frames/TimelineFrame.tsx:139` — `{ width: 800, height: 260 }`
- `components/landing/Charts.tsx:95,142` — `{ width: 800, height: 300 }`

## Rule for new charts (keep this clean)
**Any new `<ResponsiveContainer>` that can render on a statically-prerendered (`○`) page must carry an
`initialDimension` seed** (= its intended size). Omitting it re-introduces the 8-line warning. The width seed
is nominal (overwritten on mount); set the height seed to the chart's intended height so the SSR paint is
correct.

## Verify
`bunx next build` → grep `width(-1)` returns 0, still 51/51 pages. (Unrelated pre-existing warning in the same
build: `middleware` → `proxy`, a Next 16 framework deprecation — separate task, not this.)

## Provenance
Diagnosed + fixed 2026-06-22 from the operator's `bunx next build`; recharts `initialDimension` confirmed
against `recharts@3.8.1` types. Related plan build `SOLO-20` (charts on the conversation path) is a *different*
concern (emitting chart frames) — this was render-hygiene on existing charts.
