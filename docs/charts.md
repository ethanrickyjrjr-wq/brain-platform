# Charts — master build reference

Read this before touching any chart. The rules below are enforced system-wide;
individual handoffs only document what's **specific** to that chart.

---

## The one rule that reddens `main`

**`tsc` + eslint + `bun test` all PASS the RSC function-prop bug. Only `npm run build` catches it.**

`/charts` is a Server Component. `MetroAreaChart` is a Client Component. **Never pass a
function prop across that boundary** — Next.js cannot serialize it and `next build` aborts
at prerender with "Functions cannot be passed directly to Client Components."

Pass a **serializable token** (`valueFormat="ratio"`) and resolve it to a formatter _inside_
the client component. Every new `ValueFormat` token gets added to `lib/charts/format.ts` and
tested in `lib/charts/format.test.ts` before the page wires it.

Run `npm run build` before every push on `/charts` work. No exceptions.

---

## Adding a chart to `/charts`

All live charts share one page (`app/charts/page.tsx`) with a `panels[]` array. Adding a
chart is four steps:

1. **Loader** — async function at the top of `page.tsx`, same shape as `loadPassengers()`.
   Reads from `data_lake.*` via the service-role client. Returns `{ data, asOf, error }`.

2. **Mapper** — new file in `lib/charts/` (e.g. `tier-divergence-series.ts`), mirrors
   `airport-series.ts`. Handles null-filtering, sorting, derived columns (e.g. moving average),
   and emits typed `ChartRow[]`. Put math here, not in the page.

3. **Series preset** — add to `lib/charts/series.ts`. Use gulf palette tokens only.
   Always vary dash per series (solid / `"8 5"` / `"2 5"`) — colorblind mitigation is
   mandatory (§2 of `app/_design/07-charts-and-dataviz.md`).

4. **Panel entry** — add to `panels[]` in `page.tsx` and to `Promise.all([...])`. The
   `MetroAreaChart` component handles 1..N series, line vs area variant, as-of, empty state.

---

## ValueFormat tokens (serializable — never a function)

Defined in `lib/charts/format.ts`, typed as `type ValueFormat`. Current enum:

| Token | Renders as | Example |
|-------|-----------|---------|
| `"usd"` | `$XXXk` | `$412k` |
| `"rent"` | `$X,XXX/mo` | `$1,840/mo` |
| `"count"` | formatted integer | `1,152,669` |
| `"pct"` | `X.X%` | `-6.2%` |
| `"ratio"` | `X.X×` | `2.5×` |
| `"index"` | integer, rebased to 100 | `147` |

To add a new token: extend the union in `format.ts`, add a `case` in `formatChartValue` and
`formatAxisTick`, add a test case in `format.test.ts`, **then** wire it in the page. Never
add the token directly in a JSX string without registering it in format.ts first.

---

## Component reference

| Symbol | File | Notes |
|--------|------|-------|
| `MetroAreaChart` | `components/charts/ZHVIAreaChart.tsx` | Generic N-series chart. Accepts `variant="line"` (default) or `"area"`. |
| `ZHVIAreaChart` | same file | Deprecated alias — keep for existing call sites. |
| `HBarChart` | `components/charts/HBarChart.tsx` | Horizontal bar chart, corridor/ZIP grain, tier-colored. |
| `ZipChoropleth` | `components/charts/ZipChoropleth.tsx` | Lee + Collier ZIP map. Accepts `{ zip: { value: 0–1, label } }`. |
| `ChartSeriesDef` | `types/viz.ts` | `{ key, label, color, dash }` |
| `ChartRow` | `types/viz.ts` | `{ month: string; [key: string]: number \| null \| string }` |
| `ValueFormat` | `lib/charts/format.ts` | The locked serializable token union |

---

## Gulf palette (locked)

| Slot | Token | Hex | Dash |
|------|-------|-----|------|
| 1 | `--gulf-teal` | `#3dc9c0` | solid `""` |
| 2 | `--mangrove` | `#5bc97a` | dashed `"8 5"` |
| 3 | `--neutral-gold` | `#d4b370` | dotted `"2 5"` |
| 4 | `--sunset-coral` | `#e08158` | use sparingly |

Background `#0a1419`. Grid `#22414f`. Axis text `#807e76`. Max **3 series** per chart before
switching to small multiples. Full colorblind + accessibility rules: `app/_design/07-charts-and-dataviz.md §2, §4`.

---

## Pre-push checklist (every `/charts` change)

- [ ] `bun test lib/charts/` green — format tokens + any new mapper
- [ ] `npm run build` green — `/charts` appears as `○ /charts` (static prerender)
- [ ] Eyeball locally: values plausible, `as of` from real data, no hardcoded dates
- [ ] Title has no jargon (no "ZHVI", "tier", "spread", column names, brain IDs)
- [ ] Deuteranopia check — Chrome DevTools → Rendering → Emulate vision deficiency

---

## Current chart inventory (`/charts`)

| Chart | Source view | Format | Notes |
|-------|-------------|--------|-------|
| Typical home value | `data_lake.zhvi_pivoted` | `"usd"` | area variant, 3-metro |
| Typical monthly rent | `data_lake.zori_pivoted` | `"rent"` | line, 3-metro |
| Air travel through the region | `public.rsw_airport_monthly` | `"count"` | total_passengers + 12-mo trend |
| Home value momentum | `data_lake.zhvi_pivoted` (derived YoY) | `"pct"` | 3-metro YoY % |
| Luxury vs. starter price tracks | `data_lake.tier_divergence_pivoted` | `"index"` | line, 2 tiers indexed to Jan 2019 = 100 (cumulative levels) |
| Luxury vs. starter yearly change | `data_lake.tier_divergence_pivoted` (derived YoY) | `"pct"` | line, 2-tier YoY — the real divergence (rates trade the lead) |

**Next up:** none queued.

> **Tier-pair note:** the indexed-levels panel and the YoY panel are a deliberate pair, mirroring
> the metro "Typical home value" + "Home value momentum" split. Levels converge over 30 years
> (lockstep); the annual rates diverge and cross repeatedly — that's where the real luxury/starter
> divergence lives. The strict "K-shape" (luxury up while starter falls) is a near-non-event in the
> data (~0% of ZIPs across history, one 11% blip in 2024), so neither panel is titled "K-shape".

---

## Key files

| What | Where |
|------|-------|
| Page (Server Component, DB reads + panel array) | `app/charts/page.tsx` |
| Generic N-series chart component | `components/charts/ZHVIAreaChart.tsx` |
| Value-format tokens + formatters | `lib/charts/format.ts` + `format.test.ts` |
| Series presets (gulf palette, dash patterns) | `lib/charts/series.ts` |
| Airport mapper (reference pattern) | `lib/charts/airport-series.ts` |
| Pivoted-city mapper | `lib/charts/pivoted-series.ts` |
| Design rules (chart type, color, a11y) | `app/_design/07-charts-and-dataviz.md` |
