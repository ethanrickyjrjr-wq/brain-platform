# /charts — luxury–starter price gap chart (HANDOFF, 2026-06-14)

**Status: BUILT + VERIFIED 2026-06-14 — Option B wired; `bun test lib/charts` (32) + `npm run build`
(`○ /charts` prerenders) both green; view migration applied live. Two handoff bugs were corrected
during build (see SESSION_LOG): the Step-0 SQL inserted the new columns mid-list (Postgres
`CREATE OR REPLACE VIEW` can only append → now appended), and the Step-1 test examples had the
`formatChartValue`/`formatAxisTick` args reversed (actual signature is `(format, value)`).
COPY DECISION (operator, 2026-06-14): at the regional-median grain the two tiers move near-lockstep
across all 30 years (max gap ≈ 5.8 index pts; starter outran luxury 2022–24), so the original
"Two tracks / a widening gap signals market fracturing" copy was REPLACED with the honest lockstep
framing — title "Luxury vs. starter home prices, indexed", subtitle noting the tiers rose in
near-lockstep regionally and the K-shaped split is a ZIP-level (not median) story.**

**Read first:** `docs/charts.md` — master build rules, RSC boundary, component reference,
pre-push checklist. That document covers everything that applies to ALL chart builds.
This handoff only documents what is specific to this chart.

---

## Data available

### Display view — `data_lake.tier_divergence_pivoted`

Live, GRANTed to `service_role`, **363 rows** (monthly ~1996-02 → 2026-04).

| column | type | note |
|---|---|---|
| `month` | text `"YYYY-MM"` | already `ORDER BY month` ascending |
| `median_spread_ratio` | double | regional median (top-tier ÷ bottom-tier) across both-tier SWFL ZIPs |
| `both_tier_zip_count` | int | coverage count — do NOT plot on the value axis |

**Option B requires adding two columns to this view (step 1 below):**

| column to add | type | note |
|---|---|---|
| `median_top_tier` | double | regional median top-tier (luxury) ZHVI, raw, per month |
| `median_bottom_tier` | double | regional median bottom-tier (starter) ZHVI, raw, per month |

One `.select()` is safe (363 rows, well under the 1000-row PostgREST cap).
Source SQL: `docs/sql/20260614_tier_divergence_views.sql` (view A).

### Brain-input view — `data_lake.tier_divergence_zip_latest`

Per-ZIP, ~107 rows. Now carries `top_tier_yoy_prior_month_pct` +
`bottom_tier_yoy_prior_month_pct` (MoM direction wired, commit `c571342`).
**Not used by the chart** — brain context only.

---

## Design options (for reference)

Three options were evaluated (2026-06-14 session). Option B is the selected design.

### Option A — Ratio line + 12-mo trend *(not selected)*

Single `median_spread_ratio` line (gulf-teal solid) + 12-month trailing mean (neutral-gold
dashed). Mirrors the airline panel exactly. Zero view changes needed.

**Why not selected now:** the ratio is honest but abstract — a reader sees "2.5×" without
understanding what moved. Option B tells the story directly. The ratio chart is still valid
as a secondary display if the two-line chart becomes crowded.

### Option B — Indexed two-line K chart *(SELECTED)*

Both tiers indexed to 100 at a common base month (Jan 2019, pre-COVID/pre-rate-shock).
Shows the actual K-shape: two lines that diverge when luxury holds and starter falls,
converge when both move together. Honest at all times — an indexed line can't mislead by
magnitude.

- `luxury_index` — gulf-teal solid
- `starter_index` — mangrove dashed (`"8 5"`)
- Base month: `"2019-01"` (first Jan with both-tier ZIPs; fall back to first available month
  if 2019-01 is absent in the data)
- Y-axis: truncated to data range (~60–150), NOT forced to 0
- `valueFormat: "index"` — new token, renders as `${value.toFixed(0)}` (no unit suffix)
- Title: `"Two tracks: luxury vs. starter home prices"`
- Subtitle: `"Both indexed to 100 in January 2019 — a widening gap signals market fracturing"`
- One-sentence takeaway (DOM, near chart): derive from latest values,
  e.g. `"Since 2019, SWFL luxury homes are up 47% vs. starters up 31%."`

**Why selected:** the "K" is the product's core signal. An indexed chart shows it
visually — readers instantly see the lines pulling apart. The K-shape intensity metric
(`tier_kshape_intensity_swfl`) now has correct MoM direction, making this honest at the
current reading (K-shape = 0, both tiers falling — lines near-parallel, which is also
honest: there is no divergence right now).

### Option C — Deviation bar *(rejected)*

Monthly bars for `ratio − 1`. Textbook "deviation from reference" (FT Visual Vocabulary)
but 363 monthly bars is a visual wreck. Not appropriate for 30-year history.

---

## Implementation (Option B)

### Step 0 — Run the view migration

Add `median_top_tier` and `median_bottom_tier` to `tier_divergence_pivoted` (view A).
Idempotent `CREATE OR REPLACE VIEW`. Run directly per CLAUDE.md RULE 1.

```sql
CREATE OR REPLACE VIEW data_lake.tier_divergence_pivoted AS
SELECT
  to_char(period_end, 'YYYY-MM')                                          AS month,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY top_tier_value::float8 / NULLIF(bottom_tier_value::float8, 0)
  )                                                                        AS median_spread_ratio,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY top_tier_value::float8
  )                                                                        AS median_top_tier,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY bottom_tier_value::float8
  )                                                                        AS median_bottom_tier,
  count(*)                                                                 AS both_tier_zip_count
FROM data_lake.tier_divergence_swfl
WHERE top_tier_value IS NOT NULL
  AND bottom_tier_value IS NOT NULL
GROUP BY to_char(period_end, 'YYYY-MM')
ORDER BY month;

GRANT SELECT ON data_lake.tier_divergence_pivoted TO service_role;
NOTIFY pgrst, 'reload schema';
```

