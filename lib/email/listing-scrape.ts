// lib/email/listing-scrape.ts
//
// Read a pasted real-estate listing page for its REAL facts — the data the old
// Email Lab threw away (it grabbed only the og:image thumbnail). Deterministic
// core: numbers come from code, never an LLM, never invented (Brain Factory
// rule 2 + the no-invention moat). `parseListingFacts` is PURE over HTML so it
// is unit-tested against a saved fixture of a real page; `fetchListingFacts` is
// the thin, best-effort network wrapper (reuses og-image.ts's guards).
//
// Two extraction strategies, most-structured first:
//   1. The embedded `{"id":"…","label":"…","value":…}` spec island that IDX
//      sites hydrate from — stable machine ids (price/bedrooms/totalBaths/sqft/
//      acreage/year_built/category). This is the reliable path.
//   2. Visible text fallback for fields the island leaves null (street/zip).
// A field that appears nowhere is left undefined — we never guess a number.

import { getAnthropic } from "@/refinery/agents/anthropic.mts";
import { fetchOgImage } from "./og-image";
import { safeFetchPublicUrl } from "./safe-fetch";
import { resolveEmailModel } from "./model-router";

export interface ListingFacts {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  price?: string; // verbatim, e.g. "$20,895,000"
  beds?: string;
  baths?: string;
  sqft?: string;
  lotSize?: string;
  yearBuilt?: string;
  propertyType?: string;
  remarks?: string; // the marketing description, verbatim
  photos: string[]; // absolute listing photo URLs
  lat?: number; // from GeoCoordinates — used for comps chart
  lon?: number;
  sourceUrl: string; // the citation
}

/** Pull one scalar value from the spec island by its machine id. Returns the
 *  string/number value as a string, or undefined when absent or null. */
function pickById(html: string, id: string): string | undefined {
  const re = new RegExp(`"id":"${id}","label":"[^"]*","value":("[^"]*"|-?[\\d.]+|null)`);
  const m = html.match(re);
  if (!m) return undefined;
  const raw = m[1];
  if (raw === "null") return undefined;
  if (raw.startsWith('"')) {
    const inner = raw.slice(1, -1).trim();
    return inner || undefined;
  }
  return raw; // numeric string (e.g. "5", "0.692", "2021")
}

/** First capture of a JSON string field anywhere in the HTML, unescaped. */
function pickJsonString(html: string, key: string): string | undefined {
  const m = html.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return undefined;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1];
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** PURE: extract real listing facts from page HTML. Never throws, never invents —
 *  a missing field is undefined. `url` is echoed back as the citation. */
