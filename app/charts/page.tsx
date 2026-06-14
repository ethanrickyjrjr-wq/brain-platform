import { MetroAreaChart } from "@/components/charts";
import { mapPivotedCityRows, mapPivotedCityYoY } from "@/lib/charts/pivoted-series";
import { mapAirportTotalWithTrend, type AirportMonthRow } from "@/lib/charts/airport-series";
import { mapTierIndexed, type TierPivotedRow } from "@/lib/charts/tier-divergence-series";
import {
  SWFL_METRO_SERIES,
  REGION_AIR_TRAVEL_SERIES,
  TIER_INDEXED_SERIES,
} from "@/lib/charts/series";
import type { ChartRow, ChartSeriesDef, PivotedCityMonth } from "@/types/viz";
import type { ValueFormat } from "@/lib/charts/format";
import { createServiceRoleClient } from "@/utils/supabase/service-role";

export const revalidate = 3600;

type Supabase = ReturnType<typeof createServiceRoleClient>;

interface LoadedPanel {
  data: ChartRow[];
  asOf?: string;
  error: string | null;
}

// 3-metro pivoted view ({ month, cape_coral, fort_myers, naples }).
async function loadMetros(supabase: Supabase, view: string): Promise<LoadedPanel> {
  try {
    const { data, error } = await supabase
      .schema("data_lake")
      .from(view)
      .select("month, cape_coral, fort_myers, naples")
      .order("month", { ascending: true });
    if (error) return { data: [], asOf: undefined, error: error.message };
    // ~136–316 rows per view — a single .select() is safe (well under the 1000-row
    // PostgREST cap). Point a panel at a long ZIP×month view and switch to
    // selectAllPaged (refinery/lib/paginate.mts) instead.
    const mapped = mapPivotedCityRows(data as PivotedCityMonth[] | null);
    // Re-shape into plain ChartRow literals: a MetroTrendEntry interface has no
    // index signature, so it won't assign to ChartRow without this (literals are
    // checked against the index signature and pass cleanly — no `unknown` cast).
    const rows: ChartRow[] = mapped.entries.map((e) => ({
      month: e.month,
      cape_coral: e.cape_coral,
      fort_myers: e.fort_myers,
      naples: e.naples,
    }));
    return { data: rows, asOf: mapped.asOf, error: null };
  } catch (err) {
    return { data: [], asOf: undefined, error: err instanceof Error ? err.message : String(err) };
  }
}

// YoY % momentum derived from the same zhvi_pivoted view — zero new source.
async function loadHomeValueMomentum(supabase: Supabase): Promise<LoadedPanel> {
  try {
    const { data, error } = await supabase
      .schema("data_lake")
      .from("zhvi_pivoted")
      .select("month, cape_coral, fort_myers, naples")
      .order("month", { ascending: true });
    if (error) return { data: [], asOf: undefined, error: error.message };
    const mapped = mapPivotedCityYoY(data as PivotedCityMonth[] | null);
    const rows: ChartRow[] = mapped.entries.map((e) => ({
      month: e.month,
      cape_coral: e.cape_coral,
      fort_myers: e.fort_myers,
      naples: e.naples,
    }));
    return { data: rows, asOf: mapped.asOf, error: null };
  } catch (err) {
    return { data: [], asOf: undefined, error: err instanceof Error ? err.message : String(err) };
  }
}

// Luxury vs. starter home-price tracks, each indexed to 100 at 2019-01
// (data_lake.tier_divergence_pivoted — 363 monthly rows, well under the 1000-row
// PostgREST cap, so a single .select() is safe).
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

// Total-passenger feed with 12-month trend overlay (public.rsw_airport_monthly).
async function loadPassengers(supabase: Supabase): Promise<LoadedPanel> {
  try {
    const { data, error } = await supabase
      .from("rsw_airport_monthly")
      .select("report_month, value")
      .eq("airport_code", "RSW")
      .eq("metric", "total_passengers")
      .order("report_month", { ascending: true });
    if (error) return { data: [], asOf: undefined, error: error.message };
    const mapped = mapAirportTotalWithTrend(data as AirportMonthRow[] | null);
    return { data: mapped.entries, asOf: mapped.asOf, error: null };
  } catch (err) {
    return { data: [], asOf: undefined, error: err instanceof Error ? err.message : String(err) };
  }
}

interface RenderedPanel extends LoadedPanel {
  rootId: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  valueFormat: ValueFormat;
  series: ChartSeriesDef[];
  variant?: "line" | "area";
}

export default async function ChartsPage() {
  const supabase = createServiceRoleClient();
  const [homeValues, rents, passengers, homeValueMomentum, tierIndexed] = await Promise.all([
    loadMetros(supabase, "zhvi_pivoted"),
    loadMetros(supabase, "zori_pivoted"),
    loadPassengers(supabase),
    loadHomeValueMomentum(supabase),
    loadTierIndexed(supabase),
  ]);

  const panels: RenderedPanel[] = [
    {
      rootId: "home-values",
      eyebrow: "Southwest Florida",
      title: "Typical home value",
      subtitle: "Cape Coral · Fort Myers · Naples",
      valueFormat: "usd",
      series: SWFL_METRO_SERIES,
      variant: "area", // filled gradient — the original look the operator liked
      ...homeValues,
    },
    {
      rootId: "rents",
      eyebrow: "Southwest Florida",
      title: "Typical monthly rent",
      subtitle: "Cape Coral · Fort Myers · Naples",
      valueFormat: "rent",
      series: SWFL_METRO_SERIES,
      ...rents,
    },
    {
      rootId: "air-travel",
      eyebrow: "Southwest Florida",
      title: "Air travel through the region",
      subtitle: "Total passengers per month — arrivals + departures, with 12-month trend",
      valueFormat: "count",
      series: REGION_AIR_TRAVEL_SERIES,
      ...passengers,
    },
    {
      rootId: "home-value-momentum",
      eyebrow: "Southwest Florida",
      title: "Home value momentum",
      subtitle: "Year-over-year change — Cape Coral · Fort Myers · Naples",
      valueFormat: "pct",
      series: SWFL_METRO_SERIES,
      ...homeValueMomentum,
    },
    {
      rootId: "tier-gap",
      eyebrow: "Southwest Florida",
      title: "Luxury vs. starter home prices, indexed",
      subtitle:
        "Each set to 100 in Jan 2019 — regionally the two tiers have risen in near-lockstep (the K-shaped split shows up ZIP by ZIP, not in the median)",
      valueFormat: "index",
      series: TIER_INDEXED_SERIES,
      ...tierIndexed,
    },
  ];

  return (
    <main
      style={{
        background: "#0a1419",
        color: "#f0ede6",
        minHeight: "100dvh",
        padding: "32px",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "960px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
        }}
      >
        <header>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#f0ede6" }}>
            Southwest Florida — Market Trends
          </h1>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              color: "#807e76",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            Home values, rents, air travel, and market momentum across Lee and Collier County.
          </p>
        </header>

        {panels.map((panel) => (
          <MetroAreaChart
            key={panel.rootId}
            data={panel.data}
            series={panel.series}
            variant={panel.variant}
            asOf={panel.asOf}
            eyebrow={panel.eyebrow}
            title={panel.title}
            subtitle={panel.subtitle}
            valueFormat={panel.valueFormat}
            rootId={`${panel.rootId}-chart`}
            emptyTitle={panel.error ? "Data unavailable" : "No data yet"}
            emptyHint={
              panel.error
                ? panel.error
                : `No ${panel.title.toLowerCase()} to graph yet — check back after the next refresh.`
            }
          />
        ))}
      </div>
    </main>
  );
}
