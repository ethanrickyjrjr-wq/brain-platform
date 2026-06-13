import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
  BrainOutputDirection,
} from "../types/brain-output.mts";
import type { SynthesisFact } from "../types/event.mts";
import {
  flDbprLicensesSource,
  type DbprLicenseSummary,
} from "../sources/fl-dbpr-licenses-source.mts";

const SOURCE_ID = "fl_dbpr_licenses";

// 10% lapse rate: DBPR Construction Industry Annual Report cites ~8-9%
// statewide baseline; 10% used as conservative stress threshold.
// Source: https://www2.myfloridalicense.com/reports-and-publications/
// [CITATION_NEEDED — verify this specific figure against the live report]
const LAPSE_RATE_BEARISH_THRESHOLD = 0.1;

// 5% lapse rate: below this signals healthy renewal cadence (~half the
// statewide baseline cited in the DBPR annual report).
// Source: https://www2.myfloridalicense.com/reports-and-publications/
// [CITATION_NEEDED — verify this specific figure against the live report]
const LAPSE_RATE_BULLISH_THRESHOLD = 0.05;

// ── Closure state ─────────────────────────────────────────────────────────────

let lastSummary: DbprLicenseSummary | null = null;
let lastFetchedAt: string | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtN = (n: number): string => n.toLocaleString("en-US");
const fmt2 = (n: number): string => n.toFixed(2);
const fmt1pct = (n: number): string => (n * 100).toFixed(1) + "%";

function makeSource(citation: string, fetched_at: string): BrainOutputMetric["source"] {
  return {
    url: "https://www2.myfloridalicense.com/instant-public-records/",
    fetched_at,
    tier: 1,
    citation,
  };
}

function computeRatios(s: DbprLicenseSummary): {
  lapseRate: number | null;
  cbcShare: number | null;
} {
  const lapseRate =
    s.licenses_total_swfl > 0 ? s.licenses_lapsed_swfl / s.licenses_total_swfl : null;
  const cbcShare =
    s.licenses_total_active_swfl > 0
      ? s.licenses_cbc_count_swfl / s.licenses_total_active_swfl
      : null;
  return { lapseRate, cbcShare };
}

function classifyBrainDirection(lapseRate: number | null): BrainOutputDirection {
  if (lapseRate === null) return "neutral";
  if (lapseRate > LAPSE_RATE_BEARISH_THRESHOLD) return "bearish";
  if (lapseRate < LAPSE_RATE_BULLISH_THRESHOLD) return "bullish";
  return "neutral";
}

// ── corpusSummary ─────────────────────────────────────────────────────────────

function licensesSwflCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  lastSummary = null;
  lastFetchedAt = null;

  const frag = allFragments.find((f) => f.source_id === SOURCE_ID);
  if (!frag) return [];

  const s = frag.normalized as unknown as DbprLicenseSummary;
  if (s?.kind !== "dbpr-license-summary") return [];

  lastSummary = s;
  lastFetchedAt = frag.fetched_at;

  const { lapseRate } = computeRatios(s);

  return [
    {
      topic: "dbpr_licenses_snapshot",
      fact: "FL DBPR contractor license corpus — Lee + Collier",
      value:
        `Active: Lee ${fmtN(s.licenses_active_lee)}, Collier ${fmtN(s.licenses_active_collier)}. ` +
        `New last 12mo: ${fmtN(s.licenses_new_12m_swfl)}. ` +
        `Lapse rate: ${lapseRate !== null ? fmt1pct(lapseRate) : "n/a"}. ` +
        `Applicants in SWFL: ${fmtN(s.applicants_swfl)}.`,
      source_fragment_ids: [frag.fragment_id],
    },
  ];
}

// ── outputProducer ────────────────────────────────────────────────────────────

function licensesSwflOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const s = lastSummary;
  const fetchedAt = lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!s || s.licenses_total_swfl === 0) {
    return {
      conclusion:
        "licenses-swfl: FL DBPR tables returned 0 rows — the fl_dbpr_licenses pipeline has not run yet. Dispatch ingest-fl-dbpr-licenses.yml to populate.",
      key_metrics: [],
      caveats: [
        "data_lake.fl_dbpr_licenses returned 0 rows. Run: python -m ingest.pipelines.fl_dbpr_licenses.pipeline",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const { lapseRate, cbcShare } = computeRatios(s);
  const direction = classifyBrainDirection(lapseRate);

  const caveats: string[] = [];
  if (s.licenses_total_active_swfl < 100) {
    caveats.push(
      `Active license count is very low (${fmtN(s.licenses_total_active_swfl)}) — likely first run before full ingest; direction is provisional.`,
    );
  }
  if (s.licenses_new_12m_swfl === 0) {
    caveats.push(
      "No new licenses detected in the trailing 12 months — verify that original_licensure_date parsed correctly in the pipeline.",
    );
  }
  if (lapseRate === null) {
    caveats.push(
      "Lapse rate is undefined (zero total rows in Lee+Collier) — direction defaults to neutral.",
    );
  }

  const key_metrics: BrainOutputMetric[] = [
    {
      metric: "licenses_active_lee",
      label: "Active Licensed Contractors — Lee County",
      value: s.licenses_active_lee,
      direction: "stable",
      variable_type: "extensive",
      units: "licenses",
      display_format: "count",
      source: makeSource(
        `FL DBPR boards 06+08 — Lee County (county_code=46) active licenses (primary_status=C, secondary_status=A): ${fmtN(s.licenses_active_lee)}`,
        fetchedAt,
      ),
    },
    {
      metric: "licenses_active_collier",
      label: "Active Licensed Contractors — Collier County",
      value: s.licenses_active_collier,
      direction: "stable",
      variable_type: "extensive",
      units: "licenses",
      display_format: "count",
      source: makeSource(
        `FL DBPR boards 06+08 — Collier County (county_code=21) active licenses (primary_status=C, secondary_status=A): ${fmtN(s.licenses_active_collier)}`,
        fetchedAt,
      ),
    },
    {
      metric: "licenses_new_12m_swfl",
      label: "New Contractor Licenses — SWFL (Trailing 12 Months)",
      value: s.licenses_new_12m_swfl,
      direction: s.licenses_new_12m_swfl > 0 ? "rising" : "stable",
      variable_type: "extensive",
      units: "licenses",
      display_format: "count",
      source: makeSource(
        `FL DBPR boards 06+08 — Lee+Collier active licenses with original_licensure_date in trailing 12 months: ${fmtN(s.licenses_new_12m_swfl)}`,
        fetchedAt,
      ),
    },
    {
      metric: "licenses_lapse_rate_swfl",
      label: "Contractor License Lapse Rate — SWFL",
      value: lapseRate !== null ? Math.round(lapseRate * 10000) / 10000 : 0,
      direction:
        lapseRate !== null
          ? lapseRate > LAPSE_RATE_BEARISH_THRESHOLD
            ? "rising"
            : lapseRate < LAPSE_RATE_BULLISH_THRESHOLD
              ? "falling"
              : "stable"
          : "stable",
      variable_type: "intensive",
      units: "ratio",
      display_format: "ratio",
      source: makeSource(
        `FL DBPR boards 06+08 — Lee+Collier lapse rate: ${lapseRate !== null ? fmt1pct(lapseRate) : "n/a"} (lapsed ${fmtN(s.licenses_lapsed_swfl)} / total ${fmtN(s.licenses_total_swfl)}). Bearish threshold >10%, bullish <5%.`,
        fetchedAt,
      ),
    },
    {
      metric: "licenses_cbc_share_swfl",
      label: "Certified Building Contractor Share — SWFL",
      value: cbcShare !== null ? Math.round(cbcShare * 10000) / 10000 : 0,
      direction: "stable",
      variable_type: "intensive",
      units: "ratio",
      display_format: "ratio",
      source: makeSource(
        `FL DBPR board 06 (CBC occupation_code) active share of all active licenses in Lee+Collier: ${cbcShare !== null ? fmt2(cbcShare) : "n/a"} (${fmtN(s.licenses_cbc_count_swfl)} CBC / ${fmtN(s.licenses_total_active_swfl)} total active)`,
        fetchedAt,
      ),
    },
    {
      metric: "licenses_applicants_swfl",
      label: "Contractor License Applicants in Pipeline — SWFL",
      value: s.applicants_swfl,
      direction: s.applicants_swfl > 0 ? "rising" : "stable",
      variable_type: "extensive",
      units: "applicants",
      display_format: "count",
      source: makeSource(
        `FL DBPR Construction Applicants (constr_app.csv) bulk extract — Lee+Collier county_code rows: ${fmtN(s.applicants_swfl)} applicants in pipeline`,
        fetchedAt,
      ),
    },
  ];

  const leeCollierActive = s.licenses_active_lee + s.licenses_active_collier;
  const dirLabel =
    direction === "bullish"
      ? "healthy — lapse rate below stress threshold"
      : direction === "bearish"
        ? "under stress — lapse rate above 10%"
        : "stable";

  const conclusion =
    `FL DBPR contractor licensing in Lee+Collier is ${dirLabel}. ` +
    `Active licenses: Lee ${fmtN(s.licenses_active_lee)}, Collier ${fmtN(s.licenses_active_collier)} (${fmtN(leeCollierActive)} combined). ` +
    `Lapse rate: ${lapseRate !== null ? fmt1pct(lapseRate) : "n/a"} of all licenses. ` +
    `New in last 12 months: ${fmtN(s.licenses_new_12m_swfl)}. ` +
    `Applicants in pipeline: ${fmtN(s.applicants_swfl)}.`;

  return {
    conclusion,
    key_metrics,
    caveats,
    direction,
    magnitude:
      lapseRate !== null ? Math.min(Math.abs(lapseRate / LAPSE_RATE_BEARISH_THRESHOLD), 1) : 0,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

// ── PackDefinition ────────────────────────────────────────────────────────────

export const licensesSwfl: PackDefinition = {
  id: "licenses-swfl",
  brain_id: "licenses-swfl",
  public_label: "Business Licenses",
  domain: "real-estate",
  scope:
    "SWFL contractor licensing health — FL DBPR Construction Board (06) + Electrical Board (08) license counts, lapse rate, and applicant pipeline for Lee + Collier counties.",
  ttl_seconds: 30 * 24 * 60 * 60,

  sources: [flDbprLicensesSource],
  input_brains: [],

  fitScore: () => 8,

  skipSynthesisAgent: true,
  skipTriageAgent: true,

  corpusSummary: licensesSwflCorpusSummary,
  outputProducer: licensesSwflOutputProducer,

  preferences: [
    "The lapse rate is the headline signal — a rising lapse rate indicates contractor workforce contraction, a leading indicator of reduced construction capacity.",
    "CBC share (board 06 fraction of all active licenses) tracks the general-contractor vs specialist balance; declining CBC share may signal trade specialization trends. No universal bullish/bearish polarity.",
    "New-license 12-month count is a pipeline health metric — near-zero means the ingest or DBPR extract is stale, not a real market signal.",
    "Applicants count is a leading indicator of future active-license growth.",
  ],
  activeProject:
    "licenses-swfl: track SWFL contractor licensing health as a forward indicator of construction capacity and workforce availability.",
  prompts: {
    triageContext:
      "A DBPR contractor license record is decision-relevant when it covers Lee or Collier county, is in active or recently-expired status, and belongs to a construction or electrical trade board.",
    synthesisContext:
      "Surface the lapse rate as the headline signal. Quote absolute active counts (Lee vs Collier) for geographic context. Flag explicitly when this is a first-run with no historical baseline. Never infer project-level demand from license counts alone.",
  },
};
