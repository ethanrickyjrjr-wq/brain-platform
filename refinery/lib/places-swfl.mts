/**
 * Canonical SWFL place resolver — ONE source of truth for "what place is this?".
 *
 * Three consumers share this map so a name only has to be right once:
 *   1. cre-swfl submarket labels/slugs (MarketBeat/MHS `submarket` strings).
 *   2. the permits jurisdiction crosswalk (`permit-jurisdiction-aliases.mts`).
 *   3. search/vocab (plain "Naples" / "Fort Myers" must find the data).
 *
 * Operator rule (locked 2026-06-05): keep it simple. Sub-area names roll UP to
 * their parent place for search/display — Fort Myers sub-areas → Fort Myers/Lee,
 * Naples/Collier sub-areas → Naples/Collier — and bureaucratic labels
 * ("Outlying Collier County", "Unincorporated Collier", "City of Ft Myers")
 * collapse to the plain place. No word like "Unincorporated" or "Outlying"
 * survives into a slug or a customer-facing label.
 *
 * Granularity: the granular row is KEPT (its own `slug`); `parent` is the
 * primary search + rollup key. A Naples rollup is the median of its children,
 * computed in the pack — this module only declares the parent relationship.
 *
 * Provenance: every `place_fips` is a Census 2020 place GEOID verified in-session
 * against the authoritative reference file
 * (`www2.census.gov/geo/docs/reference/codes2020/place/st12_fl_place2020.txt`),
 * NOT typed from memory. `county_fips` matches `swfl-geo.mts` SWFL_COUNTY_FIPS.
 * The handed permits map was wrong on 6 of 8 places (e.g. Naples 1247650 is
 * actually Naples Manor); these are the corrected values.
 */

export type County = "Lee" | "Collier" | "Charlotte";
export type PlaceGrain = "place" | "county";

export interface PlaceRecord {
  /** Canonical slug (kebab). Used for routing + (snake-cased) metric slugs. */
  slug: string;
  /** User-facing display name. Never a bureaucratic label. */
  display: string;
  /** Slug of the place this rolls up to for search/rollup. Own places point to self. */
  parent: string;
  county: County;
  /** County FIPS (5-digit) — matches swfl-geo.mts SWFL_COUNTY_FIPS. */
  county_fips: string;
  /** Census 2020 place GEOID (7-digit). null for county-grain rows or informal
   *  directional areas (East/North Naples) that are not Census places. */
  place_fips: string | null;
  grain: PlaceGrain;
}

const LEE = "12071";
const COLLIER = "12021";
const CHARLOTTE = "12015";

/**
 * Canonical places, keyed by slug. Incorporated cities/villages are their own
 * parent; CDP sub-areas and informal directional areas roll up per the operator
 * rule. County-grain rows carry `place_fips: null`.
 */
