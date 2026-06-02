import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
} from "../types/brain-output.mts";
import type { SynthesisFact } from "../types/event.mts";
import {
  dbprSirsSource,
  type DbprSirsSummary,
} from "../sources/dbpr-sirs-source.mts";

const SOURCE_ID = "dbpr_sirs_submissions";

// Probe-validated floor: 9 pre-July + 271 July+ = 280 SWFL rows at scrape time
// (2026-06-01 session). Live run landed 239 rows on first ingest (Qlik hypercube
// fires non-deterministically). Magnitude scales against 280 so a count at or
// above the baseline yields 1.0. Not a compliance denominator — a data-volume
// signal only.
const SIRS_SWFL_EXPECTED_FLOOR = 280;

// ── Closure state ─────────────────────────────────────────────────────────────

let lastSummary: DbprSirsSummary | null = null;
let lastFetchedAt: string | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtN = (n: number): string => n.toLocaleString("en-US");

function makeSource(
  citation: string,
  fetched_at: string,
): BrainOutputMetric["source"] {
  return {
    url: "https://dbpr-publicrecords.myfloridalicense.com/qpr/single/",
    fetched_at,
    tier: 1,
    citation,
  };
}

// ── corpusSummary ─────────────────────────────────────────────────────────────

function sirsCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  lastSummary = null;
  lastFetchedAt = null;

  const frag = allFragments.find((f) => f.source_id === SOURCE_ID);
  if (!frag) return [];

  const s = frag.normalized as unknown as DbprSirsSummary;
  if (s?.kind !== "dbpr-sirs-summary") return [];

  lastSummary = s;
  lastFetchedAt = frag.fetched_at;

  return [
    {
      topic: "dbpr_sirs_snapshot",
      fact: "DBPR SIRS confirmed filings — Lee + Collier (positive signal only)",
      value:
        `Total SWFL confirmed: ${fmtN(s.sirs_confirmed_swfl)} ` +
        `(Lee: ${fmtN(s.sirs_lee_count)}, Collier: ${fmtN(s.sirs_collier_count)}). ` +
        `July 2025+ (HB 913 era): ${fmtN(s.sirs_july2025_plus_count)}. ` +
        `Coverage flag: ${s.result_truncated_any ? "floor estimate" : "complete"}. ` +
        `Latest scrape: ${s.latest_scraped_at ?? "unknown"}.`,
      source_fragment_ids: [frag.fragment_id],
    },
  ];
}

// ── outputProducer ────────────────────────────────────────────────────────────

function sirsOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const s = lastSummary;
  const fetchedAt =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // Empty-data path: pipeline has not run yet
  if (!s || s.sirs_confirmed_swfl === 0) {
    return {
      conclusion:
        "condo-sirs-swfl: DBPR SIRS table returned 0 SWFL rows — the dbpr_sirs pipeline has not run yet or produced no Lee/Collier rows. Dispatch dbpr-sirs-monthly.yml to populate.",
      key_metrics: [],
      caveats: [
        "data_lake.dbpr_sirs_submissions has 0 Lee/Collier rows. Run: python -m ingest.pipelines.dbpr_sirs.pipeline",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  // Direction: neutral — positive-signal-only regulatory dataset, no denominator
  // for compliance rate, and the Qlik hypercube fires before all rows render so
  // the count is a floor. There is no polarity to evaluate.
  const direction = "neutral" as const;

  // Magnitude: how close to or above the probe-validated baseline?
  // 280 = floor observed 2026-06-01 (9 pre-July + 271 July+).
  // magnitude caps at 1.0; exceeding the floor is fine — more data, not more bullish.
  const magnitude = Math.min(
    s.sirs_confirmed_swfl / SIRS_SWFL_EXPECTED_FLOOR,
    1.0,
  );

  const coverageValue = s.result_truncated_any
    ? "floor estimate (Qlik limit fired)"
    : "complete";

  const caveats: string[] = [
    s.result_truncated_any
      ? `Qlik hypercube limit fired on both SIRS apps — ${fmtN(s.sirs_confirmed_swfl)} SWFL associations is a floor estimate, not a complete count. The true filing universe exceeds this number.`
      : "Qlik data coverage: complete (hypercube limit did not fire).",
    "Compliance rate cannot be derived — no baseline registry of all SWFL 3-story+ condominium associations exists in this dataset. Presence = confirmed SIRS filing; absence has no meaning.",
    "Pre-July 2025 rows represent a small visible slice of older filings — the statewide hypercube limit fires before most render.",
  ];

  if (s.sirs_confirmed_swfl < 50) {
    caveats.push(
      `Confirmed count is very low (${fmtN(s.sirs_confirmed_swfl)}) — likely first run or pipeline error; interpret with caution.`,
    );
  }

  const key_metrics: BrainOutputMetric[] = [
    {
      metric: "sirs_confirmed_swfl",
      label: "SIRS-Confirmed Associations — SWFL (Lee + Collier)",
      value: s.sirs_confirmed_swfl,
      direction: "stable",
      variable_type: "extensive",
      units: "associations",
      display_format: "count",
      source: makeSource(
        `DBPR SIRS Reporting Database — pre-July 2025 app (14f1ed21) + July 2025+ app (d217126f); Lee + Collier county_normalized; confirmed SIRS filings: ${fmtN(s.sirs_confirmed_swfl)}`,
        fetchedAt,
      ),
    },
    {
      metric: "sirs_lee_count",
      label: "SIRS-Confirmed Associations — Lee County",
      value: s.sirs_lee_count,
      direction: "stable",
      variable_type: "extensive",
      units: "associations",
      display_format: "count",
      source: makeSource(
        `DBPR SIRS Reporting Database — county_normalized=LEE rows: ${fmtN(s.sirs_lee_count)}`,
        fetchedAt,
      ),
    },
    {
      metric: "sirs_collier_count",
      label: "SIRS-Confirmed Associations — Collier County",
      value: s.sirs_collier_count,
      direction: "stable",
      variable_type: "extensive",
      units: "associations",
      display_format: "count",
      source: makeSource(
        `DBPR SIRS Reporting Database — county_normalized=COLLIER rows: ${fmtN(s.sirs_collier_count)}`,
        fetchedAt,
      ),
    },
    {
      metric: "sirs_july2025_plus_count",
      label: "SIRS Filings — HB 913 Era (July 2025+)",
      value: s.sirs_july2025_plus_count,
      direction: "stable",
      variable_type: "extensive",
      units: "associations",
      display_format: "count",
      source: makeSource(
        `DBPR SIRS Reporting Database — July 2025+ app (d217126f); database_period=july_2025_plus; Lee + Collier: ${fmtN(s.sirs_july2025_plus_count)}. Represents post-HB 913 compliance push.`,
        fetchedAt,
      ),
    },
    {
      metric: "sirs_result_truncated",
      label: "Qlik Data Coverage — SIRS Registry",
      value: coverageValue,
      direction: "stable",
      variable_type: "categorical",
      source: makeSource(
        `DBPR SIRS Qlik apps — coverage flag set when 'Load more' visible at scrape end (Qlik hypercube limit). Current: "${coverageValue}".`,
        fetchedAt,
      ),
    },
  ];

  const scrapeDate = s.latest_scraped_at
    ? s.latest_scraped_at.slice(0, 10)
    : "unknown";

  const conclusion =
    `DBPR confirms ${fmtN(s.sirs_confirmed_swfl)} SWFL condominium and cooperative associations have submitted their Structural Integrity Reserve Study as of ${scrapeDate}. ` +
    `Lee County: ${fmtN(s.sirs_lee_count)}, Collier County: ${fmtN(s.sirs_collier_count)}. ` +
    `Of these, ${fmtN(s.sirs_july2025_plus_count)} filed under the HB 913 compliance push (July 2025+ database). ` +
    `${s.result_truncated_any ? "These counts are floor estimates — the Qlik hypercube limit fires before the full statewide registry renders. " : ""}` +
    `This is a positive-signal-only registry: presence confirms SIRS filing; absence cannot be interpreted without a baseline count of all SWFL 3-story+ condominiums.`;

  return {
    conclusion,
    key_metrics,
    caveats,
    direction,
    magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

// ── PackDefinition ────────────────────────────────────────────────────────────

export const condoSirsSwfl: PackDefinition = {
  id: "condo-sirs-swfl",
  brain_id: "condo-sirs-swfl",
  public_label: "Condo Milestones",
  domain: "regulatory",
  scope:
    "SWFL condominium and cooperative associations that have confirmed Structural Integrity Reserve Study (SIRS) submission to DBPR. Lee + Collier counties. Source: DBPR SIRS Reporting Database (two Qlik apps: pre-July 2025 and July 2025+ submissions). Monthly scrape. Positive signal only — presence = confirmed filing; absence has no meaning without a baseline registry of all SWFL 3-story+ condominiums.",
  ttl_seconds: 30 * 24 * 60 * 60,

  sources: [dbprSirsSource],
  input_brains: [],

  fitScore: () => 6,
  compositeCutoff: 0,

  skipSynthesisAgent: true,
  skipTriageAgent: true,

  corpusSummary: sirsCorpusSummary,
  outputProducer: sirsOutputProducer,

  preferences: [
    "The SIRS count is an informational register, not a market-direction signal. Do not infer 'enough' or 'too few' from the count alone — the total required filer universe is unknown.",
    "The July 2025+ count (HB 913 era) is the more meaningful number: it reflects post-Surfside legislation compliance. The pre-July 2025 rows are a small visible slice of older filings.",
    "Coverage flag 'floor estimate' means the Qlik hypercube limit fired — counts understate the true filing universe. Expected on every run (statewide set exceeds Qlik render threshold).",
    "Absence of an association in this dataset does NOT mean non-compliance — it may simply be outside the Qlik render window.",
  ],
  activeProject:
    "condo-sirs-swfl: track SWFL HOA/condo SIRS filing confirmation counts as a structural-safety transparency signal for the Lee + Collier condo market.",
  prompts: {
    triageContext:
      "A DBPR SIRS row is decision-relevant when county_normalized is LEE or COLLIER. All rows in this dataset are confirmed complete filings.",
    synthesisContext:
      "Surface the total SWFL count and the July 2025+ subset as the headline numbers. Always note that these are floor estimates (coverage flag). Never imply compliance rate — the denominator is unknown. Distinguish pre-July vs post-HB 913 eras when relevant.",
  },
};
