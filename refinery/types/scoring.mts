/**
 * Three-layer scoring vocabulary (adapted from premise-engine's process doc).
 * composite = (pack_fit + content_score) * type_multiplier
 */

/** Source authority tier: 1 = federal/state agency ... 5 = social. Higher wins conflicts. */
export type TrustTier = 1 | 2 | 3 | 4 | 5;

/** type_multiplier lookup by trust tier. SBA = tier 1; Sanity verified corridors = tier 2. */
export const TYPE_MULTIPLIER: Record<TrustTier, number> = {
  1: 1.5, // federal / state agency
  2: 1.3, // county record / verified editorial
  3: 1.0, // aggregator
  4: 0.9, // news
  5: 0.7, // social / unverified
};

/** The assembled three-layer score for one fragment. */
export interface FragmentScore {
  /** deterministic pack-fit (reinterpreted routing_score) — does this belong in the pack, how central */
  pack_fit: number;
  /** 0-10 decision-impact, Haiku-classified */
  content_score: number;
  /** lookup from source_trust_tier */
  type_multiplier: number;
  /** (pack_fit + content_score) * type_multiplier */
  composite: number;
}

/** Default composite floor — fragments below this are dropped in triage. Packs may override. */
export const COMPOSITE_CUTOFF = 6;