export const PLACES: Record<string, PlaceRecord> = {
  // ---- Lee — own places ----
  "fort-myers": {
    slug: "fort-myers",
    display: "Fort Myers",
    parent: "fort-myers",
    county: "Lee",
    county_fips: LEE,
    place_fips: "1224125",
    grain: "place",
  },
  "cape-coral": {
    slug: "cape-coral",
    display: "Cape Coral",
    parent: "cape-coral",
    county: "Lee",
    county_fips: LEE,
    place_fips: "1210275",
    grain: "place",
  },
  "bonita-springs": {
    slug: "bonita-springs",
    display: "Bonita Springs",
    parent: "bonita-springs",
    county: "Lee",
    county_fips: LEE,
    place_fips: "1207525",
    grain: "place",
  },
  estero: {
    slug: "estero",
    display: "Estero",
    parent: "estero",
    county: "Lee",
    county_fips: LEE,
    place_fips: "1221150",
    grain: "place",
  },
  sanibel: {
    slug: "sanibel",
    display: "Sanibel",
    parent: "sanibel",
    county: "Lee",
    county_fips: LEE,
    place_fips: "1263700",
    grain: "place",
  },
  "fort-myers-beach": {
    slug: "fort-myers-beach",
    display: "Fort Myers Beach",
    parent: "fort-myers-beach",
    county: "Lee",
    county_fips: LEE,
    place_fips: "1224150",
    grain: "place",
  },
  // Lehigh Acres is its own community (~15 mi east), NOT a Fort Myers sub-area.
  "lehigh-acres": {
    slug: "lehigh-acres",
    display: "Lehigh Acres",
    parent: "lehigh-acres",
    county: "Lee",
    county_fips: LEE,
    place_fips: "1239925",
    grain: "place",
  },

  // ---- Lee — Fort Myers sub-areas (roll up to Fort Myers) ----
  "north-fort-myers": {
    slug: "north-fort-myers",
    display: "North Fort Myers",
    parent: "fort-myers",
    county: "Lee",
    county_fips: LEE,
    place_fips: "1249350",
    grain: "place",
  },
  "san-carlos-park": {
    slug: "san-carlos-park",
    display: "San Carlos Park",
    parent: "fort-myers",
    county: "Lee",
    county_fips: LEE,
    place_fips: "1263425",
    grain: "place",
  },
  // The Islands = Sanibel + Captiva (barrier islands). The MHS broker survey
  // reports them as one combined "The Islands" submarket — NOT a single Census
  // place — so place_fips is null. Operator rule (2026-06-05): for CRE rollup it
  // runs to Fort Myers / Lee. (The permits feed keys on "City of Sanibel", which
  // resolves to the standalone `sanibel` place above — different feed, different
  // grain; both are correct.)
  "the-islands": {
    slug: "the-islands",
    display: "The Islands",
    parent: "fort-myers",
    county: "Lee",
    county_fips: LEE,
    place_fips: null,
    grain: "place",
  },

  // ---- Collier — own places ----
  naples: {
    slug: "naples",
    display: "Naples",
    parent: "naples",
    county: "Collier",
    county_fips: COLLIER,
    place_fips: "1247625",
    grain: "place",
  },
  "marco-island": {
    slug: "marco-island",
    display: "Marco Island",
    parent: "marco-island",
    county: "Collier",
    county_fips: COLLIER,
    place_fips: "1243083",
    grain: "place",
  },

  // ---- Collier — Naples sub-areas (roll up to Naples) ----
  // East/North Naples are informal directional areas — not Census places (place_fips null).
  "east-naples": {
    slug: "east-naples",
    display: "East Naples",
    parent: "naples",
    county: "Collier",
    county_fips: COLLIER,
    place_fips: null,
    grain: "place",
  },
  "north-naples": {
    slug: "north-naples",
    display: "North Naples",
    parent: "naples",
    county: "Collier",
    county_fips: COLLIER,
    place_fips: null,
    grain: "place",
  },
  "golden-gate": {
    slug: "golden-gate",
    display: "Golden Gate",
    parent: "naples",
    county: "Collier",
    county_fips: COLLIER,
    place_fips: "1226300",
    grain: "place",
  },
  lely: {
    slug: "lely",
    display: "Lely",
    parent: "naples",
    county: "Collier",
    county_fips: COLLIER,
    place_fips: "1239987",
    grain: "place",
  },

  // ---- County-grain ----
  "lee-county": {
    slug: "lee-county",
    display: "Lee County",
    parent: "lee-county",
    county: "Lee",
    county_fips: LEE,
    place_fips: null,
    grain: "county",
  },
  "collier-county": {
    slug: "collier-county",
    display: "Collier County",
    parent: "collier-county",
    county: "Collier",
    county_fips: COLLIER,
    place_fips: null,
    grain: "county",
  },
  "charlotte-county": {
    slug: "charlotte-county",
    display: "Charlotte County",
    parent: "charlotte-county",
    county: "Charlotte",
    county_fips: CHARLOTTE,
    place_fips: null,
    grain: "county",
  },

  // ---- Charlotte — own place (permits scope-filters this out; CRE doesn't reach it) ----
  "punta-gorda": {
    slug: "punta-gorda",
    display: "Punta Gorda",
    parent: "punta-gorda",
    county: "Charlotte",
    county_fips: CHARLOTTE,
    place_fips: "1259200",
    grain: "place",
  },
};

