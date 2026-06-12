// scripts/email/types.ts

export const ZIP_FOCUS = ["33908", "33919", "33912", "33907", "33931", "33914"] as const;
export type FocusZip = (typeof ZIP_FOCUS)[number];

/** Per-ZIP or county-level metric snapshot stored in the log for DELTA. */
export interface ZipMetricSnapshot {
  median_sale_price: number | null;
  dom: number | null;
  months_of_supply: number | null;
  /** 0–1 scale (e.g. 0.97 = 97%). */
  avg_sale_to_list: number | null;
  /** 0–1 scale. */
  sold_above_list_pct: number | null;
  inventory: number | null;
  /** Number of sales in the period — used for transaction floor check. */
  sale_count_period: number | null;
}

/** Per-section freshness citations. Replaces a single global freshness_token. */
export interface FreshnessManifest {
  master: { token: string; as_of: string };
  housing_swfl: { token: string; as_of: string; period_begin: string };
  city_pulse: { token: string; as_of: string };
  lee_cre: { token: string; as_of: string } | null;
  /** "preview" = dry run, must NOT stamp live-lake provenance. */
  source_env: "live" | "preview";
}

export interface CityVoiceSignal {
  topic: "breaking" | "transactions" | "development" | "business" | "structural";
  title: string;
  source_url: string;
  city: string;
}

/** All data needed to render the email. Built by fetch-digest-data.mts. */
export interface DigestPayload {
  date: string;
  freshness_manifest: FreshnessManifest;
  /** 2–3 sentence market pulse from master brain. */
  top_line: string;
  zip_metrics: Record<string, ZipMetricSnapshot>;
  county_metrics: ZipMetricSnapshot;
  /** Sorted by topic priority: breaking first. Max 4. */
  city_voices: CityVoiceSignal[];
  top_story: { title: string; slug: string; topic: string } | null;
}

/** Written to email-logs/YYYY-MM-DD.json after every send attempt. */
export interface EmailLog {
  date: string;
  last_send_date: string;
  issue: number;
  subject: string;
  freshness_manifest: FreshnessManifest;
  top_story: { title: string; slug: string; topic: string } | null;
  zip_metrics: Record<string, ZipMetricSnapshot>;
  county_metrics: ZipMetricSnapshot;
  signals_surfaced: string[];
  cta_url: string;
  send_status: "sent" | "skipped" | "error";
  send_error: string | null;
  recipients: number;
}

/** Computed delta for one metric, with Rule 5 polarity framing. */
export interface MetricDelta {
  metric: keyof ZipMetricSnapshot;
  current: number;
  previous: number;
  pct_change: number;
  is_escalation: boolean;
  direction_framing: "bullish" | "bearish" | "context";
}

// ── Brand theme (white-label) ───────────────────────────────────────────────
// Structurally identical to lib/deliverable/brand-theme.ts `BrandTheme` so the
// funnel's extractBrandTheme() output (Brandfetch / manual blob) drops in with
// ZERO adapter. Defined here — not imported — to keep this Bun email script free
// of the chart-registry dependency graph that brand-theme.ts pulls in.
export interface BrandTheme {
  /** Header band, CTA button, big stat numbers, badge/masthead accents. */
  primary: string | null;
  /** Section labels, links, top rule, [source] links. */
  accent: string | null;
  /** Bounded <Img> in the header; omitted when null. */
  logoUrl: string | null;
}

/** SWFL Data Gulf house brand — the default when no white-label theme is passed. */
export const SWFL_THEME = { primary: "#0F2035", accent: "#1BB8C9", logoUrl: null } as const;

/** Merge a nullable/partial theme over the SWFL defaults. Null/undefined fields fall back. */
export function resolveTheme(theme?: BrandTheme | null): {
  primary: string;
  accent: string;
  logoUrl: string | null;
} {
  return {
    primary: theme?.primary ?? SWFL_THEME.primary,
    accent: theme?.accent ?? SWFL_THEME.accent,
    logoUrl: theme?.logoUrl ?? SWFL_THEME.logoUrl,
  };
}
