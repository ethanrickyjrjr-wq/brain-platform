import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
  BrainOutputDirection,
} from "../types/brain-output.mts";
import {
  blsOewsSource,
  type BlsOewsSummary,
  type OewsMsaSnapshot,
} from "../sources/bls-oews-source.mts";

const SOURCE_ID = "bls_oews_swfl";
const CITATION_URL = "https://www.bls.gov/oes/tables.htm";

/**
 * labor-demand-swfl — SWFL workforce composition + wage benchmarks from BLS OEWS.
 *
 * Source: data_lake.bls_oews_swfl (ingest/pipelines/bls_oews_swfl, annual cron 15 May via
 * bls-oews-annual.yml). BLS Occupational Employment and Wage Statistics, May survey.
 * MSAs: Cape Coral-Fort Myers (15980 / Lee Co.) + Naples-Marco Island (34940 / Collier Co.)
 *
 * Note: original pipeline targeted FL DEO OSPA (weekly job postings) — that system is
 * retired. BLS OEWS is the authoritative source for county/MSA-level occupation
 * employment and wages; the state portal re-presented this federal data.
 *
 * Key metrics: top occupation groups by employment, Construction LOC_QUOTIENT (2.17x
 * in Lee, 1.88x in Naples), combined healthcare employment, YoY employment delta when
 * two survey years are available.
 *
 * Direction: YoY total employment change if two years present; neutral on first run.
 *
 * Tier-1 Reporter — no upstream brains. Pure deterministic aggregation.
 */

// ── Closure state ─────────────────────────────────────────────────────────────

let lastSummary: BlsOewsSummary | null = null;
let lastFetchedAt: string | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt1 = (n: number): string => n.toFixed(1);
const fmt2 = (n: number): string => n.toFixed(2);
const sign = (n: number): string => (n >= 0 ? "+" : "");
const fmtK = (n: number): string => n.toLocaleString("en-US");

function makeSource(
  label: string,
  fetched_at: string,
  refYear: number,
): BrainOutputMetric["source"] {
  return {
    url: CITATION_URL,
    fetched_at,
    tier: 1,
    citation: `BLS OEWS May ${refYear} — ${label}`,
  };
}

// ── outputProducer ────────────────────────────────────────────────────────────

