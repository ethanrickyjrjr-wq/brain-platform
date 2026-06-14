# /charts — add the tier-divergence (luxury–starter gap) chart (HANDOFF, 2026-06-14)

**Status: NOT DONE — design approved, ready to build. No chart code written.**
The `tier-divergence-swfl` brain shipped live to `main` at `f49fae7` (data +
views + crons + brain). This handoff adds a public chart for it on `/charts`.
Pick it up and build it.

**Read the chart rules first:** `app/_design/07-charts-and-dataviz.md` §0, §1,
§2, §3, §6 (the RSC boundary in §6 is the one that reddens `main`). The sibling
handoff `docs/handoff/2026-06-14-charts-airline-graph-and-second-chart.md`
documents the same page + component you'll be editing.

---

## The enabler — the display view is ALREADY LIVE (zero new SQL for the primary plan)

When the brain was built we deliberately shipped a display view in the exact
shape `/charts` consumes, so the chart is a wiring job, not a from-scratch build.

`data_lake.tier_divergence_pivoted` — **live, GRANTed to service_role, 363 rows**
(monthly, ~1996-02 → 2026-04), one row per month:

| column | type | note |
|---|---|---|
| `month` | text `"YYYY-MM"` | already `ORDER BY month` ascending in the view |
| `median_spread_ratio` | double | regional median of (top-tier ÷ bottom-tier) ZHVI across both-tier SWFL ZIPs — the luxury-to-starter price multiple (≈2.5× now) |
| `both_tier_zip_count` | int | how many ZIPs contributed that month (coverage; optional footnote, do NOT plot it on the value axis) |

One row per month, 363 rows → **well under the 1000-row PostgREST cap, a single
`.select()` is safe** (same as the existing metro panels; no `selectAllPaged`).

> Source SQL: `docs/sql/20260614_tier_divergence_views.sql` (view A). It is RAW
> (not seasonally adjusted) — `median_spread_ratio` is a raw monthly median, so
> month-to-month it wiggles. The 12-month trend overlay below is what tames it
> (the brain's *direction* read uses YoY, never this raw level).

---

## APPROVED design (the primary plan)

**A single LINE of `median_spread_ratio` over time, plus a 12-month trailing-mean
trend overlay** — structurally identical to the airline panel (`total_passengers`
+ 12-mo trend) that already ships. Two series, no clutter:

- `spread` — gulf-teal solid, the raw monthly median ratio.
- `trend` — neutral-gold dashed, the 12-month trailing mean (reuse the existing
  `movingAverage()` helper).

**Why a single spread line and NOT two diverging luxury/starter lines (for v1):**
the brain currently reads **bearish with K-shape = 0** — luxury (−6% YoY) and
starter (−7% YoY) are *both* falling; it's a broad downturn, not a "luxury holds
while starter cracks" divergence. Two raw-dollar lines ($700k luxury vs $280k
starter) would sit far apart and near-parallel — a bad, potentially misleading
chart. The **ratio line is honest in every regime**: it rises when the gap
widens, falls when it compresses, regardless of whether both tiers are up or
down. That is exactly the brain's headline (`tier_spread_ratio_swfl`).

- **Chart type:** line (NOT area — a filled area reads as a cumulative total;
  wrong for a ratio level). §1.2.
- **Y-axis:** truncate to the data range (ratio ≈ 2–4×) — lines need not start at
  zero. §1.3. (Do NOT carry the bar zero-baseline rule onto this line.)
- **Title (plain, no jargon — §3):** e.g. **"The luxury–starter price gap"**.
  NEVER "ZHVI", "tier", "divergence", "spread ratio", or a table name on the
  chart face.
- **Subtitle:** e.g. *"How many times more a typical luxury home costs vs. a
  starter home across Southwest Florida — with 12-month trend."*
- **One-sentence takeaway** in the DOM near the chart (a11y / no-JS fallback,
  §3): pull the live latest value, e.g. *"A typical SWFL luxury home is worth
  about 2.5× a starter home, and the gap has been widening."*
- **`as of`** date from the latest `month` in the view (real freshness, §3) —
  the loader already returns `asOf`; never hardcode.

### Implementation (small — mirror the airline panel exactly)

1. **`lib/charts/format.ts`** — add a serializable `"ratio"` token (the RSC-safe
   way; pass a token, never a function — §6 / the 2026-06-13 break):
   - extend `ValueFormat`: `"usd" | "rent" | "count" | "pct" | "ratio"`.
   - `formatChartValue`: `case "ratio": return \`${value.toFixed(1)}×\`;`
   - `formatAxisTick`: `if (format === "ratio") return \`${value.toFixed(1)}×\`;`
   - **TDD:** add a case to `lib/charts/format.test.ts` first (e.g. `2.51 → "2.5×"`).
