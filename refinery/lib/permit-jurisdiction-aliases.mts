/**
 * Permit jurisdiction → canonical place crosswalk (MHS Recipe 2).
 *
 * The MHS Data Book "ISSUED PERMITS 2025" section groups permits by a raw
 * jurisdiction string ("Unincorporated Lee County", "City of Cape Coral",
 * "Town of Fort Myers Beach", …). These are NOT MarketBeat submarket slugs and
 * NOT corridor names — they get their own crosswalk (this file), as the
 * marketbeat-submarket-aliases header always said they would.
 *
 * Operator rule (2026-06-05): keep it simple. Unincorporated areas run to their
 * county (Uninc Lee → Lee County, Uninc Collier → Collier County); cities run to
 * the city. Nobody should miss permit data because the label said
 * "Unincorporated Collier" instead of "Collier". All place/county/FIPS truth
 * lives in `places-swfl.mts` (one source) — this file only declares which raw
 * jurisdiction strings exist and which are in Lee/Collier scope.
 *
 * Scope: Lee + Collier ONLY. Charlotte-County jurisdictions (Unincorporated
 * Charlotte County, City of Punta Gorda) appear in the same PDF — they resolve
 * (so the writer recognizes them) but are flagged `in_scope: false` so the
 * writer logs + skips rather than blending out-of-region permits.
 *
 * Target table: `data_lake.mhs_permits_swfl` ONLY — never `permits_swfl` /
 * the Accela `lee_building_permits` / `collier_building_permits` feeds. That
 * isolation is what prevents the double-count the scaffold was built to avoid.
 */

import { resolvePlace, type PlaceRecord, type County } from "./places-swfl.mts";

const IN_SCOPE_COUNTIES: ReadonlySet<County> = new Set(["Lee", "Collier"]);

export interface JurisdictionResolution {
  /** Canonical place (display/slug/county/FIPS all from places-swfl.mts). */
  place: PlaceRecord;
  /** false for jurisdictions outside Lee/Collier (Charlotte, Punta Gorda) —
   *  the writer logs + skips these, does not write them to mhs_permits_swfl. */
  in_scope: boolean;
}

/**
 * Known MHS permit jurisdictions (2025 cohort, confirmed from the Data Book).
 * The last two are Charlotte County — present in the PDF, out of Lee/Collier scope.
 */
export const KNOWN_JURISDICTIONS: readonly string[] = [
  "Unincorporated Lee County",
  "City of Cape Coral",
  "City of Fort Myers",
  "City of Sanibel",
  "City of Bonita Springs",
  "Town of Fort Myers Beach",
  "Village of Estero",
  "Unincorporated Collier",
  "City of Naples",
  "City of Marco Island",
  "Unincorporated Charlotte County", // out of scope
  "City of Punta Gorda", // out of scope
];

/**
 * Resolve a raw permit jurisdiction string to its canonical place + scope flag.
 * Returns `null` for an unrecognized jurisdiction (writer logs the raw string
 * for crosswalk follow-up — never invents a place).
 */
export function resolveJurisdiction(
  raw: string,
): JurisdictionResolution | null {
  const place = resolvePlace(raw);
  if (!place) return null;
  return { place, in_scope: IN_SCOPE_COUNTIES.has(place.county) };
}
