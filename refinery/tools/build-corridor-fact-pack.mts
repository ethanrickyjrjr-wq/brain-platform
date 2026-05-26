/**
 * Corridor character generator — Stage A: fact pack builder.
 *
 * Pure function. No network. Given already-filtered rows for ONE corridor
 * (corridor_profiles row + the data_lake.* slices that overlap it), returns
 * the structured fact pack Stage C feeds to the synthesis model.
 *
 * Plan of record:
 *   docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md
 *   — Step 2 / Stage A.
 *
 * Why pure: the file Stage C imports must be deterministic and unit-testable.
 * Supabase orchestration (mapping a corridor to its ZIPs / submarket /
 * roadway segments / county FIPS, fetching the rows, computing the BLS LAUS
 * summary) lives in the Stage C wrapper, not here.
 *
 * Output shape: structured JSON. Two regions per metric — `current` (latest
 * value verbatim with units + source_url + vintage) and `important_math`
 * (zero-or-more decision-relevant derived numbers — YoY deltas, trailing-6mo
 * direction, etc.). Missing data is NOT silently dropped: every metric carries
 * `{value: null, gap_reason: "..."}` when the input row is missing or out of
 * scope. The facts block stays silent on nulls; the speculative block treats
 * them as inference prompts.
 *
 * Per the plan's non-negotiable rule 3, the indicators computed here are the
 * ones we know are decision-relevant at top-of-corridor:
 *   - YoY delta on cap_rate / vacancy / asking_rent (when prior quarter present)
 *   - permit-volume trailing-6mo direction (Lee only; Collier gets gap_reason)
 *   - BLS LAUS county-trend direction (YoY delta on unemployment_rate)
 *   - ZORI YoY rent change (rolled across the corridor's ZIPs)
 *   - NFIP claim frequency direction (multi-year)
 * We do NOT pre-compute every conceivable comparison — consumer-Claude does
 * live arithmetic on raw values when the user asks something we didn't
 * anticipate.
 */

import type {
  CorridorNormalized,
  CorridorMetricDirection,
} from "../sources/cre-source.mts";
import type { MarketbeatSwflNormalized } from "../sources/marketbeat-swfl-source.mts";
import type { LausSwflSummary } from "../sources/bls-laus-source.mts";

// ── Types ────────────────────────────────────────────────────────────────────

/** A single value carried into the fact pack — verbatim, never rounded or softened. */
export interface FactValue<T = number> {
  /** The value. `null` when the input is missing or out of scope. */
  value: T | null;
  /** Unit suffix the facts block must restate verbatim (e.g. "%", "pp", "$/sqft NNN", "sqft", "permits", "claims"). */
  unit: string;
  /** Source URL — corridor_profiles.{metric}_source_url or row source_url or the source connector's primary URL. */
  source_url: string | null;
  /** Human-readable source label for citations (e.g. "corridor_profiles.cap_rate_pct", "data_lake.bls_laus (LAUCN12071, measure 03, 2026-04)"). */
  source_label: string;
  /** ISO date or "YYYY-MM" / "YYYY-Qn" of the value's vintage. `null` if the row carried no period anchor. */
  vintage: string | null;
  /** Present only when `value` is null. One-line reason ("Collier County not in lee_building_permits ingest", "marketbeat_swfl row missing prior-year quarter"). */
  gap_reason?: string;
}

/** One computed delta or trend — every input it consumed is exposed. */
export interface ImportantMath {
  /** Stable identifier — Stage C uses it to thread inline citations. */
  label: string;
  /** Computed value. `null` when an input was missing. */
  value: number | null;
  /** Unit ("pp", "%", "$/sqft", "sqft", "permits", "claims/yr"). */
  unit: string;
  /** Direction tag, when applicable. */
  direction: "rising" | "falling" | "stable" | null;
  /** Plain-English description of the computation ("2026-Q1 minus 2025-Q1", "trailing-6mo count vs. prior-6mo count"). */
  computation: string;
  /** Inputs the math consumed — preserved so the facts block can cite them. */
  inputs: Array<{ ref: string; value: number | null; vintage: string | null }>;
  /** Present when the math could not be computed. */
  gap_reason?: string;
}

/** Per-metric bundle: a `current` reading + zero-or-more derived `important_math` rows. */
export interface MetricFact {
  current: FactValue;
  important_math: ImportantMath[];
}

