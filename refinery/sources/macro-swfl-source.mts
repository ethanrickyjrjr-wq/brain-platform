import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * macro-swfl source connector — FRED (Federal Reserve Economic Data) series
 * focused on the macro context an SWFL operator actually cares about:
 * funding rates (SOFR), Florida labor market (FLUR + FL LFPR via LBSSA12),
 * and headline inflation (CPI YoY via CPIAUCSL with units=pc1).
 *
 * Trust tier: 1 (FRED is a primary federal source).
 *
 * Live mode hits `https://api.stlouisfed.org/fred/series/observations` once
 * per series. Fixture mode (REFINERY_SOURCE=fixture) reads the committed
 * sample. The fixture and the live mapping both return normalized fragments
 * keyed by `series_id` ∈ { SOFR, FLUR, CPIAUCSL_YOY, FLLFPR } so the pack's
 * METRIC_MAP stays unchanged regardless of source mode.
 */

const SOURCE_ID = "fred_macro";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "macro-swfl.sample.json",
);

/** Normalized macro indicator — what Stage 2 / Stage 3 see. */
export interface MacroSwflNormalized {
  kind: "macro-indicator";
  /** Stable id used by the pack's METRIC_MAP — see FRED_SERIES below */
  series_id: string;
  label: string;
  value: number;
  unit: string;
  period: string;
  direction: "rising" | "falling" | "stable";
  context: string;
  /**
   * Canonical receipt URL for the underlying source. In live mode this is the
   * FRED observations endpoint for the actual queried fred_id (api_key stripped
   * so the URL is shareable). In fixture mode this is a `fixture://` scheme URI
   * pinned to the file + series_id. The pack's outputProducer uses this as the
   * per-metric BrainOutputMetricSource.url so a disputant can trace any value
   * back to the exact federal series query that produced it.
   */
  source_url: string;
}

// ---------------------------------------------------------------------
// FRED live mapping. The `key` is the normalized id the pack expects; the
// `fred_id` is what we actually query; `units` is the FRED transformation
// applied. CPIAUCSL with units=pc1 returns year-over-year % change, which
// is the form the pack wants (CPIAUCSL_YOY).
// ---------------------------------------------------------------------
interface FredSpec {
  /** key under which this series surfaces to the pack */
  key: "SOFR" | "FLUR" | "CPIAUCSL_YOY" | "FLLFPR";
  /** FRED series id we actually hit */
  fred_id: string;
  /** FRED transformation: "lin" = level, "pc1" = year-over-year % */
  units: "lin" | "pc1";
  label: string;
  unit: string;
  /** Editorial note appended to the normalized context */
  context: string;
}

const FRED_SERIES: FredSpec[] = [
  {
    key: "SOFR",
    fred_id: "SOFR",
    units: "lin",
    label: "Secured Overnight Financing Rate",
    unit: "percent_annualized",
    context:
      "SOFR is the floor for floating-rate CRE debt — direction of travel sets how repricing pressure runs through SWFL portfolios.",
  },
  {
    key: "FLUR",
    fred_id: "FLUR",
    units: "lin",
    label: "Florida Unemployment Rate",
    unit: "percent",
    context:
      "Florida unemployment is the headline labor-tightness read for SWFL operators — tourism and construction absorb new entrants when this stays low.",
  },
  {
    key: "CPIAUCSL_YOY",
    fred_id: "CPIAUCSL",
    units: "pc1",
    label: "US CPI (All Items) Year-over-Year",
    unit: "percent",
    context:
      "Headline CPI YoY is the inflation reading the Fed targets at 2% — shelter is the remaining sticky component most of 2026.",
  },
  {
    key: "FLLFPR",
    fred_id: "LBSSA12",
    units: "lin",
    label: "Florida Labor Force Participation Rate",
    unit: "percent",
    context:
      "FL LFPR climbs against retirement-state demographic gravity — a positive read on Florida's working-age engagement.",
  },
];

interface FredObservation {
  date: string; // YYYY-MM-DD
  value: string; // numeric or "." for missing
}

interface FredResponse {
  observations?: FredObservation[];
}

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

