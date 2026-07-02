// lib/listings/select.ts
//
// Turns raw RentCast listings into the inputs the email + social labs already speak:
// cited `MarketFigure`s (reusing the email lab's figure shape + renderer) and a
// code-set hero aerial. The four-lane moat is unchanged — listings are real cited
// numbers (user-facing source = "SWFL Data Gulf", as-of = lastSeenDate; vendor names and
// the MLS number are internal provenance, never surfaced in a citation); the AI quotes them and
// never invents. Pure helpers are unit-tested; `loadListingContext` is the one impure
// orchestrator (the single RentCast call), live-verified.

import type { MarketFigure } from "@/lib/email/market-context";
import { figuresToPromptBlock } from "@/lib/email/market-context";
import { heroPhotoBlock, upsertHeroPhoto } from "@/lib/email/inject-photo";
import type { EmailDoc } from "@/lib/email/doc/types";
import type { BuildScope } from "@/lib/email/build-doc";
import { aerialUrl } from "./aerial";
import { type Listing } from "./rentcast";
// KNOWN-DEBT(data_lake: listing_state lives in the data_lake schema, which the typed
// Supabase client intentionally does not cover — see utils/supabase/service-role.ts):
import { createServiceRoleClientUntyped } from "@/utils/supabase/service-role";
import zipCounty from "@/fixtures/swfl-zip-county.json";

// ── Scope → the one city we query (RentCast has no county/ZIP filter) ─────────
// county → its anchor city; zip → its county (Census-verified fixture) → anchor city;
// no/unknown scope → the SWFL default. A zip scope broadens to the county anchor (v1):
// every listing is still labeled by its TRUE address/city, so citations stay truthful.
const COUNTY_ANCHOR_CITY: Record<string, string> = {
  Lee: "Cape Coral",
  Collier: "Naples",
  Charlotte: "Port Charlotte",
  Sarasota: "Sarasota",
  Glades: "Moore Haven",
  Hendry: "Clewiston",
};
const DEFAULT_CITY = "Cape Coral";

const ZIP_COUNTY: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  const entries =
    (zipCounty as { entries?: { zip?: string; county_names?: string[] }[] }).entries ?? [];
  for (const e of entries) {
    if (e.zip && e.county_names?.[0]) m[e.zip] = e.county_names[0];
  }
  return m;
})();

export function scopeCity(scope?: BuildScope): string {
  if (!scope?.value) return DEFAULT_CITY;
  if (scope.kind === "county") {
    const county = scope.value.replace(/\s*County$/i, "").trim();
    return COUNTY_ANCHOR_CITY[county] ?? DEFAULT_CITY;
  }
  if (scope.kind === "zip") {
    const county = ZIP_COUNTY[scope.value.trim()];
    return county ? (COUNTY_ANCHOR_CITY[county] ?? DEFAULT_CITY) : DEFAULT_CITY;
  }
  return DEFAULT_CITY;
}

// ── Ranking / selection ──────────────────────────────────────────────────────
const RESIDENTIAL = new Set([
  "Single Family",
  "Condo",
  "Townhouse",
  "Multi-Family",
  "Apartment",
  "Manufactured",
]);

/** Best-first: priced listings, preferring those with coordinates (aerial-able) and a
 *  residential type, then newest-listed. Deterministic (stable tiebreak on id). */
