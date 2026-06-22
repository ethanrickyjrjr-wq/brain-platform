# NOTE — recharts `width(-1)/height(-1)` warnings during `next build` (work-on-later)

**Observed:** `bunx next build` (Next 16.2.6, Turbopack), 2026-06-22 — build is **GREEN** (exit 0,
TypeScript ✓, 51/51 static pages). This is a **cosmetic SSR warning, not a build error** — saved here so it
doesn't get lost. Repeated ×8 during "Collecting page data":

```
The width(-1) and height(-1) of chart should be greater than 0,
   please check the style of container, or the props width(100%) and height(100%),
   or add a minWidth(0) or minHeight(undefined) or use aspect(undefined) ...
```

## Root cause (verified)
recharts `<ResponsiveContainer>` measures its **parent DOM** to size the chart. During Next **static
prerender** (the `○` static pages — `/charts`, `/embed/charts`, `/embed/cards/asking-rent`, `/showcase`,
`/data-intel`, `/demo`) there is no real layout, so a container set to `height="100%"` measures the parent
as **-1**. Containers given a **numeric** height render fine and stay silent.

## The two culprits (the only `height="100%"` instances)
- `components/charts/ZHVIAreaChart.tsx:259` — `<ResponsiveContainer width="100%" height="100%">`
- `components/charts/SeasonalRadialChart.tsx:69` — `<ResponsiveContainer width="100%" height="100%">`

**Already correct (the pattern to copy — numeric height, no warning):**
- `components/charts/ChartBlockView.tsx:130,183` — `height={height}`
- `components/charts/registry/frames/TimelineFrame.tsx:139` — `height={260}`
- `components/landing/Charts.tsx:95,142` — `height={300}`

## Fix direction (pick one — all client-verified before shipping)
1. **Simplest:** give the two `height="100%"` containers a concrete numeric `height={NNN}` (match the
   surrounding component's chart height), OR put a fixed/`minHeight` on their immediate parent `div` so the
   100% resolves to a real number at SSR. This is what every other chart here already does.
2. **Client-only render:** gate the `<ResponsiveContainer>` behind a mounted check (it needs a measured DOM
   anyway), so it never renders during static prerender. Heavier; only if a fixed height is undesirable.
3. **`aspect`:** set `aspect={n}` on the container instead of a height (recharts sizes by ratio) — good for
   the radial chart if a fixed height fights the layout.

## Why it's safe to defer
Build exits 0; the charts render correctly **client-side** once the container mounts and measures. This is
log-noise + a (cosmetic) zero-size first paint on those static pages, not a correctness or deploy blocker.

## Verify the fix
Re-run `bunx next build` — the 8 `width(-1)/height(-1)` lines should be gone, still 51/51 pages. (Unrelated
pre-existing warning in the same build: `middleware` → `proxy` rename, a Next 16 framework deprecation —
separate task, not this.)

## Provenance
Diagnosed 2026-06-22 from the operator's `bunx next build` run; `ResponsiveContainer` usages located via grep
across `components/charts/**` + `components/landing/Charts.tsx`. Related plan build: `SOLO-20` (charts on the
conversation path) is a *different* concern (emitting chart frames) — this is render-hygiene on existing charts.
