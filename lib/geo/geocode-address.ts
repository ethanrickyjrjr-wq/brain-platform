// geocode-address.ts — the assistant's FIRST street-address resolver.
//
// Turns a free-text street address into { lat, lon, county } so the on-demand
// comp helper (lib/assistant/comp-helper.ts) can call SteadyAPI's per-point
// endpoints and enforce the Lee/Collier-only gate. This is a THIN wrapper over the
// existing Mapbox/Census geocoder (refinery/lib/geocode.mts) — we do NOT re-integrate
// Mapbox (RULE 0.5: reuse what exists). That module already forward-geocodes in
// Mapbox's default TEMPORARY mode (no `permanent=true`, nothing persisted) with the
// URL-restricted MAPBOX_TOKEN + Referer, and falls back to Census.
//
// This wrapper adds ONE thing: county derivation from the resolved ZIP via
// resolveZip, so the caller can gate on Lee (12071) / Collier (12021). An
// out-of-footprint hit still returns its point with a null county — so the caller
// can tell "couldn't pin the address" apart from "pinned, but outside Lee/Collier"
// and ask the right lane-4 question.
//
// Empty-tolerant: null on empty input, a geocoder miss, or any thrown error.
import { geocodeAddress as geocodePoint, type GeocodeResult } from "@/refinery/lib/geocode.mts";
import { resolveZip, type CountyFips } from "@/refinery/lib/zip-resolver.mts";

/** The geocoder dependency — injectable so tests never touch Mapbox/Census. */
export type GeocodeFn = (q: string) => Promise<GeocodeResult | null>;

export interface GeocodedAddress {
  lat: number;
  lon: number;
  /** The place/label the geocoder matched (context only — never surfaced as a fact). */
  matchedAddress: string;
  /** Resolved 5-digit ZIP, or null when the geocoder didn't return one. */
  zip: string | null;
  /** County name ("Lee" | "Collier" | …), or null when out of the SWFL footprint. */
  county: string | null;
  /** County FIPS for the scope gate ("12071" Lee / "12021" Collier), or null. */
  countyFips: CountyFips | null;
}

/**
 * Forward-geocode a free-text address and enrich it with its SWFL county. Returns
 * null on empty input, a geocoder miss, or any error (never throws). An out-of-scope
 * hit returns the point with `county`/`countyFips` = null (the caller decides).
 */
export async function geocodeAddress(
  text: string,
  deps: { geocode?: GeocodeFn } = {},
): Promise<GeocodedAddress | null> {
  const query = String(text ?? "").trim();
  if (!query) return null;
  const geocode = deps.geocode ?? geocodePoint;

  let hit: GeocodeResult | null;
  try {
    hit = await geocode(query);
  } catch {
    return null;
  }
  if (!hit) return null;

  const zip = hit.zip ?? null;
  const resolution = zip ? resolveZip(zip) : null;
  const countyFips = resolution?.in_scope ? resolution.primary_county : null;
  const county = resolution?.in_scope ? (resolution.county_names[0] ?? null) : null;

  return {
    lat: hit.lat,
    lon: hit.lon,
    matchedAddress: hit.place ?? query,
    zip,
    county,
    countyFips,
  };
}