/** Prior-run continuity context (read from corridor_profiles by Stage C). */
export interface PriorQuarterContext {
  /** Whatever character_facts held on the prior run (verbatim). `null` first run. */
  character_facts: string | null;
  /** Whatever character_speculative held on the prior run (verbatim). `null` first run. */
  character_speculative: string | null;
  /** When the prior row was generated. `null` if unknown. */
  generated_at: string | null;
  /** "OLDEST-YYYY-MM" marker of the prior run's inputs. */
  fact_pack_vintage: string | null;
}

/** One ZORI ZIP-level reading the caller pre-filtered for this corridor. */
export interface ZoriCorridorRow {
  zip_code: string;
  period_end: string; // ISO date
  rent_index: number;
}

/** One NFIP claim summary row (year-rolled) the caller pre-filtered. */
export interface NfipCorridorYearRow {
  year_of_loss: number;
  claim_count: number;
  is_storm_year: boolean;
}

/** One pre-filtered Lee building permits row (Lee only). */
export interface LeePermitCorridorRow {
  permit_id: string;
  issued_date: string; // ISO date
  bucket: string;
}

/** One pre-filtered FDOT AADT segment overlapping the corridor. */
export interface FdotAadtCorridorRow {
  year: number;
  county: string;
  roadway: string;
  aadt: number;
  shape_length: number;
}

/** Everything Stage C hands the fact-pack builder for ONE corridor. */
export interface BuildFactPackInput {
  /** The corridor_profiles row (already passed through normalizeCorridor). */
  corridor: CorridorNormalized;
  /**
   * MarketBeat rows for the corridor's submarket, sorted oldest → newest.
   * Caller resolves submarketFor(corridor.name) and pulls every verified row
   * (not just the latest). YoY math needs the prior-year same-quarter row.
   */
  marketbeat_submarket_rows: MarketbeatSwflNormalized[];
  /** BLS LAUS county-level summary (already computed by buildLausSwflSummary). */
  bls_laus: LausSwflSummary | null;
  /** ZORI readings within the corridor's ZIPs, sorted oldest → newest. */
  zori_rows: ZoriCorridorRow[];
  /** NFIP year-rolled counts within the corridor scope, sorted oldest → newest. */
  nfip_year_rows: NfipCorridorYearRow[];
  /** Lee building permits intersecting the corridor (empty for Collier — gap_reason fires). */
  lee_permits: LeePermitCorridorRow[];
  /** FDOT AADT segments overlapping the corridor (length-weighted average computed here). */
  fdot_aadt_rows: FdotAadtCorridorRow[];
  /** Optional prior-run continuity context. */
  prior_quarter_context: PriorQuarterContext | null;
  /** UTC timestamp of the run that's building this pack. Stage C passes new Date().toISOString(). */
  generated_at: string;
}

/** The final structured fact pack Stage C feeds to the synthesis model. */
export interface CorridorFactPack {
  corridor_name: string;
  city: string;
  county: "Lee" | "Collier" | "Unknown";
  corridor_type: string;
  generated_at: string;
  /** "OLDEST-YYYY-MM" — the oldest non-null vintage across every consumed fact. */
  fact_pack_vintage: string;
  metrics: {
    cap_rate: MetricFact;
    vacancy_rate: MetricFact;
    absorption_sqft: MetricFact;
    asking_rent_psf: MetricFact;
    unemployment_rate: MetricFact;
    zori_rent_index: MetricFact;
    permits_trailing_6mo: MetricFact;
    nfip_claim_frequency: MetricFact;
    fdot_aadt: MetricFact;
  };
  prior_quarter_context: PriorQuarterContext | null;
}

// ── Internal helpers ────────────────────────────────────────────────────────

const COUNTY_PRIMARY_SOURCE: Record<"Lee" | "Collier" | "Unknown", string> = {
  Lee: "https://www.bls.gov/lau/",
  Collier: "https://www.bls.gov/lau/",
  Unknown: "",
};

