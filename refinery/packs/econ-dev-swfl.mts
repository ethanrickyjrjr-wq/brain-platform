import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
  BrainOutputDirection,
} from "../types/brain-output.mts";
import {
  swflIncSource,
  type SwflIncNormalized,
} from "../sources/swfl-inc-source.mts";
import { env } from "../config/env.mts";

/**
 * econ-dev-swfl — SWFL economic development project announcements from
 * Southwest Florida Inc. (Lee County EDO), weekly scrape of swflinc.com.
 *
 * Source: public.swfl_inc_announcements (ingest/pipelines/swfl_inc,
 * cron Monday 08:00 UTC via swfl-inc-weekly.yml).
 *
 * Coverage: Lee + Collier + Charlotte counties (all announcements from the
 * official Lee County economic development organization's news feed).
 *
 * Key metrics:
 *   econ_dev_announcements_90d   — count of announcements in last 90 days
 *   econ_dev_investment_usd_90d  — sum of investment where disclosed, last 90 days
 *   econ_dev_jobs_90d            — sum of jobs announced where disclosed, last 90 days
 *   econ_dev_announcements_prior_90d — prior-window count (90–180 days ago), for momentum
 *
 * Leaf brain (no upstream brains). Direction vote: compare latest 90-day window
 * to prior 90-day window. Rising announcement count = bullish; falling = bearish.
 */

// ── Closure state ─────────────────────────────────────────────────────────────

