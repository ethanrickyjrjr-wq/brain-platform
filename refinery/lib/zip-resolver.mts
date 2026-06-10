/**
 * zip-resolver — §A spine of Universal Location Search.
 *
 * Given a ZIP, return its full geography nest — scope, county/counties, barrier
 * classification, the place names that contain it, and the corridors covering it —
 * built ENTIRELY from data we already hold. This is the foundation every other
 * section (§B dispatcher, §C fan-out) sits on, and the scope gate J2/J3 call before
 * writing any `zip_code` to the lake.
 *
 * Plan: docs/superpowers/plans/2026-06-09-universal-location-search/01-spine.md
 *
 * G1 — PURE: static ESM JSON import only, NO `fs`. This module must load inside the
 * Vercel MCP function (mirrors geography-gazetteer.mts, which already ships in the
 * live `_meta.geography`).
 *
 * Each source does exactly ONE job — do not blur them:
 *   - swfl-zip-county.json    -> scope + county authority (in_scope, counties, primary).
 *   - place-zip crosswalk     -> place NAMES + human context only (11 Lee/Collier places).
 *   - swfl-geo barrierClassFor -> flood barrier classification (G6: null, never a default).
 *   - pockets                 -> place -> pocket -> corridor (Path A, no geometry).
 */
import zipCountyJson from "../../fixtures/swfl-zip-county.json";
import { PLACE_ZIP_CROSSWALK, type PlaceZipEntry } from "./geography-gazetteer.mts";
import { barrierClassFor } from "./swfl-geo.mts";
import { allPockets, corridorsInPocket, type Pocket } from "./pockets.mts";

/** The grain ladder. Location is a lens, not a storage grain. */
export type Grain =
  | "zip"
  | "corridor"
  | "city"
  | "county"
  | "msa"
  | "region"
  | "state"
  | "national";

/** The 6-county SWFL footprint (Charlotte, Collier, Glades, Hendry, Lee, Sarasota). */
export type CountyFips = "12015" | "12021" | "12043" | "12051" | "12071" | "12115";

export interface ZipResolution {
  zip: string;
  in_scope: boolean;
  counties: CountyFips[];
  primary_county: CountyFips | null;
  county_names: string[];
  barrier: {
    classification: string | null;
    score: number | null;
    name: string | null;
  };
  places: {
    place: string;
    match: "primary" | "alt";
    county: string;
    usps_preferred_city: string;
    source: string;
    needs_verification: boolean;
  }[];
  corridors: { corridor_id: string; pocket: string }[];
  resolution_notes: string[];
}

interface ZipCountyEntry {
  zip: string;
  counties: string[];
  primary_county: string;
  county_names: string[];
}

// ---- scope + county authority (swfl-zip-county.json) ----
const ZIP_COUNTY = new Map<string, ZipCountyEntry>(
  (zipCountyJson.entries as ZipCountyEntry[]).map((e) => [e.zip, e]),
);

// ---- corridors: place -> pocket -> corridor (Path A) ----
// Collier's "Naples" lumps three pockets the data didn't split; a Naples ZIP can't
// be disambiguated to one, so it attaches all three (label "Naples-area").
const NAPLES_POCKETS: Pocket[] = ["Downtown Naples", "North Naples", "East Naples"];
const POCKET_NAMES = new Set<string>(allPockets());

/**
 * The pocket(s) a crosswalk place name maps to. Several place names ARE pocket
 * names (Fort Myers, Cape Coral, Estero, Bonita Springs, Fort Myers Beach, Lehigh
 * Acres) -> a single pocket. "Naples" -> the three Naples pockets. Places with no
 * pocket (Gateway, Sanibel, Marco Island, Immokalee) -> none (a ZIP can still gain
 * corridors via a co-resolved place, e.g. 33913 = Gateway + Fort Myers alt).
 */
