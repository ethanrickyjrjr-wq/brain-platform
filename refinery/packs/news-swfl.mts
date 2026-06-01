import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
  BrainOutputDirection,
} from "../types/brain-output.mts";
import {
  dbprPressReleasesSource,
  type DbprPressReleaseNormalized,
} from "../sources/dbpr-press-releases-source.mts";
import {
  dbprPublicNoticesSource,
  type DbprPublicNoticeNormalized,
} from "../sources/dbpr-public-notices-source.mts";
import { env } from "../config/env.mts";

/**
 * news-swfl — FL DBPR enforcement pulse for SWFL.
 *
 * Two sources:
 *   SourceA: dbpr_press_releases — Sonnet-enriched, aggregate narrative,
 *            SWFL flag + topics + affected_industries. Soft signal (announced activity).
 *   SourceB: dbpr_public_notices — hard-parsed, individual case-level,
 *            county + industry + violation_type, all rows SWFL. Hard signal (confirmed actions).
 *
 * Key metrics (9 total):
 *   SourceA momentum (3): dbpr_swfl_releases_90d, dbpr_swfl_releases_prior_90d, dbpr_total_releases_90d
 *   SourceB confirmed (4): dbpr_notices_construction_90d, dbpr_notices_abt_90d,
 *                          dbpr_notices_lee_90d, dbpr_notices_collier_90d
 *   SourceA sector (2):   dbpr_releases_construction_90d, dbpr_releases_abt_90d
 *
 * Declared polarities (locked):
 *   dbpr_notices_construction_90d rising → bullish (recovery signal)
 *   dbpr_notices_abt_90d rising → bearish (compliance stress signal)
 *   Geographic splits: data-only, no direction contribution
 *
 * Direction vote: SourceA SWFL-relevant momentum only (prior vs recent 90-day window).
 * Leaf brain (no upstream brains).
 */

// ── Pack-private normalized interface ─────────────────────────────────────────
// Both sources convert to this shape in corpusSummary.
interface DbprEnforcementNormalized {
  source: "press_releases" | "public_notices";
  county: string | null; // exact for notices; first SWFL county from geographic_mentions for releases
  industry: string | null; // affected_industries[0] (releases) or industry field (notices)
  violation_type: "unlicensed_activity" | "disciplinary" | null; // null for press releases
  is_swfl_relevant: boolean; // enricher flag (releases) or always true (notices)
  published_date: string | null; // published_date (releases) or response_deadline (notices)
  topics: string[]; // from releases; [] for notices
  is_construction: boolean;
  is_abt: boolean;
}

// ── Closure state ─────────────────────────────────────────────────────────────
let lastEnforcement: DbprEnforcementNormalized[] = [];
let lastFetchedAt: string | null = null;

// ── Industry classifiers ──────────────────────────────────────────────────────
const CONSTRUCTION_INDUSTRIES = new Set([
  "construction",
  "electrical",
  "engineering",
  "landscape",
  "architecture",
  "general_contractors",
  "contractor",
]);
const ABT_INDUSTRIES = new Set(["hospitality", "abt", "beverage", "tobacco"]);

function isConstruction(industry: string | null): boolean {
  return (
    industry != null && CONSTRUCTION_INDUSTRIES.has(industry.toLowerCase())
  );
}

function isAbt(industries: string[]): boolean {
  return industries.some((i) => ABT_INDUSTRIES.has(i.toLowerCase()));
}

const SWFL_COUNTIES = [
  "lee",
  "collier",
  "charlotte",
  "sarasota",
  "hendry",
  "manatee",
  "monroe",
];

function firstSwflCounty(mentions: string[]): string | null {
  for (const m of mentions) {
    const lower = m.toLowerCase();
    for (const c of SWFL_COUNTIES) {
      if (lower.includes(c)) return c.charAt(0).toUpperCase() + c.slice(1);
    }
  }
  return null;
}