export function parseListingFacts(html: string, url: string): ListingFacts {
  const price = pickById(html, "price");
  const beds = pickById(html, "bedrooms");
  const baths = pickById(html, "totalBaths") ?? pickById(html, "fullBaths");
  const sqft = pickById(html, "sqft");
  const lotSize = pickById(html, "acreage");
  const yearBuilt = pickById(html, "year_built");
  const propertyType = pickById(html, "category") ?? pickById(html, "style");

  const city = pickJsonString(html, "city");
  const stateMatch = html.match(/"state":"([A-Za-z]{2})"/);
  const state = stateMatch ? stateMatch[1].toUpperCase() : undefined;

  // street/zip are often null in the island → recover from the visible address line.
  let zip: string | undefined;
  let address: string | undefined;
  if (city) {
    const cityEsc = escapeRe(city);
    const zipM = html.match(new RegExp(`${cityEsc}[,\\s]+(?:[A-Z]{2})\\s*(\\d{5})`, "i"));
    if (zipM) zip = zipM[1];
    const addrM = html.match(
      new RegExp(`(\\d{1,6}[^,<>"]{2,50},\\s*${cityEsc}[^\\d]{0,8}[A-Z]{2}\\s*\\d{5})`, "i"),
    );
    if (addrM) address = addrM[1].replace(/\s+/g, " ").trim();
  }

  const remarks = pickJsonString(html, "description");

  // Photos: real listing images only. `/listings/` excludes the brokerage logo
  // (which lives under /images/<id>/…/logo.webp). Normalize escaped slashes first.
  const norm = html.replace(/\\\//g, "/");
  const photos = [
    ...new Set(
      (norm.match(/https?:\/\/[^\s"'<>)]+?\.(?:jpe?g|png|webp)/gi) ?? [])
        .filter((u) => /\/listings\//i.test(u))
        .map((u) => u.replace(/&amp;/g, "&")),
    ),
  ].slice(0, 12);

  return {
    address,
    city,
    state,
    zip,
    price,
    beds,
    baths,
    sqft,
    lotSize,
    yearBuilt,
    propertyType,
    remarks: remarks && remarks.trim() ? remarks.trim() : undefined,
    photos,
    sourceUrl: url,
  };
}

// ── Tier 2: standard schema.org JSON-LD ──────────────────────────────────────
// Many IDX/brokerage sites (John R. Wood, Sotheby's, etc.) don't use the island —
// they embed schema.org JSON-LD (Product + SingleFamilyResidence + Offer). Field
// names verified IN-SESSION against schema.org (RULE 0.4): numberOfBedrooms /
// numberOfRooms(+unitText) / numberOfBathroomsTotal / floorSize / yearBuilt /
// PostalAddress{streetAddress,addressLocality,addressRegion,postalCode} / offers.
// price / description / image. Real pages are quirky (beds as numberOfRooms with
// unitText "Bedrooms", price as a bare number) — this reads the actual shapes.

type JsonObj = Record<string, unknown>;

/** Every object node across all <script type=ld+json> blocks (recursively). */
function collectJsonLdNodes(html: string): JsonObj[] {
  const nodes: JsonObj[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") {
        nodes.push(x as JsonObj);
        for (const v of Object.values(x as JsonObj)) walk(v);
      }
    };
    walk(parsed);
  }
  return nodes;
}

function toNum(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\d[\d,]*\.?\d*$/.test(v.trim()))
    return Number(v.replace(/,/g, ""));
  return undefined;
}

function formatPrice(v: unknown): string | undefined {
  if (typeof v === "string" && v.includes("$")) return v.trim();
  const n = toNum(v);
  return n === undefined ? undefined : "$" + Math.round(n).toLocaleString("en-US");
}

/** A QuantitativeValue { value, unitText } or a bare number → its value as string. */
function qvValue(v: unknown): string | undefined {
  if (v && typeof v === "object" && "value" in (v as JsonObj)) {
    const n = toNum((v as JsonObj).value);
    return n === undefined ? undefined : String(n);
  }
  const n = toNum(v);
  return n === undefined ? undefined : String(n);
}

/** "SingleFamilyResidence" → "Single Family Residence". */
function spaceType(t: unknown): string | undefined {
  if (typeof t !== "string") return undefined;
  return t.replace(/([a-z])([A-Z])/g, "$1 $2").trim() || undefined;
}

/** PURE: extract listing facts from schema.org JSON-LD. Empty fields when absent. */
export function parseJsonLdFacts(html: string, url: string): ListingFacts {
  const out: ListingFacts = { photos: [], sourceUrl: url };
  const pushImg = (img: unknown): void => {
    if (typeof img === "string") {
      out.photos.push(img);
      return;
    }
    if (img && typeof img === "object" && !Array.isArray(img)) {
      const obj = img as JsonObj;
      // ImageObject: prefer contentUrl, fall back to url
      const src =
        typeof obj.contentUrl === "string"
          ? obj.contentUrl
          : typeof obj.url === "string"
            ? obj.url
            : undefined;
      if (src) {
        out.photos.push(src);
        return;
      }
    }
    if (Array.isArray(img)) for (const i of img) pushImg(i);
  };

  for (const node of collectJsonLdNodes(html)) {
    const type = String(node["@type"] ?? "").toLowerCase();

    if (type.includes("postaladdress")) {
      const street = typeof node.streetAddress === "string" ? node.streetAddress : undefined;
      const loc = typeof node.addressLocality === "string" ? node.addressLocality : undefined;
      const region = typeof node.addressRegion === "string" ? node.addressRegion : undefined;
      const zip = typeof node.postalCode === "string" ? node.postalCode : undefined;
      out.city ??= loc;
      out.state ??= region;
      out.zip ??= zip;
      if (out.address === undefined && street) {
        out.address = [street, [loc, region].filter(Boolean).join(", "), zip]
          .filter(Boolean)
          .join(", ");
      }
    }

    // Offer (standalone or nested under a product) → price.
    if (out.price === undefined && type.includes("offer") && "price" in node) {
      out.price = formatPrice(node.price);
    }
    if (out.price === undefined && node.offers != null) {
      const offersArr = Array.isArray(node.offers) ? node.offers : [node.offers];
      for (const off of offersArr) {
        if (off && typeof off === "object" && "price" in (off as JsonObj)) {
          out.price = formatPrice((off as JsonObj).price);
          break;
        }
      }
    }

    const placeish = /residence|house|apartment|product|place|singlefamily/.test(type);
    if (placeish || "floorSize" in node || "numberOfRooms" in node || "numberOfBedrooms" in node) {
      if (out.beds === undefined) {
        if ("numberOfBedrooms" in node) out.beds = qvValue(node.numberOfBedrooms);
        else if ("numberOfRooms" in node) {
          const nr = node.numberOfRooms as JsonObj;
          const unit = String(nr?.unitText ?? "").toLowerCase();
          if (unit.includes("bed") || unit === "") out.beds = qvValue(nr);
        }
      }
      if (out.baths === undefined) {
        out.baths = qvValue(node.numberOfBathroomsTotal) ?? qvValue(node.numberOfFullBathrooms);
      }
      if (out.sqft === undefined && "floorSize" in node) out.sqft = qvValue(node.floorSize);
      if (out.yearBuilt === undefined) {
        const y = toNum(node.yearBuilt);
        if (y) out.yearBuilt = String(y);
      }
      if (out.propertyType === undefined && /residence|house|apartment|singlefamily/.test(type)) {
        out.propertyType = spaceType(node["@type"]);
      }
    }

    if (type.includes("geocoordinates") || ("latitude" in node && "longitude" in node)) {
      if (out.lat === undefined) {
        const lat = toNum(node.latitude);
        const lon = toNum(node.longitude);
        if (lat !== undefined && lon !== undefined) {
          out.lat = lat;
          out.lon = lon;
        }
      }
    }

    if (
      out.remarks === undefined &&
      typeof node.description === "string" &&
      node.description.trim().length > 80
    ) {
      out.remarks = node.description.trim();
    }
    if (out.photos.length === 0) pushImg(node.image);
  }

  out.photos = [...new Set(out.photos)].slice(0, 12);
  return out;
}

// ── Cascade merge + Tier 3 (text + LLM) ──────────────────────────────────────

/** Merge two fact sets: PRIMARY wins per field (deterministic tiers beat the LLM),
 *  SECONDARY fills gaps; photos are unioned (primary first). Primary's citation. */
export function mergeFacts(primary: ListingFacts, secondary: ListingFacts): ListingFacts {
  return {
    address: primary.address ?? secondary.address,
    city: primary.city ?? secondary.city,
    state: primary.state ?? secondary.state,
    zip: primary.zip ?? secondary.zip,
    price: primary.price ?? secondary.price,
    beds: primary.beds ?? secondary.beds,
    baths: primary.baths ?? secondary.baths,
    sqft: primary.sqft ?? secondary.sqft,
    lotSize: primary.lotSize ?? secondary.lotSize,
    yearBuilt: primary.yearBuilt ?? secondary.yearBuilt,
    propertyType: primary.propertyType ?? secondary.propertyType,
    remarks: primary.remarks ?? secondary.remarks,
    photos: [...new Set([...(primary.photos ?? []), ...(secondary.photos ?? [])])].slice(0, 12),
    lat: primary.lat ?? secondary.lat,
    lon: primary.lon ?? secondary.lon,
    sourceUrl: primary.sourceUrl,
  };
}

/** PURE: strip a page to visible text (drop scripts/styles/tags, collapse space). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/\s+/g, " ")
    .trim();
}

const LLM_STRING_FIELDS = [
  "address",
  "city",
  "state",
  "zip",
  "price",
  "beds",
  "baths",
  "sqft",
  "lotSize",
  "yearBuilt",
  "propertyType",
  "remarks",
] as const;

/** PURE: parse the model's JSON output into ListingFacts. Whitelist of known keys,
 *  coerce numbers to strings, ignore anything else. Never throws — empty on garbage. */
export function parseLlmFacts(text: string, url: string): ListingFacts {
  const out: ListingFacts = { photos: [], sourceUrl: url };
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return out;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return out;
  }
  if (!obj || typeof obj !== "object") return out;
  const sink = out as unknown as Record<string, unknown>;
  for (const k of LLM_STRING_FIELDS) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) sink[k] = v.trim();
    else if (typeof v === "number") sink[k] = String(v);
  }
  if (Array.isArray(obj.photos)) {
    out.photos = obj.photos.filter((p): p is string => typeof p === "string").slice(0, 12);
  }
  return out;
}

