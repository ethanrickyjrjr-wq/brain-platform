/**
 * corridor-pulse-swfl — deterministic Tier-1 reporter for weekly SWFL corridor
 * current events (Build #2).
 *
 * Reads non-expired data_lake.city_pulse_corridors rows (one citation-backed fact
 * each) and emits a standard BrainOutput. Every surfaced signal becomes a
 * key_metric with a per-metric source receipt (url + cited_text) — that receipt is
 * the structural no-unbacked-claim guarantee on this surface (the distill step
 * already dropped any uncited fact). Reporter = cited facts, NO opinions;
 * direction/speculation stay with master.
 *
 * Wiring (Build #2 Option 4): this brain is NOT a direct master input. Its output is
 * consumed by cre-swfl via makeBrainInputSource("corridor-pulse-swfl") — corridor
 * news enriches cre-swfl's vertical-grain synthesis, and only cre-swfl's vote reaches
 * master. Keeping it off master's composite respects "stop at the grain".
 */
import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
} from "../types/brain-output.mts";
import {
  corridorPulseSource,
  type CorridorPulseNormalized,
} from "../sources/corridor-pulse-source.mts";
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

/** Cap on how many signals we surface as key_metrics. */
const MAX_SIGNALS = 8;

const CORRIDOR_PULSE_SCOPE =
  "SWFL (Lee + Collier) weekly corridor current-events pulse — dated commercial-real-estate transactions, construction, leasing, and openings/closings on the CRE corridors, each cited to a primary source.";

const CORRIDOR_PULSE_TTL = 604800; // 7 days — weekly pulse

// ---------------------------------------------------------------------
// Closure state — populated by corpusSummary, read by outputProducer.
// ---------------------------------------------------------------------

interface CorridorPulseSnapshot {
  signals: CorridorPulseNormalized[]; // non-expired, sorted by topic priority then newest
  fetched_at: string | null;
  corridorCounts: Record<string, number>;
}

let lastSnapshot: CorridorPulseSnapshot | null = null;

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

function pulseRowsFrom(fragments: RawFragment[]): CorridorPulseNormalized[] {
  return fragments
    .map((f) => f.normalized as unknown as CorridorPulseNormalized)
    .filter(
      (n) =>
        n &&
        n.kind === "corridor-pulse" &&
        n.fact.length > 0 &&
        n.source_url.length > 0,
    );
}

