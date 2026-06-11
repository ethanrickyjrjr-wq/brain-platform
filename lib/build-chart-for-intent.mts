import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ChartIntent } from "@/lib/route-chart";
import type { ChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import { lintChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import { CORRIDOR_ALIASES } from "@/refinery/lib/corridor-aliases.mts";
import type {
  CorridorEntry,
  CorridorPermitsEntry,
  CorridorCentroidEntry,
  JoinedCorridorRow,
  ZHVIMonth,
  ZHVITrendEntry,
} from "@/types/viz";

export type ChartResult =
  | { block: ChartBlock; asOf: string }
  | { component: "zhvi"; data: ZHVITrendEntry[]; asOf: string }
  | { component: "scatter"; data: JoinedCorridorRow[]; asOf: string };

// The corridor fixtures are a static "Jun 2026" sample. The block-level `asOf`
// is the ISO keystone (end-of-month = data-through-June); the `source` citation
// keeps the "fixture sample" provenance label on the caption. The outer
// `ChartResult.asOf` display string ("Jun 2026") is retained for back-compat.
const FIXTURE_ASOF = "2026-06-30";
const FIXTURE_SOURCE = "SWFL fixture sample";

async function loadFixture<T>(name: string): Promise<T> {
  const file = path.join(process.cwd(), "fixtures", name);
  const raw = await readFile(file, "utf-8");
  return JSON.parse(raw) as T;
}

/**
 * Maps a ChartIntent → chart data.
 *
 * `[LB-R4]` Single source of truth: the persisted `chart_block` jsonb in
 * `saved_charts` is the FROZEN authority for a saved/filed chart. This
 * function is the LIVE render only. A filed chart is frozen at save time
 * and the ProjectItem references that frozen chart_id — it is NEVER
 * recomputed via this function after filing.
 */
export async function buildChartForIntent(intent: ChartIntent): Promise<ChartResult | null> {
  try {
    switch (intent.scope) {
      case "asking-rent":
        return await buildRentChart();
      case "vacancy":
        return await buildVacancyChart();
      case "zhvi":
        return await buildZhviChart();
      case "corridor-scatter":
        return await buildScatterChart();
      case "flood-aal":
        // env-swfl brain has no detail_tables — deferred (FINDINGS-datapaths.md)
        return null;
      case "vitals":
        // deferred per A8
        return null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

async function buildRentChart(): Promise<{ block: ChartBlock; asOf: string } | null> {
  const rents = await loadFixture<CorridorEntry[]>("corridor-rents.json");

  const rows = rents
    .filter(
      (c): c is CorridorEntry & { nnn_asking_rent_per_sqft: number } =>
        c.nnn_asking_rent_per_sqft != null,
    )
    .sort((a, b) => b.nnn_asking_rent_per_sqft - a.nnn_asking_rent_per_sqft)
    .slice(0, 12)
    .map((c): [string, number] => [c.name, c.nnn_asking_rent_per_sqft]);

  if (rows.length < 3) return null;

  const block: ChartBlock = {
    title: "SWFL Corridor NNN Asking Rents",
    columns: ["Corridor", "NNN Asking Rent ($/sqft)"],
    rows,
    chart_type: "bar",
    value_format: "currency",
    asOf: FIXTURE_ASOF,
    source: { citation: FIXTURE_SOURCE },
  };

  const result = lintChartBlock(block);
  if (!result.ok) return null;
  return { block, asOf: "Jun 2026" };
}

async function buildVacancyChart(): Promise<{ block: ChartBlock; asOf: string } | null> {
  const rents = await loadFixture<CorridorEntry[]>("corridor-rents.json");

  const rows = rents
    .filter((c): c is CorridorEntry & { vacancy_pct: number } => c.vacancy_pct != null)
    .sort((a, b) => b.vacancy_pct - a.vacancy_pct)
    .slice(0, 12)
    .map((c): [string, number] => [c.name, c.vacancy_pct]);

  if (rows.length < 3) return null;

  const block: ChartBlock = {
    title: "SWFL Corridor Vacancy Rates",
    columns: ["Corridor", "Vacancy (%)"],
    rows,
    chart_type: "bar",
    value_format: "percent",
    asOf: FIXTURE_ASOF,
    source: { citation: FIXTURE_SOURCE },
  };

  const result = lintChartBlock(block);
  if (!result.ok) return null;
  return { block, asOf: "Jun 2026" };
}

async function buildZhviChart(): Promise<{
  component: "zhvi";
  data: ZHVITrendEntry[];
  asOf: string;
} | null> {
  const raw = await loadFixture<ZHVIMonth[]>("zhvi-trend.json");

  const data = raw.filter(
    (r): r is ZHVITrendEntry => r.cape_coral != null && r.fort_myers != null && r.naples != null,
  );

  if (data.length < 3) return null;
  const lastMonth = data.reduce((m, r) => (r.month > m ? r.month : m), data[0].month);
  const [yr, mo] = lastMonth.split("-");
  const asOf = new Date(parseInt(yr), parseInt(mo) - 1, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
  return { component: "zhvi", data, asOf };
}

async function buildScatterChart(): Promise<{
  component: "scatter";
  data: JoinedCorridorRow[];
  asOf: string;
} | null> {
  const aliasMap = CORRIDOR_ALIASES as Record<string, string | null | undefined>;

  const [rents, permits, centroids] = await Promise.all([
    loadFixture<CorridorEntry[]>("corridor-rents.json"),
    loadFixture<CorridorPermitsEntry[]>("corridor-permits.json").catch(
      () => [] as CorridorPermitsEntry[],
    ),
    loadFixture<CorridorCentroidEntry[]>("corridor-centroids.json").catch(
      () => [] as CorridorCentroidEntry[],
    ),
  ]);

  const permitsById = new Map(permits.map((p) => [p.corridor_id, p]));
  const centroidsById = new Map(centroids.map((c) => [c.corridor_id, c]));

  const rows: JoinedCorridorRow[] = rents.map((row) => {
    const centroidId = aliasMap[row.id];
    const permitsEntry = centroidId == null ? null : (permitsById.get(centroidId) ?? null);
    const centroidEntry = centroidId == null ? null : (centroidsById.get(centroidId) ?? null);
    return {
      id: row.id,
      name: row.name,
      submarket: row.submarket,
      nnn_asking_rent_per_sqft: row.nnn_asking_rent_per_sqft,
      vacancy_pct: row.vacancy_pct,
      absorption_sqft: row.absorption_sqft,
      permits: permitsEntry,
      centroid: centroidEntry,
    };
  });

  const plottable = rows.filter(
    (r) => r.nnn_asking_rent_per_sqft != null && r.vacancy_pct != null && r.permits != null,
  );
  if (plottable.length < 3) return null;

  return { component: "scatter", data: rows, asOf: "Jun 2026" };
}
