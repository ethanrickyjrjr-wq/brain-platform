import type { TrustTier, FragmentScore } from "./scoring.mts";

/**
 * Stage 1 output: a raw source row, normalized but not judged.
 * `raw` is verbatim and never mutated — "raw text never lost".
 * `normalized` is a deterministic column projection; its shape is pack-specific.
 */
export interface RawFragment<N = unknown> {
  fragment_id: string;
  /** citation source id, e.g. "sba_loans_franchise_outcomes" */
  source_id: string;
  source_trust_tier: TrustTier;
  /** ISO timestamp of the fetch */
  fetched_at: string;
  /** verbatim source row — immutable source of truth */
  raw: Record<string, unknown>;
  /** deterministic projection of `raw`; no judgement, no LLM. Pack-specific shape — consumers cast. */
  normalized: N;
}

/**
 * Stage 2 output: a RawFragment plus classification + the three-layer score.
 */
export interface TriagedFragment<N = unknown> extends RawFragment<N> {
  classification: {
    topic: string;
    subtopic_key: string;
    decision_relevance_reason: string;
  };
  scoring: FragmentScore;
}