let lastRows: SwflIncNormalized[] = [];
let lastFetchedAt: string | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsdMillions(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${(n / 1_000).toFixed(0)}K`;
}

function daysBefore(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function makeSource(
  fetchedAt: string,
  sourceUrl: string,
  label: string,
): BrainOutputMetric["source"] {
  return {
    url: sourceUrl || "https://www.swflinc.com/news/",
    fetched_at: fetchedAt,
    tier: 2,
    citation: `SWFL Inc. Economic Development Announcements — Lee County EDO (${label})`,
  };
}

// ── corpusSummary ─────────────────────────────────────────────────────────────

function econDevSwflCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const rows = allFragments
    .map((f) => f.normalized as unknown as SwflIncNormalized)
    .filter((n): n is SwflIncNormalized => n?.kind === "swfl-inc-announcement");

  lastRows = rows;
  lastFetchedAt = allFragments[0]?.fetched_at ?? null;

  if (rows.length === 0) return [];

  const cutoff90 = daysBefore(90);
  const cutoff180 = daysBefore(180);

  const recent = rows.filter(
    (r) => r.announced_date !== null && r.announced_date >= cutoff90,
  );
  const prior = rows.filter(
    (r) =>
      r.announced_date !== null &&
      r.announced_date >= cutoff180 &&
      r.announced_date < cutoff90,
  );

  const recentInv = recent.reduce(
    (s, r) => s + (r.investment_usd ?? 0),
    0,
  );
  const recentJobs = recent.reduce((s, r) => s + (r.jobs ?? 0), 0);
  const knownInvCount = recent.filter((r) => r.investment_usd != null).length;
  const knownJobsCount = recent.filter((r) => r.jobs != null).length;

  const facts: SynthesisFact[] = [];

  facts.push({
    topic: "econ_dev_snapshot",
    fact: `SWFL economic development pulse — latest 90 days`,
    value:
      `SWFL Inc. announcements (last 90 days): ${recent.length} projects. ` +
      (recentInv > 0
        ? `Disclosed investment: ${fmtUsdMillions(recentInv)} (${knownInvCount}/${recent.length} announced amounts). `
        : "") +
      (recentJobs > 0
        ? `Disclosed jobs: ${recentJobs.toLocaleString()} (${knownJobsCount}/${recent.length} stated job counts). `
        : "") +
      `Prior window (90–180 days): ${prior.length} projects. ` +
      (prior.length > 0
        ? `Momentum: ${recent.length > prior.length ? "rising" : recent.length < prior.length ? "falling" : "flat"}.`
        : ""),
    source_fragment_ids: [],
  });

  return facts;
}

// ── outputProducer ────────────────────────────────────────────────────────────

function econDevSwflOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const rows = lastRows;
  const fetchedAt =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (rows.length === 0) {
    return {
      conclusion:
        "econ-dev-swfl: no SWFL Inc. announcement data available — table may be empty or pipeline has not yet run.",
      key_metrics: [],
      caveats: [
        "swfl_inc_announcements table returned 0 rows. Run the swfl-inc-weekly pipeline.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const cutoff90 = daysBefore(90);
  const cutoff180 = daysBefore(180);

  const recent = rows.filter(
    (r) => r.announced_date !== null && r.announced_date >= cutoff90,
  );
  const prior = rows.filter(
    (r) =>
      r.announced_date !== null &&
      r.announced_date >= cutoff180 &&
      r.announced_date < cutoff90,
  );

  const recentInv = recent.reduce((s, r) => s + (r.investment_usd ?? 0), 0);
  const recentJobs = recent.reduce((s, r) => s + (r.jobs ?? 0), 0);

  const sourceUrl =
    rows.find((r) => r.source_url)?.source_url ?? "https://www.swflinc.com/news/";

  const key_metrics: BrainOutputMetric[] = [];

  // Metric 1 — announcement count, last 90 days
  key_metrics.push({
    metric: "econ_dev_announcements_90d",
    label: "Economic development announcements (last 90 days)",
    value: recent.length,
    direction:
      prior.length === 0
        ? "stable"
        : recent.length > prior.length
          ? "rising"
          : recent.length < prior.length
            ? "falling"
            : "stable",
    variable_type: "extensive",
    units: "count",
    display_format: "raw",
    source: makeSource(
      fetchedAt,
      sourceUrl,
      `${recent.length} announcements in last 90 days via swfl_inc_announcements`,
    ),
  });

  // Metric 2 — prior-window count (for momentum context)
  key_metrics.push({
    metric: "econ_dev_announcements_prior_90d",
    label: "Economic development announcements (prior 90-day window)",
    value: prior.length,
    direction: "stable",
    variable_type: "extensive",
    units: "count",
    display_format: "raw",
    source: makeSource(
      fetchedAt,
      sourceUrl,
      `${prior.length} announcements in 90–180 days prior window`,
    ),
  });

  // Metric 3 — disclosed investment sum, last 90 days
  if (recentInv > 0) {
    key_metrics.push({
      metric: "econ_dev_investment_usd_90d",
      label: "Total disclosed investment (last 90 days, USD)",
      value: recentInv,
      direction: "stable",
      variable_type: "extensive",
      units: "USD",
      display_format: "currency",
      source: makeSource(
        fetchedAt,
        sourceUrl,
        `${fmtUsdMillions(recentInv)} total across ${recent.filter((r) => r.investment_usd != null).length} announced projects`,
      ),
    });
  }

  // Metric 4 — disclosed jobs sum, last 90 days
  if (recentJobs > 0) {
    key_metrics.push({
      metric: "econ_dev_jobs_90d",
      label: "Total disclosed jobs announced (last 90 days)",
      value: recentJobs,
      direction: "stable",
      variable_type: "extensive",
      units: "jobs",
      display_format: "raw",
      source: makeSource(
        fetchedAt,
        sourceUrl,
        `${recentJobs.toLocaleString()} jobs across ${recent.filter((r) => r.jobs != null).length} announced projects`,
      ),
    });
  }

  // ── Direction ────────────────────────────────────────────────────────────────
  let direction: BrainOutputDirection;
  let magnitude: number;
  if (prior.length === 0) {
    // No prior window for comparison — neutral
    direction = "neutral";
    magnitude = 0.3;
  } else {
    const delta = recent.length - prior.length;
    const ratio = prior.length > 0 ? Math.abs(delta) / prior.length : 0;
    if (delta > 0) {
      direction = "bullish";
      magnitude = Math.min(0.4 + ratio * 0.5, 0.8);
    } else if (delta < 0) {
      direction = "bearish";
      magnitude = Math.min(0.4 + ratio * 0.5, 0.75);
    } else {
      direction = "neutral";
      magnitude = 0.35;
    }
  }

  // ── Conclusion ───────────────────────────────────────────────────────────────
  const parts: string[] = [];
  parts.push(
    `SWFL Inc. logged ${recent.length} economic development announcement${recent.length === 1 ? "" : "s"} in the last 90 days.`,
  );
  if (recentInv > 0) {
    parts.push(
      `Disclosed investment: ${fmtUsdMillions(recentInv)}.`,
    );
  }
  if (recentJobs > 0) {
    parts.push(`Announced jobs: ${recentJobs.toLocaleString()}.`);
  }
  if (prior.length > 0) {
    const change = recent.length - prior.length;
    const changeStr =
      change > 0
        ? `+${change} vs prior 90-day window (${prior.length} projects)`
        : change < 0
          ? `${change} vs prior 90-day window (${prior.length} projects)`
          : `flat vs prior 90-day window`;
    parts.push(`Momentum: ${changeStr}.`);
  }
  parts.push(
    `Source: SWFL Inc. (swflinc.com/news/), the official Lee County economic development organization.`,
  );

  const caveats: string[] = [
    "Investment and job figures reflect disclosures at announcement time; actual outcomes may vary as projects develop.",
    "SWFL Inc. covers primarily Lee County projects; Collier County coverage depends on cross-county partnerships and co-announcements.",
  ];
  if (env.source === "fixture") {
    caveats.unshift(
      "econ-dev-swfl: this build uses SYNTHETIC fixture data — set REFINERY_SOURCE=live to read real swfl_inc_announcements.",
    );
  }

  return {
    conclusion: parts.join(" "),
    key_metrics,
    caveats,
    direction,
    magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
    grain_boundary:
      "Weekly SWFL economic development pulse; announcement-level grain; Lee County primary coverage (Collier via partnerships); investment/job figures are disclosed-at-announcement only.",
  };
}

// ── Pack definition ───────────────────────────────────────────────────────────

export const econDevSwfl: PackDefinition = {
  id: "econ-dev-swfl",
  brain_id: "econ-dev-swfl",
  domain: "macro",
  scope:
    "Southwest Florida economic development project announcements — weekly scrape of SWFL Inc. (Lee County EDO) news feed. Tracks project count, disclosed investment, and announced job creation for Lee + Collier + Charlotte counties.",
  ttl_seconds: 604800, // 7 days — matches weekly ingest cadence

  sources: [swflIncSource],
  input_brains: [],

  fitScore: () => 0.7,
  compositeCutoff: 0,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: econDevSwflCorpusSummary,
  outputProducer: econDevSwflOutputProducer,
  synthesisStrategy: "deterministic",

  preferences: [
    "The user tracks economic development momentum in SWFL — new business relocations, expansions, grants, and major project announcements as a leading indicator of regional growth.",
    "The user reads announcement counts and disclosed investment totals as forward-looking pipeline signals, not confirmed outcomes.",
    "The user expects this brain to surface momentum (rising/falling announcement rate) and let master synthesize against labor, CRE, and macro context downstream.",
  ],
  activeProject:
    "econ-dev-swfl: weekly SWFL economic development pulse from SWFL Inc. (swflinc.com/news/) — announcement count, investment totals, job counts, and 90-day momentum for Lee + Collier counties.",
  prompts: {
    triageContext:
      "These fragments are SWFL Inc. economic development announcement rows from swfl_inc_announcements. They are decision-relevant by construction; the pack is pure deterministic aggregation.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is produced deterministically by econDevSwflCorpusSummary and the BrainOutput is built by econDevSwflOutputProducer.",
  },
};