function laborDemandOutputProducer(
  _out: PackOutput,
): BrainOutputProducerResult {
  const summary = lastSummary;
  const fetchedAt =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!summary || !summary.ref_year) {
    return {
      conclusion:
        "labor-demand-swfl: no BLS OEWS data available — data_lake.bls_oews_swfl may be empty. Run the bls-oews-annual pipeline with --backfill.",
      key_metrics: [],
      caveats: [
        "data_lake.bls_oews_swfl returned 0 rows. Run: python -m ingest.pipelines.bls_oews_swfl.pipeline --backfill",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const {
    ref_year,
    cape_coral,
    naples,
    cape_coral_employment_yoy_pct,
    naples_employment_yoy_pct,
  } = summary;

  const key_metrics: BrainOutputMetric[] = [];

  // ── Per-MSA metrics ─────────────────────────────────────────────────────────

  function addMsaMetrics(msa: OewsMsaSnapshot, yoy: number | null): void {
    const areaTag = msa.area_code === "15980" ? "lee" : "collier";
    const areaLabel =
      msa.area_code === "15980"
        ? "Lee (Cape Coral-Fort Myers)"
        : "Collier (Naples)";

    // Top occupation group by employment
    const top = msa.top_groups[0];
    if (top && top.tot_emp != null) {
      key_metrics.push({
        metric: `${areaTag}_top_occupation_employment`,
        label: `${areaLabel} Largest Workforce Sector`,
        value: top.tot_emp,
        direction: "stable",
        variable_type: "extensive",
        units: "workers",
        display_format: "count",
        source: makeSource(
          `${areaLabel} — ${top.occ_title}: ${fmtK(top.tot_emp)} workers`,
          fetchedAt,
          ref_year,
        ),
      });
    }

    // Construction LOC_QUOTIENT
    if (msa.construction_loc_q != null) {
      const locQ = msa.construction_loc_q;
      const locDir = locQ >= 1.5 ? "rising" : locQ < 0.8 ? "falling" : "stable";
      key_metrics.push({
        metric: `${areaTag}_construction_loc_quotient`,
        label: `${areaLabel} Construction Concentration (LOC_Q)`,
        value: locQ,
        direction: locDir,
        variable_type: "intensive",
        units: "x",
        display_format: "raw",
        source: makeSource(
          `${areaLabel} Construction & Extraction — ${fmt2(locQ)}× national avg`,
          fetchedAt,
          ref_year,
        ),
      });
    }

    // Combined healthcare employment
    if (msa.healthcare_employment != null) {
      key_metrics.push({
        metric: `${areaTag}_healthcare_employment`,
        label: `${areaLabel} Healthcare Workforce`,
        value: msa.healthcare_employment,
        direction: "stable",
        variable_type: "extensive",
        units: "workers",
        display_format: "count",
        source: makeSource(
          `${areaLabel} — Healthcare Practitioners + Support: ${fmtK(msa.healthcare_employment)} workers`,
          fetchedAt,
          ref_year,
        ),
      });
    }

    // Construction median wage
    if (msa.construction_median_wage != null) {
      key_metrics.push({
        metric: `${areaTag}_construction_median_hourly_wage`,
        label: `${areaLabel} Construction Median Hourly Wage`,
        value: msa.construction_median_wage,
        direction: "stable",
        variable_type: "intensive",
        units: "$/hr",
        display_format: "currency",
        source: makeSource(
          `${areaLabel} Construction & Extraction — median $${fmt2(msa.construction_median_wage)}/hr`,
          fetchedAt,
          ref_year,
        ),
      });
    }

    // YoY employment delta
    if (yoy != null) {
      const yoyDir = yoy > 1 ? "rising" : yoy < -1 ? "falling" : "stable";
      key_metrics.push({
        metric: `${areaTag}_total_employment_yoy_pct`,
        label: `${areaLabel} Total Employment YoY Δ`,
        value: yoy,
        direction: yoyDir,
        variable_type: "intensive",
        units: "%",
        display_format: "percent",
        source: makeSource(
          `${areaLabel} total employment YoY: ${sign(yoy)}${fmt1(yoy)}%`,
          fetchedAt,
          ref_year,
        ),
      });
    }
  }

  addMsaMetrics(cape_coral, cape_coral_employment_yoy_pct);
  addMsaMetrics(naples, naples_employment_yoy_pct);

  // ── Direction ─────────────────────────────────────────────────────────────

  let direction: BrainOutputDirection = "neutral";

  if (
    cape_coral_employment_yoy_pct != null &&
    naples_employment_yoy_pct != null
  ) {
    const avgYoy =
      (cape_coral_employment_yoy_pct + naples_employment_yoy_pct) / 2;
    direction = avgYoy > 1 ? "bullish" : avgYoy < -1 ? "bearish" : "neutral";
  } else if (cape_coral_employment_yoy_pct != null) {
    direction =
      cape_coral_employment_yoy_pct > 1
        ? "bullish"
        : cape_coral_employment_yoy_pct < -1
          ? "bearish"
          : "neutral";
  }

  // ── Conclusion ─────────────────────────────────────────────────────────────

  const leeParts = [
    cape_coral.top_groups[0]
      ? `top sector: ${cape_coral.top_groups[0].occ_title} (${fmtK(cape_coral.top_groups[0].tot_emp ?? 0)})`
      : null,
    cape_coral.construction_loc_q != null
      ? `Construction ${fmt2(cape_coral.construction_loc_q)}× national`
      : null,
    cape_coral_employment_yoy_pct != null
      ? `employment ${sign(cape_coral_employment_yoy_pct)}${fmt1(cape_coral_employment_yoy_pct)}% YoY`
      : null,
  ]
    .filter(Boolean)
    .join(", ");

  const naplesParts = [
    naples.top_groups[0]
      ? `top sector: ${naples.top_groups[0].occ_title} (${fmtK(naples.top_groups[0].tot_emp ?? 0)})`
      : null,
    naples.construction_loc_q != null
      ? `Construction ${fmt2(naples.construction_loc_q)}× national`
      : null,
    naples_employment_yoy_pct != null
      ? `employment ${sign(naples_employment_yoy_pct)}${fmt1(naples_employment_yoy_pct)}% YoY`
      : null,
  ]
    .filter(Boolean)
    .join(", ");

  const conclusion =
    `BLS OEWS May ${ref_year} — SWFL workforce. ` +
    `Lee (Cape Coral-Fort Myers MSA): ${leeParts}. ` +
    `Collier (Naples MSA): ${naplesParts}. ` +
    `Source: BLS Occupational Employment and Wage Statistics (${CITATION_URL}).`;

  const maxLocQ = Math.max(
    cape_coral.construction_loc_q ?? 0,
    naples.construction_loc_q ?? 0,
  );
  const magnitude = Math.min((maxLocQ - 1) / 1.5, 1.0);

  return {
    conclusion,
    key_metrics,
    caveats: [
      "BLS OEWS data is annual (May survey); released ~April of the following year. Counts are employment estimates, not job openings.",
      cape_coral_employment_yoy_pct == null
        ? "Only one survey year loaded — YoY delta will appear after a second annual run (--backfill or next May cron)."
        : null,
    ].filter(Boolean) as string[],
    direction,
    magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
    grain_boundary: {
      not_available: [
        "Job openings / vacancy counts — BLS OEWS tracks employment levels, not open positions",
        "Wage data suppressed by BLS below sample threshold (marked * in source)",
        "Sub-MSA county breakdowns — Lee and Collier reported as MSAs only (no ZIP or city grain)",
        "Industry-by-occupation cross-tabs — major group totals are cross-industry only",
      ],
      finest_grain: "msa-annual",
    },
  };
}

// ── Pack definition ───────────────────────────────────────────────────────────

export const laborDemandSwfl: PackDefinition = {
  id: "labor-demand-swfl",
  brain_id: "labor-demand-swfl",
  domain: "macro",
  scope:
    "Southwest Florida workforce composition and wage benchmarks — BLS OEWS major occupation groups for Cape Coral-Fort Myers MSA (Lee Co.) and Naples-Marco Island MSA (Collier Co.). Annual May survey data.",
  ttl_seconds: 90 * 24 * 60 * 60, // 90 days — annual data, stable within year

  sources: [blsOewsSource],
  input_brains: [],

  fitScore: () => 0.8,

  skipSynthesisAgent: true,
  skipTriageAgent: true,

  corpusSummary: (allFragments: RawFragment[]) => {
    const fragment = allFragments.find(
      (f) =>
        f.source_id === SOURCE_ID &&
        (f.normalized as { kind?: string }).kind === "bls-oews-swfl-summary",
    );
    lastSummary = fragment ? (fragment.normalized as BlsOewsSummary) : null;
    lastFetchedAt = fragment?.fetched_at ?? null;

    if (!lastSummary) return [];

    const { ref_year, cape_coral, naples } = lastSummary;
    const leeTop = cape_coral.top_groups[0];
    const naplesTop = naples.top_groups[0];

    return [
      {
        topic: "bls_oews_swfl_snapshot",
        fact: `BLS OEWS May ${ref_year} — SWFL workforce composition`,
        value:
          `Lee (Cape Coral-Fort Myers): top sector ${leeTop?.occ_title ?? "n/a"} (${fmtK(leeTop?.tot_emp ?? 0)} workers), Construction ${fmt2(cape_coral.construction_loc_q ?? 0)}× national LOC_Q. ` +
          `Collier (Naples): top sector ${naplesTop?.occ_title ?? "n/a"} (${fmtK(naplesTop?.tot_emp ?? 0)} workers), Construction ${fmt2(naples.construction_loc_q ?? 0)}× national LOC_Q. ` +
          `Source: BLS OEWS (${CITATION_URL}).`,
        source_fragment_ids: [],
      },
    ];
  },

  outputProducer: laborDemandOutputProducer,

  preferences: [
    "BLS OEWS data reflects employment levels and wages, not open job postings. Construction is structurally overrepresented in SWFL vs the national average.",
    "Lee County (Cape Coral-Fort Myers MSA) is the primary reference; Collier (Naples MSA) is secondary.",
    "YoY employment delta is the directional signal. Construction LOC_QUOTIENT documents SWFL's structural concentration.",
  ],
  activeProject:
    "labor-demand-swfl: BLS OEWS annual workforce composition for Lee + Collier counties — Cape Coral-Fort Myers and Naples MSAs.",
  prompts: {
    triageContext:
      "Fragment is a bls-oews-swfl-summary with employment by SOC major group and LOC_QUOTIENT for Lee + Collier MSAs. Decision-relevant by construction; pack is pure deterministic aggregation.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). BrainOutput built by laborDemandOutputProducer from annual OEWS employment counts and LOC_QUOTIENT values.",
  },
};