/**
 * Lowercase, fold separators/punctuation, strip the government prefixes/suffixes
 * that make bureaucratic labels miss a plain-name search, collapse whitespace.
 * "City of Cape Coral" → "cape coral"; "Unincorporated Collier" → "collier";
 * "Outlying Collier County" → "collier county"; "UNINC LEE" → "lee".
 */
export function normalizePlace(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[_\-.,]+/g, " ")
    .replace(/\b(city|town|village) of\b/g, " ")
    .replace(/\b(unincorporated|uninc|outlying)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Curated alias → canonical slug. Keys are stored already-normalized (via
 * `normalizePlace`) so the raw MHS submarket strings, the permit jurisdiction
 * strings (ALL-CAPS or title-case), and plain user searches all land here.
 * A `null` value marks a known label we deliberately do NOT resolve yet.
 */
const RAW_ALIASES: Record<string, string | null> = {
  // plain place names (most users type these)
  "fort myers": "fort-myers",
  "ft myers": "fort-myers",
  "cape coral": "cape-coral",
  "bonita springs": "bonita-springs",
  bonita: "bonita-springs",
  estero: "estero",
  sanibel: "sanibel",
  "fort myers beach": "fort-myers-beach",
  fmb: "fort-myers-beach",
  lehigh: "lehigh-acres",
  "lehigh acres": "lehigh-acres",
  naples: "naples",
  "marco island": "marco-island",
  marco: "marco-island",
  "punta gorda": "punta-gorda",

  // Fort Myers sub-areas
  "north fort myers": "north-fort-myers",
  "san carlos park": "san-carlos-park",
  "san carlos": "san-carlos-park",
  "sfm san carlos": "san-carlos-park", // raw MHS slug "sfm-san-carlos"
  "the islands": "the-islands", // Sanibel + Captiva → Fort Myers/Lee (operator 2026-06-05)
  "sanibel captiva": "the-islands",
  "sanibel & captiva": "the-islands",

  // Naples sub-areas
  "east naples": "east-naples",
  "north naples": "north-naples",
  "golden gate": "golden-gate",
  lely: "lely",
  "lely resort": "lely",

  // county grain — "Unincorporated Lee/Collier", "Outlying Collier County", plain county
  lee: "lee-county",
  "lee county": "lee-county",
  collier: "collier-county",
  "collier county": "collier-county",
  charlotte: "charlotte-county",
  "charlotte county": "charlotte-county",
};

const ALIAS_BY_NORM: Map<string, string | null> = new Map(
  Object.entries(RAW_ALIASES).map(([k, v]) => [normalizePlace(k), v]),
);

/**
 * Resolve any raw label (MHS submarket / permit jurisdiction / user search) to
 * its canonical `PlaceRecord`. Returns `null` for an unknown or deliberately
 * unresolved label — callers log + skip rather than surfacing a raw string.
 */
export function resolvePlace(raw: string): PlaceRecord | null {
  const norm = normalizePlace(raw);
  if (!norm) return null;
  // 1. curated alias (covers bureaucratic + abbreviated + plain forms)
  if (ALIAS_BY_NORM.has(norm)) {
    const slug = ALIAS_BY_NORM.get(norm);
    return slug ? (PLACES[slug] ?? null) : null;
  }
  // 2. the normalized string already equals a canonical display/slug
  for (const rec of Object.values(PLACES)) {
    if (normalizePlace(rec.display) === norm || rec.slug === norm) return rec;
  }
  return null;
}

/** The place a label rolls up to (parent record). null if unresolved. */
export function parentOf(raw: string): PlaceRecord | null {
  const rec = resolvePlace(raw);
  return rec ? (PLACES[rec.parent] ?? null) : null;
}

/** snake_case slug suffix for metric names (e.g. "east-naples" → "east_naples"). */
export function metricSlug(rec: PlaceRecord): string {
  return rec.slug.replace(/-/g, "_");
}