function pocketsForPlace(place: string): Pocket[] {
  if (place === "Naples") return NAPLES_POCKETS;
  return POCKET_NAMES.has(place) ? [place as Pocket] : [];
}

// ---- places: invert the crosswalk by ZIP (primary `zip` + every `alt_zips`) ----
type PlaceMatch = { entry: PlaceZipEntry; match: "primary" | "alt" };
const PLACES_BY_ZIP = new Map<string, PlaceMatch[]>();
for (const entry of PLACE_ZIP_CROSSWALK.entries) {
  const add = (zip: string, match: "primary" | "alt") => {
    const list = PLACES_BY_ZIP.get(zip) ?? [];
    list.push({ entry, match });
    PLACES_BY_ZIP.set(zip, list);
  };
  add(entry.zip, "primary");
  for (const alt of entry.alt_zips) add(alt, "alt");
}

/**
 * Resolve a ZIP to its full geography nest. Pure + deterministic. The Grain is
 * always "zip" — a place name is human context, never the answer grain.
 */
export function resolveZip(zip: string): ZipResolution {
  const z = String(zip ?? "").trim();
  const notes: string[] = [];

  const countyRec = ZIP_COUNTY.get(z);
  const in_scope = countyRec !== undefined;

  // Out of scope: stop here. No places, no corridors, no barrier claim, one note.
  if (!countyRec) {
    notes.push(
      `ZIP ${z || "(empty)"} is outside the 6-county SWFL footprint ` +
        `(Charlotte, Collier, Glades, Hendry, Lee, Sarasota).`,
    );
    return {
      zip: z,
      in_scope: false,
      counties: [],
      primary_county: null,
      county_names: [],
      barrier: { classification: null, score: null, name: null },
      places: [],
      corridors: [],
      resolution_notes: notes,
    };
  }

  // ---- barrier (G6: never present the "inland" default as a fact) ----
  const b = barrierClassFor(z);
  const barrier = b.record
    ? {
        classification: b.record.classification as string,
        score: b.record.barrier_score as number,
        name: b.record.name as string,
      }
    : { classification: null, score: null, name: null };
  if (!b.record) {
    notes.push("Barrier-island flood classification not assessed for this ZIP.");
  }

  // ---- places (primary before alt; crosswalk order is the deterministic tie-break) ----
  const matches = (PLACES_BY_ZIP.get(z) ?? [])
    .slice()
    .sort((a, c) => (a.match === c.match ? 0 : a.match === "primary" ? -1 : 1));
  const places = matches.map(({ entry, match }) => ({
    place: entry.place,
    match,
    county: entry.county,
    usps_preferred_city: entry.usps_preferred_city,
    source: entry.source,
    needs_verification: entry.needs_verification,
  }));
  for (const p of places) {
    if (p.needs_verification) {
      notes.push(
        `Place "${p.place}" for this ZIP is flagged needs_verification — confirm before citing.`,
      );
    }
  }

  // ---- corridors (place -> pocket -> corridor; dedup, preserve place/pocket order) ----
  const corridors: { corridor_id: string; pocket: string }[] = [];
  const seen = new Set<string>();
  for (const p of places) {
    for (const pocket of pocketsForPlace(p.place)) {
      for (const cid of corridorsInPocket(pocket)) {
        if (seen.has(cid)) continue;
        seen.add(cid);
        corridors.push({ corridor_id: cid, pocket });
      }
    }
  }
  if (places.some((p) => p.place === "Naples")) {
    notes.push(
      "ZIP resolves to the Naples area broadly (Downtown / North / East Naples); " +
        "the corridor list spans all three pockets.",
    );
  }
  if (corridors.length === 0) {
    notes.push("No retail-corridor profile covers this ZIP.");
  }

  return {
    zip: z,
    in_scope,
    counties: countyRec.counties as CountyFips[],
    primary_county: countyRec.primary_county as CountyFips,
    county_names: countyRec.county_names,
    barrier,
    places,
    corridors,
    resolution_notes: notes,
  };
}