function sortSignals(
  rows: CorridorPulseNormalized[],
): CorridorPulseNormalized[] {
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

function corridorPulseCorpusSummary(
  allFragments: RawFragment[],
): SynthesisFact[] {
  const rows = sortSignals(pulseRowsFrom(allFragments));

  const corridorCounts: Record<string, number> = {};
  for (const r of rows)
    corridorCounts[r.corridor] = (corridorCounts[r.corridor] ?? 0) + 1;

  const sourceFragment = allFragments.find(
    (f) =>
      (f.normalized as unknown as CorridorPulseNormalized)?.kind ===
      "corridor-pulse",
  );

  lastSnapshot = {
    signals: rows,
    fetched_at: sourceFragment?.fetched_at ?? null,
    corridorCounts,
  };

  if (rows.length === 0) return [];

  const facts: SynthesisFact[] = [];

  // Summary fact — one aggregate across all signals.
  facts.push({
    topic: "corridor-pulse:summary",
    fact: "Live SWFL corridor current-events signals",
    value:
      `${rows.length} non-expired signals across ${Object.keys(corridorCounts).length} corridors ` +
      `(${Object.entries(corridorCounts)
        .map(([c, n]) => `${c}: ${n}`)
        .join(", ")}).`,
    source_fragment_ids: [],
  });

  // One fact per surfaced signal (capped at MAX_SIGNALS).
  for (const r of rows.slice(0, MAX_SIGNALS)) {
    facts.push({
      topic: `corridor-pulse:${r.topic}`,
      fact: `${r.corridor} — ${r.topic}`,
      value: `${r.fact} (source: ${r.source_url})`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

// ---------------------------------------------------------------------
// Stage 4 — BrainOutput producer.
// ---------------------------------------------------------------------

function corridorPulseOutputProducer(
  _out: PackOutput,
): BrainOutputProducerResult {
  const snapshot = lastSnapshot;
  const fetched_at =
    snapshot?.fetched_at ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // Empty-snapshot guard — valid neutral output, no throw.
  if (!snapshot || snapshot.signals.length === 0) {
    return {
      conclusion:
        "corridor-pulse-swfl: no non-expired corridor current-events signals in this build window — no live pulse to report.",
      key_metrics: [],
      caveats: [
        env.source === "fixture"
          ? "Corridor pulse is reading FIXTURE data — check the fixture file at refinery/__fixtures__/corridor-pulse.sample.json."
          : "No non-expired city_pulse_corridors rows. Either the weekly pulse has not run, all signals have aged past their TTL, or no tracked corridor made news this window.",
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
      value: `${s.corridor}: ${s.fact}`,
      direction: "stable", // reporter facts carry no trend; master/cre-swfl interpret
      label: `${s.corridor} — ${s.topic}`,
      variable_type: "categorical",
      // units intentionally OMITTED for categorical metrics (spec-validator rule)
      source: {
        url: s.source_url,
        fetched_at,
        tier: 2,
        citation: s.cited_text
          ? `${s.source_title ?? s.corridor}: "${s.cited_text}"`
          : `${s.source_title ?? s.corridor} (${s.source_url})`,
      },
    }),
  );

  const corridorList = Object.entries(snapshot.corridorCounts)
    .map(([c, n]) => `${c} (${n})`)
    .join(", ");

  const conclusionParts: string[] = [
    `SWFL corridor pulse as of ${fetched_at.slice(0, 10)}: ${snapshot.signals.length} live current-events signals across ${Object.keys(snapshot.corridorCounts).length} corridors — ${corridorList}.`,
  ];
  if (surfaced.length > 0) {
    conclusionParts.push(
      `Most current: ${surfaced[0].corridor} — ${surfaced[0].fact}`,
    );
  }
  conclusionParts.push(
    "These are current cited facts only; the corridor read and any direction call live downstream in cre-swfl and master.",
  );

  const caveats: string[] = [];
  if (snapshot.signals.length > MAX_SIGNALS) {
    caveats.push(
      `${snapshot.signals.length - MAX_SIGNALS} additional live signals not surfaced here (cap ${MAX_SIGNALS}); the full set is in data_lake.city_pulse_corridors.`,
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

export const corridorPulseSwfl: PackDefinition = {
  id: "corridor-pulse-swfl",
  brain_id: "corridor-pulse-swfl",
  public_label: "Corridor Pulse",
  domain: "real-estate",
  scope: CORRIDOR_PULSE_SCOPE,
  ttl_seconds: CORRIDOR_PULSE_TTL,
  sources: [corridorPulseSource],
  input_brains: [],
  fitScore: (): number => 8,
  compositeCutoff: 0,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: corridorPulseCorpusSummary,
  outputProducer: corridorPulseOutputProducer,
  synthesisStrategy: "deterministic",
  preferences: [
    "The user reads corridor pulse as the fast 'what just happened on this corridor' layer that the structural CRE brain lacks.",
    "The user expects every surfaced signal to be a dated, cited fact — never an opinion or a forecast.",
    "The user expects cre-swfl to weave these current corridor signals into its vertical-grain read, and master to see only that enriched vote.",
  ],
  activeProject:
    "corridor-pulse-swfl: weekly SWFL corridor-grain current-events reporter over data_lake.city_pulse_corridors (TTL'd, citation-backed); brain-input edge into cre-swfl.",
  prompts: {
    triageContext:
      "These fragments are non-expired city_pulse_corridors rows — one dated, citation-backed current-events fact each. Decision-relevant by construction; the pack is pure deterministic selection.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Facts come from corridorPulseCorpusSummary; the BrainOutput is built by corridorPulseOutputProducer. Every metric carries a source receipt.",
  },
};