/** Round to 2 decimals, preserving null. */
function r2(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/** Direction classifier for a delta, with a small-magnitude band that maps to "stable". */
function classifyDirection(
  delta: number | null,
  stableBandAbs: number,
): "rising" | "falling" | "stable" | null {
  if (delta == null) return null;
  if (Math.abs(delta) < stableBandAbs) return "stable";
  return delta > 0 ? "rising" : "falling";
}

/** Extract "YYYY-MM" from a "YYYY-Qn" period (Q1→01, Q2→04, Q3→07, Q4→10 — first month of the quarter). */
function quarterToMonth(quarter: string): string | null {
  const m = quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const qToMonth: Record<string, string> = {
    "1": "01",
    "2": "04",
    "3": "07",
    "4": "10",
  };
  return `${m[1]}-${qToMonth[m[2]]}`;
}

/** Extract "YYYY-MM" from an arbitrary anchor string ("YYYY-MM-DD", "YYYY-Qn", "YYYY-MM"). Returns null if unparseable. */
function anchorToYearMonth(anchor: string | null): string | null {
  if (anchor == null) return null;
  const iso = anchor.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  return quarterToMonth(anchor);
}

/** Scan every consumed FactValue.vintage and pick the OLDEST "YYYY-MM"; "OLDEST-UNKNOWN" if none. */
function computeFactPackVintage(metrics: CorridorFactPack["metrics"]): string {
  const anchors: string[] = [];
  for (const m of Object.values(metrics)) {
    const a = anchorToYearMonth(m.current.vintage);
    if (a) anchors.push(a);
    for (const im of m.important_math) {
      for (const inp of im.inputs) {
        const ia = anchorToYearMonth(inp.vintage);
        if (ia) anchors.push(ia);
      }
    }
  }
  if (anchors.length === 0) return "OLDEST-UNKNOWN";
  anchors.sort();
  return `OLDEST-${anchors[0]}`;
}

/** Length-weighted mean across FDOT segments — preserves null when no rows / total length is zero. */
function lengthWeightedAadt(rows: FdotAadtCorridorRow[]): number | null {
  if (rows.length === 0) return null;
  let weightedSum = 0;
  let totalLength = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.aadt) || !Number.isFinite(r.shape_length)) continue;
    weightedSum += r.aadt * r.shape_length;
    totalLength += r.shape_length;
  }
  if (totalLength === 0) return null;
  return weightedSum / totalLength;
}

// ── Per-metric builders ─────────────────────────────────────────────────────

function buildCapRate(input: BuildFactPackInput): MetricFact {
  const c = input.corridor;
  const current: FactValue = {
    value: c.cap_rate_pct,
    unit: "%",
    source_url: c.cap_rate_source_url ?? c.source_url,
    source_label: "corridor_profiles.cap_rate_pct",
    vintage: c.metrics_verified_date,
    ...(c.cap_rate_pct == null
      ? {
          gap_reason:
            "corridor_profiles.cap_rate_pct is null for this corridor",
        }
      : {}),
  };

  // Cap rate is NOT in marketbeat_swfl, so we can't compute a YoY delta from
  // observed quarterly readings. The corridor row carries an editorial
  // direction string — pass it through as a hint, but mark the numeric delta
  // as unavailable. Per the plan, gaps drive the speculative block; the facts
  // block stays silent on null math.
  const yoy: ImportantMath = {
    label: "cap_rate_yoy_delta_pp",
    value: null,
    unit: "pp",
    direction: editorialDirectionToTrend(c.cap_rate_direction),
    computation:
      "YoY delta unavailable: cap_rate is not carried in data_lake.marketbeat_swfl; corridor_profiles holds a single snapshot only. Editorial direction string passed through.",
    inputs: [
      {
        ref: "corridor_profiles.cap_rate_direction",
        value: null,
        vintage: c.metrics_verified_date,
      },
    ],
    gap_reason:
      "Cap rate YoY requires a quarterly time series we do not currently ingest.",
  };

  return { current, important_math: [yoy] };
}

function editorialDirectionToTrend(
  d: CorridorMetricDirection | null,
): "rising" | "falling" | "stable" | null {
  if (d === "rising") return "rising";
  if (d === "falling") return "falling";
  if (d === "stable") return "stable";
  return null;
}

function buildVacancyRate(input: BuildFactPackInput): MetricFact {
  const c = input.corridor;
  const current: FactValue = {
    value: c.vacancy_rate_pct,
    unit: "%",
    source_url: c.vacancy_rate_source_url ?? c.source_url,
    source_label: "corridor_profiles.vacancy_rate_pct",
    vintage: c.metrics_period ?? c.metrics_verified_date,
    ...(c.vacancy_rate_pct == null
      ? {
          gap_reason:
            "corridor_profiles.vacancy_rate_pct is null for this corridor",
        }
      : {}),
  };

  const math = buildMarketbeatYoy(input, {
    label: "vacancy_rate_yoy_delta_pp",
    unit: "pp",
    pick: (r) => r.vacancy_rate,
    stableBandAbs: 0.3,
  });

  return { current, important_math: [math] };
}

