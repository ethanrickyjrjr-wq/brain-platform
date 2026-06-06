/**
 * Pockets — the "back out a little" zoom tier between a single place and the
 * metro. Users rarely open at a single corridor; they ask about an area
 * ("North Naples", "Fort Myers") and zoom in only when they name a spot.
 *
 * Lee corridors map 1:1 from their centroid `submarket`. The Collier
 * `submarket="Naples"` bucket lumps 9 corridors, which are split by hand into
 * Downtown / North / East Naples (locals distinguish them; the data didn't).
 * Two corridors near the Pine Ridge Rd line (`pine-ridge-rd-naples`,
 * `airport-pulling-naples`) are judgment calls placed in North Naples — change
 * here if a "Central Naples" pocket is ever introduced.
 *
 * Keyed by `corridor_id` (the frozen internal slug); this is additive on top
 * of those IDs, never a rename. Coverage is guaranteed by a unit test that
 * asserts every centroid corridor_id appears in exactly one pocket.
 */

export type Pocket =
  | "Fort Myers"
  | "Cape Coral"
  | "Estero"
  | "Bonita Springs"
  | "Fort Myers Beach"
  | "Lehigh Acres"
  | "Downtown Naples"
  | "North Naples"
  | "East Naples";

/** Pocket -> the centroid corridor_ids it contains. */
export const POCKETS: Record<Pocket, string[]> = {
  "Fort Myers": [
    "cleveland-ave-fort-myers",
    "colonial-east",
    "daniels-pkwy",
    "gulf-coast-town-center",
    "midpoint-bridge-corridor",
    "six-mile-cypress-pkwy",
    "summerlin-rd-fort-myers",
  ],
  "Cape Coral": [
    "cape-coral-coral-pointe",
    "cape-coral-pkwy-e",
    "pine-island-rd-cape-coral",
  ],
  Estero: [
    "ben-hill-griffin-pkwy",
    "coconut-point-mall",
    "three-oaks-pkwy-coconut-rd-estero-bonita-boundary",
  ],
  "Bonita Springs": ["bonita-beach-rd-bonita-beach", "bonita-trail"],
  "Fort Myers Beach": ["estero-blvd-fort-myers-beach"],
  "Lehigh Acres": ["lee-blvd-lehigh-acres"],
  "Downtown Naples": ["5th-ave-south-3rd-street-south"],
  "North Naples": [
    "vanderbilt-beach-rd-mercato",
    "immokalee-rd-north-naples",
    "waterside-shops",
    "pine-ridge-rd-naples",
    "airport-pulling-naples",
  ],
  "East Naples": [
    "davis-blvd-east-naples",
    "collier-blvd-cr-951",
    "tamiami-naples",
  ],
};

/** County a pocket belongs to — the zoom-out tier (Naples vs Fort Myers metro). */
export const POCKET_COUNTY: Record<Pocket, "lee" | "collier"> = {
  "Fort Myers": "lee",
  "Cape Coral": "lee",
  Estero: "lee",
  "Bonita Springs": "lee",
  "Fort Myers Beach": "lee",
  "Lehigh Acres": "lee",
  "Downtown Naples": "collier",
  "North Naples": "collier",
  "East Naples": "collier",
};

const POCKET_BY_CORRIDOR = new Map<string, Pocket>();
for (const [pocket, ids] of Object.entries(POCKETS) as [Pocket, string[]][]) {
  for (const id of ids) POCKET_BY_CORRIDOR.set(id, pocket);
}

/** The pocket a corridor belongs to, or undefined if the slug is unknown. */
export function pocketFor(corridorId: string): Pocket | undefined {
  return POCKET_BY_CORRIDOR.get(corridorId);
}

/** The corridor_ids in a pocket (empty array for an unknown pocket). */
export function corridorsInPocket(pocket: Pocket): string[] {
  return POCKETS[pocket] ?? [];
}

/** All pocket names, in declaration order. */
export function allPockets(): Pocket[] {
  return Object.keys(POCKETS) as Pocket[];
}
