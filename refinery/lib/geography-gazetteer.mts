/**
 * Geography gazetteer — the list of SWFL areas we cover, shipped in every
 * payload's `_meta.geography` so a downstream (Tier-3) Claude can map any
 * named place to a pocket itself and NEVER say "not in our system" for a real
 * Lee/Collier location.
 *
 * This is the cheap, primary mechanism for place resolution (the consuming AI
 * already knows SWFL geography; it just needs to know which areas we hold).
 * `resolvePlace` is the server-side belt-and-suspenders for non-AI consumers.
 *
 * Built deterministically from `POCKETS` + display names — no hand-maintained
 * second copy to drift.
 */
import { POCKETS, POCKET_COUNTY, allPockets, type Pocket } from "./pockets.mts";
import { displayNameFor } from "./corridor-display.mts";
import crosswalkJson from "../../fixtures/swfl-place-zip-crosswalk.json";

export interface GazetteerPocket {
  pocket: Pocket;
  county: "lee" | "collier";
  /** User-facing place names inside this pocket. */
  places: string[];
}

/** One sourced place-name -> primary-ZIP entry. */
export interface PlaceZipEntry {
  place: string;
  aliases: string[];
  /** Primary (core / most-recognized) ZIP for the place. */
  zip: string;
  /** Other ZIPs the place spans (empty for single-ZIP places). */
  alt_zips: string[];
  county: "lee" | "collier";
  usps_preferred_city: string;
  /** Provenance — USPS / Census; never LLM knowledge. */
  source: string;
  needs_verification: boolean;
  note: string;
}

/**
 * Sourced place-name -> ZIP crosswalk. UNLIKE `pockets` (area names only),
 * this resolves a named place to a citable primary ZIP. Each entry carries
 * its `source`. Built from `fixtures/swfl-place-zip-crosswalk.json`.
 */
export interface PlaceZipCrosswalk {
  crosswalk_vintage: string;
  note: string;
  default_source: string;
  verified_date: string;
  entries: PlaceZipEntry[];
}

export interface GeographyGazetteer {
  note: string;
  metros: { lee: string; collier: string };
  pockets: GazetteerPocket[];
  /**
   * Sourced place-name -> primary-ZIP crosswalk. This is the deterministic,
   * citable ZIP resolver — quote each entry's `source` when answering.
   */
  place_zip_crosswalk: PlaceZipCrosswalk;
}

interface RawCrosswalk extends PlaceZipCrosswalk {
  verification_method?: string;
}

const RAW_CROSSWALK = crosswalkJson as unknown as RawCrosswalk;

export const PLACE_ZIP_CROSSWALK: PlaceZipCrosswalk = {
  crosswalk_vintage: RAW_CROSSWALK.crosswalk_vintage,
  note: RAW_CROSSWALK.note,
  default_source: RAW_CROSSWALK.default_source,
  verified_date: RAW_CROSSWALK.verified_date,
  entries: RAW_CROSSWALK.entries,
};

/** Lowercase, fold dashes/underscores to spaces, collapse whitespace. */
function normalizePlace(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// place name + every alias -> entry (normalized keys).
const ENTRY_BY_NORM = new Map<string, PlaceZipEntry>();
for (const entry of PLACE_ZIP_CROSSWALK.entries) {
  ENTRY_BY_NORM.set(normalizePlace(entry.place), entry);
  for (const alias of entry.aliases)
    ENTRY_BY_NORM.set(normalizePlace(alias), entry);
}

/**
 * Resolve a place name to its sourced crosswalk entry (exact match on the
 * place name or any alias, after normalization). Returns `undefined` when the
 * place isn't in the crosswalk — the caller then falls back to the consuming
 * AI's own SWFL geography, never an invented ZIP.
 */
export function resolvePlaceZip(input: string): PlaceZipEntry | undefined {
  return ENTRY_BY_NORM.get(normalizePlace(input ?? ""));
}

const NOTE =
  "These are the Southwest Florida areas (Lee + Collier counties) this data covers. " +
  "Map any place a user names to its nearest pocket below and answer at that altitude. " +
  "A colloquial place — a neighborhood, plaza, or landmark — that sits inside one of these " +
  "pockets IS covered: resolve it and answer, never say 'not in our system'. Zoom out to the " +
  "county/metro for a broad question; zoom into one pocket only when the user names a spot. " +
  "Decline only when a place is genuinely outside Lee or Collier county.";

export const GEOGRAPHY_GAZETTEER: GeographyGazetteer = {
  note: NOTE,
  metros: {
    lee: "Fort Myers / Cape Coral / Bonita-Estero (Lee County)",
    collier: "Naples (Collier County)",
  },
  pockets: allPockets().map((pocket) => ({
    pocket,
    county: POCKET_COUNTY[pocket],
    places: POCKETS[pocket].map((id) => displayNameFor(id)),
  })),
  place_zip_crosswalk: PLACE_ZIP_CROSSWALK,
};
