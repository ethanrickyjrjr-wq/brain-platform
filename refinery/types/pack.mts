import type { RawFragment } from "./fragment.mts";
import type { SynthesizedEvent, SynthesisFact } from "./event.mts";
import type { BrainOutputProducerResult } from "./brain-output.mts";

/**
 * Synthesis strategy for a pack. v1 ships everything as `"deterministic"`;
 * the `"llm-assisted"` slot is reserved for Month 4+ when narrative-quality
 * brains may opt into a guarded LLM step (confidence stays deterministic
 * regardless — locked decision #4).
 */
export type SynthesisStrategy = "deterministic" | "llm-assisted";

/**
 * BrainDomain — the controlled vocabulary for `PackDefinition.domain`.
 * Mirrored by a SQL CHECK constraint on `brain_registry.domain`. Adding a new
 * domain requires a one-line edit here AND in the SQL — the friction is the
 * feature: it prevents the registry from fragmenting into "real-estate" /
 * "real_estate" / "realestate" within a week.
 */
export type BrainDomain =
  | "real-estate"
  | "finance"
  | "environmental"
  | "demographics"
  | "logistics"
  | "hospitality"
  | "macro"
  | "regulatory";

/**
 * Source authority tier — drives the deterministic confidence formula.
 * 1 = primary (federal/SEC/NOAA etc.)
 * 2 = verified editorial / already-shipped brain output
 * 3 = secondary aggregator / industry report
 * 4 = inferred / weakly attested
 */
export type TrustTier = 1 | 2 | 3 | 4;

/**
 * BrainEdgeType — how an upstream brain relates to its downstream consumer.
 *
 *   "input":      consumed as data. The default; covers ~every leaf → master edge today.
 *   "constraint": bounds the downstream's conclusion space (e.g. caps magnitude,
 *                 forbids a direction) without flipping it outright.
 *   "veto":       can flip the downstream's direction unilaterally.
 *   "modifier":   adjusts magnitude or confidence but never direction.
 *
 * Surfaced inline in `BrainOutput.drivers` so a disputant can ask
 *   "did env-swfl *veto* this conclusion or just *influence* it?"
 * and the answer is in the receipt, not the code.
 */
export type BrainEdgeType = "input" | "constraint" | "veto" | "modifier";

/**
 * A typed DAG edge from a downstream pack to one of its upstream brains.
 * Replaces the bare-string `input_brains: string[]` shape.
 */
export interface BrainEdge {
  /** Upstream brain id — must exist as a key in PACKS at build time. */
  id: string;
  /** Edge semantic. See `BrainEdgeType` for the meaning of each value. */
  edge_type: BrainEdgeType;
  /**
   * When true, this upstream is part of the brain's critical set — a failure
   * to freshen it triggers the degraded-inputs token in Phase 2+. Not all
   * upstreams are critical; only those whose absence meaningfully degrades
   * the synthesis (e.g. macro trilogy, env-swfl, cre-swfl for master).
   */
  critical?: boolean;
}

/**
 * Convenience constructor for `BrainEdge`. Defaults `edge_type` to `"input"` so
 * the common case stays terse:
 *   input_brains: [edge("franchise-outcomes"), edge("env-swfl", "veto")]
 */
export function edge(
  id: string,
  edge_type: BrainEdgeType = "input",
  critical?: boolean,
): BrainEdge {
  return critical ? { id, edge_type, critical } : { id, edge_type };
}

/** A row in the spec-v1.1 CITATION TABLE. */
export interface CitationRow {
  /** s01, s02, ... */
  id: string;
  /** human-readable source name */
  source: string;
  /** ISO date the source was last verified */
  verified: string;
  /** ISO date, or "never" — precomputed (spec v1.1: a date, not a duration) */
  expires: string;
}

/**
 * A source connector knows how to fetch RawFragments for a pack and
 * describe itself as a citation. Fixture vs. live mode is handled inside.
 */
export interface SourceConnector {
  /** stable id, also used as RawFragment.source_id; Stage 4 maps it to a citation id */
  source_id: string;
  /**
   * Authority tier for the deterministic confidence formula. Stage 4 averages
   * `trust_tier_score` across `pack.sources` (1→1.0, 2→0.8, 3→0.6, 4→0.4) and
   * multiplies by the TTL freshness ratio. Set once per connector — never per
   * fragment. See `BrainOutput.confidence` docs for the full formula.
   */
  trust_tier: TrustTier;
  /** fetch raw fragments (live or fixture, decided internally from env) */
  fetch(): Promise<RawFragment[]>;
  /** citation metadata for this source; Stage 4 assigns the `id` (s01, s02, ...) */
  citationMeta(
    verifiedDate: string,
    ttlSeconds: number,
  ): Omit<CitationRow, "id">;
}

/**
 * A pack definition: everything that makes one vertical pack distinct.
 * Two packs share the whole engine; they differ only in this object.
 */
