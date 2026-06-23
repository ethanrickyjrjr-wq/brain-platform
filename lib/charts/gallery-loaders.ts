import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { mapPivotedCityRows, mapPivotedCityYoY } from "@/lib/charts/pivoted-series";
import { mapAirportTotalWithTrend, type AirportMonthRow } from "@/lib/charts/airport-series";
import {
  mapTierIndexed,
  mapTierYoY,
  type TierPivotedRow,
} from "@/lib/charts/tier-divergence-series";
import {
  SWFL_METRO_SERIES,
  REGION_AIR_TRAVEL_SERIES,
  TIER_INDEXED_SERIES,
} from "@/lib/charts/series";
import type { ChartRow, ChartSeriesDef, PivotedCityMonth } from "@/types/viz";
import type { ValueFormat } from "@/lib/charts/format";

type Supabase = ReturnType<typeof createServiceRoleClient>;

export interface LoadedPanel {
  data: ChartRow[];
  asOf?: string;
  error: string | null;
}

export interface GalleryPanel {
  rootId: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  valueFormat: ValueFormat;
  series: ChartSeriesDef[];
  variant?: "line" | "area";
  data: ChartRow[];
  asOf?: string;
  error: string | null;
}

// Exported so page.tsx can use the same tier-yoy series definition.
export const TIER_YOY_SERIES: ChartSeriesDef[] = [
  { key: "luxury_yoy", label: "Luxury homes", color: "#0a8078", dash: "" },
  { key: "starter_yoy", label: "Starter homes", color: "#5bc97a", dash: "8 5" },
];

export async function loadMetros(supabase: Supabase, view: string): Promise<LoadedPanel> {
  try {
    const { data, error } = await supabase
      .schema("data_lake")
      .from(view)
      .select("month, cape_coral, fort_myers, naples")
      .order("month", { ascending: true });
    if (error) return { data: [], asOf: undefined, error: error.message };
    const mapped = mapPivotedCityRows(data as PivotedCityMonth[] | null);
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

export async function loadHomeValueMomentum(supabase: Supabase): Promise<LoadedPanel> {
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

export async function loadTierIndexed(supabase: Supabase): Promise<LoadedPanel> {
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

export async function loadTierYoY(supabase: Supabase): Promise<LoadedPanel> {
  try {
    const { data, error } = await supabase
      .schema("data_lake")
      .from("tier_divergence_pivoted")
      .select("month, median_top_tier, median_bottom_tier")
      .order("month", { ascending: true });
    if (error) return { data: [], asOf: undefined, error: error.message };
    const mapped = mapTierYoY(data as TierPivotedRow[] | null);
    return { data: mapped.entries, asOf: mapped.asOf, error: null };
  } catch (err) {
    return { data: [], asOf: undefined, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadPassengers(supabase: Supabase): Promise<LoadedPanel> {
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

interface PanelConfig {
  rootId: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  valueFormat: ValueFormat;
  series: ChartSeriesDef[];
  variant?: "line" | "area";
  load: (supabase: Supabase) => Promise<LoadedPanel>;
}

// Panel metadata without data — used in the route to know which loader + series to use.
const PANEL_CONFIGS: PanelConfig[] = [
  {
    rootId: "home-values",
    eyebrow: "Southwest Florida",
    title: "Median Home Value",
    subtitle: "Cape Coral · Fort Myers · Naples",
    valueFormat: "usd",
    series: SWFL_METRO_SERIES,
    variant: "area",
    load: (db) => loadMetros(db, "zhvi_pivoted"),
  },
  {
    rootId: "rents",
    eyebrow: "Southwest Florida",
    title: "Median Monthly Rent",
    subtitle: "Cape Coral · Fort Myers · Naples",
    valueFormat: "rent",
    series: SWFL_METRO_SERIES,
    load: (db) => loadMetros(db, "zori_pivoted"),
  },
  {
    rootId: "air-travel",
    eyebrow: "Southwest Florida",
    title: "RSW Airport Passenger Volume",
    subtitle: "Monthly Arrivals + Departures — RSW, with 12-Month Trend",
    valueFormat: "count",
    series: REGION_AIR_TRAVEL_SERIES,
    load: (db) => loadPassengers(db),
  },
  {
    rootId: "home-value-momentum",
    eyebrow: "Southwest Florida",
    title: "Home Value Year-Over-Year Growth",
    subtitle: "Year-over-year change — Cape Coral · Fort Myers · Naples",
    valueFormat: "pct",
    series: SWFL_METRO_SERIES,
    load: (db) => loadHomeValueMomentum(db),
  },
  {
    rootId: "tier-gap",
    eyebrow: "Southwest Florida",
    title: "Luxury vs. Starter Home Price Index",
    subtitle:
      "Each set to 100 in Jan 2019 — regionally the two tiers have risen in near-lockstep (the K-shaped split shows up ZIP by ZIP, not in the median)",
    valueFormat: "index",
    series: TIER_INDEXED_SERIES,
    load: (db) => loadTierIndexed(db),
  },
  {
    rootId: "tier-momentum",
    eyebrow: "Southwest Florida",
    title: "Luxury vs. Starter: Yearly Price Change",
    subtitle:
      "Year-over-year change in each tier's typical price — the two ride the same cycle but trade the lead: starter runs hotter in recoveries, luxury holds firmer in downturns. Both are falling now, luxury a little less.",
    valueFormat: "pct",
    series: TIER_YOY_SERIES,
    load: (db) => loadTierYoY(db),
  },
];

export async function loadGalleryPanel(
  supabase: Supabase,
  rootId: string,
): Promise<GalleryPanel | null> {
  const config = PANEL_CONFIGS.find((p) => p.rootId === rootId);
  if (!config) return null;
  const { data, asOf, error } = await config.load(supabase);
  return {
    rootId: config.rootId,
    eyebrow: config.eyebrow,
    title: config.title,
    subtitle: config.subtitle,
    valueFormat: config.valueFormat,
    series: config.series,
    variant: config.variant,
    data,
    asOf,
    error,
  };
}
