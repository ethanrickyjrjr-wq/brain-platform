import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ChartIntent } from "@/lib/route-chart";
import type { ChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import { lintChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import type { ChartSpec } from "@/components/charts/registry/chart-spec";
import { CORRIDOR_ALIASES } from "@/refinery/lib/corridor-aliases.mts";
import { fetchBrain } from "@/lib/fetch-brain";
import { loadMetroTrend } from "@/lib/charts/load-metro-trend";
import type { BrainOutputDetailTable } from "@/refinery/types/brain-output.mts";
import type {
  CorridorEntry,
  CorridorPermitsEntry,
  CorridorCentroidEntry,
  JoinedCorridorRow,
  ChartRow,
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

/**
 * Pure mapping: live `data_lake.zhvi_pivoted` rows (month + 3 metros) → a ZHVI area
 * ChartSpec. Exported for unit testing with no I/O (mirrors `vacancyChartSpecFromTable`:
 * the live read lives in `buildZhviChart`, the mapping is tested here deterministically).
 * Drops incomplete months, derives a REAL `asOf` from the newest covered month, and
 * returns null when fewer than 3 complete months are present.
 */
/**
 * Render a drawn chart's REAL figures as a compact, customer-clean grounding block so the
 * model narrates the chart from TRUTH, never invented numbers. Without this, telling the
 * model "a SWFL Home Values chart is on screen" while grounding it ONLY on cre-swfl made it
 * hallucinate home-value dollar figures (a moat violation that scored "clean" on the
 * deflection/leak detectors). The chart carries the deterministic numbers; this hands the
 * narrator the endpoints + peak so any figure it states is real and cited, and an in-between
 * month defers to the chart. (Brain-factory rule 2: deterministic math, narrative prose.)
 */
export function summarizeChartForGrounding(chart: ChartSpec): string {
  const src = chart.source?.citation ? ` Source: ${chart.source.citation}.` : "";
  if (chart.frameId === "zhvi-area") {
    const data = (chart.options?.data ?? []) as ZHVITrendEntry[];
    if (data.length === 0) return `${chart.title}.${src}`;
    const first = data[0];
    const last = data[data.length - 1];
    const cities: Array<[string, keyof ZHVITrendEntry]> = [
      ["Cape Coral", "cape_coral"],
      ["Fort Myers", "fort_myers"],
      ["Naples", "naples"],
    ];
    const lines = cities.map(([name, key]) => {
      const series = data.map((d) => d[key] as number);
      const max = Math.max(...series);
      const maxMonth = data[series.indexOf(max)].month;
      const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
      return `- ${name}: ${fmt(first[key] as number)} (${first.month}) to ${fmt(last[key] as number)} (${last.month}); peak ${fmt(max)} (${maxMonth}).`;
    });
    return (
      `${chart.title} — the chart now on screen, monthly ${first.month} through ${last.month}.${src}\n` +
      lines.join("\n") +
      `\nThese are the ONLY home-value figures you may state; for any in-between month, say "see the chart" rather than name a number. Never invent a home-value figure.`
    );
  }
  if (Array.isArray(chart.rows) && chart.rows.length > 0) {
    const lines = chart.rows.slice(0, 12).map((r) => `- ${r[0]}: ${r[1]}`);
    const through = chart.asOf ? ` Data through ${chart.asOf}.` : "";
    return (
      `${chart.title} — the chart now on screen.${through}${src}\n` +
      lines.join("\n") +
      `\nState ONLY these figures; never invent one not listed here.`
    );
  }
  return `${chart.title}.${chart.asOf ? ` Data through ${chart.asOf}.` : ""}${src}`;
}

export function zhviChartSpecFromRows(rows: ChartRow[], asOf?: string): ChartSpec | null {
  // filter + map (NOT a `r is ZHVITrendEntry` type predicate): ZHVITrendEntry lacks
  // ChartRow's string index signature, so a predicate is not assignable to the param type
  // and `next build` rejects it (tsconfig's include is *.ts/*.tsx, so a local
  // `tsc -p tsconfig.json` skips this .mts — only the Next import-graph check catches it).
  const data: ZHVITrendEntry[] = rows
    .filter(
      (r) =>
        typeof r.cape_coral === "number" &&
        typeof r.fort_myers === "number" &&
        typeof r.naples === "number",
    )
    .map((r) => ({
      month: r.month,
      cape_coral: r.cape_coral as number,
      fort_myers: r.fort_myers as number,
      naples: r.naples as number,
    }));
  if (data.length < 3 || !asOf) return null;

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
    asOf: monthEndIso(asOf), // REAL latest covered month from the live view
    source: { citation: "Zillow Home Value Index (ZHVI)" },
    frameId: "zhvi-area",
    options: { data },
  };
}

async function buildZhviChart(): Promise<ChartSpec | null> {
  // LIVE home values from `data_lake.zhvi_pivoted` — the SAME view /charts reads — NOT the
  // old `fixtures/zhvi-trend.json`, which stamped a fabricated `asOf` and sample numbers
  // (a no-invention moat hole on a customer-facing chart, and the reason "Chart home values
  // over time" could never draw REAL data). `loadMetroTrend` guards missing lake creds →
  // empty (no throw), so a credless env degrades to "no chart", never a 500.
  const { data: rows, asOf } = await loadMetroTrend("zhvi_pivoted");
  return zhviChartSpecFromRows(rows, asOf);
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
