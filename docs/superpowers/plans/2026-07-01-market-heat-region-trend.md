# Market-Heat Region Monthly Trend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** ⚡ Sonnet — keywords: architecture

**Goal:** market-heat-swfl emits a compact, date-indexed region monthly-trend `detail_table` (region median per month of active listings / days-on-market / pending ratio), computed in-brain from the monthly history it already loads.

**Architecture:** One pack change (`refinery/packs/market-heat-swfl.mts`). A new exported pure helper `regionMonthlyTrend(coreByZip)` inverts the already-loaded `Map<zip, Map<month, row>>` to a month-keyed region-median series; `corpusSummary` stashes it on `lastData`; `outputProducer` appends it as a second `detail_tables` entry beside the existing `market_heat_by_zip` table. No chart-path touch, no new SQL, no new read.

**Tech Stack:** TypeScript `.mts`, `bun:test` + `node:assert/strict`, refinery pack contract (`BrainOutput`).

## Global Constraints

- **Foundation only:** emit the trend data. Do NOT wire any chart path (`pickFramesForData` / `buildChartForQuestion`), do NOT add a renderer. Plotting is a separate queued build.
- **Faithful / no-invention (FOCUS rule 1):** every cell is a `median()` of real realtor.com lake values; a month/metric with all-null ZIP values emits `null`, never a filled-in number. The table carries the brain's existing realtor.com `source`.
- **Aggregate at source:** compute from the in-memory `coreByZip` the brain already loads — no new SQL view, no new DB read.
- **No vocab entry:** detail_table ids are NOT vocab-tracked (confirmed: `market_heat_by_zip` and its column ids are absent from `refinery/vocab/brain-vocabulary.json`). Do not add one.
- **Gate 5 (pre-push):** touching `refinery/packs/**` runs `catalog.test.mts` + this pack's `bun:test`. Keep them green; sync `catalog.mts` only if the mirror requires it.
- **Rebuild with `--target-only`** to avoid clobbering a parallel session's `brains/*.md`.
- Date column id MUST be `month` (matches `DATE_COLUMN_RE = /date|year|month|period|quarter|week/i` so the future picker reads it as time-series).

---

## File Structure

- **Modify** `refinery/packs/market-heat-swfl.mts`:
  - add `RegionTrendPoint` type + `regionTrend` field on the `MarketHeatData` interface (~`:163-178`);
  - add exported pure `regionMonthlyTrend()` (near the other pure helpers, after `median()` `:188`);
  - call it in `marketHeatCorpusSummary` when building `lastData` (`:298-313`);
  - append the trend `detail_table` in `marketHeatOutputProducer` (`:473-526`);
  - add `export` to `marketHeatCorpusSummary` + `marketHeatOutputProducer` (test access only).
- **Modify** `refinery/packs/market-heat-swfl.test.mts`: unit tests for `regionMonthlyTrend` + one end-to-end emission test.

---

## Task 1: Pure `regionMonthlyTrend` helper

**Files:**
- 🔴 Modify: `refinery/packs/market-heat-swfl.mts` (add type + exported helper)
- 🔴 Test: `refinery/packs/market-heat-swfl.test.mts`

**Interfaces:**
- Consumes: existing `median(values: readonly (number|null)[]): number | null` (`:182`), `MarketHeatCoreRow` (fields `month`, `active_listing_count`, `median_days_on_market`, `pending_ratio`, all `number | null` / `string`).
- Produces: `interface RegionTrendPoint { month: string; active: number|null; dom: number|null; pending: number|null }` and `export function regionMonthlyTrend(coreByZip: Map<string, Map<string, MarketHeatCoreRow>>, cap?: number): RegionTrendPoint[]`.

- [ ] **Step 1: Write the failing test** (append to `market-heat-swfl.test.mts`)

