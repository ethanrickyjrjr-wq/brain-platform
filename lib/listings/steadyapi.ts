// lib/listings/steadyapi.ts
//
// SteadyAPI real-estate search client — returns for-sale listings WITH photo URLs
// (realtor.com CDN, rdcpix.com). Used to enrich the email + social lab with real
// listing photos.
//
// VERIFIED LIVE 2026-06-30 (RULE 0.4): GET /v1/real-estate/search returns photo_url
// per listing, 6 259 Cape Coral results confirmed. Auth: Bearer token. Location format:
// "City-Name_FL". Cloudflare requires browser-like headers — plain fetch() from Next.js
// server works; urllib default UA is blocked.
//
// Empty-tolerant (four-lane / ODD): no key, non-200, quota, or bad body → [], never throws.
// Hour-cached to be frugal on the 10 000 req/month Starter tier.

import type { Listing } from "./rentcast";

const BASE = "https://api.steadyapi.com/v1/real-estate";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
  Origin: "https://steadyapi.com",
  Referer: "https://steadyapi.com/",
};

// "Cape Coral" → "Cape-Coral_FL", "Fort Myers" → "Fort-Myers_FL"
function cityToSlug(city: string, state = "FL"): string {
  return `${city.trim().replace(/\s+/g, "-")}_${state}`;
}

interface RawResult {
  property_id?: unknown;
  price?: { amount?: unknown; display?: unknown };
  status?: unknown;
  permalink?: unknown;
  photo_url?: unknown;
  source_type?: unknown;
  description?: {
    beds?: unknown;
    sqft?: unknown;
    lot_sqft?: unknown;
  };
  location?: {
    lat?: unknown;
    lon?: unknown;
    county_fips?: unknown;
  };
  flags?: {
    is_new_listing?: unknown;
    is_price_reduced?: unknown;
    is_new_construction?: unknown;
  };
}

function normalizeResult(raw: RawResult, city: string, state: string): Listing | null {
  const id = typeof raw.property_id === "string" ? raw.property_id : String(raw.property_id ?? "");
  if (!id) return null;
  const price =
    typeof raw.price?.amount === "number"
      ? raw.price.amount
      : typeof raw.price?.amount === "string"
        ? Number(raw.price.amount)
        : null;
  const lat =
    typeof raw.location?.lat === "number"
      ? raw.location.lat
      : typeof raw.location?.lat === "string"
        ? Number(raw.location.lat)
        : null;
  const lon =
    typeof raw.location?.lon === "number"
      ? raw.location.lon
      : typeof raw.location?.lon === "string"
        ? Number(raw.location.lon)
        : null;
  const photoUrl = typeof raw.photo_url === "string" && raw.photo_url ? raw.photo_url : undefined;
  const permalink = typeof raw.permalink === "string" ? raw.permalink : "";
  // last path segment: "1403-NE-19th-Ter_Cape-Coral_FL_33909_M54931-01642"
  const lastSegment = permalink.split("/").pop() ?? "";
  const slugParts = lastSegment.split("_");
  const addressLine1 = (slugParts[0] ?? "").replace(/-/g, " ");
  const zipCode = slugParts.find((p) => /^\d{5}$/.test(p)) ?? "";
  const beds =
    typeof raw.description?.beds === "number"
      ? raw.description.beds
      : typeof raw.description?.beds === "string"
        ? Number(raw.description.beds)
        : null;
  const sqft =
    typeof raw.description?.sqft === "number"
      ? raw.description.sqft
      : typeof raw.description?.sqft === "string"
        ? Number(raw.description.sqft)
        : null;
  return {
    id: `sa_${id}`,
    formattedAddress: [addressLine1, city, state, zipCode].filter(Boolean).join(", "),
    addressLine1,
    city,
    state,
    zipCode,
    county: "",
    latitude: lat != null && Number.isFinite(lat) ? lat : null,
    longitude: lon != null && Number.isFinite(lon) ? lon : null,
    propertyType: "Single Family",
    bedrooms: beds != null && Number.isFinite(beds) ? beds : null,
    bathrooms: null,
    squareFootage: sqft != null && Number.isFinite(sqft) ? sqft : null,
    lotSize: null,
    yearBuilt: null,
    status: typeof raw.status === "string" ? raw.status : "for_sale",
    price: price != null && Number.isFinite(price) ? price : null,
    listedDate: null,
    removedDate: null,
    lastSeenDate: new Date().toISOString().slice(0, 10),
    daysOnMarket: null,
    mlsName: typeof raw.source_type === "string" ? raw.source_type : null,
    mlsNumber: null,
    photoUrl,
  };
}