// ── Source normalizers ────────────────────────────────────────────────────────
function toPressReleaseEnforcement(
  r: DbprPressReleaseNormalized,
): DbprEnforcementNormalized {
  const industry = r.affected_industries[0] ?? null;
  return {
    source: "press_releases",
    county: firstSwflCounty(r.geographic_mentions),
    industry,
    violation_type: null,
    is_swfl_relevant: r.is_swfl_relevant,
    published_date: r.published_date,
    topics: r.topics,
    is_construction:
      isConstruction(industry) || r.topics.includes("construction"),
    is_abt:
      isAbt(r.affected_industries) ||
      r.topics.some((t) => ["ABT", "hospitality", "beverage"].includes(t)),
  };
}

function toNoticeEnforcement(
  n: DbprPublicNoticeNormalized,
): DbprEnforcementNormalized {
  return {
    source: "public_notices",
    county: n.county,
    industry: n.industry,
    violation_type: n.violation_type,
    is_swfl_relevant: true, // all public notices are SWFL by construction
    published_date: n.response_deadline, // best proxy for event recency
    topics: [],
    is_construction: isConstruction(n.industry),
    is_abt: n.industry != null && ABT_INDUSTRIES.has(n.industry.toLowerCase()),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysBefore(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function makeSource(
  fetchedAt: string,
  sourceUrl: string,
  citation: string,
): BrainOutputMetric["source"] {
  return {
    url: sourceUrl || "https://www2.myfloridalicense.com/press-releases/",
    fetched_at: fetchedAt,
    tier: 2,
    citation: `FL DBPR — ${citation}`,
  };
}

// ── corpusSummary ─────────────────────────────────────────────────────────────
function newsSwflCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const pressRows = allFragments
    .map((f) => f.normalized as unknown as DbprPressReleaseNormalized)
    .filter(
      (n): n is DbprPressReleaseNormalized => n?.kind === "dbpr-press-release",
    );

  const noticeRows = allFragments
    .map((f) => f.normalized as unknown as DbprPublicNoticeNormalized)
    .filter(
      (n): n is DbprPublicNoticeNormalized => n?.kind === "dbpr-public-notice",
    );

  lastFetchedAt = allFragments[0]?.fetched_at ?? null;

  lastEnforcement = [
    ...pressRows.map(toPressReleaseEnforcement),
    ...noticeRows.map(toNoticeEnforcement),
  ];

  if (lastEnforcement.length === 0) return [];

  const cutoff90 = daysBefore(90);
  const swflRecent = pressRows.filter(
    (r) =>
      r.is_swfl_relevant &&
      r.published_date !== null &&
      r.published_date >= cutoff90,
  );

  return [
    {
      topic: "dbpr_news_snapshot",
      fact: "DBPR enforcement pulse — latest 90 days",
      value:
        `DBPR SWFL-relevant press releases (last 90 days): ${swflRecent.length}. ` +
        `Public notices (all SWFL): ${noticeRows.length}. ` +
        `Total enforcement records: ${lastEnforcement.length}.`,
      source_fragment_ids: [],
    },
  ];
}

// ── outputProducer ────────────────────────────────────────────────────────────
function newsSwflOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const rows = lastEnforcement;
  const fetchedAt =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (rows.length === 0) {
    return {
      conclusion: "news-swfl: no DBPR enforcement data available.",
      key_metrics: [],
      caveats: [
        "dbpr_press_releases and dbpr_public_notices both returned 0 rows.",
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

  // ── SourceA: press releases (direction vote anchor) ───────────────────────
  const pressRows = rows.filter((r) => r.source === "press_releases");
  const swflRecent = pressRows.filter(
    (r) =>
      r.is_swfl_relevant &&
      r.published_date !== null &&
      r.published_date >= cutoff90,
  );
  const swflPrior = pressRows.filter(
    (r) =>
      r.is_swfl_relevant &&
      r.published_date !== null &&
      r.published_date >= cutoff180 &&
      r.published_date < cutoff90,
  );
  const allRecent = pressRows.filter(
    (r) => r.published_date !== null && r.published_date >= cutoff90,
  );

  // ── SourceB: public notices (confirmed case-level enforcement) ────────────
  const noticeRows = rows.filter((r) => r.source === "public_notices");
  const recentNotices = noticeRows.filter(
    (r) => r.published_date !== null && r.published_date >= cutoff90,
  );

  const sourceUrl = "https://www2.myfloridalicense.com/press-releases/";
  const noticeUrl = "https://www2.myfloridalicense.com/public-notices/";

  const key_metrics: BrainOutputMetric[] = [];

  // ── Existing 3 metrics (SourceA momentum) ────────────────────────────────
  key_metrics.push({
    metric: "dbpr_swfl_releases_90d",
    label: "SWFL-relevant DBPR press releases (last 90 days)",
    value: swflRecent.length,
    direction:
      swflPrior.length === 0
        ? "stable"
        : swflRecent.length > swflPrior.length
          ? "rising"
          : swflRecent.length < swflPrior.length
            ? "falling"
            : "stable",
    variable_type: "extensive",
    units: "count",
    display_format: "raw",
    source: makeSource(
      fetchedAt,
      sourceUrl,
      `Press Releases — ${swflRecent.length} SWFL-relevant releases in last 90 days`,
    ),
  });

  key_metrics.push({
    metric: "dbpr_swfl_releases_prior_90d",
    label: "SWFL-relevant DBPR press releases (prior 90-day window)",
    value: swflPrior.length,
    direction: "stable",
    variable_type: "extensive",
    units: "count",
    display_format: "raw",
    source: makeSource(
      fetchedAt,
      sourceUrl,
      `Press Releases — ${swflPrior.length} SWFL-relevant releases 90-180 days prior`,
    ),
  });

  key_metrics.push({
    metric: "dbpr_total_releases_90d",
    label: "Total DBPR press releases (last 90 days, statewide)",
    value: allRecent.length,
    direction: "stable",
    variable_type: "extensive",
    units: "count",
    display_format: "raw",
    source: makeSource(
      fetchedAt,
      sourceUrl,
      `Press Releases — ${allRecent.length} total statewide releases in last 90 days`,
    ),
  });

  // ── 6 new metrics ─────────────────────────────────────────────────────────

  // Construction confirmed: SourceB (unlicensed_activity + construction industry)
  const noticesConstruction = recentNotices.filter(
    (r) => r.is_construction && r.violation_type === "unlicensed_activity",
  );
  key_metrics.push({
    metric: "dbpr_notices_construction_90d",
    label:
      "Confirmed construction enforcement notices, last 90 days (DBPR public notices — hard-parsed)",
    value: noticesConstruction.length,
    // "stable" — no prior-window query for public notices; trend needs more data history.
    direction: "stable",
    variable_type: "extensive",
    units: "count",
    display_format: "raw",
    source: makeSource(
      fetchedAt,
      noticeUrl,
      `Public Notices — ${noticesConstruction.length} unlicensed construction notices in last 90 days`,
    ),
  });

  // Construction announced: SourceA (construction in affected_industries or topics)
  const releasesConstruction = swflRecent.filter((r) => r.is_construction);
  const priorConstruction = swflPrior.filter((r) => r.is_construction);
  key_metrics.push({
    metric: "dbpr_releases_construction_90d",
    label:
      "Announced construction enforcement activity, last 90 days (DBPR press releases — Sonnet-inferred)",
    value: releasesConstruction.length,
    direction:
      releasesConstruction.length > priorConstruction.length
        ? "rising"
        : releasesConstruction.length < priorConstruction.length
          ? "falling"
          : "stable",
    variable_type: "extensive",
    units: "count",
    display_format: "raw",
    source: makeSource(
      fetchedAt,
      sourceUrl,
      `Press Releases — ${releasesConstruction.length} SWFL construction-related releases in last 90 days`,
    ),
  });

  // ABT confirmed: SourceB (any violation_type + ABT/hospitality industry)
  const noticesAbt = recentNotices.filter((r) => r.is_abt);
  key_metrics.push({
    metric: "dbpr_notices_abt_90d",
    label:
      "ABT/hospitality enforcement notices, last 90 days (DBPR public notices — hard-parsed)",
    value: noticesAbt.length,
    // "stable" — no prior-window query for public notices; trend needs more data history.
    direction: "stable",
    variable_type: "extensive",
    units: "count",
    display_format: "raw",
    source: makeSource(
      fetchedAt,
      noticeUrl,
      `Public Notices — ${noticesAbt.length} ABT/hospitality notices in last 90 days`,
    ),
  });

  // ABT announced: SourceA
  const releasesAbt = swflRecent.filter((r) => r.is_abt);
  const priorAbt = swflPrior.filter((r) => r.is_abt);
  key_metrics.push({
    metric: "dbpr_releases_abt_90d",
    label:
      "ABT/hospitality enforcement activity, last 90 days (DBPR press releases — Sonnet-inferred)",
    value: releasesAbt.length,
    direction:
      releasesAbt.length > priorAbt.length
        ? "rising"
        : releasesAbt.length < priorAbt.length
          ? "falling"
          : "stable",
    variable_type: "extensive",
    units: "count",
    display_format: "raw",
    source: makeSource(
      fetchedAt,
      sourceUrl,
      `Press Releases — ${releasesAbt.length} SWFL ABT/hospitality-related releases in last 90 days`,
    ),
  });

  // Geographic: SourceB exact county splits
  const noticesLee = recentNotices.filter(
    (r) => r.county?.toLowerCase() === "lee",
  );
  key_metrics.push({
    metric: "dbpr_notices_lee_90d",
    label: "Lee County enforcement notices, last 90 days (DBPR public notices)",
    value: noticesLee.length,
    direction: "stable",
    variable_type: "extensive",
    units: "count",
    display_format: "raw",
    source: makeSource(
      fetchedAt,
      noticeUrl,
      `Public Notices — ${noticesLee.length} Lee County notices in last 90 days`,
    ),
  });

  const noticesCollier = recentNotices.filter(
    (r) => r.county?.toLowerCase() === "collier",
  );
  key_metrics.push({
    metric: "dbpr_notices_collier_90d",
    label:
      "Collier County enforcement notices, last 90 days (DBPR public notices)",
    value: noticesCollier.length,
    direction: "stable",
    variable_type: "extensive",
    units: "count",
    display_format: "raw",
    source: makeSource(
      fetchedAt,
      noticeUrl,
      `Public Notices — ${noticesCollier.length} Collier County notices in last 90 days`,
    ),
  });

  // ── Direction (SourceA momentum only — unchanged contract) ────────────────
  let direction: BrainOutputDirection;
  let magnitude: number;
  if (swflPrior.length === 0) {
    direction = "neutral";
    magnitude = 0.3;
  } else {
    const delta = swflRecent.length - swflPrior.length;
    const ratio = Math.abs(delta) / swflPrior.length;
    direction = delta > 0 ? "bullish" : delta < 0 ? "bearish" : "neutral";
    magnitude = delta === 0 ? 0.3 : Math.min(0.3 + ratio * 0.4, 0.7);
  }

  // ── Conclusion ────────────────────────────────────────────────────────────
  const parts: string[] = [];
  parts.push(
    `DBPR issued ${swflRecent.length} SWFL-relevant press release${swflRecent.length === 1 ? "" : "s"} in the last 90 days.`,
  );
  if (recentNotices.length > 0) {
    parts.push(
      `${recentNotices.length} individual enforcement notice${recentNotices.length === 1 ? "" : "s"} active in SWFL (${noticesConstruction.length} construction unlicensed, ${noticesAbt.length} ABT/hospitality).`,
    );
  }
  if (swflPrior.length > 0) {
    const delta = swflRecent.length - swflPrior.length;
    const trend =
      delta > 0
        ? `+${delta} vs prior 90-day window`
        : delta < 0
          ? `${delta} vs prior 90-day window`
          : "flat vs prior 90-day window";
    parts.push(`Enforcement activity momentum: ${trend}.`);
  }
  if (swflRecent.length > 0) {
    const topicCounts: Record<string, number> = {};
    for (const r of swflRecent) {
      for (const t of r.topics) topicCounts[t] = (topicCounts[t] ?? 0) + 1;
    }
    const topTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);
    if (topTopics.length > 0)
      parts.push(`Top press release topics: ${topTopics.join(", ")}.`);
  }
  parts.push(
    "Sources: FL DBPR press releases (www2.myfloridalicense.com/press-releases/) and public enforcement notices (www2.myfloridalicense.com/public-notices/).",
  );

  const caveats: string[] = [
    "Construction enforcement split: public notices = confirmed individual actions (hard-parsed violation_type); press releases = announced sweeps (Sonnet-inferred affected_industries). Do not sum them.",
    "Polarity: rising construction notices = bullish (recovery-driven unlicensed activity). Rising ABT notices = bearish (hospitality compliance stress).",
    "SWFL relevance in press releases determined by geographic mentions — releases without explicit county names may be undercounted.",
    `${allRecent.length - swflRecent.length} of ${allRecent.length} recent releases were statewide with no SWFL geographic mention.`,
  ];
  if (env.source === "fixture") {
    caveats.unshift(
      "news-swfl: this build uses SYNTHETIC fixture data — set REFINERY_SOURCE=live to read real data.",
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
    grain_boundary: {
      not_available: [
        "Individual license actions or complaint filings — only press releases and active public notices",
        "Sub-county grain — press releases name counties/cities; notices are county-level only",
        "Enforcement outcome resolution — not final dispositions, only notice/announcement stage",
      ],
      finest_grain: "enforcement-release",
    },
  };
}

// ── Pack definition ───────────────────────────────────────────────────────────
export const newsSwfl: PackDefinition = {
  id: "news-swfl",
  brain_id: "news-swfl",
  domain: "macro",
  scope:
    "FL DBPR enforcement pulse for SWFL — weekly scrape of press releases (announced sweeps) and public notices (confirmed individual actions). Tracks regulatory enforcement across construction, ABT/hospitality, and real estate for Lee, Collier, Charlotte, Sarasota, and Hendry counties.",
  ttl_seconds: 604800, // 7 days — matches weekly ingest cadence

  sources: [dbprPressReleasesSource, dbprPublicNoticesSource],
  input_brains: [],

  fitScore: () => 0.6,
  compositeCutoff: 0,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: newsSwflCorpusSummary,
  outputProducer: newsSwflOutputProducer,
  synthesisStrategy: "deterministic",

  preferences: [
    "The user tracks SWFL regulatory environment signals — enforcement sweeps, licensing actions, and legislative activity affecting real estate, construction, and hospitality.",
    "The user reads DBPR public notices (confirmed individual actions) as a harder signal than press releases (announced sweeps). Rising construction enforcement post-storm signals recovery activity; rising ABT enforcement signals hospitality stress.",
    "The user expects the brain to surface the confirmed/announced split so master can weight each appropriately.",
  ],
  activeProject:
    "news-swfl: DBPR enforcement pulse for SWFL — press releases (SourceA, Sonnet-inferred) + public notices (SourceB, hard-parsed) feeding 9 deterministic key metrics.",
  prompts: {
    triageContext:
      "These fragments are DBPR enforcement records from two sources: dbpr_press_releases (Sonnet-enriched aggregate) and dbpr_public_notices (hard-parsed individual cases). All public notice rows are SWFL by construction; press releases are SWFL-filtered by geographic_mentions.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). All metrics are produced deterministically by newsSwflOutputProducer from the two source streams.",
  },
};
