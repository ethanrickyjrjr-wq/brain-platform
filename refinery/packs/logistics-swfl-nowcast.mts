import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutput,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";
import {
  fdotFreightSegmentsSource,
  AVG_PAYLOAD_TONS_PER_TRUCK,
  LATEST_FDOT_YEAR,
  type FreightSegmentNormalized,
  type ShockLogRow,
} from "../sources/fdot-freight-source.mts";
import {
  makeBrainInputSource,
  type BrainInputNormalized,
} from "../sources/brain-input-source.mts";
import { env } from "../config/env.mts";

/**
 * logistics-swfl-nowcast — daily FDOT-vs-FDOT-history freight-activity
 * deviation read. THIRTEENTH PACK in the brain factory.
 *
 * Path B refactor (2026-05-18, post-commit 297ad23): the v1 design compared
 * FDOT freight ACTIVITY (segment counts of AADT × payload × miles) against
 * FAF5 inbound FLOW (tons delivered to SWFL annually). Two compounding bugs:
 *   1. Dimensional — ton-miles vs tons.
 *   2. Population  — pass-through vs delivered.
 * Path B replaces the baseline with FDOT's own rolling history of the same
 * activity proxy. The math is now apples-to-apples by construction. The FAF5
 * value stays in the output as CONTEXT (a labeled audited flow number) but is
 * no longer the math anchor.
 *
 * Thin pipe (v1.1 non-negotiable #1): the upstream logistics-swfl brain's
 * `--- OUTPUT ---` block still feeds in via the brain-input source, but its
 * `inbound_freight_tons_swfl` metric is consumed as DISPLAY CONTEXT only —
 * the FAF5 value is exposed verbatim in the output. Path B does NOT reach
 * into logistics-swfl's branches.
 *
 * Math (v1.1 non-negotiable #2 — deterministic, never LLM):
 *   current_activity   = Σ segments(AADT × tfctr × payload × 365)         [tons/year]
 *   rolling_mean       = mean(shock_log.current_activity_tons_year[-N:])
 *   rolling_stddev     = stddev(shock_log.current_activity_tons_year[-N:])
 *   deviation_z        = (current_activity - rolling_mean) / rolling_stddev
 * where N = COLD_START_THRESHOLD_DAYS (90). If history has fewer than N rows
 * with a non-null activity value, the brain suppresses z and emits the
 * `insufficient_history` caveat instead.
 *
 * shock_state state machine (Path B):
 *   |z| <= 3                              → "normal"
 *   |z| > 3 for >= 3 consecutive days     → "anomaly"
 *   |z| > 3 for >= 30 consecutive days    → "structural_break"
 *   |z| > 3 for >= 90 consecutive days    → baseline_validity_flag flips to
 *                                           "stale-structural" (sticky)
 *   history < COLD_START_THRESHOLD_DAYS   → "insufficient_history" (suppress
 *                                           z, hold state-machine progression)
 *
 * Stale-upstream cascade (CLAUDE.md non-negotiable #5): handled by Stage 4's
 * Lane 2E machinery via the `input_brains` edge to logistics-swfl. Under
 * Path B the cascade NO LONGER means "the deviation math is compromised"
 * (the math no longer depends on the upstream value) — it now means "the
 * FAF5 context paragraph in the output may be outdated." Confidence
 * capping still applies.
 */

// ---------------------------------------------------------------------
// Constants & thresholds (locked from Path B refactor).
// ---------------------------------------------------------------------

const BASELINE_UPSTREAM_ID = "logistics-swfl";
const FAF5_CONTEXT_METRIC = "inbound_freight_tons_swfl";

// inbound_freight_tons_swfl is published in THOUSAND tons; the conversion
// multiplier brings it onto the same display basis as the FDOT-derived
// activity. Used for CONTEXT framing only — not the math anchor.
const THOUSAND_TONS_TO_TONS = 1000;

const Z_BREACH_THRESHOLD = 3;
const ANOMALY_CONSECUTIVE_DAYS = 3;
const STRUCTURAL_BREAK_CONSECUTIVE_DAYS = 30;
const STALE_STRUCTURAL_CONSECUTIVE_DAYS = 90;