export interface PackDefinition {
  /** CLI arg, e.g. "franchise-outcomes" — also the URL-safe slug */
  id: string;
  /** frontmatter brain_id (also the brains/{slug}.md filename) */
  brain_id: string;
  /**
   * Curated user-facing label for this brain, e.g. "Flood & Environment".
   * Lifted onto BrainOutput.degraded_inputs so the degradation token carries
   * a human-readable name through the thin pipe. Required on every pack that
   * appears as a `critical` edge anywhere in the registry (registry invariant
   * in config/packs.mts will throw at module load if missing).
   */
  public_label?: string;
  /**
   * Vertical of intelligence — controls freshness-token scoping (per-domain
   * LAKE_ID) and registry filtering. See `BrainDomain` for the closed set.
   */
  domain: BrainDomain;
  /** frontmatter scope — what the pack COVERS, never who it belongs to */
  scope: string;
  ttl_seconds: number;
  sources: SourceConnector[];
  /**
   * Typed DAG edges to upstream brains this pack consumes via BrainInputSource.
   * The DAG resolver reads `.id` for build order; the renderer surfaces
   * `.edge_type` inline in OUTPUT.drivers so consumers see edge semantics in
   * the receipt. Empty array = leaf brain. Replaces the deprecated
   * `subBrainPointers` mechanism.
   */
  input_brains: BrainEdge[];
  /** deterministic pack-fit score for a fragment (reinterpreted routing_score) */
  fitScore: (fragment: RawFragment) => number;
  /** optional composite-cutoff override; falls back to COMPOSITE_CUTOFF */
  compositeCutoff?: number;
  /**
   * Optional deterministic corpus-level facts, computed in code (not the LLM)
   * over ALL Stage-1 fragments — including ones the pack-fit filter dropped.
   * These carry every numeric cross-brand aggregate (sums, counts, medians,
   * rankings); the synthesis agent is forbidden from computing those. Stage 3
   * prepends them as the pack's header facts. Returns [] if not applicable.
   */
  corpusSummary?: (allFragments: RawFragment[]) => SynthesisFact[];
  /**
   * DEPRECATED — superseded by `input_brains` + the brain_registry. The
   * renderer still emits this section until BrainInputSource is wired in and
   * all existing consumers migrate. New packs should NOT set this.
   */
  subBrainPointers?: string[];
  /**
   * When true, Stage 3 skips the synthesis agent entirely — every fact comes
   * from `corpusSummary`. For a pure deterministic pack (e.g. the master
   * index) this is a guarantee, not a prompt the agent might ignore.
   */
  skipSynthesisAgent?: boolean;
  /**
   * When true, Stage 2 skips the Haiku content-score call — `content_score`
   * is treated as 0 and the composite collapses to `pack_fit × type_multiplier`.
   * Use for packs with a deterministic constant `fitScore` and
   * `compositeCutoff: 0` where every fragment belongs anyway: the LLM call
   * adds zero signal and may stall on large fragment counts (>~100).
   */
  skipTriageAgent?: boolean;
  /**
   * Optional producer of the BrainOutput narrative + qualitative fields.
   * Receives the fully-resolved PackOutput (citations finalized, facts
   * f-id-assigned) and returns the producer-owned slice of BrainOutput:
   *   conclusion, key_metrics, caveats, direction, magnitude, drivers,
   *   overrides, contradicts, exogenous_signals.
   * Engine-owned fields (brain_id, version, refined_at, confidence,
   * trust_tier, upstream_count, relevance) are computed deterministically
   * by Stage 4 and overlaid afterwards.
   * If unset, Stage 4 falls back to a default producer that emits a
   * minimum-viable v3 shape (neutral direction, 0.5 magnitude, empty
   * arrays, conclusion from top composite fact, metrics from `topic:metric:*`).
   * Keeps the "deterministic where possible" invariant — no global
   * synthesis-agent prompt expansion.
   */
  outputProducer?: (out: PackOutput) => BrainOutputProducerResult;
  /**
   * Optional Stage 4 sidecar emit. Runs AFTER the brain `.md` is written and
   * BEFORE the optional Supabase upsert. Returns a flat list of named JSON
   * payloads; Stage 4 routes each `{ name, data }` to `fixtures/{name}.json`
   * via `writeJsonAtomic` (deterministic stringify + tmpfile rename).
   *
   * Receives `rawFragments` (Stage 1's collected output) because some sidecars
   * — like permits-swfl's per-corridor cells — need upstream data that the
   * engine-finalized `PackOutput.facts` does not carry. The producer is
   * expected to re-derive deterministically from those fragments (e.g.
   * re-run a pure `buildSnapshot`).
   *
   * Returning an empty array (or a `{ name, data: [] }` entry) is a signal to
   * SKIP the write — used to avoid zero-byte overwrites when an upstream
   * fetch flaked (e.g. Accela returning 0 permits). spec-validator already
   * gates the brain `.md` write on 0 facts, so getting here implies the
   * brain itself was valid.
   *
   * Thin-pipe rule applies on the consumer side: downstream readers consume
   * the published sidecar artifact, never reach into the pack's in-memory
   * snapshot.
   */
  sidecarProducer?: (
    output: PackOutput,
    rawFragments: ReadonlyArray<RawFragment>,
  ) => Promise<Array<{ name: string; data: unknown }>>;
  /**
   * Marks the synthesis approach for this pack. v1 default is `"deterministic"`
   * — pure code, no LLM in the output path. `"llm-assisted"` is reserved for
   * Month 4+ narrative-only enhancements; numeric confidence stays
   * deterministic regardless (locked decision #4).
   */
  synthesisStrategy?: SynthesisStrategy;
  /** descriptive "HOW THE USER LIKES TO WORK" lines (third-person, never imperative) */
  preferences: string[];
  /** one-line "ACTIVE PROJECTS" description */
  activeProject: string;
  /** pack-specific context injected into the agent prompts */
  prompts: {
    triageContext: string;
    synthesisContext: string;
  };
}

/** Everything Stage 4 needs to render a Master Index. */
export interface PackOutput {
  pack: PackDefinition;
  version: number;
  refined_at: string;
  citations: CitationRow[];
  facts: SynthesizedEvent[];
  /** one-line "RECENT NOTES" entry */
  recentNote: string;
}