Verify: `SELECT month, median_top_tier, median_bottom_tier FROM data_lake.tier_divergence_pivoted WHERE month = '2019-01';`
Both columns must be non-null before proceeding.

Also update `docs/sql/20260614_tier_divergence_views.sql` (view A block) to match.

### Step 1 — `lib/charts/format.ts`

Add `"index"` to `ValueFormat` union. TDD: write the test case first.

```ts
// format.test.ts
expect(formatChartValue(147, "index")).toBe("147");
expect(formatAxisTick(100, "index")).toBe("100");

// format.ts
// In ValueFormat union:
"usd" | "rent" | "count" | "pct" | "ratio" | "index"

// In formatChartValue:
case "index": return `${value.toFixed(0)}`;

// In formatAxisTick:
if (format === "index") return `${value.toFixed(0)}`;
```

### Step 2 — `lib/charts/tier-divergence-series.ts` (new file)

Mirror `airport-series.ts`. The key logic is the indexer:

```ts
interface TierPivotedRow {
  month: string;
  median_top_tier: number | null;
  median_bottom_tier: number | null;
}

const BASE_MONTH = "2019-01";

export function mapTierIndexed(rows: TierPivotedRow[] | null): {
  entries: ChartRow[];
  asOf?: string;
  baseMonth: string;
} {
  if (!rows || rows.length === 0) return { entries: [], baseMonth: BASE_MONTH };

  const sorted = rows
    .filter((r) => r.median_top_tier !== null && r.median_bottom_tier !== null)
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  // Find base row — prefer 2019-01, fall back to first available
  const baseRow = sorted.find((r) => r.month === BASE_MONTH) ?? sorted[0];
  const baseTop = baseRow.median_top_tier!;
  const baseBot = baseRow.median_bottom_tier!;
  const baseMonth = baseRow.month;

  const entries: ChartRow[] = sorted.map((r) => ({
    month: r.month,
    luxury_index: Math.round(((r.median_top_tier! / baseTop) * 100) * 10) / 10,
    starter_index: Math.round(((r.median_bottom_tier! / baseBot) * 100) * 10) / 10,
  }));

  return { entries, asOf: sorted[sorted.length - 1].month, baseMonth };
}
```

No moving-average trend needed — the indexed lines are already smooth (monthly medians over
~107 ZIPs). Add one if it looks noisy after eyeballing.

### Step 3 — `lib/charts/series.ts`

```ts
export const TIER_INDEXED_SERIES: ChartSeriesDef[] = [
  { key: "luxury_index", label: "Luxury homes",  color: "#3dc9c0", dash: "" },      // gulf-teal solid
  { key: "starter_index", label: "Starter homes", color: "#5bc97a", dash: "8 5" }, // mangrove dashed
];
```

### Step 4 — `app/charts/page.tsx`

```ts
import { mapTierIndexed, type TierPivotedRow } from "@/lib/charts/tier-divergence-series";
import { TIER_INDEXED_SERIES } from "@/lib/charts/series";

async function loadTierIndexed(supabase: Supabase): Promise<LoadedPanel> {
  try {
    const { data, error } = await supabase
      .schema("data_lake")
      .from("tier_divergence_pivoted")
      .select("month, median_top_tier, median_bottom_tier")
      .order("month", { ascending: true });
    if (error) return { data: [], asOf: undefined, error: error.message };
    const mapped = mapTierIndexed(data as TierPivotedRow[] | null);
    return { data: mapped.entries, asOf: mapped.asOf, error: null };
  } catch (err) {
    return { data: [], asOf: undefined, error: err instanceof Error ? err.message : String(err) };
  }
}
```

Add to `Promise.all([...])` and `panels[]`:

```ts
{
  rootId: "tier-gap",
  eyebrow: "Southwest Florida",
  title: "Two tracks: luxury vs. starter home prices",
  subtitle: "Both indexed to 100 in January 2019 — a widening gap signals market fracturing",
  valueFormat: "index",
  series: TIER_INDEXED_SERIES,
  ...tierIndexed,
},
```

---

## Verify

1. `bun test lib/charts/` — green (format `"index"` token + mapper null-handling)
2. `npm run build` — green, `/charts` prerendering as `○ /charts`
3. Eyeball: both lines start at 100 in Jan 2019, diverge after 2022, current reading shows
   them near-parallel (both fell YoY — no K-shape active). `as of Apr 2026`.
4. Tooltip shows e.g. `"Luxury homes: 147"` and `"Starter homes: 131"`.
5. Deuteranopia check (Chrome DevTools → Rendering → Emulate vision deficiency) — lines
   differ by color AND dash, so they're distinguishable in B&W.
6. No jargon on chart face — no "ZHVI", "tier", "divergence", "indexed", column names.

---

## Context: why the K-shape reads 0 right now (not a bug)

`tier_kshape_intensity_swfl = 0` is correct. K-shape is defined as luxury YoY ≥ 0 AND
starter YoY < 0. Currently both tiers are falling (luxury −6% YoY, starter −7% YoY) so
zero ZIPs qualify. The indexed chart will show this honestly: two lines declining together,
near-parallel. That IS the story. When luxury stabilizes while starter keeps falling, the
lines will diverge and the K-shape intensity score will rise — and the chart will show it.

The MoM direction for the intensity score is now correctly wired (commit `c571342`) using
T-1mo vs T-13mo YoY anchors — no longer hardcoded `"stable"`.