2. **`lib/charts/tier-divergence-series.ts`** (new — mirror `airport-series.ts`):
   - `interface TierSpreadMonthRow { month: string; median_spread_ratio: number | null }`
   - `export function mapTierSpreadWithTrend(rows): { entries: ChartRow[]; asOf?: string; rowCount: number }`
     — filter null ratio, sort ascending by `month`, compute the 12-mo trend via
     `import { movingAverage } from "./airport-series"` over the full series
     (BEFORE any range-slice, like the airport mapper does), emit
     `{ month, spread: ratio, trend? }`. `asOf` = newest month.
3. **`lib/charts/series.ts`** — add the preset:
   ```ts
   export const TIER_SPREAD_SERIES: ChartSeriesDef[] = [
     { key: "spread", label: "Luxury-to-starter ratio", color: "#3dc9c0", dash: "" },   // gulf-teal solid
     { key: "trend",  label: "12-month trend",          color: "#d4b370", dash: "8 5" }, // neutral-gold dashed
   ];
   ```
4. **`app/charts/page.tsx`** — add a loader + a panel (copy the airline pattern):
   ```ts
   async function loadTierSpread(supabase: Supabase): Promise<LoadedPanel> {
     try {
       const { data, error } = await supabase
         .schema("data_lake")
         .from("tier_divergence_pivoted")
         .select("month, median_spread_ratio")
         .order("month", { ascending: true });
       if (error) return { data: [], asOf: undefined, error: error.message };
       const mapped = mapTierSpreadWithTrend(data as TierSpreadMonthRow[] | null);
       return { data: mapped.entries, asOf: mapped.asOf, error: null };
     } catch (err) {
       return { data: [], asOf: undefined, error: err instanceof Error ? err.message : String(err) };
     }
   }
   ```
   Add `loadTierSpread(supabase)` to the `Promise.all([...])`, then a `panels[]`
   entry: `rootId: "tier-gap"`, `eyebrow: "Southwest Florida"`,
   `title: "The luxury–starter price gap"`, `subtitle: "…"`,
   `valueFormat: "ratio"`, `series: TIER_SPREAD_SERIES` (no `variant` → default
   line). Update the header `<p>` blurb to mention the gap if you like.

That's the whole drop-in. Component (`MetroAreaChart`) is already N-series + dash
+ legend + as-of capable; nothing to change there.

---

## OPTIONAL enhancement (do NOT do for v1 unless asked) — the two-line "K"

The iconic K-shape is two lines pulling apart. To do it honestly you must
**index both tiers to 100 at a common base month** (raw dollars are
incomparable magnitudes; FT Visual Vocabulary "indexed" technique). That needs a
small view change in `docs/sql/20260614_tier_divergence_views.sql` (view A) to
emit per-month median top-tier and median bottom-tier (then index in the mapper),
plus a second series preset. It is strictly more work and more ways to mislead —
ship the single ratio line first.

---

## Build gates & gotchas (do NOT skip)

- **RSC boundary (§6) — the rule that reddened `main` on 2026-06-13.** `/charts`
  is a Server Component; `MetroAreaChart` is a Client Component. **Never pass a
  function prop across that line** — pass the serializable `valueFormat="ratio"`
  token (that's why step 1 adds it to `format.ts`, not an inline formatter).
- **`tsc` + eslint + `bun test` all PASS the RSC bug — only `next build` catches
  it. Run `npm run build` before pushing.** Non-negotiable for `/charts` work.
- **Palette + colorblind (§2):** gulf tokens only; the two series already differ
  by dash (solid vs `8 5`) — keep it. ≤3 series.
- **No jargon (§3):** plain title, no "ZHVI/tier/spread/divergence" on the chart
  face; date from real freshness.
- **Don't mislead (brain honesty):** the chart shows the *gap*. A rising luxury
  tier is NOT bullish (cash insulates the top — the brain's locked polarity).
  The ratio framing keeps this honest; don't add a "luxury winning" spin.

## Verify
1. `bun test lib/charts/` green (incl. the new `format` ratio case + the mapper if you test it).
2. `npm run build` green — confirm `/charts` still prerenders (it's `○ /charts`).
3. Eyeball locally: the ratio line ≈ 2–4×, trend line smooth, `as of Apr 2026`,
   plain title, no jargon. Tooltip shows e.g. `2.5×`.
4. Deuteranopia check (Chrome DevTools "Emulate vision deficiencies", §4).

## File map
| What | Where |
|---|---|
| The page (Server Component, DB reads) | `app/charts/page.tsx` |
| Generic N-series chart component | `components/charts/ZHVIAreaChart.tsx` (`MetroAreaChart`) |
| Value-format tokens (serializable) | `lib/charts/format.ts` (+ `format.test.ts`) |
| Series presets | `lib/charts/series.ts` |
| New mapper (mirror airport) | `lib/charts/tier-divergence-series.ts` (reuse `movingAverage` from `airport-series.ts`) |
| Live display view | `data_lake.tier_divergence_pivoted` (363 rows; SQL in `docs/sql/20260614_tier_divergence_views.sql`) |
| Chart rules (READ FIRST) | `app/_design/07-charts-and-dataviz.md` |
| The brain (context) | `refinery/packs/tier-divergence-swfl.mts`; live read `swfl_fetch` / `/api/b/tier-divergence-swfl` |