/**
 * Cold-start threshold — number of prior shock-log rows with non-null
 * current_activity_tons_year required before the brain will compute a z-score.
 *
 * Chosen at 90 days. Rationale: this is the same operational horizon as
 * STALE_STRUCTURAL_CONSECUTIVE_DAYS. Below 90 days the rolling stddev is
 * dominated by short-term noise (one weather event, one closure week) and
 * the structural-break / stale-structural escalation has nothing to compare
 * against. Picking the same threshold for "we have enough history to do math"
 * and "we have enough sustained breach to flag the baseline stale" keeps the
 * brain's operational horizons aligned — no one has to remember two numbers.
 *
 * Below this threshold the brain returns shock_state = "insufficient_history",
 * deviation_z = null (suppressed), and a verbatim caveat. The state machine
 * does not progress on cold-start days.
 */
export const COLD_START_THRESHOLD_DAYS = 90;

/** Rolling-window size for the mean/stddev computation. Set equal to the
 * cold-start threshold by design — once the brain has enough history to
 * leave cold start, every subsequent day's math uses the same 90-day window.
 * If a longer window is desired later, bump SHOCK_LOG_PULL_COUNT in the
 * connector to match. */
export const ROLLING_WINDOW_DAYS = 90;

export type ShockState =
  | "normal"
  | "anomaly"
  | "structural_break"
  | "insufficient_history";
export type BaselineValidityFlag = "valid" | "stale-structural";

// ---------------------------------------------------------------------
// Per-pipeline-run state — populated by corpusSummary, read by producer.
// (Same pattern as macro-swfl / master / cre-swfl.)
// ---------------------------------------------------------------------

interface NowcastSnapshot {
  segments: FreightSegmentNormalized[];
  priorShockLog: ShockLogRow[];
  baselineOutput: BrainOutput | null;
  fetched_at: string;
}

let lastSnapshot: NowcastSnapshot | null = null;

// ---------------------------------------------------------------------
// Pure helpers (unit-tested).
// ---------------------------------------------------------------------

function segmentsFrom(fragments: RawFragment[]): FreightSegmentNormalized[] {
  return fragments
    .map((f) => f.normalized as unknown as FreightSegmentNormalized)
    .filter((n) => n?.kind === "fdot-freight-segment");
}

function shockLogFrom(fragments: RawFragment[]): ShockLogRow[] {
  return fragments
    .map((f) => f.normalized as unknown as ShockLogRow)
    .filter((n) => n?.kind === "fdot-freight-shock-log")
    .sort((a, b) => Date.parse(a.refined_at) - Date.parse(b.refined_at));
}

function baselineOutputFrom(fragments: RawFragment[]): BrainOutput | null {
  for (const f of fragments) {
    const n = f.normalized as unknown as BrainInputNormalized;
    if (n?.kind === "brain-input" && n.upstream_id === BASELINE_UPSTREAM_ID) {
      return n.output;
    }
  }
  return null;
}

/**
 * Pure rolling-stats helper. Walks the SHOCK_LOG_WINDOW most recent rows with
 * a non-null `current_activity_tons_year` and returns {mean, stddev, observed}.
 * Exposed for testing. `observed` is the count of rows that contributed —
 * callers use this to decide whether the cold-start gate is met.
 *
 * Walks the tail of the array (the connector guarantees oldest-first order),
 * collecting up to `window` rows where current_activity_tons_year is not null.
 * Cold-start rows logged with null activity are skipped without counting.
 */
