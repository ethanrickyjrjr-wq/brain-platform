import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ChartIntent } from "@/lib/route-chart";
import type { ChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import { lintChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import type { ChartSpec } from "@/components/charts/registry/chart-spec";
import { CORRIDOR_ALIASES } from "@/refinery/lib/corridor-aliases.mts";
import { fetchBrain } from "@/lib/fetch-brain";
import type { BrainOutputDetailTable } from "@/refinery/types/brain-output.mts";
import type {
  CorridorEntry,
  CorridorPermitsEntry,
  CorridorCentroidEntry,
  JoinedCorridorRow,
  ZHVIMonth,
  ZHVITrendEntry,
} from "@/types/viz";

// The corridor fixtures (rents + permits) are a static "Jun 2026" sample; their
// block-level `asOf` is the ISO keystone for that snapshot. The ZHVI fixture is a
// SEPARATE file (`zhvi-trend.json`) whose series runs through its own last month —
// its `asOf` is derived from that month, NOT this constant, so the chart never
// claims a vintage newer than its data (CLAUDE.md data-provenance).
const FIXTURE_ASOF = "2026-06-30";
const FIXTURE_SOURCE = "SWFL fixture sample";

async function loadFixture<T>(name: string): Promise<T> {
  const file = path.join(process.cwd(), "fixtures", name);
  const raw = await readFile(file, "utf-8");
  return JSON.parse(raw) as T;
}

/** "YYYY-MM" → ISO last-day-of-that-month ("2026-04" → "2026-04-30"), UTC-safe.
 *  The honest "data through" vintage for a monthly series. */
function monthEndIso(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Maps a ChartIntent → a ready-to-render `ChartSpec` (or `null`).
 *
 * ONE normalization path: every case returns a `ChartSpec` carrying its
 * `frameId`. Frames that wrap a raw-array component (`zhvi-area`,
 * `corridor-scatter`) carry the untouched typed array under `options.data` — no
 * flatten-to-columns, no lossy reconstruction. The dock renders the spec through
 * `FrameRenderer` with zero normalization of its own.
 *
 * `[LB-R4]` Single source of truth: the persisted `chart_block` jsonb in
 * `saved_charts` is the FROZEN authority for a saved/filed chart. This function
 * is the LIVE render only. A filed chart is frozen at save time and the
 * ProjectItem references that frozen chart_id — it is NEVER recomputed here.
 */
export async function buildChartForIntent(intent: ChartIntent): Promise<ChartSpec | null> {
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

async function buildRentChart(): Promise<ChartSpec | null> {
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

  if (!lintChartBlock(block).ok) return null;
  return { ...block, frameId: "bar-table" };
}

/**
 * Pure mapping: cre-swfl's `corridor_vacancy` detail_table → a vacancy bar
 * ChartSpec. Exported for unit testing (no I/O). Sorts corridors high→low
 * vacancy, caps at 12, derives a REAL `asOf` from the table's `fetched_at`
 * (never the fabricated `FIXTURE_ASOF`), and passes the corridor_profiles
 * citation through unchanged — so the chart and the analyst prose draw the same
 * per-corridor numbers from ONE source. Returns null when fewer than 3 corridors
 * carry a numeric vacancy or the block fails the chart lint.
 */
export function vacancyChartSpecFromTable(table: BrainOutputDetailTable): ChartSpec | null {
  const rows = table.rows
    .filter((r) => typeof r.cells.vacancy_rate_pct === "number")
    .map((r): [string, number] => [r.label, r.cells.vacancy_rate_pct as number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  if (rows.length < 3) return null;

  const block: ChartBlock = {
    title: "SWFL Corridor Vacancy Rates",
    columns: ["Corridor", "Vacancy (%)"],
    rows,
    chart_type: "bar",
    value_format: "percent",
    asOf: table.source.fetched_at.slice(0, 10), // REAL vintage, not FIXTURE_ASOF
    source: { citation: table.source.citation },
  };

  if (!lintChartBlock(block).ok) return null;
  return { ...block, frameId: "bar-table" };
}

async function buildVacancyChart(): Promise<ChartSpec | null> {
  // ONE source for chart + prose: cre-swfl's deterministic corridor_vacancy
  // detail_table (read off brains/cre-swfl.md). Returns null in the gap between
  // deploying this code and the nightly that first renders the table — the
  // chart simply doesn't paint until the brain carries it (no fixture fallback,
  // which is what used to ship the fabricated future `asOf`).
  const { output } = await fetchBrain("cre-swfl", { tier: 2 });
  const table = output.detail_tables?.find((t) => t.id === "corridor_vacancy");
  if (!table) return null;
  return vacancyChartSpecFromTable(table);
}

async function buildZhviChart(): Promise<ChartSpec | null> {
  const raw = await loadFixture<ZHVIMonth[]>("zhvi-trend.json");

  const data = raw.filter(
    (r): r is ZHVITrendEntry => r.cape_coral != null && r.fort_myers != null && r.naples != null,
  );

  if (data.length < 3) return null;
  const lastMonth = data.reduce((m, r) => (r.month > m ? r.month : m), data[0].month);

  // columns/rows satisfy the ChartBlock contract and are a faithful tabular view;
  // the zhvi-area frame reads `options.data` (the raw ZHVITrendEntry[]) directly.
  return {
    title: "SWFL Home Values (ZHVI)",
    columns: ["month", "cape_coral", "fort_myers", "naples"],
    rows: data.map((e): [string, number, number, number] => [
      e.month,
      e.cape_coral,
      e.fort_myers,
      e.naples,
    ]),
    chart_type: "area",
    value_format: "usd",
    asOf: monthEndIso(lastMonth),
    source: { citation: FIXTURE_SOURCE },
    frameId: "zhvi-area",
    options: { data },
  };
}

async function buildScatterChart(): Promise<ChartSpec | null> {
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

  // `options.data` carries the FULL JoinedCorridorRow[] UNTOUCHED — `permits`
  // (incl. n_current) and the `permits: null` no-coverage marker are preserved so
  // the scatter component's internal filter + tooltip work exactly as before. The
  // columns/rows below exist only to satisfy the ChartBlock type (numeric-first so
  // a degraded fallback still plots); the corridor-scatter frame ignores them.
  return {
    title: "SWFL Corridor Market Scatter",
    columns: ["vacancy_pct", "nnn_asking_rent_per_sqft", "corridor"],
    rows: plottable.map((c): [number, number, string] => [
      c.vacancy_pct as number,
      c.nnn_asking_rent_per_sqft as number,
      c.name,
    ]),
    chart_type: "scatter",
    asOf: FIXTURE_ASOF,
    source: { citation: FIXTURE_SOURCE },
    frameId: "corridor-scatter",
    options: { data: rows },
  };
}
