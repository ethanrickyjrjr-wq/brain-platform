/**
 * MarketBeat submarket → corridor_profiles.corridor_name[] fan-out table.
 *
 * Scope: maps the free-text `submarket` field from `data_lake.marketbeat_swfl`
 * (as populated by the n8n Firecrawl ingest flow / MHS geometry extractor) to
 * one or more corridor names as they appear in `corridor_profiles.corridor_name`
 * and `fixtures/corridor-rents.json`.
 *
 * This is intentionally a SEPARATE file from `corridor-aliases.mts`.
 * corridor-aliases.mts maps CRE slugs → centroid IDs for the permits join.
 * This file maps MarketBeat broker-survey regions → CRE corridor names for the
 * Flow-3 per-corridor enrichment join in cre-source.mts. Different domains,
 * different key types, different join target.
 *
 * NOTE ON PERMIT JURISDICTIONS: permit jurisdiction strings
 * ("Unincorporated Lee County", "City of Sanibel", etc.) do NOT align 1:1 with
 * MarketBeat submarkets and must NOT be added here. They belong in a separate
 * jurisdiction crosswalk file (planned as Recipe 2 Step 2).
 *
 * Coverage notes:
 *   - "Naples", "Fort Myers", "Cape Coral", "Bonita Springs" appear in current
 *     MarketBeat / MHS fixture data.
 *   - "Estero" and "Fort Myers Beach" appear in CRE corridor data but have no
 *     corresponding MarketBeat submarket in the current broker report cadence.
 *     They are included here so the mapping is exhaustive; they will silently
 *     produce zero MarketBeat rows until coverage is added.
 *   - "Charlotte County" is a COUNTY-LEVEL entry (FIPS 12015, geographic_type:
 *     'county'). It has no corridor profile mappings; its corridor array is
 *     intentionally empty. Metadata lives in SUBMARKET_METADATA below.
 *
 * Source of truth for corridor names: `fixtures/corridor-rents.json` (26 rows).
 */

export type MarketbeatSubmarket = string;
export type CorridorProfileName = string;

/**
 * Optional per-submarket metadata. Populated for entries where the standard
 * submarket → corridor join doesn't apply, e.g. county-level rows that MHS
 * tags `geographic_type: 'county'` rather than `'submarket'`.
 */
export interface SubmarketMeta {
  /** FIPS code for the county this entry represents (county entries only). */
  fips?: string;
  geographic_type: "submarket" | "county";
}

/**
 * Metadata for registered submarkets that carry non-default attributes.
 * Entries here are a superset of `MARKETBEAT_SUBMARKET_MAP` — every entry
 * in this record MUST also appear as a key in the map below.
 */
export const SUBMARKET_METADATA: Partial<
  Record<MarketbeatSubmarket, SubmarketMeta>
> = {
  /** Charlotte County (FIPS 12015) — county-level grain, no corridor profiles. */
  "Charlotte County": { fips: "12015", geographic_type: "county" },
};

export const MARKETBEAT_SUBMARKET_MAP: Record<
  MarketbeatSubmarket,
  CorridorProfileName[]
> = {
  Naples: [
    "5th Ave South / 3rd Street South",
    "Airport-Pulling Naples",
    "Collier Blvd / CR-951",
    "Davis Blvd East Naples",
    "Immokalee Rd North Naples",
    "Pine Ridge Rd Naples",
    "Tamiami Naples",
    "Vanderbilt Beach Rd / Mercato",
    "Waterside Shops",
  ],
  "Fort Myers": [
    "Cleveland Ave Fort Myers",
    "Colonial East",
    "Daniels Pkwy",
    "Gulf Coast Town Center",
    "Midpoint Bridge Corridor",
    "Six Mile Cypress Pkwy",
    "Summerlin Rd Fort Myers",
  ],
  "Cape Coral": [
    "Cape Coral – Coral Pointe",
    "Cape Coral Pkwy E",
    "Pine Island Rd Cape Coral",
  ],
  "Bonita Springs": ["Bonita Beach Rd / Bonita Beach", "Bonita Trail"],
  Estero: [
    "Ben Hill Griffin Pkwy",
    "Coconut Point Mall",
    "Three Oaks Pkwy / Coconut Rd (Estero/Bonita boundary)",
  ],
  "Fort Myers Beach": ["Estero Blvd Fort Myers Beach"],
  /**
   * Charlotte County — county-level grain (FIPS 12015, geographic_type: 'county').
   * No corridor profile mappings (county rows don't resolve to a single CRE corridor).
   * Per-submarket MarketBeat key_metrics will still emit for this entry; the
   * zero-matched-corridors caveat fires (expected — see buildMarketbeatSubmarketSource).
   */
  "Charlotte County": [],
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
  // Fold hyphen runs too, so a raw label like "sfm-san-carlos" can't leak a
  // hyphen into an otherwise underscore-only slug. (Canonical labels resolve
  // through places-swfl.mts; this is the fallback for unmapped strings.)
  return submarket.toLowerCase().replace(/[\s-]+/g, "_");
}
