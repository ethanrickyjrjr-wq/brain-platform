/**
 * MarketBeat submarket → corridor_profiles.corridor_name[] fan-out table.
 *
 * Scope: maps the free-text `submarket` field from `data_lake.marketbeat_swfl`
 * (as populated by the n8n Firecrawl ingest flow) to one or more corridor names
 * as they appear in `corridor_profiles.corridor_name` and `fixtures/corridor-rents.json`.
 *
 * This is intentionally a SEPARATE file from `corridor-aliases.mts`.
 * corridor-aliases.mts maps CRE slugs → centroid IDs for the permits join.
 * This file maps MarketBeat broker-survey regions → CRE corridor names for the
 * Flow-3 per-corridor enrichment join in cre-source.mts. Different domains,
 * different key types, different join target.
 *
 * Coverage notes:
 *   - "Naples", "Fort Myers", "Cape Coral", "Bonita Springs" appear in current
 *     MarketBeat fixture data.
 *   - "Estero" and "Fort Myers Beach" appear in CRE corridor data but have no
 *     corresponding MarketBeat submarket in the current broker report cadence.
 *     They are included here so the mapping is exhaustive; they will silently
 *     produce zero MarketBeat rows until coverage is added.
 *
 * Source of truth for corridor names: `fixtures/corridor-rents.json` (26 rows).
 */

export type MarketbeatSubmarket = string;
export type CorridorProfileName = string;

export const MARKETBEAT_SUBMARKET_MAP: Record<
  MarketbeatSubmarket,
  CorridorProfileName[]
> = {
  Naples: [
    "5th Ave South / 3rd Street South",
    "Collier Blvd / CR-951",
    "Davis Blvd East Naples",
    "Immokalee Rd North Naples",
    "Naples Airport-Pulling (North)",
    "Naples Airport-Pulling (South)",
    "Pine Ridge Rd Naples",
    "US-41 Tamiami Trail Naples",
    "Vanderbilt Beach Rd / Mercato",
    "Waterside Shops",
  ],
  "Fort Myers": [
    "Colonial Blvd East (US-41 to I-75)",
    "Daniels Pkwy (I-75 to Ben Hill Griffin)",
    "Gulf Coast Town Center",
    "Six Mile Cypress Pkwy",
    "Summerlin Rd Fort Myers",
    "US-41 / Cleveland Ave Fort Myers",
    "Veterans Pkwy / Colonial Blvd (Midpoint Bridge Corridor)",
  ],
  "Cape Coral": [
    "Cape Coral – Coral Pointe",
    "Cape Coral Pkwy E",
    "Pine Island Rd Cape Coral",
  ],
  "Bonita Springs": [
    "Bonita Beach Rd (US-41 to Sanibel Causeway)",
    "US-41 Bonita Springs",
  ],
  Estero: [
    "Ben Hill Griffin Pkwy",
    "Coconut Point Mall",
    "Three Oaks Pkwy / Coconut Rd (Estero/Bonita boundary)",
  ],
  "Fort Myers Beach": ["Estero Blvd Fort Myers Beach"],
};

/**
 * Look up which MarketBeat submarket a corridor belongs to.
 * Returns `undefined` if the corridor name is not in the table.
 */
export function submarketFor(
  corridorName: CorridorProfileName,
): MarketbeatSubmarket | undefined {
  for (const [submarket, corridors] of Object.entries(
    MARKETBEAT_SUBMARKET_MAP,
  )) {
    if (corridors.includes(corridorName)) return submarket;
  }
  return undefined;
}

/**
 * Look up the corridor names for a given MarketBeat submarket.
 * Returns an empty array if the submarket has no entry (not `undefined`),
 * so callers can safely iterate without null-checking.
 */
export function corridorsForSubmarket(
  submarket: MarketbeatSubmarket,
): CorridorProfileName[] {
  return MARKETBEAT_SUBMARKET_MAP[submarket] ?? [];
}

/**
 * Single-sourced snake_case derivation for a MarketBeat submarket.
 * Used as the per-submarket suffix in key_metric slugs
 * (e.g. `vacancy_rate_marketbeat_fort_myers`).
 *
 * Whitespace runs collapse to a single underscore. This is a known
 * lossy normalization — see the alias-test collision smoke test.
 */
export function submarketSlug(submarket: MarketbeatSubmarket): string {
  return submarket.toLowerCase().replace(/\s+/g, "_");
}