export function rollingActivityStats(
  log: readonly ShockLogRow[],
  window: number = ROLLING_WINDOW_DAYS,
): { mean: number; stddev: number; observed: number } {
  const values: number[] = [];
  for (let i = log.length - 1; i >= 0 && values.length < window; i--) {
    const v = log[i].current_activity_tons_year;
    if (typeof v === "number" && Number.isFinite(v)) values.push(v);
  }
  const observed = values.length;
  if (observed === 0) return { mean: 0, stddev: 0, observed: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / observed;
  // Population stddev (not sample stddev) — we treat the rolling window as
  // the population for the purpose of z-scoring the current run. With a
  // 90-day window the difference is ~0.6% and the deterministic-math
  // requirement weighs heavier than the unbiased-estimator nicety.
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / observed;
  const stddev = Math.sqrt(variance);
  return { mean, stddev, observed };
}

/**
 * Compute the next consecutive_breach_days count given prior log + current z.
 * Pure function — exported for unit testing the state machine in isolation.
 *
 * Rule (locked):
 *   - Current run breaches if |z| > Z_BREACH_THRESHOLD AND z is finite.
 *   - If current z is null (cold-start) → counter resets to 0 and the
 *     state-machine does NOT progress.
 *   - If current run does NOT breach → counter resets to 0.
 *   - If current run breaches but the most recent prior log entry had z of
 *     OPPOSITE sign (or did not breach) → counter resets to 1 (this is the
 *     first day of a new streak).
 *   - Otherwise counter = (count of consecutive prior breaches with matching
 *     z sign, walking backwards from the most recent log entry) + 1.
 */
export function nextConsecutiveBreachDays(
  currentZ: number | null,
  priorLog: readonly ShockLogRow[],
): number {
  if (currentZ == null || !Number.isFinite(currentZ)) return 0;
  if (Math.abs(currentZ) <= Z_BREACH_THRESHOLD) return 0;
  const currentSign = Math.sign(currentZ);
  // Walk priorLog backwards (most-recent-first). Each prior breach with
  // matching sign adds 1 to the streak. A break (no breach, sign flip, or
  // missing z) stops the count.
  let count = 1; // current run is day 1 by default
  for (let i = priorLog.length - 1; i >= 0; i--) {
    const entry = priorLog[i];
    if (entry.deviation_z == null) break;
    if (Math.abs(entry.deviation_z) <= Z_BREACH_THRESHOLD) break;
    if (Math.sign(entry.deviation_z) !== currentSign) break;
    count += 1;
  }
  return count;
}

/** Classify shock_state from a consecutive_breach_days count + cold-start signal.
 * When `coldStart` is true, the state machine returns "insufficient_history"
 * regardless of the counter (the counter is itself 0 in that case). Pure. */
export function classifyShockState(
  consecutiveBreachDays: number,
  coldStart = false,
): ShockState {
  if (coldStart) return "insufficient_history";
  if (consecutiveBreachDays >= STRUCTURAL_BREAK_CONSECUTIVE_DAYS) {
    return "structural_break";
  }
  if (consecutiveBreachDays >= ANOMALY_CONSECUTIVE_DAYS) {
    return "anomaly";
  }
  return "normal";
}

/**
 * Decide baseline_validity_flag. Once a prior run flipped to "stale-structural"
 * the flag stays sticky for the duration of the chain — the log is the source
 * of truth, not in-memory state. A current 90-day streak ALSO flips the flag
 * even if no prior log entry was stale (first-time flip). Cold-start runs
 * never flip the flag (they don't even progress the consecutive counter).
 */
export function decideBaselineValidityFlag(
  consecutiveBreachDays: number,
  priorLog: readonly ShockLogRow[],
): BaselineValidityFlag {
  if (consecutiveBreachDays >= STALE_STRUCTURAL_CONSECUTIVE_DAYS) {
    return "stale-structural";
  }
  for (const entry of priorLog) {
    if (entry.baseline_validity_flag === "stale-structural") {
      return "stale-structural";
    }
  }
  return "valid";
}

// ---------------------------------------------------------------------
// corpusSummary — pure deterministic, sets snapshot for the producer.
// ---------------------------------------------------------------------

function logisticsNowcastCorpusSummary(
  allFragments: RawFragment[],
): SynthesisFact[] {
  const segments = segmentsFrom(allFragments);
  const priorShockLog = shockLogFrom(allFragments);
  const baselineOutput = baselineOutputFrom(allFragments);
  const fetched_at =
    allFragments[0]?.fetched_at ??
    new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  lastSnapshot = { segments, priorShockLog, baselineOutput, fetched_at };

  const facts: SynthesisFact[] = [];
  const currentActivity = segments.reduce(
    (s, seg) => s + seg.activity_tons_per_year,
    0,
  );
  const { observed } = rollingActivityStats(priorShockLog);
  facts.push({
    topic: "corpus_overview",
    fact: "FDOT freight-coded corpus — Lee + Collier interstates + US routes",
    value:
      `${segments.length} freight-coded FDOT segments (I-* + US-*) for Lee + Collier in year ${LATEST_FDOT_YEAR}. ` +
      `Connector pre-computed per-segment annualized activity tons; corpus total: ${Math.round(currentActivity).toLocaleString("en-US")} tons/year. ` +
      `Prior shock-log entries available: ${priorShockLog.length} (${observed} with non-null activity in the last ${ROLLING_WINDOW_DAYS} days). ` +
      `Upstream FAF5 context (logistics-swfl) available: ${baselineOutput ? "yes" : "no"}.`,
    source_fragment_ids: [],
  });

  if (baselineOutput) {
    const faf5Metric = baselineOutput.key_metrics.find(
      (m) => m.metric === FAF5_CONTEXT_METRIC,
    );
    if (faf5Metric) {
      facts.push({
        topic: "faf5_context",
        fact: "Upstream logistics-swfl FAF5 context (display only)",
        value:
          `logistics-swfl (confidence ${baselineOutput.confidence.toFixed(2)}, refined ${baselineOutput.refined_at.slice(0, 10)}) ` +
          `reports ${FAF5_CONTEXT_METRIC} = ${faf5Metric.value} thousand tons/year (= ${(Number(faf5Metric.value) * THOUSAND_TONS_TO_TONS).toLocaleString("en-US")} tons/year). ` +
          `Path B: this value is CONTEXT only — the deviation z-score below is computed against FDOT's own rolling history, not against the FAF5 number.`,
        source_fragment_ids: [],
      });
    }
  }
  return facts;
}

// ---------------------------------------------------------------------
// outputProducer — does all the math + builds key_metrics + caveats.
// ---------------------------------------------------------------------

function buildFdotSource(
  fetched_at: string,
  segmentCount: number,
): BrainOutputMetricSource {
  const url =
    env.source === "live" && env.supabaseUrl
      ? `${env.supabaseUrl}/rest/v1/fdot_aadt_fl?select=year_,county,roadway,desc_frm,desc_to,aadt,tfctr,shape_length&county=in.(LEE,COLLIER)&year_=eq.${LATEST_FDOT_YEAR}`
      : "fixture://refinery/__fixtures__/logistics-swfl-nowcast.sample.json";
  const provenance =
    env.source === "live"
      ? `FDOT AADT freight-coded segments (data_lake.fdot_aadt_fl filtered to I-* + US-* roadways, Lee + Collier, year ${LATEST_FDOT_YEAR})`
      : `FDOT AADT freight-coded segments (fixture; refinery/__fixtures__/logistics-swfl-nowcast.sample.json)`;
  return {
    url,
    fetched_at,
    tier: 2,
    citation:
      `${provenance} — ` +
      `${segmentCount} segments contributed to the annualized current-activity tonnage proxy.`,
  };
}

function buildBrainInputSource(
  upstream: BrainOutput,
  fetched_at: string,
): BrainOutputMetricSource {
  return {
    url: `https://www.swfldatagulf.com/api/b/${BASELINE_UPSTREAM_ID}`,
    fetched_at,
    tier: upstream.trust_tier,
    citation:
      `Upstream brain ${BASELINE_UPSTREAM_ID} (confidence ${upstream.confidence.toFixed(2)}, ` +
      `refined ${upstream.refined_at.slice(0, 10)}) — supplies the FAF5 inbound-flow CONTEXT number (not the math anchor under Path B).`,
  };
}

function emptyProducerResult(reason: string): BrainOutputProducerResult {
  return {
    conclusion: `logistics-swfl-nowcast could not compute a freight deviation read: ${reason}`,
    key_metrics: [],
    caveats: [
      reason,
      "Check the FDOT freight connector if segments are missing; the upstream logistics-swfl brain is no longer load-bearing for the math but is still consulted for FAF5 context framing.",
    ],
    direction: "neutral",
    magnitude: 0,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

/** Render the two-sentence FAF5 framing demanded by the Path B contract.
 * Exposed (not inlined) so tests can assert the exact template verbatim. */
export function renderFaf5ContextSentences(
  faf5InboundTonsYear: number,
  faf5RefinedYear: number,
): string {
  return (
    `FAF5 audited annual inbound freight: ${faf5InboundTonsYear.toLocaleString("en-US")} tons (CY${faf5RefinedYear}). ` +
    `This is a flow metric; the deviation below is an activity metric from FDOT segment counts.`
  );
}

function logisticsNowcastOutputProducer(
  _out: PackOutput,
): BrainOutputProducerResult {
  const snap = lastSnapshot;
  if (!snap) {
    return emptyProducerResult("no fragments received");
  }
  const { segments, priorShockLog, baselineOutput, fetched_at } = snap;

  if (segments.length === 0) {
    return emptyProducerResult(
      "FDOT freight connector returned no segments — cannot compute current_activity",
    );
  }

  // ----- Deterministic activity math (no upstream dependency) -----
  const currentActivity = segments.reduce(
    (s, seg) => s + seg.activity_tons_per_year,
    0,
  );
  const {
    mean: rollingMean,
    stddev: rollingStddev,
    observed: historyDays,
  } = rollingActivityStats(priorShockLog);
  const coldStart = historyDays < COLD_START_THRESHOLD_DAYS;

  const deviationZ =
    coldStart || rollingStddev === 0
      ? null
      : (currentActivity - rollingMean) / rollingStddev;
  const deviationPct =
    coldStart || rollingMean === 0
      ? null
      : ((currentActivity - rollingMean) / rollingMean) * 100;

  // ----- State-machine reads -----
  const consecutiveBreachDays = nextConsecutiveBreachDays(
    deviationZ,
    priorShockLog,
  );
  const shockState = classifyShockState(consecutiveBreachDays, coldStart);
  const baselineValidityFlag = decideBaselineValidityFlag(
    consecutiveBreachDays,
    priorShockLog,
  );

  const fdotSourceMeta = buildFdotSource(fetched_at, segments.length);

  // ----- FAF5 context (display-only) -----
  // Path B: FAF5 is preserved as a labeled CONTEXT metric. The presence of
  // the upstream brain output is OPTIONAL — if it's missing the math still
  // runs; we just skip the FAF5 metric and the context sentences.
  const faf5Metric = baselineOutput
    ? baselineOutput.key_metrics.find((m) => m.metric === FAF5_CONTEXT_METRIC)
    : null;
  const faf5InboundTonsYear =
    faf5Metric && typeof faf5Metric.value === "number"
      ? faf5Metric.value * THOUSAND_TONS_TO_TONS
      : null;
  const faf5SourceMeta =
    baselineOutput && faf5InboundTonsYear != null
      ? buildBrainInputSource(baselineOutput, fetched_at)
      : null;

  const key_metrics: BrainOutputMetric[] = [];

  if (faf5InboundTonsYear != null && faf5SourceMeta) {
    key_metrics.push({
      metric: "faf5_inbound_flow_tons_year",
      value: Math.round(faf5InboundTonsYear),
      direction: "stable",
      label: `FAF5 audited annual inbound freight FLOW to SWFL (CONTEXT — not the math anchor; the deviation z below is computed against FDOT's own rolling history)`,
      variable_type: "extensive",
      units: "tons/year",
      display_format: "count",
      source: faf5SourceMeta,
    });
  }

  key_metrics.push({
    metric: "current_activity_tons_year",
    value: Math.round(currentActivity),
    direction:
      rollingMean === 0
        ? "stable"
        : currentActivity > rollingMean * 1.01
          ? "rising"
          : currentActivity < rollingMean * 0.99
            ? "falling"
            : "stable",
    label: `Current-state freight ACTIVITY proxy from FDOT AADT × tfctr × payload × 365 (annualized tons crossing the freight-coded corpus)`,
    variable_type: "extensive",
    units: "tons/year",
    display_format: "count",
    source: fdotSourceMeta,
  });

  key_metrics.push({
    metric: "rolling_mean_activity_tons_year",
    value: Math.round(rollingMean),
    direction: "stable",
    label: `Rolling-mean baseline (last ${historyDays} of up to ${ROLLING_WINDOW_DAYS} prior runs) — the actual math anchor for the deviation z below`,
    variable_type: "extensive",
    units: "tons/year",
    display_format: "count",
    source: fdotSourceMeta,
  });

  key_metrics.push({
    metric: "rolling_stddev_activity_tons_year",
    value: Math.round(rollingStddev),
    direction: "stable",
    label: `Rolling-stddev baseline (population stddev over the same window) — denominator of the deviation z below`,
    variable_type: "extensive",
    units: "tons/year",
    display_format: "count",
    source: fdotSourceMeta,
  });

  key_metrics.push({
    metric: "history_days_observed",
    value: historyDays,
    direction: "stable",
    label: `Count of prior shock-log rows with non-null activity in the rolling window — must be ≥ ${COLD_START_THRESHOLD_DAYS} for z computation to proceed`,
    variable_type: "extensive",
    units: "days",
    display_format: "count",
    source: fdotSourceMeta,
  });

  // Path B: on cold-start runs deviation_z and deviation_pct are SUPPRESSED
  // (not emitted at all). Downstream consumers should rely on
  // history_days_observed + shock_state="insufficient_history" to detect the
  // suppression. Emitting a value of 0 or null would be ambiguous against a
  // genuine zero-deviation reading.
  if (!coldStart && deviationZ != null && deviationPct != null) {
    key_metrics.push({
      metric: "deviation_z",
      value: Math.round(deviationZ * 100) / 100,
      direction:
        deviationZ > 0.5 ? "rising" : deviationZ < -0.5 ? "falling" : "stable",
      label:
        "Deviation z-score: (current_activity − rolling_mean) / rolling_stddev",
      variable_type: "intensive",
      units: "z-score",
      display_format: "ratio",
      source: fdotSourceMeta,
    });

    key_metrics.push({
      metric: "deviation_pct",
      value: Math.round(deviationPct * 10) / 10,
      direction:
        deviationPct > 1 ? "rising" : deviationPct < -1 ? "falling" : "stable",
      label: "Deviation as percent of rolling_mean",
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: fdotSourceMeta,
    });
  }

  key_metrics.push({
    metric: "shock_state",
    value: shockState,
    direction: "stable",
    label:
      "Shock-state classifier (normal | anomaly | structural_break | insufficient_history)",
    variable_type: "categorical",
    source: fdotSourceMeta,
  });

  key_metrics.push({
    metric: "baseline_validity_flag",
    value: baselineValidityFlag,
    direction: "stable",
    label:
      "Baseline-validity flag (valid | stale-structural, sticky once stale)",
    variable_type: "categorical",
    source: fdotSourceMeta,
  });

  key_metrics.push({
    metric: "consecutive_breach_days",
    value: consecutiveBreachDays,
    direction:
      consecutiveBreachDays > 0 && deviationZ != null
        ? deviationZ > 0
          ? "rising"
          : "falling"
        : "stable",
    label:
      "Consecutive prior refines (incl. this one) where |z| > 3 with matching sign — cold-start runs do not progress the counter",
    variable_type: "extensive",
    units: "days",
    display_format: "count",
    source: fdotSourceMeta,
  });

  key_metrics.push({
    metric: "freight_segment_count",
    value: segments.length,
    direction: "stable",
    label: "Freight-coded FDOT segments contributing to current_activity",
    variable_type: "extensive",
    units: "segments",
    display_format: "count",
    source: fdotSourceMeta,
  });

  key_metrics.push({
    metric: "avg_payload_tons_per_truck",
    value: AVG_PAYLOAD_TONS_PER_TRUCK,
    direction: "stable",
    label:
      "Assumed combination-truck average payload — FHWA Highway Statistics 2023, Table VM-1",
    variable_type: "intensive",
    units: "tons/truck",
    display_format: "raw",
    source: {
      url: "https://www.fhwa.dot.gov/policyinformation/statistics/2023/vm1.cfm",
      fetched_at,
      tier: 1,
      citation:
        "FHWA Highway Statistics 2023, Table VM-1 — combination-truck average payload assumption (16.0 tons).",
    },
  });

  // ----- Conclusion (deterministic narrative) -----
  // Two-sentence FAF5 framing is the locked Path B contract (requirement #3).
  // It runs FIRST in the conclusion so it's impossible to misread the FAF5
  // value as the math baseline.
  const conclusionParts: string[] = [];
  if (faf5InboundTonsYear != null && baselineOutput) {
    const faf5Year =
      Number(baselineOutput.refined_at.slice(0, 4)) || LATEST_FDOT_YEAR;
    conclusionParts.push(
      renderFaf5ContextSentences(Math.round(faf5InboundTonsYear), faf5Year),
    );
  }

  if (coldStart) {
    conclusionParts.push(
      `Current freight activity (annualized from ${segments.length} freight-coded FDOT segments) is ${Math.round(currentActivity).toLocaleString("en-US")} tons/year. ` +
        `Shock-state: ${shockState}. Only ${historyDays}/${COLD_START_THRESHOLD_DAYS} required days of rolling-baseline history are available — deviation z is suppressed until the history matures.`,
    );
  } else {
    conclusionParts.push(
      `Current freight activity (annualized from ${segments.length} freight-coded FDOT segments) is ${Math.round(currentActivity).toLocaleString("en-US")} tons/year ` +
        `against a ${Math.round(rollingMean).toLocaleString("en-US")} tons/year rolling baseline (${historyDays}-day window, σ = ${Math.round(rollingStddev).toLocaleString("en-US")}) — deviation z = ${(Math.round((deviationZ ?? 0) * 100) / 100).toFixed(2)} (${(Math.round((deviationPct ?? 0) * 10) / 10).toFixed(1)}%).`,
    );
    conclusionParts.push(
      `Shock-state: ${shockState}. Baseline-validity flag: ${baselineValidityFlag}. Consecutive breach days: ${consecutiveBreachDays}.`,
    );
    if (shockState === "anomaly") {
      conclusionParts.push(
        "Anomaly state means |z| has stayed > 3 with matching sign for at least 3 consecutive refines — short-window deviation worth investigating.",
      );
    } else if (shockState === "structural_break") {
      conclusionParts.push(
        "Structural-break state means |z| has stayed > 3 with matching sign for at least 30 consecutive refines — current activity has diverged from the rolling FDOT history at multi-month timescales.",
      );
    }
  }

  // ----- Caveats -----
  const caveats: string[] = [
    `Path B (post-commit 297ad23): deviation math compares CURRENT FDOT segment-count activity (Σ AADT × tfctr × payload × 365) against the rolling mean/stddev of the same quantity in the last ${ROLLING_WINDOW_DAYS} days of shock-log history. The FAF5 number above is preserved as audited CONTEXT but is no longer the math anchor — the prior v1 design comparing FDOT activity to FAF5 flow had dimensional + population mismatches.`,
    `Daily-cadence shock detection uses a synthetic per-day denominator (annual tons_per_year ÷ 365) because Tier 2 carries only annual FDOT AADT. 30d / 90d escalation thresholds will rarely fire from current Tier 2 data alone — true daily AADT-equivalent (FDOT continuous-count stations) is reserved for v2 ingest.`,
    `Conversion math: activity_tons_per_year_per_segment = AADT × tfctr × ${AVG_PAYLOAD_TONS_PER_TRUCK} × 365. The 16.0 tons/truck payload is FHWA HS 2023 Table VM-1 (combination trucks); commodity-mix shifts (heavy gravel vs light electronics) are not modeled in v1.`,
    `Path B over-counts pass-through traffic (one truck traversing five segments contributes to five segment counts) — the over-count is constant across days and cancels in the z-score, but the headline tons/year number should NOT be compared directly to FAF5 flow.`,
    `Scheduled FDOT construction closures look mathematically identical to genuine slowdowns; v1 has no calendar-aware filter to separate the two.`,
  ];
  if (coldStart) {
    caveats.unshift(
      `Insufficient history: only ${historyDays} of ${COLD_START_THRESHOLD_DAYS} required prior shock-log rows are available — deviation z is suppressed and the shock-state machine is held at "insufficient_history" until the rolling baseline matures.`,
    );
  }
  if (baselineValidityFlag === "stale-structural") {
    caveats.unshift(
      `Baseline validity flag flipped to stale-structural at ${new Date().toISOString().slice(0, 10)}: |z|>3 sustained for 90+ consecutive days against the rolling FDOT history baseline. Even within the same population the rolling mean has drifted enough to warrant operator review — request a rolling-window reset before consuming downstream.`,
    );
  }
  if (env.source === "fixture") {
    caveats.unshift(
      "FDOT freight segments and shock-log entries in this build are synthetic fixture data — unset REFINERY_SOURCE or set it to `live` to query data_lake.fdot_aadt_fl + data_lake.fdot_freight_nowcast_shock_log.",
    );
  }

  // ----- Direction / magnitude (deterministic) -----
  // Convention: a negative deviation (current < rolling) reads bearish for
  // freight throughput; a positive deviation reads bullish. shock_state ramps
  // magnitude — anomaly is half a signal, structural_break is full.
  // Cold-start runs return neutral / zero magnitude (no signal to surface).
  let direction: BrainOutputProducerResult["direction"] = "neutral";
  if (deviationZ != null) {
    if (deviationZ <= -Z_BREACH_THRESHOLD) direction = "bearish";
    else if (deviationZ >= Z_BREACH_THRESHOLD) direction = "bullish";
  }

  let magnitude = coldStart ? 0 : Math.min(1, Math.abs(deviationZ ?? 0) / 6);
  if (shockState === "anomaly") magnitude = Math.max(magnitude, 0.6);
  if (shockState === "structural_break") magnitude = Math.max(magnitude, 0.8);
  if (baselineValidityFlag === "stale-structural") {
    // Once the rolling baseline is stale-structural we are LESS confident in
    // the deviation read (the rolling mean we are comparing against may
    // itself have drifted from "what the corpus has historically looked
    // like"). Dampen.
    magnitude = Math.min(magnitude, 0.3);
  }

  return {
    conclusion: conclusionParts.join(" "),
    key_metrics,
    caveats,
    direction,
    magnitude,
    drivers: baselineOutput ? [BASELINE_UPSTREAM_ID] : [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

// ---------------------------------------------------------------------
// PackDefinition export.
// ---------------------------------------------------------------------

const logisticsNowcastPreferences = [
  "The user reads the nowcast as a fast deviation gauge — the math anchor is FDOT's own rolling history (Path B), not the FAF5 baseline. FAF5 is preserved as audited CONTEXT.",
  "The user understands shock_state is a deterministic z-score classifier, not an LLM judgment.",
  "The user knows baseline_validity_flag flips sticky once a 90-day structural break is detected against the rolling baseline — at which point the rolling window itself should be re-examined.",
];

export const logisticsSwflNowcast: PackDefinition = {
  id: "logistics-swfl-nowcast",
  brain_id: "logistics-swfl-nowcast",
  public_label: "Logistics Nowcast",
  domain: "logistics",
  scope:
    "Current-state freight-activity nowcast for SWFL — derives a daily activity proxy from FDOT AADT × tfctr × payload, compares against the brain's OWN rolling history (Path B), and classifies shock_state + baseline_validity_flag. FAF5 inbound-flow is preserved as audited CONTEXT.",
  ttl_seconds: 86400, // 24h — FDOT refreshes nightly in production
  sources: [
    fdotFreightSegmentsSource,
    makeBrainInputSource(BASELINE_UPSTREAM_ID),
  ],
  // Path B semantic shift: the upstream logistics-swfl brain is no longer
  // load-bearing for the math (the deviation z is computed against rolling
  // FDOT history, not against FAF5). The edge is retained so Stage 4's Lane 2E
  // stale-upstream cascade still fires — staleness now means the FAF5 context
  // paragraph in the output may be outdated, not that the math is compromised.
  input_brains: [{ id: BASELINE_UPSTREAM_ID, edge_type: "input" }],
  fitScore: () => 8,
  compositeCutoff: 0,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: logisticsNowcastCorpusSummary,
  outputProducer: logisticsNowcastOutputProducer,
  synthesisStrategy: "deterministic",
  preferences: logisticsNowcastPreferences,
  activeProject:
    "logistics-swfl-nowcast: daily freight-activity deviation read against the brain's rolling FDOT history (Path B).",
  prompts: {
    triageContext:
      "Fragments are (a) one BrainInput OUTPUT from logistics-swfl carrying the FAF5 inbound-flow CONTEXT value, (b) per-segment freight-activity readings derived from FDOT AADT × tfctr × payload, and (c) prior shock-log rows that drive both the consecutive-day breach counter AND the rolling mean/stddev baseline that anchors the deviation z-score.",
    synthesisContext:
      "Pure deterministic — outputProducer computes current_activity, rolling-mean/stddev from shock_log history, the cold-start gate, deviation_z, the shock_state state machine, and the baseline_validity_flag. No LLM in the output path.",
  },
};