const LISTING_EXTRACT_SYSTEM = `You extract real-estate listing facts from page text. Return ONLY a JSON object containing any of these keys you can find ON THE PAGE: address, city, state, zip, price, beds, baths, sqft, lotSize, yearBuilt, propertyType, remarks. Use the page's EXACT numbers verbatim — never invent, estimate, or round. Omit any field the page does not state. "remarks" = the listing's marketing description, copied from the page. Output the JSON object only, no other text.`;

/** Tier 3: best-effort LLM extraction over the page text. Reads facts off the page;
 *  the strict prompt + the whitelist parser keep it to real, on-page values. NEVER
 *  throws — empty facts on any failure. */
export async function llmExtractFacts(html: string, url: string): Promise<ListingFacts> {
  try {
    const text = htmlToText(html).slice(0, 9000);
    const msg = await getAnthropic("other").messages.create({
      model: resolveEmailModel("interactive"),
      max_tokens: 800,
      system: LISTING_EXTRACT_SYSTEM,
      messages: [{ role: "user", content: text }],
    });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    return parseLlmFacts(raw, url);
  } catch {
    return { photos: [], sourceUrl: url };
  }
}

const FETCH_TIMEOUT_MS = 9000;
const MAX_HTML_BYTES = 2_000_000;

/** Best-effort: fetch a listing URL (through the SSRF-safe guard) and parse its facts.
 *  Falls back to the og:image hero when the page has no inline photos. NEVER throws —
 *  returns null on any guard-reject/block/failure so the build degrades, never crashes. */
