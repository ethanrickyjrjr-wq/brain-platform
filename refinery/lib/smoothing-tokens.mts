/**
 * SMOOTHING_TOKENS — single source of truth for the smoothing-language ban list.
 *
 * Per Coupling 3 in `cosmic-rolling-brook.md` (v2): this constant is consumed
 * by BOTH the Stage 4 `smoothing-lint` validator AND the consumption contract
 * (Lane 2C rewrite). Never duplicate the token list inline anywhere else —
 * `docs/consumption-contract.md` quotes this file path and a build-time check
 * cross-validates the doc's enumeration against this export. Drift-proof by
 * design.
 *
 * Two groups, no spatial group. Wave 2A polygon work was killed in v2, so
 * brains no longer emit spatial-apportionment language.
 *
 * `numeric_softening`: vague quantifiers that mask whether a number is
 *   precise, smoothed, or interpolated. The brain platform's contract is
 *   that numbers are deterministic (Stage 4 math), so prose around them
 *   should never reach for these softeners.
 *
 * `prose_confidence_translation`: hand-wavy confidence verbalizations that
 *   re-encode the deterministic `confidence` / `confidence_dispersion` /
 *   `joint_integrity` fields into LLM-flavored adjectives. Downstream
 *   Claude sessions consume the numbers; the brain prose must not paraphrase
 *   them into ambiguous English.
 */
export const SMOOTHING_TOKENS = {
  numeric_softening: [
    "approximately",
    "roughly",
    "ballpark",
    "on the order of",
    "smoothed",
    "interpolated",
    "extrapolated",
    "estimated from",
    "rounded to",
    "in the range of",
  ],
  prose_confidence_translation: [
    "fairly confident",
    "high confidence",
    "moderate confidence",
    "low confidence",
    "we're confident",
    "the model suggests",
    "with reasonable certainty",
  ],
} as const;

export type SmoothingTokenGroup = keyof typeof SMOOTHING_TOKENS;