First add `regionMonthlyTrend` to the existing TOP-LEVEL destructure at the head of the test file (the `const { marketHeatSwfl, ..., zipExhibitsFalsifier } = await import("./market-heat-swfl.mts");` block, `:7-18`) — bun supports top-level await, but `await` inside a sync `describe`/`test` callback is a syntax error, so imports stay at module top. Then append:

```ts
describe("regionMonthlyTrend", () => {
  // helper: build a coreByZip fixture from [zip, month, active, dom, pending] tuples
  function build(tuples: Array<[string, string, number | null, number | null, number | null]>) {
    const m = new Map<string, Map<string, any>>();
    for (const [zip, month, active, dom, pending] of tuples) {
      if (!m.has(zip)) m.set(zip, new Map());
      m.get(zip)!.set(month, {
        zip_code: zip, month,
        active_listing_count: active, median_days_on_market: dom, pending_ratio: pending,
      });
    }
    return m;
  }

  test("returns one ascending row per month, region median across ZIPs", () => {
    const core = build([
      ["33901", "2026-01", 100, 40, 0.5],
      ["33902", "2026-01", 200, 60, 0.7],
      ["33901", "2026-02", 110, 30, 0.6],
      ["33902", "2026-02", 210, 50, 0.8],
    ]);
    const out = regionMonthlyTrend(core);
    assert.deepStrictEqual(out.map((p) => p.month), ["2026-01", "2026-02"]);
    assert.strictEqual(out[0]!.active, 150); // median(100,200)
    assert.strictEqual(out[0]!.dom, 50); // median(40,60)
    assert.strictEqual(out[1]!.pending, 0.7); // median(0.6,0.8)
  });

  test("null-safe: a null ZIP value is dropped from that month's median, not zeroed", () => {
    const core = build([
      ["33901", "2026-01", null, 40, 0.5],
      ["33902", "2026-01", 200, 60, 0.7],
    ]);
    const out = regionMonthlyTrend(core);
    assert.strictEqual(out[0]!.active, 200); // only the non-null value
  });

  test("all-null metric for a month emits null (never fabricated)", () => {
    const core = build([["33901", "2026-01", null, null, null]]);
    assert.strictEqual(regionMonthlyTrend(core)[0]!.active, null);
  });

  test("caps to the last N months", () => {
    const tuples = Array.from({ length: 40 }, (_, i) => {
      const mm = String((i % 12) + 1).padStart(2, "0");
      const yy = 2020 + Math.floor(i / 12);
      return ["33901", `${yy}-${mm}`, i, i, i / 100] as [string, string, number, number, number];
    });
    assert.strictEqual(regionMonthlyTrend(build(tuples), 36).length, 36);
  });

  test("empty input returns []", () => {
    assert.deepStrictEqual(regionMonthlyTrend(new Map()), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test refinery/packs/market-heat-swfl.test.mts`
Expected: FAIL — `regionMonthlyTrend` is not exported.

- [ ] **Step 3: Add the type and the exported helper**

(Do NOT touch the `MarketHeatData` interface here — the `regionTrend` field and the `lastData` literal that
populates it are added together in Task 2, so this task stays self-contained and compiles.)

Add near the other pure helpers (just after `median()` at `:188`):

```ts
export interface RegionTrendPoint {
  month: string;
  active: number | null;
  dom: number | null;
  pending: number | null;
}

/**
 * Region monthly trend — inverts the loaded `coreByZip` history to a month-keyed
 * series carrying the region MEDIAN across ZIPs of the three per-month core
 * signals. Real medians of held realtor.com values (null-safe via `median()`);
 * a month/metric with no non-null values yields null, never a fabricated number.
 * Sorted ascending; capped to the last `cap` months (default 36).
 */
export function regionMonthlyTrend(
  coreByZip: Map<string, Map<string, MarketHeatCoreRow>>,
  cap = 36,
): RegionTrendPoint[] {
  const byMonth = new Map<string, MarketHeatCoreRow[]>();
  for (const months of coreByZip.values()) {
    for (const [m, row] of months) {
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(row);
    }
  }
  const points = [...byMonth.keys()].sort().map((m) => {
    const rows = byMonth.get(m)!;
    return {
      month: m,
      active: median(rows.map((r) => r.active_listing_count)),
      dom: median(rows.map((r) => r.median_days_on_market)),
      pending: median(rows.map((r) => r.pending_ratio)),
    };
  });
  return points.slice(-cap);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test refinery/packs/market-heat-swfl.test.mts`
