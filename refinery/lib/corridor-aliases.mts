/**
 * Cross-domain corridor alias table.
 *
 * The cre-swfl pack identifies corridors by `corridor_profiles.corridor_name`
 * slug (26 entries — 17 Lee, 9 Collier). The permits-swfl pack identifies
 * corridors by centroid `corridor_id` (26 entries, Lee + Collier; see
 * `docs/data-coverage.md`). When the render-time join in
 * `app/embed/charts/page.tsx` needs to attach permit z-scores to rent rows,
 * it walks this table — it never falls back to fuzzy string matching.
 *
 * Lee + Collier corridors: centroid IDs in `fixtures/corridor-centroids.json`
 * are hand-authored to MATCH cre-swfl slugs exactly (Step 2 design lock),
 * so every entry is a 1:1 identity map. The redundancy is intentional —
 * it's a drift sentinel for either side renaming a corridor without
 * updating the other.
 *
 * Reserved semantic: a `null` value would mean "this corridor exists in
 * cre-swfl but has no centroid / permits coverage." No entries hold that
 * value today (Collier permits shipped 2026-05-27, wiring all 10 Collier
 * corridors). Anything not in the table at all is a coverage gap and the
 * test below fails loudly.
 */

export type CentroidCorridorId = string;
export type CreSwflCorridorSlug = string;

export const CORRIDOR_ALIASES: Record<
  CreSwflCorridorSlug,
  CentroidCorridorId | null
> = {
  // Lee — identity map to centroids.
  "ben-hill-griffin-pkwy": "ben-hill-griffin-pkwy",
  "bonita-beach-rd-bonita-beach": "bonita-beach-rd-bonita-beach",
  "bonita-trail": "bonita-trail",
  "cape-coral-coral-pointe": "cape-coral-coral-pointe",
  "cape-coral-pkwy-e": "cape-coral-pkwy-e",
  "cleveland-ave-fort-myers": "cleveland-ave-fort-myers",
  "coconut-point-mall": "coconut-point-mall",
  "colonial-east": "colonial-east",
  "daniels-pkwy": "daniels-pkwy",
  "estero-blvd-fort-myers-beach": "estero-blvd-fort-myers-beach",
  "gulf-coast-town-center": "gulf-coast-town-center",
  "lee-blvd-lehigh-acres": "lee-blvd-lehigh-acres",
  "midpoint-bridge-corridor": "midpoint-bridge-corridor",
  "pine-island-rd-cape-coral": "pine-island-rd-cape-coral",
  "six-mile-cypress-pkwy": "six-mile-cypress-pkwy",
  "summerlin-rd-fort-myers": "summerlin-rd-fort-myers",
  "three-oaks-pkwy-coconut-rd-estero-bonita-boundary":
    "three-oaks-pkwy-coconut-rd-estero-bonita-boundary",

  // Collier — identity map to centroids.
  "5th-ave-south-3rd-street-south": "5th-ave-south-3rd-street-south",
  "airport-pulling-naples": "airport-pulling-naples",
  "collier-blvd-cr-951": "collier-blvd-cr-951",
  "davis-blvd-east-naples": "davis-blvd-east-naples",
  "immokalee-rd-north-naples": "immokalee-rd-north-naples",
  "pine-ridge-rd-naples": "pine-ridge-rd-naples",
  "tamiami-naples": "tamiami-naples",
  "vanderbilt-beach-rd-mercato": "vanderbilt-beach-rd-mercato",
  "waterside-shops": "waterside-shops",
};

/**
 * Look up the centroid corridor_id for a cre-swfl slug. Returns:
 *   - `string`     → known Lee corridor with permits coverage
 *   - `null`       → known corridor with explicit no-coverage (Collier)
 *   - `undefined`  → corridor unknown to the alias table (a coverage hole;
 *                    the unit test prevents this from shipping)
 */
export function aliasFor(
  slug: CreSwflCorridorSlug,
): CentroidCorridorId | null | undefined {
  return CORRIDOR_ALIASES[slug];
}
