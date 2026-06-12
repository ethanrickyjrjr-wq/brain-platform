import fs from "node:fs/promises";
import path from "node:path";
import { CorridorRentChart, ZHVIAreaChart, CorridorMarketScatter } from "@/components/charts";
import { CORRIDOR_ALIASES } from "@/refinery/lib/corridor-aliases.mts";
import type {
  CorridorEntry,
  CorridorPermitsEntry,
  CorridorCentroidEntry,
  JoinedCorridorRow,
  ZHVIMonth,
  ZHVITrendEntry,
} from "@/types/viz";
import { composeCorridorCharacterRender } from "@/refinery/render/corridor-character.mts";
import { ChartBlockView } from "@/components/charts/ChartBlockView";
import type { ChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { parseBrainMarkdown } from "@/refinery/render/speaker.mts";
import type { NfipZipAggregate } from "@/refinery/sources/fema-nfip-source.mts";
import { adaptFloodZipsToHBar } from "@/refinery/lib/chart-adapter.mts";
import { HBarChart } from "@/components/charts/HBarChart";

export const revalidate = 3600;

const ZIP_AAL_METRIC = /^swfl_zip_(\d{5})_flood_aal_usd_per_insured_property$/;

async function loadFloodZips(): Promise<NfipZipAggregate[]> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "brains", "env-swfl.md"), "utf-8");
    const brain = parseBrainMarkdown(raw);
    // Index county label from the metric label, e.g. "33957 (Lee County) per-insured..."
    const countyByZip = new Map<string, string>();
    const aalByZip = new Map<string, number>();
    for (const m of brain.output.key_metrics) {
      const aalMatch = ZIP_AAL_METRIC.exec(m.metric);
      if (aalMatch) {
        const zip = aalMatch[1];
        aalByZip.set(zip, m.value as number);
        // Extract county name from label: "33957 (Lee County) per-insured..."
        const countyMatch = /\(([^)]+)\)/.exec(m.label ?? "");
        if (countyMatch) countyByZip.set(zip, countyMatch[1]);
      }
    }
    return Array.from(aalByZip.entries()).map(([zip, aal]) => ({
      kind: "nfip-zip-aggregate" as const,
      zip,
      county_code: "",
      county_name: countyByZip.get(zip) ?? "",
      aal_usd_per_insured_property: aal,
      aal_pct_swfl_rank: 0,
      median_building_property_value_usd: 0,
      claim_count_in_window: 0,
      window_years: 10,
      window_end_year: 0,
      insured_denominator: 0,
      insured_denominator_basis: "",
      paid_total_in_window_usd: 0,
    }));
  } catch {
    return [];
  }
}

async function loadFixture<T>(name: string): Promise<T> {
  const file = path.join(process.cwd(), "fixtures", name);
  const raw = await fs.readFile(file, "utf-8");
  return JSON.parse(raw) as T;
}