function buildAbsorptionSqft(input: BuildFactPackInput): MetricFact {
  const c = input.corridor;
  const current: FactValue = {
    value: c.absorption_sqft,
    unit: "sqft",
    source_url: c.absorption_sqft_source_url ?? c.source_url,
    source_label: "corridor_profiles.absorption_sqft",
    vintage: c.metrics_period ?? c.metrics_verified_date,
    ...(c.absorption_sqft == null
      ? {
          gap_reason:
            "corridor_profiles.absorption_sqft is null — typically requires CoStar or broker contact",
        }
      : {}),
  };

  const math = buildMarketbeatYoy(input, {
    label: "absorption_sqft_yoy_delta",
    unit: "sqft",
    pick: (r) => r.absorption_sqft,
    stableBandAbs: 5000, // <5k sqft swing reads as stable at corridor scale
  });

  return { current, important_math: [math] };
}

function buildAskingRentPsf(input: BuildFactPackInput): MetricFact {
  const c = input.corridor;
  const current: FactValue = {
    value: c.asking_rent_psf,
    unit: "$/sqft NNN",
    source_url: c.asking_rent_psf_source_url ?? c.source_url,
    source_label: "corridor_profiles.asking_rent_psf",
    vintage: c.metrics_period ?? c.metrics_verified_date,
    ...(c.asking_rent_psf == null
      ? {
          gap_reason:
            "corridor_profiles.asking_rent_psf is null for this corridor",
        }
      : {}),
  };

  const math = buildMarketbeatYoy(input, {
    label: "asking_rent_psf_yoy_delta",
    unit: "$/sqft",
    pick: (r) => r.asking_rent_nnn,
    stableBandAbs: 0.5,
  });

  return { current, important_math: [math] };
}

/**
 * Generic MarketBeat-backed YoY delta builder. Picks the latest quarter
 * available in `marketbeat_submarket_rows` and finds the same quarter one
 * year prior. Returns gap_reason when either anchor is missing.
 */
function buildMarketbeatYoy(
  input: BuildFactPackInput,
  cfg: {
    label: string;
    unit: string;
    pick: (r: MarketbeatSwflNormalized) => number | null;
    stableBandAbs: number;
  },
): ImportantMath {
  const rows = input.marketbeat_submarket_rows;
  if (rows.length === 0) {
    return {
      label: cfg.label,
      value: null,
      unit: cfg.unit,
      direction: null,
      computation:
        "Latest-quarter vs. prior-year-same-quarter from data_lake.marketbeat_swfl.",
      inputs: [],
      gap_reason:
        "No verified MarketBeat rows for this corridor's submarket — pipeline has not yet landed a row, OR submarket alias map needs an entry.",
    };
  }

  // Sort defensive — caller is supposed to pre-sort but don't trust input shape.
  const sorted = [...rows].sort((a, b) => a.quarter.localeCompare(b.quarter));
  const latest = sorted[sorted.length - 1];
  const latestMatch = latest.quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!latestMatch) {
    return {
      label: cfg.label,
      value: null,
      unit: cfg.unit,
      direction: null,
      computation: "Latest-quarter vs. prior-year-same-quarter.",
      inputs: [],
      gap_reason: `Latest MarketBeat row has non-canonical quarter "${latest.quarter}"; YoY anchor lookup skipped.`,
    };
  }
  const priorQuarter = `${parseInt(latestMatch[1], 10) - 1}-Q${latestMatch[2]}`;
  const prior = sorted.find((r) => r.quarter === priorQuarter) ?? null;

  const latestValue = cfg.pick(latest);
  const priorValue = prior ? cfg.pick(prior) : null;

  if (latestValue == null || priorValue == null) {
    return {
      label: cfg.label,
      value: null,
      unit: cfg.unit,
      direction: null,
      computation: `${latest.quarter} minus ${priorQuarter}`,
      inputs: [
        {
          ref: `marketbeat_swfl[${latest.quarter}]`,
          value: latestValue,
          vintage: quarterToMonth(latest.quarter),
        },
        {
          ref: `marketbeat_swfl[${priorQuarter}]`,
          value: priorValue,
          vintage: quarterToMonth(priorQuarter),
        },
      ],
      gap_reason:
        prior == null
          ? `Prior-year same-quarter (${priorQuarter}) row missing in data_lake.marketbeat_swfl.`
          : "One or both quarter readings are null in data_lake.marketbeat_swfl.",
    };
  }

  const delta = latestValue - priorValue;
  return {
    label: cfg.label,
    value: r2(delta),
    unit: cfg.unit,
    direction: classifyDirection(delta, cfg.stableBandAbs),
    computation: `${latest.quarter} minus ${priorQuarter}`,
    inputs: [
      {
        ref: `marketbeat_swfl[${latest.quarter}]`,
        value: latestValue,
        vintage: quarterToMonth(latest.quarter),
      },
      {
        ref: `marketbeat_swfl[${priorQuarter}]`,
        value: priorValue,
        vintage: quarterToMonth(priorQuarter),
      },
    ],
  };
}

