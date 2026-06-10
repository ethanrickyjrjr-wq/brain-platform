/**
 * geocode — §E of Universal Location Search.
 *
 * Turn a free-text street address (or a long-tail place name the gazetteer
 * doesn't carry) into lat/lon + ZIP so the §B dispatcher can fan it out at
 * ZIP + corridor grain. HONEST BOUNDARY: this resolves a point to its ZIP, NOT
 * the value of the exact parcel (that's §G; we don't hold the join today).
 *
 * Plan:    docs/superpowers/plans/2026-06-09-universal-location-search/05-geocoding.md
 * G4 note: docs/superpowers/plans/2026-06-09-universal-location-search/05-geocoding-G4-evidence.md
 *          (real live JSON field paths, recorded BEFORE this file was written).
 *
 * DEVIATION from the plan's "New: lib/geocode.ts": this lives at
 * refinery/lib/geocode.mts, co-located with its sole consumer
 * (location-resolver.mts), which imports relative `.mts` siblings only. Keeps the
 * refinery nodenext typecheck clean; app code can still import it via
 * `@/refinery/lib/geocode.mts` exactly as it imports the resolver itself.
 *
 * Provider order (plan §G4): Mapbox v6 primary, Census single-line the ONLY
 * approved fallback. No third vendor.
 *
 * TOKEN RESTRICTION (verified in-session, see G4 note §0): MAPBOX_TOKEN is a
 * public token URL-restricted to https://www.swfldatagulf.com/. A server-side
 * fetch sends no Referer, so every Mapbox call MUST set it or Mapbox 403s. We
 * send it explicitly below — the restriction stays (token unusable elsewhere).
 */

const MAPBOX_FORWARD = "https://api.mapbox.com/search/geocode/v6/forward";
const MAPBOX_REVERSE = "https://api.mapbox.com/search/geocode/v6/reverse";
const CENSUS_ONELINE = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

/** The allowed-URL the token is locked to; sent as Referer on every Mapbox call. */
const MAPBOX_REFERER = "https://www.swfldatagulf.com/";

export interface GeocodeResult {
  lat: number;
  lon: number;
  zip: string | null;
  place: string | null;
  region: string | null;
  confidence: number;
  provider: "mapbox" | "census";
}

/** Mapbox v6 match_code.confidence enum → a 0..1 score. */
const MAPBOX_CONFIDENCE: Record<string, number> = {
  exact: 1,
  high: 0.9,
  medium: 0.6,
  low: 0.3,
};

/**
 * Resolve a free-text location to lat/lon + ZIP. Mapbox primary; Census fallback
 * when Mapbox is unavailable, forbidden, or finds nothing. Returns null only when
 * BOTH providers miss (or the query is empty). Never throws on a network/parse
 * error — a bad upstream degrades to the fallback, then to null.
 */
export async function geocodeAddress(q: string): Promise<GeocodeResult | null> {
  const query = String(q ?? "").trim();
  if (!query) return null;

  const viaMapbox = await geocodeMapbox(query);
  if (viaMapbox) return viaMapbox;

  return geocodeCensus(query);
}

// ---- Mapbox primary ----------------------------------------------------------

async function geocodeMapbox(query: string): Promise<GeocodeResult | null> {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return null; // no key → let the caller fall through to Census

  const data = await mapboxFetch(
    `${MAPBOX_FORWARD}?q=${encodeURIComponent(query)}&country=us&limit=1&access_token=${token}`,
  );
  const props = firstFeatureProps(data);
  if (!props) return null;

  const lat = numOrNull(props.coordinates?.latitude);
  const lon = numOrNull(props.coordinates?.longitude);
  if (lat === null || lon === null) return null;

  const ctx = props.context ?? {};
  const place = strOrNull(ctx.place?.name);
  const region = strOrNull(ctx.region?.region_code) ?? strOrNull(ctx.region?.name);

  const confKey = props.match_code?.confidence;
  const confidence =
    confKey && confKey in MAPBOX_CONFIDENCE
      ? MAPBOX_CONFIDENCE[confKey]
      : props.match_code
        ? 0.5 // a match with an unknown confidence label
        : 0.6; // no match_code at all (locality/place-level hit)

  // address-level hits carry context.postcode; locality/place hits don't, so we
  // reverse-geocode the resolved point for its postcode (G4 note §2).
  let zip = strOrNull(ctx.postcode?.name);
  if (!zip) zip = await reversePostcode(lat, lon, token);

  return { lat, lon, zip, place, region, confidence, provider: "mapbox" };
}

/** Reverse-geocode a point to its postcode (the locality fall-through). */
async function reversePostcode(lat: number, lon: number, token: string): Promise<string | null> {
  const data = await mapboxFetch(
    `${MAPBOX_REVERSE}?longitude=${lon}&latitude=${lat}&types=postcode&access_token=${token}`,
  );
  const props = firstFeatureProps(data);
  if (!props) return null;
  // a types=postcode feature names the ZIP directly; context.postcode is the backup
  return strOrNull(props.name) ?? strOrNull(props.context?.postcode?.name);
}

/** GET a Mapbox endpoint with the required Referer; null on any error/non-2xx. */
async function mapboxFetch(url: string): Promise<MapboxResponse | null> {
  try {
    const res = await fetch(url, { headers: { Referer: MAPBOX_REFERER } });
    if (!res.ok) return null;
    return (await res.json()) as MapboxResponse;
  } catch {
    return null;
  }
}

// ---- Census fallback ---------------------------------------------------------

async function geocodeCensus(query: string): Promise<GeocodeResult | null> {
  let data: CensusResponse | null;
  try {
    const res = await fetch(
      `${CENSUS_ONELINE}?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&format=json`,
    );
    if (!res.ok) return null;
    data = (await res.json()) as CensusResponse;
  } catch {
    return null;
  }

  const match = data?.result?.addressMatches?.[0];
  if (!match) return null;

  const lon = numOrNull(match.coordinates?.x); // Census: x = longitude
  const lat = numOrNull(match.coordinates?.y); // Census: y = latitude
  if (lat === null || lon === null) return null;

  const ac = match.addressComponents ?? {};
  return {
    lat,
    lon,
    zip: strOrNull(ac.zip),
    place: strOrNull(ac.city),
    region: strOrNull(ac.state),
    confidence: 0.5, // Census has no confidence field; fixed fallback weight
    provider: "census",
  };
}

// ---- helpers + minimal response typings --------------------------------------

interface MapboxContext {
  postcode?: { name?: string };
  place?: { name?: string };
  region?: { region_code?: string; name?: string };
  district?: { name?: string };
}
interface MapboxFeatureProps {
  feature_type?: string;
  name?: string;
  coordinates?: { latitude?: number; longitude?: number };
  match_code?: { confidence?: string };
  context?: MapboxContext;
}
interface MapboxResponse {
  features?: { properties?: MapboxFeatureProps }[];
}
interface CensusResponse {
  result?: {
    addressMatches?: {
      coordinates?: { x?: number; y?: number };
      addressComponents?: { zip?: string; city?: string; state?: string };
    }[];
  };
}

function firstFeatureProps(data: MapboxResponse | null): MapboxFeatureProps | null {
  return data?.features?.[0]?.properties ?? null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