/**
 * Fetch for-sale listings with photos for one city via SteadyAPI.
 * Never throws — any failure returns [].
 * Results are hour-cached (Next.js fetch cache).
 */
export async function fetchPhotoListings(opts: {
  city: string;
  state?: string;
  limit?: number;
}): Promise<Listing[]> {
  const key = process.env.PHOTOS_API;
  if (!key || !opts.city) return [];
  const state = opts.state ?? "FL";
  const slug = cityToSlug(opts.city, state);
  const params = new URLSearchParams({ location: slug, offset: "0" });
  try {
    const res = await fetch(`${BASE}/search?${params}`, {
      headers: {
        ...BROWSER_HEADERS,
        Authorization: `Bearer ${key}`,
      },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return [];
    const body = (data as Record<string, unknown>).body;
    if (!Array.isArray(body)) return [];
    const limit = opts.limit ?? 200;
    return body
      .slice(0, limit)
      .map((r) => normalizeResult(r as RawResult, opts.city, state))
      .filter((l): l is Listing => l !== null && l.photoUrl !== undefined);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// On-demand comp helper (SteadyAPI Sole-Spine Phase 2B) — two per-point endpoints
// that feed lib/assistant/comp-helper.ts. Verbatim vendor contracts recorded in
// docs/superpowers/specs/2026-06-30-steadyapi-comp-helper-design.md (crawl4ai on
// docs.steadyapi.com, 06/30/2026). Same auth/headers/hour-cache/never-throws shape
// as the /search client above; PHOTOS_API is a Vercel env var (not a repo secret),
// so every path is empty-tolerant and no live call fires without the key.
// ---------------------------------------------------------------------------

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Raw `/nearby-home-values` property (only the fields we read are typed). The
 *  id/url fields ARE listed here so the normalizer can deliberately DROP them. */
export interface RawNearbyProperty {
  property_id?: unknown;
  listing_id?: unknown;
  status?: unknown;
  list_price?: unknown;
  href?: unknown;
  permalink?: unknown;
  address?: { line?: unknown; city?: unknown; state_code?: unknown; postal_code?: unknown };
  description?: { beds?: unknown; baths?: unknown; sqft?: unknown; lot_sqft?: unknown };
  estimates?: { best?: { value?: unknown; date?: unknown } };
  source?: { id?: unknown };
}

/** A nearby comparable, MLS-SCRUBBED at this boundary: `listing_id`, `href`,
 *  `permalink`, and `source.id` are dropped and never placed on this object. The
 *  realtor.com `property_id` survives ONLY as the internal `propertyId` handle for
 *  the +1 sold-event lookup — the render layer never emits it. */
export interface NearbyComp {
  addressLine: string;
  city: string;
  state: string;
  zip: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lotSqft: number | null;
  status: string;
  /** Last LIST price (not a sale). */
  listPrice: number | null;
  /** realtor.com AVM estimate + its date (not a sale). */
  estimateValue: number | null;
  estimateDate: string | null;
  /** Internal realtor.com join key for the +1 sold-event lookup — NEVER surfaced. */
  propertyId: string | null;
}

/** Normalize one raw property into a scrubbed NearbyComp. Null when there is no
 *  usable street address. Pure — unit-tested against the doc-JSON fixture. */
export function normalizeNearbyComp(raw: RawNearbyProperty): NearbyComp | null {
  const addr = raw.address ?? {};
  const addressLine = typeof addr.line === "string" ? addr.line : "";
  if (!addressLine) return null;
  const desc = raw.description ?? {};
  const best = raw.estimates?.best;
  const propertyId =
    typeof raw.property_id === "string"
      ? raw.property_id
      : raw.property_id != null
        ? String(raw.property_id)
        : null;
  return {
    addressLine,
    city: typeof addr.city === "string" ? addr.city : "",
    state: typeof addr.state_code === "string" ? addr.state_code : "",
    zip: typeof addr.postal_code === "string" ? addr.postal_code : "",
    beds: toNum(desc.beds),
    baths: toNum(desc.baths), // arrives as a string like "2.5"
    sqft: toNum(desc.sqft),
    lotSqft: toNum(desc.lot_sqft),
    status: typeof raw.status === "string" ? raw.status : "",
    listPrice: toNum(raw.list_price),
    estimateValue: best ? toNum(best.value) : null,
    estimateDate: best && typeof best.date === "string" ? best.date : null,
    propertyId,
  };
}

/**
 * One `/nearby-home-values` call — the comp source (up to ~25 nearby properties with
 * beds/baths/sqft + AVM + last list price + status). Empty-tolerant: no key, bad
 * coords, non-200, or bad body → `[]`, never throws. `fetchImpl` is injectable for
 * offline tests (default: the Next.js-cached global fetch).
 *
 * NOTE: the contract carries no distance field and no per-property lat/lon, so this
 * never surfaces a "0.X mi" figure. "Nearest" = the API's returned order.
 */
export async function fetchNearbyValues(
  opts: { lat: number; lon: number; radius?: string | number; status?: string; limit?: number },
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<NearbyComp[]> {
  const key = process.env.PHOTOS_API;
  if (!key || !Number.isFinite(opts.lat) || !Number.isFinite(opts.lon)) return [];
  const doFetch = deps.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    lat: String(opts.lat),
    lon: String(opts.lon),
    limit: String(opts.limit ?? 25),
  });
  if (opts.radius != null) params.set("radius", String(opts.radius));
  if (opts.status) params.set("status", opts.status);
  try {
    const res = await doFetch(`${BASE}/nearby-home-values?${params}`, {
      headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${key}` },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const props = (data as { body?: { properties?: unknown } })?.body?.properties;
    if (!Array.isArray(props)) return [];
    return props
      .map((p) => normalizeNearbyComp(p as RawNearbyProperty))
      .filter((c): c is NearbyComp => c !== null);
  } catch {
    return [];
  }
}

/** The exact recorded sale for one property (from `/property-tax-history`). */
export interface SoldEvent {
  soldPrice: number;
  soldDate: string;
}

/** Read the most-recent `event_name == "Sold"` row out of a tax-history body.
 *  ISO dates sort lexically, so `date > best.soldDate` keeps the latest. Pure. */
export function parseSoldEvent(body: unknown): SoldEvent | null {
  const history = (body as { body?: { property_history?: unknown } })?.body?.property_history;
  if (!Array.isArray(history)) return null;
  let best: SoldEvent | null = null;
  for (const row of history) {
    const r = row as { date?: unknown; event_name?: unknown; price?: unknown };
    if (r.event_name !== "Sold") continue;
    const price = toNum(r.price);
    const date = typeof r.date === "string" ? r.date : null;
    if (price == null || !date) continue;
    if (!best || date > best.soldDate) best = { soldPrice: price, soldDate: date };
  }
  return best;
}

/**
 * One `/property-tax-history` call — the exact sold price+date for a chosen comp.
 * `propertyId` is an argument only; it never appears in the return. Empty-tolerant:
 * no key, non-200, no Sold event, or bad body → null, never throws.
 */
export async function fetchSoldEvent(
  propertyId: string,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<SoldEvent | null> {
  const key = process.env.PHOTOS_API;
  if (!key || !propertyId) return null;
  const doFetch = deps.fetchImpl ?? fetch;
  const params = new URLSearchParams({ propertyId });
  try {
    const res = await doFetch(`${BASE}/property-tax-history?${params}`, {
      headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${key}` },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return parseSoldEvent(await res.json());
  } catch {
    return null;
  }
}