function buildUnemploymentRate(input: BuildFactPackInput): MetricFact {
  const summary = input.bls_laus;
  const county = input.corridor.county;
  const sourceUrl = COUNTY_PRIMARY_SOURCE[county] || null;

  if (summary == null || county === "Unknown") {
    const current: FactValue = {
      value: null,
      unit: "%",
      source_url: sourceUrl,
      source_label: "data_lake.bls_laus (county-level)",
      vintage: null,
      gap_reason:
        county === "Unknown"
          ? `Corridor city "${input.corridor.city}" not in CITY_TO_COUNTY map — county-level BLS LAUS not joinable.`
          : "BLS LAUS summary not provided by caller — bls-laus-source fetch may have returned no rows.",
    };
    return {
      current,
      important_math: [
        {
          label: "unemployment_rate_yoy_delta_pp",
          value: null,
          unit: "pp",
          direction: null,
          computation: "Latest-month vs. prior-year-same-month.",
          inputs: [],
          gap_reason: current.gap_reason,
        },
      ],
    };
  }

  const countyMetrics =
    county === "Lee" ? summary.lee_county : summary.collier_county;
  const refMonth = summary.reference_month;
  const refMonthYearMonth = refMonth
    ? refMonth.replace(/M(\d{2})$/, "-$1")
    : null;

  const current: FactValue = {
    value: countyMetrics.unemployment_rate,
    unit: "%",
    source_url: sourceUrl,
    source_label: `data_lake.bls_laus (${county} County, measure 03, ${refMonth ?? "unknown reference month"}${summary.is_preliminary ? "; preliminary" : ""})`,
    vintage: refMonthYearMonth,
    ...(countyMetrics.unemployment_rate == null
      ? {
          gap_reason:
            "BLS LAUS county-level unemployment_rate null at latest period.",
        }
      : {}),
  };

  const delta = countyMetrics.unemployment_rate_yoy_delta;
  const math: ImportantMath = {
    label: "unemployment_rate_yoy_delta_pp",
    value: delta,
    unit: "pp",
    direction: classifyDirection(delta, 0.2),
    computation: `${refMonth ?? "latest"} minus prior-year same period (BLS LAUS county series)`,
    inputs: [
      {
        ref: `bls_laus[${county},03,${refMonth ?? "?"}]`,
        value: countyMetrics.unemployment_rate,
        vintage: refMonthYearMonth,
      },
    ],
    ...(delta == null
      ? {
          gap_reason:
            "YoY delta null — prior-year same-period reading missing in data_lake.bls_laus.",
        }
      : {}),
  };

  return { current, important_math: [math] };
}

