/**
 * Cross-domain corridor alias table.
 *
 * The cre-swfl pack identifies corridors by `corridor_profiles.corridor_name`
 * slug (26 entries — 16 Lee, 10 Collier). The permits-swfl pack identifies
 * corridors by centroid `corridor_id` (16 entries, Lee-only by structural
 * reality; see `docs/data-coverage.md`). When the render-time join in
 * `app/embed/charts/page.tsx` needs to attach permit z-scores to rent rows,
 * it walks this table — it never falls back to fuzzy string matching.
 *
 * Lee corridors: centroid IDs in `fixtures/corridor-centroids.json` are
 * hand-authored to MATCH cre-swfl slugs exactly (Step 2 design lock), so
 * Lee entries are a 1:1 identity map. The redundancy is intentional — it's
 * a drift sentinel for either side renaming a corridor without updating
 * the other.
 *
 * Collier corridors: explicit `null`. Means "we know this corridor exists
 * in cre-swfl AND we know there is no centroid / permits data for it."
 * Anything else (no entry at all) is a coverage gap and the test below
 * fails loudly. The render layer treats `null` as a signal to draw the
 * "no permits coverage" badge — not a silent null-render.
 */

export type CentroidCorridorId = string;
export type CreSwflCorridorSlug = string;

export const CORRIDOR_ALIASES: Record<
  CreSwflCorridorSlug,
  CentroidCorridorId | null
> = {
  // Lee — identity map to centroids.
  "ben-hill-griffin-pkwy": "ben-hill-griffin-pkwy",
  "bonita-beach-rd-us-41-to-sanibel-causeway":
    "bonita-beach-rd-us-41-to-sanibel-causeway",
  "cape-coral-coral-pointe": "cape-coral-coral-pointe",
  "cape-coral-pkwy-e": "cape-coral-pkwy-e",
  "coconut-point-mall": "coconut-point-mall",
  "colonial-blvd-east-us-41-to-i-75": "colonial-blvd-east-us-41-to-i-75",
  "daniels-pkwy-i-75-to-ben-hill-griffin":
    "daniels-pkwy-i-75-to-ben-hill-griffin",
  "estero-blvd-fort-myers-beach": "estero-blvd-fort-myers-beach",
  "gulf-coast-town-center": "gulf-coast-town-center",
  "pine-island-rd-cape-coral": "pine-island-rd-cape-coral",
  "six-mile-cypress-pkwy": "six-mile-cypress-pkwy",
  "summerlin-rd-fort-myers": "summerlin-rd-fort-myers",
  "three-oaks-pkwy-coconut-rd-estero-bonita-boundary":
    "three-oaks-pkwy-coconut-rd-estero-bonita-boundary",
  "us-41-bonita-springs": "us-41-bonita-springs",
  "us-41-cleveland-ave-fort-myers": "us-41-cleveland-ave-fort-myers",
  "veterans-pkwy-colonial-blvd-midpoint-bridge-corridor":
    "veterans-pkwy-colonial-blvd-midpoint-bridge-corridor",

  // Collier — explicit no-coverage until a Collier permits pack ships.
  "5th-ave-south-3rd-street-south": null,
  "collier-blvd-cr-951": null,
  "davis-blvd-east-naples": null,
  "immokalee-rd-north-naples": null,
  "naples-airport-pulling-north": null,
  "naples-airport-pulling-south": null,
  "pine-ridge-rd-naples": null,
  "us-41-tamiami-trail-naples": null,
  "vanderbilt-beach-rd-mercato": null,
  "waterside-shops": null,
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
