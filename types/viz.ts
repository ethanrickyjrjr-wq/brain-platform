// Shared TypeScript interfaces for all viz components.
// Every component in components/viz/ imports from here.
// Do not duplicate these inline — keep the source of truth here.

export interface CorridorEntry {
  id: string;
  name: string;
  submarket: string;
  nnn_asking_rent_per_sqft: number;
  vacancy_pct: number;
  absorption_sqft: number | null;
  permit_zscore: number;
  saturation_index: number;
  lat: number;
  lng: number;
}

export interface ZHVIMonth {
  month: string; // "YYYY-MM"
  cape_coral: number | null;
  fort_myers: number | null;
  naples: number | null;
}

export interface ZORIEntry {
  zip: string;
  city: string;
  county: string;
  trend: { month: string; rent: number }[];
}

export interface KeyMetric {
  label: string;
  value: string;
  trend: "up" | "down" | "flat";
  change_pct: number;
}

export interface BrainOutput {
  id: string;
  conclusion: string;
  confidence: number; // 0–1
  freshness_token: string;
  updated_at: string;
  sources_count: number;
  key_metrics: KeyMetric[];
  caveats: string[];
}

export interface PermitMonth {
  month: string; // "YYYY-MM"
  zscore: number;
}

export interface PermitHeatmapRow {
  corridor: string;
  months: PermitMonth[];
}

export interface VizStats {
  corridors_tracked: number;
  sqft_analyzed: number;
  data_sources: number;
  swfl_zips: number;
  flood_records: number;
  brain_confidence: number;
}