function buildZoriRentIndex(input: BuildFactPackInput): MetricFact {
  const rows = input.zori_rows;
  if (rows.length === 0) {
    const current: FactValue = {
      value: null,
      unit: "ZORI index",
      source_url: "https://www.zillow.com/research/data/",
      source_label: "data_lake.zori_swfl (corridor-ZIP rollup)",
      vintage: null,
      gap_reason:
        "No ZORI rows mapped to this corridor — corridor-to-ZIP mapping table may not cover it, or the ZORI ingest has not landed for this metro.",
    };
    return {
      current,
      important_math: [
        {
          label: "zori_rent_index_yoy_pct",
          value: null,
          unit: "%",
          direction: null,
          computation:
            "Latest-month vs. prior-year-same-month (ZIP-mean rollup).",
          inputs: [],
          gap_reason: current.gap_reason,
        },
      ],
    };
  }

  const sorted = [...rows].sort((a, b) =>
    a.period_end.localeCompare(b.period_end),
  );
  // Mean across ZIPs at the latest period_end.
  const latestPeriod = sorted[sorted.length - 1].period_end;
  const latestRows = sorted.filter((r) => r.period_end === latestPeriod);
  const latestMean = latestRows.length
    ? latestRows.reduce((s, r) => s + r.rent_index, 0) / latestRows.length
    : null;

  // Prior-year same month rollup.
  const latestDate = new Date(latestPeriod);
  const priorDate = new Date(latestDate);
  priorDate.setUTCFullYear(priorDate.getUTCFullYear() - 1);
  const priorIso = priorDate.toISOString().slice(0, 10);
  const priorRows = sorted.filter((r) => r.period_end === priorIso);
  const priorMean = priorRows.length
    ? priorRows.reduce((s, r) => s + r.rent_index, 0) / priorRows.length
    : null;

  const current: FactValue = {
    value: r2(latestMean),
    unit: "ZORI index",
    source_url: "https://www.zillow.com/research/data/",
    source_label: `data_lake.zori_swfl (corridor-ZIP rollup, ${latestRows.length} ZIPs, ${latestPeriod})`,
    vintage: latestPeriod,
    ...(latestMean == null
      ? { gap_reason: "Latest-period ZIP rollup mean is null." }
      : {}),
  };

  let yoyPct: number | null = null;
  if (latestMean != null && priorMean != null && priorMean !== 0) {
    yoyPct = r2(((latestMean - priorMean) / priorMean) * 100);
  }

  const math: ImportantMath = {
    label: "zori_rent_index_yoy_pct",
    value: yoyPct,
    unit: "%",
    direction: classifyDirection(yoyPct, 0.5),
    computation: `(${latestPeriod} mean − ${priorIso} mean) / ${priorIso} mean × 100`,
    inputs: [
      {
        ref: `zori_swfl[${latestPeriod}, mean]`,
        value: r2(latestMean),
        vintage: latestPeriod,
      },
      {
        ref: `zori_swfl[${priorIso}, mean]`,
        value: r2(priorMean),
        vintage: priorIso,
      },
    ],
    ...(yoyPct == null
      ? {
          gap_reason:
            "Prior-year same-month rollup missing — ingest may not extend back 12 months, or no ZIPs reported in that period.",
        }
      : {}),
  };

  return { current, important_math: [math] };
}

function buildPermitsTrailing6Mo(input: BuildFactPackInput): MetricFact {
  const county = input.corridor.county;

  if (county !== "Lee") {
    const reason =
      county === "Collier"
        ? "Collier County not in lee_building_permits ingest scope (Lee-only v1)."
        : `Corridor county unresolved ("${input.corridor.city}") — permits ingest is Lee-only.`;
    const current: FactValue = {
      value: null,
      unit: "permits",
      source_url: "https://aca-prod.accela.com/LEECO/",
      source_label: "data_lake.lee_building_permits (corridor geo-join)",
      vintage: null,
      gap_reason: reason,
    };
    return {
      current,
      important_math: [
        {
          label: "permits_trailing_6mo_direction",
          value: null,
          unit: "permits",
          direction: null,
          computation: "Trailing-6mo permit count vs. prior-6mo permit count.",
          inputs: [],
          gap_reason: reason,
        },
      ],
    };
  }

  const rows = input.lee_permits;
  if (rows.length === 0) {
    const current: FactValue = {
      value: null,
      unit: "permits",
      source_url: "https://aca-prod.accela.com/LEECO/",
      source_label: "data_lake.lee_building_permits (corridor geo-join)",
      vintage: null,
      gap_reason:
        "Zero permits joined to this corridor — geo-join may not have matched, or the corridor had no permitting activity in the ingest window.",
    };
    return {
      current,
      important_math: [
        {
          label: "permits_trailing_6mo_direction",
          value: null,
          unit: "permits",
          direction: null,
          computation: "Trailing-6mo permit count vs. prior-6mo permit count.",
          inputs: [],
          gap_reason: current.gap_reason,
        },
      ],
    };
  }

  const sorted = [...rows].sort((a, b) =>
    a.issued_date.localeCompare(b.issued_date),
  );
  const latestIso = sorted[sorted.length - 1].issued_date;
  const latestDate = new Date(latestIso);
  const sixMoAgo = new Date(latestDate);
  sixMoAgo.setUTCMonth(sixMoAgo.getUTCMonth() - 6);
  const twelveMoAgo = new Date(latestDate);
  twelveMoAgo.setUTCMonth(twelveMoAgo.getUTCMonth() - 12);

  const trailing6mo = sorted.filter(
    (r) => new Date(r.issued_date) > sixMoAgo,
  ).length;
  const prior6mo = sorted.filter((r) => {
    const d = new Date(r.issued_date);
    return d > twelveMoAgo && d <= sixMoAgo;
  }).length;

  const delta = trailing6mo - prior6mo;
  const current: FactValue = {
    value: trailing6mo,
    unit: "permits",
    source_url: "https://aca-prod.accela.com/LEECO/",
    source_label: `data_lake.lee_building_permits (corridor geo-join, trailing 6mo to ${latestIso})`,
    vintage: latestIso,
  };

  const math: ImportantMath = {
    label: "permits_trailing_6mo_direction",
    value: delta,
    unit: "permits",
    direction: classifyDirection(delta, 3),
    computation: `Permits issued in 6mo before ${latestIso} minus prior-6mo count`,
    inputs: [
      {
        ref: `lee_building_permits[trailing-6mo]`,
        value: trailing6mo,
        vintage: latestIso,
      },
      {
        ref: `lee_building_permits[prior-6mo]`,
        value: prior6mo,
        vintage: sixMoAgo.toISOString().slice(0, 10),
      },
    ],
  };

  return { current, important_math: [math] };
}

