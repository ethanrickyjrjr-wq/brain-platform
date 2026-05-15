import type { RawFragment } from "./fragment.mts";
import type { SynthesizedEvent, SynthesisFact } from "./event.mts";
import type { BrainOutput } from "./brain-output.mts";

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
  | "macro";

/**
 * Source authority tier — drives the deterministic confidence formula.
 * 1 = primary (federal/SEC/NOAA etc.)
 * 2 = verified editorial / already-shipped brain output
 * 3 = secondary aggregator / industry report
 * 4 = inferred / weakly attested
 */
export type TrustTier = 1 | 2 | 3 | 4;

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
   * Vertical of intelligence — controls freshness-token scoping (per-domain
   * LAKE_ID) and registry filtering. See `BrainDomain` for the closed set.
   */
  domain: BrainDomain;
  /** frontmatter scope — what the pack COVERS, never who it belongs to */
  scope: string;
  ttl_seconds: number;
  sources: SourceConnector[];
  /**
   * Ids of upstream brains this pack consumes via BrainInputSource. The DAG
   * resolver uses this to compute build order. Empty array = no upstream
   * dependencies. Replaces the deprecated `subBrainPointers` mechanism.
   */
  input_brains: string[];
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
   * Optional producer of the BrainOutput narrative fields. Receives the
   * fully-resolved PackOutput (citations finalized, facts f-id-assigned) and
   * returns the conclusion + key_metrics + caveats that go into the `---
   * OUTPUT ---` block. If unset, Stage 4 falls back to: conclusion = top
   * composite fact's value, key_metrics = facts tagged `topic: "metric:*"`,
   * caveats = []. Keeps the "deterministic where possible" invariant — no
   * global synthesis-agent prompt expansion.
   */
  outputProducer?: (
    out: PackOutput,
  ) => Pick<BrainOutput, "conclusion" | "key_metrics" | "caveats">;
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
