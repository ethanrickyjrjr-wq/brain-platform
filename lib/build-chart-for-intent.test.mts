import { describe, it, expect } from "vitest";
import { buildChartForIntent, vacancyChartSpecFromTable } from "./build-chart-for-intent.mts";
import type { ZHVITrendEntry, JoinedCorridorRow } from "@/types/viz";
import type { BrainOutputDetailTable } from "@/refinery/types/brain-output.mts";

// The disk-backed `fetchBrain` read (brains/cre-swfl.md) is exercised in
// production; here we unit-test the pure mapping `vacancyChartSpecFromTable`,
// which holds ALL the chart logic. That cre-swfl actually emits the table is
// proven deterministically in refinery/packs/cre-swfl.test.mts.
const SAMPLE_VACANCY_TABLE: BrainOutputDetailTable = {
  id: "corridor_vacancy",
  title: "SWFL CRE corridor vacancy rate",
  grain: "corridor",
  columns: [{ id: "vacancy_rate_pct", label: "Vacancy", display_format: "percent", units: "%" }],
  rows: [
    { key: "Estero Blvd Fort Myers Beach", label: "Estero Blvd", cells: { vacancy_rate_pct: 2.9 } },
    { key: "Pine Ridge Rd Naples", label: "Pine Ridge Rd", cells: { vacancy_rate_pct: 3.2 } },
    {
      key: "Lee Blvd Lehigh Acres",
      label: "Lee Blvd",
      cells: {
        vacancy_rate_pct: 0.2,
        coverage_note: "From the MarketBeat submarket survey — incomplete corridor-level coverage.",
      },
    },
    {
      key: "Gulf Coast Town Center",
      label: "Gulf Coast Town Center",
      cells: { vacancy_rate_pct: 7.7 },
    },
  ],
  source: {
    url: "https://x.supabase.co/rest/v1/corridor_profiles?select=corridor_name,vacancy_rate_pct",
    fetched_at: "2026-06-15T00:00:00Z",
    tier: 2,
    citation:
      "Brains Supabase corridor_profiles (verified, non-deleted) — vacancy_rate_pct per corridor. " +
      "27 of 27 corridors reporting. 2 flagged coverage_note draw on the incomplete MarketBeat submarket survey.",
  },
};

// buildChartForIntent now returns a ready ChartSpec (one normalization path).
// Frames that wrap a raw-array component carry the untouched typed array under
// `options.data` — these tests lock that the migration neither changed the data
// nor dropped fields (the regression target: scatter `permits.n_current`).

describe("buildChartForIntent → ChartSpec", () => {
  it("asking-rent → bar-table spec (bar, fixture keystone, >=3 rows)", async () => {
    const r = await buildChartForIntent({ chart_type: "bar", scope: "asking-rent" });
    expect(r).not.toBeNull();
    expect(r?.frameId).toBe("bar-table");
    expect(r?.chart_type).toBe("bar");
    expect(r?.asOf).toBe("2026-06-30");
    expect(typeof r?.title).toBe("string");
    expect(r?.columns.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(r?.rows.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("zhvi → zhvi-area spec; raw series in options.data, all three columns", async () => {
    const r = await buildChartForIntent({ chart_type: "area", scope: "zhvi" });
    expect(r?.frameId).toBe("zhvi-area");
    const data = r?.options?.data as ZHVITrendEntry[] | undefined;
    expect(Array.isArray(data)).toBe(true);
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(3);
    const e = data![0];
    expect(typeof e.month).toBe("string");
    expect(typeof e.cape_coral).toBe("number");
    expect(typeof e.fort_myers).toBe("number");
    expect(typeof e.naples).toBe("number");
  });

  it("zhvi asOf is honest ISO derived from its own last month (not the corridor keystone)", async () => {
    const r = await buildChartForIntent({ chart_type: "area", scope: "zhvi" });
    expect(r?.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The zhvi fixture runs through Apr 2026 — it must NOT inherit the corridor
    // sample's Jun 2026 keystone (that would claim a vintage newer than the data).
    expect(r?.asOf).not.toBe("2026-06-30");
  });

  it("corridor-scatter → corridor-scatter spec; full rows untouched in options.data", async () => {
    const r = await buildChartForIntent({ chart_type: "scatter", scope: "corridor-scatter" });
    expect(r?.frameId).toBe("corridor-scatter");
    const data = r?.options?.data as JoinedCorridorRow[] | undefined;
    expect(Array.isArray(data)).toBe(true);
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("REGRESSION: scatter preserves permits.n_current (the field flat-columns dropped)", async () => {
    const r = await buildChartForIntent({ chart_type: "scatter", scope: "corridor-scatter" });
    const data = (r?.options?.data as JoinedCorridorRow[]) ?? [];
    const covered = data.find((row) => row.permits != null);
    expect(covered).toBeDefined();
    expect(typeof covered!.permits!.n_current).toBe("number");
    expect(typeof covered!.permits!.headline_z).toBe("number");
  });

  it("REGRESSION: scatter keeps no-coverage rows (permits === null) for the internal filter", async () => {
    const r = await buildChartForIntent({ chart_type: "scatter", scope: "corridor-scatter" });
    const data = (r?.options?.data as JoinedCorridorRow[]) ?? [];
    // The producer passes ALL rows; null-permits (Collier) corridors must survive
    // so the component's `permits != null` exclusion still has something to exclude.
    expect(data.some((row) => row.permits === null)).toBe(true);
  });

  it("returns null for deferred vitals", async () => {
    expect(
      await buildChartForIntent({ chart_type: "bar", scope: "vitals", corridor_slug: "x" }),
    ).toBeNull();
  });

  it("returns null for flood-aal (no env detail_tables)", async () => {
    expect(await buildChartForIntent({ chart_type: "bar", scope: "flood-aal" })).toBeNull();
  });
});

describe("vacancyChartSpecFromTable (cre-swfl corridor_vacancy → ChartSpec)", () => {
  it("maps the detail_table to a bar-table spec, sorted high→low, percent format", () => {
    const r = vacancyChartSpecFromTable(SAMPLE_VACANCY_TABLE);
    expect(r?.frameId).toBe("bar-table");
    expect(r?.chart_type).toBe("bar");
    expect(r?.value_format).toBe("percent");
    expect(r?.rows.length).toBe(4);
    // sorted high→low, capped at 12; the 7.7 corridor leads, the 0.2 trails
    expect(r?.rows[0][1]).toBe(7.7);
    expect(r?.rows[r!.rows.length - 1][1]).toBe(0.2);
    // labels (display names) carry the corridor, not the raw key
    expect(r?.rows[0][0]).toBe("Gulf Coast Town Center");
  });

  it("derives asOf from the table's fetched_at, never the fabricated fixture keystone", () => {
    const r = vacancyChartSpecFromTable(SAMPLE_VACANCY_TABLE);
    expect(r?.asOf).toBe("2026-06-15");
    expect(r?.asOf).not.toBe("2026-06-30");
    expect(r?.source.citation).toMatch(/corridor_profiles/);
  });

  it("returns null when fewer than 3 corridors carry a numeric vacancy", () => {
    const thin: BrainOutputDetailTable = {
      ...SAMPLE_VACANCY_TABLE,
      rows: SAMPLE_VACANCY_TABLE.rows.slice(0, 2),
    };
    expect(vacancyChartSpecFromTable(thin)).toBeNull();
  });
});