function buildNfipClaimFrequency(input: BuildFactPackInput): MetricFact {
  const rows = input.nfip_year_rows;
  if (rows.length === 0) {
    const current: FactValue = {
      value: null,
      unit: "claims/yr",
      source_url:
        "https://www.fema.gov/openfema-data-page/fima-nfip-redacted-claims-v2",
      source_label: "data_lake.fema_nfip_claims (corridor scope, year rollup)",
      vintage: null,
      gap_reason:
        "No NFIP claims rolled up for this corridor — corridor-to-ZIP mapping may not cover it, or the corridor sees no historical claims in the ingest window.",
    };
    return {
      current,
      important_math: [
        {
          label: "nfip_claim_frequency_direction",
          value: null,
          unit: "claims/yr",
          direction: null,
          computation:
            "Non-storm-year mean claim count, latest 3 years vs. prior 3 years.",
          inputs: [],
          gap_reason: current.gap_reason,
        },
      ],
    };
  }

  const sorted = [...rows].sort((a, b) => a.year_of_loss - b.year_of_loss);
  const nonStorm = sorted.filter((r) => !r.is_storm_year);
  const latestYear = sorted[sorted.length - 1].year_of_loss;
  const current: FactValue = {
    value: sorted[sorted.length - 1].claim_count,
    unit: "claims/yr",
    source_url:
      "https://www.fema.gov/openfema-data-page/fima-nfip-redacted-claims-v2",
    source_label: `data_lake.fema_nfip_claims (corridor scope, ${latestYear} year-of-loss${sorted[sorted.length - 1].is_storm_year ? "; storm year" : ""})`,
    vintage: `${latestYear}-01`,
  };

  if (nonStorm.length < 4) {
    return {
      current,
      important_math: [
        {
          label: "nfip_claim_frequency_direction",
          value: null,
          unit: "claims/yr",
          direction: null,
          computation:
            "Non-storm-year mean claim count, latest 3 years vs. prior 3 years.",
          inputs: nonStorm.map((r) => ({
            ref: `fema_nfip_claims[${r.year_of_loss}]`,
            value: r.claim_count,
            vintage: `${r.year_of_loss}-01`,
          })),
          gap_reason: `Fewer than 4 non-storm years available (have ${nonStorm.length}); 3-vs-3 baseline comparison not supportable.`,
        },
      ],
    };
  }

  const recent3 = nonStorm.slice(-3);
  const prior3 = nonStorm.slice(-6, -3);
  if (prior3.length < 3) {
    return {
      current,
      important_math: [
        {
          label: "nfip_claim_frequency_direction",
          value: null,
          unit: "claims/yr",
          direction: null,
          computation:
            "Non-storm-year mean claim count, latest 3 years vs. prior 3 years.",
          inputs: [...recent3, ...prior3].map((r) => ({
            ref: `fema_nfip_claims[${r.year_of_loss}]`,
            value: r.claim_count,
            vintage: `${r.year_of_loss}-01`,
          })),
          gap_reason: `Prior-3-year baseline incomplete (have ${prior3.length}/3 non-storm years).`,
        },
      ],
    };
  }

  const recentMean =
    recent3.reduce((s, r) => s + r.claim_count, 0) / recent3.length;
  const priorMean =
    prior3.reduce((s, r) => s + r.claim_count, 0) / prior3.length;
  const delta = r2(recentMean - priorMean);

  const math: ImportantMath = {
    label: "nfip_claim_frequency_direction",
    value: delta,
    unit: "claims/yr",
    direction: classifyDirection(delta, 1),
    computation: `Mean claims/yr in latest 3 non-storm years (${recent3.map((r) => r.year_of_loss).join(", ")}) minus mean of prior 3 (${prior3.map((r) => r.year_of_loss).join(", ")})`,
    inputs: [...recent3, ...prior3].map((r) => ({
      ref: `fema_nfip_claims[${r.year_of_loss}]`,
      value: r.claim_count,
      vintage: `${r.year_of_loss}-01`,
    })),
  };

  return { current, important_math: [math] };
}

