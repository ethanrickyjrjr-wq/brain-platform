/**
 * city-pulse-swfl — deterministic Tier-1 reporter for daily SWFL current events.
 *
 * Reads non-expired data_lake.city_pulse rows (one citation-backed fact each)
 * and emits a standard BrainOutput. Every surfaced signal becomes a key_metric
 * with a per-metric source receipt (url + cited_text) — that receipt is the
 * structural no-unbacked-claim guarantee on this surface (the distill step
 * already dropped any uncited fact). Reporter = cited facts, NO opinions;
 * direction/speculation stay with master.
 */
import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
} from "../types/brain-output.mts";
import {
  cityPulseSource,
  type CityPulseNormalized,
} from "../sources/city-pulse-source.mts";
import { env } from "../config/env.mts";

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

/** Topic display order — breaking is most volatile, structural least. */
const TOPIC_PRIORITY = [
  "breaking",
  "transactions",
  "development",
  "business",
  "structural",
];

/** Cap on how many signals we surface as key_metrics (plan spec). */
const MAX_SIGNALS = 8;

const CITY_PULSE_SCOPE =
  "SWFL (Lee + Collier) daily current-events pulse — dated business openings/closings, transactions, construction, and disaster signals for 7 cities, each cited to a primary source.";

const CITY_PULSE_TTL = 86400; // 1 day — daily pulse

// ---------------------------------------------------------------------
// Closure state — populated by corpusSummary, read by outputProducer.
// ---------------------------------------------------------------------

interface CityPulseSnapshot {
  signals: CityPulseNormalized[]; // non-expired, sorted by topic priority then newest
  fetched_at: string | null;
  cityCounts: Record<string, number>;
}

let lastSnapshot: CityPulseSnapshot | null = null;

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

function pulseRowsFrom(fragments: RawFragment[]): CityPulseNormalized[] {
  return fragments
    .map((f) => f.normalized as unknown as CityPulseNormalized)
    .filter(
      (n) =>
        n &&
        n.kind === "city-pulse" &&
        n.fact.length > 0 &&
        n.source_url.length > 0,
    );
}

function sortSignals(rows: CityPulseNormalized[]): CityPulseNormalized[] {
  return [...rows].sort((a, b) => {
    const ta = TOPIC_PRIORITY.indexOf(a.topic);
    const tb = TOPIC_PRIORITY.indexOf(b.topic);
    // Unknown topics sort last
    const t =
      (ta === -1 ? TOPIC_PRIORITY.length : ta) -
      (tb === -1 ? TOPIC_PRIORITY.length : tb);
    if (t !== 0) return t;
    return b.captured_at.localeCompare(a.captured_at); // newest first within topic
  });
}

// ---------------------------------------------------------------------
// Stage 3 — deterministic corpus facts.
// ---------------------------------------------------------------------

function cityPulseCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const rows = sortSignals(pulseRowsFrom(allFragments));

  const cityCounts: Record<string, number> = {};
  for (const r of rows) cityCounts[r.city] = (cityCounts[r.city] ?? 0) + 1;

  const sourceFragment = allFragments.find(
    (f) =>
      (f.normalized as unknown as CityPulseNormalized)?.kind === "city-pulse",
  );

  lastSnapshot = {
    signals: rows,
    fetched_at: sourceFragment?.fetched_at ?? null,
    cityCounts,
  };

  if (rows.length === 0) return [];

  const facts: SynthesisFact[] = [];

  // Summary fact — one aggregate across all signals.
  facts.push({
    topic: "city-pulse:summary",
    fact: "Live SWFL current-events signals",
    value:
      `${rows.length} non-expired signals across ${Object.keys(cityCounts).length} cities ` +
      `(${Object.entries(cityCounts)
        .map(([c, n]) => `${c}: ${n}`)
        .join(", ")}).`,
    source_fragment_ids: [],
  });

  // One fact per surfaced signal (capped at MAX_SIGNALS).
  for (const r of rows.slice(0, MAX_SIGNALS)) {
    facts.push({
      topic: `city-pulse:${r.topic}`,
      fact: `${r.city} — ${r.topic}`,
      value: `${r.fact} (source: ${r.source_url})`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

// ---------------------------------------------------------------------
// Stage 4 — BrainOutput producer.
// ---------------------------------------------------------------------

function cityPulseOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const snapshot = lastSnapshot;
  const fetched_at =
    snapshot?.fetched_at ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // Empty-snapshot guard — valid neutral output, no throw.
  if (!snapshot || snapshot.signals.length === 0) {
    return {
      conclusion:
        "city-pulse-swfl: no non-expired current-events signals in this build window — no live pulse to report.",
      key_metrics: [],
      caveats: [
        env.source === "fixture"
          ? "City pulse is reading FIXTURE data — check the fixture file at refinery/__fixtures__/city-pulse.sample.json."
          : "No non-expired city_pulse rows. Either the daily pulse has not run or all signals have aged past their TTL.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const surfaced = snapshot.signals.slice(0, MAX_SIGNALS);

  // Each surfaced signal → one BrainOutputMetric with a source receipt.
  const key_metrics: BrainOutputMetric[] = surfaced.map(
    (s, i): BrainOutputMetric => ({
      metric: `signal_${s.topic}_${i + 1}`,
      value: `${s.city}: ${s.fact}`,
      direction: "stable", // reporter facts carry no trend; master interprets
      label: `${s.city} — ${s.topic}`,
      variable_type: "categorical",
      // units intentionally OMITTED for categorical metrics (spec-validator rule)
      source: {
        url: s.source_url,
        fetched_at,
        tier: 2,
        citation: s.cited_text
          ? `${s.source_title ?? s.city}: "${s.cited_text}"`
          : `${s.source_title ?? s.city} (${s.source_url})`,
      },
    }),
  );

  const cityList = Object.entries(snapshot.cityCounts)
    .map(([c, n]) => `${c} (${n})`)
    .join(", ");

  const conclusionParts: string[] = [
    `SWFL city pulse as of ${fetched_at.slice(0, 10)}: ${snapshot.signals.length} live current-events signals across ${Object.keys(snapshot.cityCounts).length} cities — ${cityList}.`,
  ];
  if (surfaced.length > 0) {
    conclusionParts.push(
      `Most current: ${surfaced[0].city} — ${surfaced[0].fact}`,
    );
  }
  conclusionParts.push(
    "These are current cited facts only; the cross-vertical read and any direction call live downstream in master.",
  );

  const caveats: string[] = [];
  if (snapshot.signals.length > MAX_SIGNALS) {
    caveats.push(
      `${snapshot.signals.length - MAX_SIGNALS} additional live signals not surfaced here (cap ${MAX_SIGNALS}); the full set is in data_lake.city_pulse.`,
    );
  }
  caveats.push(
    "Each signal is dated current-events context with a per-signal source; freshness is TTL-bounded by topic (breaking 1d → structural 90d).",
  );

  return {
    conclusion: conclusionParts.join(" "),
    key_metrics,
    caveats,
    direction: "neutral",
    magnitude: 0,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

// ---------------------------------------------------------------------
// Pack definition
// ---------------------------------------------------------------------

export const cityPulseSwfl: PackDefinition = {
  id: "city-pulse-swfl",
  brain_id: "city-pulse-swfl",
  domain: "macro",
  scope: CITY_PULSE_SCOPE,
  ttl_seconds: CITY_PULSE_TTL,
  sources: [cityPulseSource],
  input_brains: [],
  fitScore: (): number => 8,
  compositeCutoff: 0,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: cityPulseCorpusSummary,
  outputProducer: cityPulseOutputProducer,
  synthesisStrategy: "deterministic",
  preferences: [
    "The user reads city pulse as the fast 'what is happening right now' layer that the slower corridor and economic brains lack.",
    "The user expects every surfaced signal to be a dated, cited fact — never an opinion or a forecast.",
    "The user expects master to weigh these current signals against the structural reads downstream.",
  ],
  activeProject:
    "city-pulse-swfl: daily SWFL city-grain current-events reporter over data_lake.city_pulse (TTL'd, citation-backed).",
  prompts: {
    triageContext:
      "These fragments are non-expired city_pulse rows — one dated, citation-backed current-events fact each. Decision-relevant by construction; the pack is pure deterministic selection.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Facts come from cityPulseCorpusSummary; the BrainOutput is built by cityPulseOutputProducer. Every metric carries a source receipt.",
  },
};