async function fetchFredSeries(spec: FredSpec): Promise<FredObservation[]> {
  const key = env.fredApiKey;
  if (!key) {
    throw new Error(
      "macro-swfl-source: FRED_API_KEY not set. Add it to .env.local or run with REFINERY_SOURCE=fixture.",
    );
  }
  const url =
    `${FRED_BASE}?series_id=${spec.fred_id}` +
    `&units=${spec.units}` +
    `&api_key=${key}` +
    `&file_type=json` +
    `&sort_order=desc` +
    `&limit=24`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `macro-swfl-source: FRED ${spec.fred_id} returned HTTP ${res.status} — check key validity and series id.`,
    );
  }
  const data = (await res.json()) as FredResponse;
  const obs = (data.observations ?? []).filter((o) => o.value !== ".");
  if (obs.length === 0) {
    throw new Error(
      `macro-swfl-source: FRED ${spec.fred_id} returned no usable observations.`,
    );
  }
  return obs; // descending by date
}

/** Latest value vs. ~6-period-ago value → categorical direction. */
function computeDirection(
  observations: FredObservation[],
): MacroSwflNormalized["direction"] {
  if (observations.length < 2) return "stable";
  const latest = parseFloat(observations[0].value);
  const compareIdx = Math.min(observations.length - 1, 6);
  const prior = parseFloat(observations[compareIdx].value);
  if (!Number.isFinite(latest) || !Number.isFinite(prior) || prior === 0) {
    return "stable";
  }
  const relChange = (latest - prior) / Math.abs(prior);
  if (relChange > 0.02) return "rising";
  if (relChange < -0.02) return "falling";
  return "stable";
}

/** FRED receipt URL — api_key stripped so the URL is reproducible by any reader. */
function fredReceiptUrl(spec: FredSpec): string {
  return (
    `${FRED_BASE}?series_id=${spec.fred_id}` +
    `&units=${spec.units}` +
    `&file_type=json` +
    `&sort_order=desc` +
    `&limit=24`
  );
}

async function liveFred(): Promise<MacroSwflNormalized[]> {
  const series = await Promise.all(
    FRED_SERIES.map(async (spec): Promise<MacroSwflNormalized> => {
      const obs = await fetchFredSeries(spec);
      const latest = obs[0];
      const value = parseFloat(latest.value);
      return {
        kind: "macro-indicator",
        series_id: spec.key,
        label: spec.label,
        value,
        unit: spec.unit,
        period: latest.date,
        direction: computeDirection(obs),
        context: spec.context,
        source_url: fredReceiptUrl(spec),
      };
    }),
  );
  return series;
}

function isDirection(s: unknown): s is MacroSwflNormalized["direction"] {
  return s === "rising" || s === "falling" || s === "stable";
}

function normalizeFixtureRow(
  row: Record<string, unknown>,
): MacroSwflNormalized {
  const direction = isDirection(row.direction) ? row.direction : "stable";
  const series_id = String(row.series_id ?? "");
  const spec = FRED_SERIES.find((s) => s.key === series_id);
  const source_url = spec
    ? fredReceiptUrl(spec)
    : `fixture://refinery/__fixtures__/macro-swfl.sample.json#${series_id}`;
  return {
    kind: "macro-indicator",
    series_id,
    label: String(row.label ?? ""),
    value: Number(row.value),
    unit: String(row.unit ?? ""),
    period: String(row.period ?? ""),
    direction,
    context: String(row.context ?? ""),
    source_url,
  };
}

async function loadFixtureRows(): Promise<MacroSwflNormalized[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const data = JSON.parse(raw) as
    | { rows?: unknown[]; data?: unknown[] }
    | unknown[];
  const rows: unknown[] = Array.isArray(data)
    ? data
    : (data.rows ?? data.data ?? []);
  return (rows as Record<string, unknown>[]).map(normalizeFixtureRow);
}

export const macroSwflSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1, // FRED = Federal Reserve, primary federal source
  async fetch(): Promise<RawFragment[]> {
    const indicators =
      env.source === "fixture" ? await loadFixtureRows() : await liveFred();
    const fetched_at = isoTimestamp();
    return indicators.map(
      (normalized): RawFragment<MacroSwflNormalized> => ({
        fragment_id: fragmentId(SOURCE_ID, normalized.series_id),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: { series_id: normalized.series_id, period: normalized.period },
        normalized,
      }),
    );
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? "FRED — Federal Reserve Economic Data (fixture; SOFR, FLUR, CPIAUCSL YoY, LBSSA12)"
          : "FRED — Federal Reserve Economic Data (live API; SOFR, FLUR, CPIAUCSL YoY, LBSSA12)",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