function buildFdotAadt(input: BuildFactPackInput): MetricFact {
  const rows = input.fdot_aadt_rows;
  if (rows.length === 0) {
    const current: FactValue = {
      value: null,
      unit: "AADT",
      source_url: "https://tdaappsprod.dot.state.fl.us/fto/",
      source_label: "data_lake.fdot_aadt_fl (corridor roadway overlap)",
      vintage: null,
      gap_reason:
        "No FDOT AADT segments overlapping this corridor in the latest year — roadway name may not match, or FDOT suppressed AADT for this segment.",
    };
    return { current, important_math: [] };
  }

  const sorted = [...rows].sort((a, b) => b.year - a.year);
  const latestYear = sorted[0].year;
  const latestRows = sorted.filter((r) => r.year === latestYear);
  const priorYearRows = sorted.filter((r) => r.year === latestYear - 1);

  const latestAadt = lengthWeightedAadt(latestRows);
  const priorAadt = lengthWeightedAadt(priorYearRows);

  const current: FactValue = {
    value: latestAadt == null ? null : Math.round(latestAadt),
    unit: "AADT",
    source_url: "https://tdaappsprod.dot.state.fl.us/fto/",
    source_label: `data_lake.fdot_aadt_fl (length-weighted across ${latestRows.length} segments, ${latestYear})`,
    vintage: `${latestYear}-01`,
    ...(latestAadt == null
      ? {
          gap_reason:
            "Length-weighted AADT computed null — all segments missing aadt or shape_length.",
        }
      : {}),
  };

  if (latestAadt == null || priorAadt == null) {
    return {
      current,
      important_math: [
        {
          label: "aadt_yoy_pct",
          value: null,
          unit: "%",
          direction: null,
          computation: `Length-weighted AADT (${latestYear}) vs. (${latestYear - 1})`,
          inputs: [
            {
              ref: `fdot_aadt_fl[${latestYear}]`,
              value: latestAadt,
              vintage: `${latestYear}-01`,
            },
            {
              ref: `fdot_aadt_fl[${latestYear - 1}]`,
              value: priorAadt,
              vintage: `${latestYear - 1}-01`,
            },
          ],
          gap_reason:
            "Prior-year segments missing or null-weighted; YoY pct not computable.",
        },
      ],
    };
  }

  const pct =
    priorAadt === 0 ? null : r2(((latestAadt - priorAadt) / priorAadt) * 100);
  return {
    current,
    important_math: [
      {
        label: "aadt_yoy_pct",
        value: pct,
        unit: "%",
        direction: classifyDirection(pct, 1),
        computation: `Length-weighted AADT (${latestYear}) vs. (${latestYear - 1}), expressed as % change`,
        inputs: [
          {
            ref: `fdot_aadt_fl[${latestYear}]`,
            value: Math.round(latestAadt),
            vintage: `${latestYear}-01`,
          },
          {
            ref: `fdot_aadt_fl[${latestYear - 1}]`,
            value: Math.round(priorAadt),
            vintage: `${latestYear - 1}-01`,
          },
        ],
      },
    ],
  };
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Build the structured fact pack for ONE corridor.
 *
 * Pure: no IO, no clock reads (caller passes generated_at), no env reads.
 * Deterministic for a given input — Stage C reruns produce byte-identical
 * fact packs when the inputs haven't changed (modulo the generated_at field
 * the caller controls).
 */
export function buildCorridorFactPack(
  input: BuildFactPackInput,
): CorridorFactPack {
  const metrics: CorridorFactPack["metrics"] = {
    cap_rate: buildCapRate(input),
    vacancy_rate: buildVacancyRate(input),
    absorption_sqft: buildAbsorptionSqft(input),
    asking_rent_psf: buildAskingRentPsf(input),
    unemployment_rate: buildUnemploymentRate(input),
    zori_rent_index: buildZoriRentIndex(input),
    permits_trailing_6mo: buildPermitsTrailing6Mo(input),
    nfip_claim_frequency: buildNfipClaimFrequency(input),
    fdot_aadt: buildFdotAadt(input),
  };

  return {
    corridor_name: input.corridor.name,
    city: input.corridor.city,
    county: input.corridor.county,
    corridor_type: input.corridor.corridor_type,
    generated_at: input.generated_at,
    fact_pack_vintage: computeFactPackVintage(metrics),
    metrics,
    prior_quarter_context: input.prior_quarter_context,
  };
}