Expected: PASS (5 new tests).

- [ ] **Step 5: Commit**

```bash
git add refinery/packs/market-heat-swfl.mts refinery/packs/market-heat-swfl.test.mts
git commit -m "feat(market-heat): regionMonthlyTrend pure helper"
```

---

## Task 2: Stash on `lastData` + emit the trend `detail_table`

**Files:**
- 🔴 Modify: `refinery/packs/market-heat-swfl.mts` (corpusSummary stash, outputProducer emit, test exports)
- 🔴 Test: `refinery/packs/market-heat-swfl.test.mts`

**Interfaces:**
- Consumes: `regionMonthlyTrend` (Task 1); the existing `source: BrainOutputMetricSource` built in `outputProducer` (`:356`); `BrainOutputDetailTable`.
- Produces: `detail_tables` now contains `{ id: "market_heat_region_trend", ... }`; `export`ed `marketHeatCorpusSummary` + `marketHeatOutputProducer` for tests.

- [ ] **Step 1: Write the failing test** (append to `market-heat-swfl.test.mts`)

Add these to the TOP-LEVEL imports at the head of the test file (module top — not inside a callback):

```ts
const { marketHeatCorpusSummary, marketHeatOutputProducer } = await import("./market-heat-swfl.mts");
const { isDateColumn } = await import("../lib/chart-from-metrics.mts");
```

Then append:

```ts
describe("market-heat output — region trend detail_table", () => {
  test("emits market_heat_region_trend with a month date column and rows", () => {
    marketHeatCorpusSummary(allFragments); // sets module lastData
    const out = marketHeatOutputProducer({} as never);
    const trend = out.detail_tables?.find((t) => t.id === "market_heat_region_trend");
    assert.ok(trend, "region trend table present");
    assert.ok(
      trend!.columns.some((c) => c.id === "month"),
      "has a `month` date column (future picker reads it as time-series)",
    );
    assert.ok(trend!.rows.length >= 1, "at least one month row");
    assert.ok(isDateColumn("month")); // date column id is picker-recognized
    assert.ok("region_median_active_listings" in trend!.rows[0]!.cells); // faithful cell keys
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test refinery/packs/market-heat-swfl.test.mts`
Expected: FAIL — functions not exported / no `market_heat_region_trend` table.

- [ ] **Step 3a: Export the two producer functions**

Change `function marketHeatCorpusSummary(` → `export function marketHeatCorpusSummary(` (`:197`) and `function marketHeatOutputProducer(` → `export function marketHeatOutputProducer(` (`:336`). (Both remain wired into the `marketHeatSwfl` definition unchanged — export is additive.)

- [ ] **Step 3b: Add the interface field + stash the trend on `lastData` (together, so it compiles)**

Add the field to the `MarketHeatData` interface (after `falsifierWatchCount`, `~:177`):

```ts
  regionTrend: RegionTrendPoint[];
```

And in `marketHeatCorpusSummary`, in the `lastData = { ... }` literal (`:298-313`), add the matching entry:

```ts
    regionTrend: regionMonthlyTrend(coreByZip),
```

(Both in the same commit — a required interface field with no populating literal would not compile.)

- [ ] **Step 3c: Emit the trend table**

In `marketHeatOutputProducer`, extend the `detail_tables` array (`:473-526`) so it also includes the trend table (append after the existing `market_heat_by_zip` object, still inside the array literal):