async function loadFixtureOptional<T>(name: string): Promise<T | null> {
  try {
    return await loadFixture<T>(name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Single canonical join site for the three corridor fixtures. Walks the
 * alias table in `refinery/lib/corridor-aliases.mts` — never falls back to
 * fuzzy string matching. The alias-coverage test guarantees every rent row
 * has an explicit entry (string for Lee, null for Collier), so a row whose
 * alias resolves to `undefined` is a bug, not a no-coverage signal.
 *
 * `corridor-permits.json` is currently absent on disk because the live
 * `npm run refinery permits-swfl` run is blocked on Accela ingest (see the
 * TODO at the top of `brains/permits-swfl.md`). The viz components handle
 * `permits: null` as "no permits coverage" — same treatment Collier rows
 * get permanently. When Accela ships and the sidecar lands, all 16 Lee
 * rows light up automatically.
 */
function joinCorridors(
  rents: CorridorEntry[],
  permits: CorridorPermitsEntry[],
  centroids: CorridorCentroidEntry[],
): JoinedCorridorRow[] {
  const permitsById = new Map(permits.map((p) => [p.corridor_id, p]));
  const centroidsById = new Map(centroids.map((c) => [c.corridor_id, c]));
  return rents.map((row) => {
    const centroidId = CORRIDOR_ALIASES[row.id];
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
}

export default async function EmbedChartsPage() {
  const corridorCharts: Array<{ name: string; chart: ChartBlock }> = [];
  try {
    const supabase = createServiceRoleClient();
    const { data } = await supabase
      .from("corridor_profiles")
      .select("corridor_name, character_chart, character_facts, character_speculative")
      .is("deleted_at", null);

    if (data) {
      for (const row of data) {
        const rendered = composeCorridorCharacterRender({
          characterFacts: row.character_facts as string | null,
          characterSpeculative: row.character_speculative as string | null,
          characterChart: row.character_chart,
        });
        if (rendered.chart) {
          corridorCharts.push({
            name: row.corridor_name as string,
            chart: rendered.chart,
          });
        }
      }
    }
  } catch {
    // degrade silently — page still renders without chart data
  }

  const [zhviRaw, rents, permits, centroids, floodZips] = await Promise.all([
    loadFixture<ZHVIMonth[]>("zhvi-trend.json"),
    loadFixture<CorridorEntry[]>("corridor-rents.json"),
    loadFixtureOptional<CorridorPermitsEntry[]>("corridor-permits.json"),
    loadFixture<CorridorCentroidEntry[]>("corridor-centroids.json"),
    loadFloodZips(),
  ]);
  const floodChartProps = floodZips.length > 0 ? adaptFloodZipsToHBar(floodZips) : null;

  const zhvi: ZHVITrendEntry[] = zhviRaw.filter(
    (m): m is ZHVITrendEntry => m.cape_coral != null && m.fort_myers != null && m.naples != null,
  );

  const joined = joinCorridors(rents, permits ?? [], centroids);
  const withPermits = joined.filter((r) => r.permits != null).length;
  const noCoverage = joined.length - withPermits;

  return (
    <main
      style={{
        background: "#0A1419",
        color: "#F0EDE6",
        minHeight: "100dvh",
        padding: "32px",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))",
          gap: "24px",
          maxWidth: "1280px",
          margin: "0 auto",
        }}
      >
        <section
          style={{
            background: "#152832",
            border: "1px solid #22414F",
            borderRadius: 12,
            padding: 24,
          }}
        >
          <header style={{ marginBottom: 16 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                color: "#F0EDE6",
              }}
            >
              Home values across SWFL
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "#807E76",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              Zillow ZHVI · Cape Coral · Fort Myers · Naples
            </p>
          </header>
          <ZHVIAreaChart data={zhvi} loading={false} />
        </section>

        <section
          style={{
            background: "#152832",
            border: "1px solid #22414F",
            borderRadius: 12,
            padding: 24,
          }}
        >
          <header style={{ marginBottom: 16 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                color: "#F0EDE6",
              }}
            >
              CRE corridor asking rents
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "#807E76",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {joined.length} corridors · NNN $/sqft · click a bar for detail
            </p>
          </header>
          <CorridorRentChart data={joined} loading={false} />
        </section>

        <section
          style={{
            background: "#152832",
            border: "1px solid #22414F",
            borderRadius: 12,
            padding: 24,
            gridColumn: "1 / -1",
          }}
        >
          <header style={{ marginBottom: 16 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                color: "#F0EDE6",
              }}
            >
              CRE corridor market scatter
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "#807E76",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {withPermits} Lee corridors plotted · {noCoverage} Collier corridors hidden (no
              permits coverage — see docs/data-coverage.md)
            </p>
          </header>
          <CorridorMarketScatter data={joined} loading={false} />
        </section>

        {floodChartProps && (
          <section
            style={{
              background: "#152832",
              border: "1px solid #22414F",
              borderRadius: 12,
              padding: 24,
            }}
          >
            <header style={{ marginBottom: 16 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 600,
                  color: "#F0EDE6",
                }}
              >
                Flood loss by ZIP
              </h2>
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 13,
                  color: "#807E76",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                NFIP · 10-yr AAL per insured property · SWFL top ZIPs
              </p>
            </header>
            <HBarChart {...floodChartProps} />
          </section>
        )}

        {corridorCharts.length > 0 && (
          <section
            style={{
              background: "#152832",
              border: "1px solid #22414F",
              borderRadius: 12,
              padding: 24,
              gridColumn: "1 / -1",
            }}
          >
            <header style={{ marginBottom: 16 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 600,
                  color: "#F0EDE6",
                }}
              >
                Corridor character charts
              </h2>
            </header>
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {corridorCharts.map(({ name, chart }) => (
                <div key={name}>
                  <ChartBlockView block={chart} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
