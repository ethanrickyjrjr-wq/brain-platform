import type { RawFragment } from "./fragment.mts";
import type { SynthesizedEvent, SynthesisFact } from "./event.mts";

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
  /** CLI arg, e.g. "franchise-outcomes" */
  id: string;
  /** frontmatter brain_id (also the brains/{slug}.md filename) */
  brain_id: string;
  /** frontmatter scope — what the pack COVERS, never who it belongs to */
  scope: string;
  ttl_seconds: number;
  sources: SourceConnector[];
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