export async function fetchListingFacts(url: string): Promise<ListingFacts | null> {
  try {
    const res = await safeFetchPublicUrl(url, { timeoutMs: FETCH_TIMEOUT_MS });
    if (!res || !res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text()).slice(0, MAX_HTML_BYTES);

    // CASCADE — deterministic tiers first (numbers from code, never invented):
    //   Tier 1 island → Tier 2 schema.org JSON-LD (merged, island wins on conflict).
    let facts = mergeFacts(parseListingFacts(html, url), parseJsonLdFacts(html, url));

    // Tier 3 (text + LLM) — ONLY when a core spec is still missing, so structured
    // pages cost nothing. The LLM reads the page text; it fills gaps and can never
    // override a deterministic value (mergeFacts: existing facts win).
    const coreMissing = !facts.price || !facts.beds || !facts.baths || !facts.sqft;
    if (coreMissing && process.env.ANTHROPIC_API_KEY) {
      const llm = await llmExtractFacts(html, url).catch(() => null);
      if (llm) facts = mergeFacts(facts, llm);
    }

    if (facts.photos.length === 0) {
      const og = await fetchOgImage(url).catch(() => null);
      if (og?.image) facts.photos.push(og.image);
    }
    // Usable only if we got at least one real fact — else the caller keeps the
    // newsletter path rather than building a flyer from nothing.
    const hasFact = Boolean(facts.price || facts.beds || facts.sqft || facts.remarks);
    return hasFact ? facts : null;
  } catch {
    return null;
  }
}