export function rankListings(listings: Listing[]): Listing[] {
  const score = (l: Listing): number =>
    (l.latitude != null && l.longitude != null ? 2 : 0) + (RESIDENTIAL.has(l.propertyType) ? 1 : 0);
  return listings
    .filter((l) => l.price != null && l.price > 0)
    .slice()
    .sort((a, b) => {
      const s = score(b) - score(a);
      if (s !== 0) return s;
      const da = a.listedDate ? Date.parse(a.listedDate) : 0;
      const db = b.listedDate ? Date.parse(b.listedDate) : 0;
      if (db !== da) return db - da;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/** The single listing to feature (highest-ranked one that has coordinates), or null. */
export function pickFeatured(listings: Listing[]): Listing | null {
  return rankListings(listings).find((l) => l.latitude != null && l.longitude != null) ?? null;
}

// ── Listings → cited figures (the email lab's MarketFigure shape) ─────────────
const usd = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;
const pad = (n: number): string => String(n).padStart(2, "0");
const mdY = (iso?: string | null): string | undefined => {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
};
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** One concrete listing → a cited figure (verbatim-quotable). */
export function listingToFigure(l: Listing): MarketFigure {
  const bb = [
    l.bedrooms != null ? `${l.bedrooms}BR` : "",
    l.bathrooms != null ? `${l.bathrooms}BA` : "",
  ]
    .filter(Boolean)
    .join("/");
  const desc = [bb, l.propertyType].filter(Boolean).join(" ") || "Listing";
  const where = [l.addressLine1, l.city, l.zipCode].filter(Boolean).join(", ");
  const dom = l.daysOnMarket != null ? `, ${l.daysOnMarket} days on market` : "";
  return {
    key: `rc_${l.id}`,
    label: `For sale — ${desc}, ${where}`,
    value: (l.price != null ? usd(l.price) : "list price n/a") + dom,
    // User-facing citation is our platform — never a data-vendor name, never the MLS
    // number (both are internal provenance, not for the reader). Cite "SWFL Data Gulf".
    source: "SWFL Data Gulf",
    as_of: mdY(l.lastSeenDate),
  };
}

/** A scope's listings → one aggregate figure + up to 4 concrete ones. */
export function listingsToFigures(listings: Listing[], asOf: Date, city: string): MarketFigure[] {
  if (!listings.length) return [];
  const ranked = rankListings(listings);
  const prices = ranked.map((l) => l.price).filter((p): p is number => p != null && p > 0);
  const doms = ranked.map((l) => l.daysOnMarket).filter((d): d is number => d != null && d >= 0);
  const medList = median(prices);
  const medDom = median(doms);
  const asOfStr = `${pad(asOf.getUTCMonth() + 1)}/${pad(asOf.getUTCDate())}/${asOf.getUTCFullYear()}`;

  const aggregate: MarketFigure = {
    key: "rc_active",
    label: `Active for-sale listings — ${city}`,
    value:
      `${ranked.length}` +
      (medList != null ? `, median list ${usd(medList)}` : "") +
      (medDom != null ? `, median ${Math.round(medDom)} days on market` : ""),
    source: "SWFL Data Gulf",
    as_of: asOfStr,
  };
  return [aggregate, ...ranked.slice(0, 4).map(listingToFigure)];
}

/** The "CURRENT FOR-SALE LISTINGS" context block appended to the lab's lakeContext. */
export function renderListingsBlock(figures: MarketFigure[]): string {
  if (!figures.length) return "";
  return `CURRENT FOR-SALE LISTINGS (cite verbatim — value · source · as-of):\n${figuresToPromptBlock(figures)}`;
}

/** A one-line prompt addendum letting a post feature a SPECIFIC home (still cited). */
export function featuredContextLine(l: Listing): string {
  const f = listingToFigure(l);
  return `FEATURED LISTING (you MAY write this post about this specific home; cite its facts verbatim, never invent): ${f.label} — ${f.value} (${f.source}${f.as_of ? `, ${f.as_of}` : ""}).`;
}

/** Pure: attach the best available photo to the top of the card.
 *  Prefers a real MLS listing photo (photoUrl) over the satellite aerial fallback.
 *  No usable photo and no coords → card unchanged. */
export function attachFeaturedAerial(card: EmailDoc, listing: Listing): EmailDoc {
  const where = [listing.addressLine1, listing.city].filter(Boolean).join(", ") || "this property";
  if (listing.photoUrl) {
    return upsertHeroPhoto(
      card,
      heroPhotoBlock({
        url: listing.photoUrl,
        alt: `Listing photo of ${where}`,
        caption: `${where}`,
      }),
    );
  }
  if (listing.latitude == null || listing.longitude == null) return card;
  const url = aerialUrl({ lat: listing.latitude, lon: listing.longitude });
  if (!url) return card;
  return upsertHeroPhoto(
    card,
    heroPhotoBlock({
      url,
      alt: `Aerial satellite view of ${where}`,
      caption: `Aerial view · ${where}`,
    }),
  );
}

// ── The one impure orchestrator (a lake read, graceful) ───────────────────────
export interface ListingContext {
  /** Aggregate + concrete cited figures for the scope (possibly empty). */
  figures: MarketFigure[];
  /** Rank-ordered listings (for rotating a featured one across posts). */
  ranked: Listing[];
  /** The city actually queried. */
  city: string;
}

interface LakeListingRow {
  listing_id: string | null;
  street_address: string | null;
  city: string | null;
  county: string | null;
  zip_code: string | null;
  lat: number | null;
  lon: number | null;
  property_type: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lot_acres: number | null;
  status: string | null;
  list_price: number | null;
  listed_date: string | null;
  last_seen: string | null;
  days_on_market: number | null;
  mls_name: string | null;
  mls_number: string | null;
  photo_url: string | null;
}

/** Pure: coerce one data_lake.listing_state row into the shared `Listing` shape.
 *  `yearBuilt`/`removedDate` have no lake column — left null rather than invented. */
export function lakeRowToListing(row: LakeListingRow): Listing | null {
  if (!row.listing_id || !row.street_address) return null;
  return {
    id: row.listing_id,
    formattedAddress: row.street_address,
    addressLine1: row.street_address,
    city: row.city ?? "",
    state: "FL",
    zipCode: row.zip_code ?? "",
    county: row.county ?? "",
    latitude: row.lat,
    longitude: row.lon,
    propertyType: row.property_type ?? "",
    bedrooms: row.beds,
    bathrooms: row.baths,
    squareFootage: row.sqft,
    lotSize: row.lot_acres,
    yearBuilt: null,
    status: row.status ?? "Active",
    price: row.list_price,
    listedDate: row.listed_date,
    removedDate: null,
    lastSeenDate: row.last_seen,
    daysOnMarket: row.days_on_market,
    mlsName: row.mls_name,
    mlsNumber: row.mls_number,
    ...(row.photo_url ? { photoUrl: row.photo_url } : {}),
  };
}

const LAKE_LISTING_COLUMNS =
  "listing_id, street_address, city, county, zip_code, lat, lon, property_type, beds, baths, " +
  "sqft, lot_acres, status, list_price, listed_date, last_seen, days_on_market, mls_name, " +
  "mls_number, photo_url";

/** Fetch active for-sale listings for one city straight from the lake (populated daily by
 *  ingest/pipelines/listing_lifecycle — no live vendor call, no per-request cost). Empty-tolerant:
 *  no creds, no rows, any query error → `[]`, never throws (four-lane/ODD contract). */
async function fetchLakeListings(city: string): Promise<Listing[]> {
  if (!city) return [];
  try {
    const db = createServiceRoleClientUntyped();
    const { data } = await db
      .schema("data_lake")
      .from("listing_state")
      .select(LAKE_LISTING_COLUMNS)
      .eq("city", city)
      .eq("state", "active")
      .eq("sale_or_rent", "sale")
      .eq("source_name", "api_feed")
      .limit(500);
    if (!Array.isArray(data)) return [];
    return (data as unknown as LakeListingRow[])
      .map(lakeRowToListing)
      .filter((l): l is Listing => l !== null);
  } catch {
    return [];
  }
}

export async function loadListingContext(
  scope: BuildScope | undefined,
  today: Date,
): Promise<ListingContext> {
  const city = scopeCity(scope);
  const listings = await fetchLakeListings(city);
  return {
    figures: listingsToFigures(listings, today, city),
    ranked: rankListings(listings),
    city,
  };
}