```ts
    ...(data.regionTrend.length
      ? [
          {
            id: "market_heat_region_trend",
            title: "SWFL market heat — region monthly trend (realtor.com core inventory)",
            grain: "region-month",
            columns: [
              { id: "month", label: "Month" },
              {
                id: "region_median_active_listings",
                label: "Median Active Listings",
                display_format: "count",
                units: "listings",
              },
              { id: "region_median_dom", label: "Median DOM", display_format: "count", units: "days" },
              {
                id: "region_median_pending_ratio",
                label: "Median Pending Ratio",
                display_format: "ratio",
                units: "ratio",
              },
            ],
            rows: data.regionTrend.map((p) => ({
              key: p.month,
              label: p.month,
              cells: {
                month: p.month,
                region_median_active_listings: p.active,
                region_median_dom: p.dom,
                region_median_pending_ratio: p.pending,
              },
            })),
            source,
          } as BrainOutputDetailTable,
        ]
      : []),
```

- [ ] **Step 4: Run tests + the pack gate**

Run: `bun test refinery/packs/market-heat-swfl.test.mts`
Expected: PASS (existing + new).
Run: `bun test refinery/packs/catalog.test.mts`
Expected: PASS (mirror unaffected — an appended detail_table is not catalog metadata; if it flags, mirror the change in `catalog.mts` and re-run).

- [ ] **Step 5: Rebuild the brain locally + eyeball the trend table**

Run: `bun run refinery -- market-heat-swfl --target-only`
Expected: build succeeds; open `brains/market-heat-swfl.md` and confirm a `market_heat_region_trend` table with one row per month (real medians, ascending). Confirm the existing headline / ranked-ZIP output is unchanged.

- [ ] **Step 6: Commit**

```bash
git add refinery/packs/market-heat-swfl.mts refinery/packs/market-heat-swfl.test.mts
git commit -m "feat(market-heat): emit region monthly trend detail_table (foundation)"
```

---

## Self-Review

**Spec coverage:** region-median-per-month of active/DOM/pending computed in-brain from `coreByZip` (T1) · emitted as a `month`-keyed `detail_table` with the brain's realtor.com source (T2) · aggregate-at-source, no new SQL/read (T1 operates on the loaded map) · faithful/null-safe (T1 null tests) · 36-month cap (T1) · empty-tolerant (T1 empty→[], T2 conditional spread) · date column `month` recognized (T2 `isDateColumn`) · no chart-path touch, no vocab entry (Global Constraints) · Gate-5 catalog + pack test (T2 Step 4). ✔ All spec requirements covered.

**Placeholder scan:** no TBD/TODO; every code step is complete. The one caveat note (stray `node:util` import) is explicitly flagged for removal, not a placeholder. ✔

**Type consistency:** `RegionTrendPoint {month, active, dom, pending}` defined T1, consumed identically in T2's `rows.map`. `regionMonthlyTrend(coreByZip, cap?)` signature stable across T1/T2. Cell keys (`region_median_active_listings/_dom/_pending_ratio`) match between the T2 emit and the T2 test assertion. `market_heat_region_trend` id identical in emit + test. ✔

## Follow-up note for the queued sweep + charting build (NOT this plan)

When the charting wire lands, `pickFramesForData` must prefer the trend table (varying `month`) over the existing `market_heat_by_zip` table — whose `month` column is a **constant** (all latest month) and would false-positive as a degenerate time series. The picker/wire needs a "date column actually varies across rows" guard, or to target the `market_heat_region_trend` id explicitly. Flag this in the sweep spec.

---

## Parallel Safety

> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.

| Group | Tasks | Shared Files |
|-------|-------|--------------|
| 🔴 | Task 1, Task 2 | `refinery/packs/market-heat-swfl.mts`, `refinery/packs/market-heat-swfl.test.mts` |

Tasks with no color badge have no file conflicts — safe to parallelize freely.
