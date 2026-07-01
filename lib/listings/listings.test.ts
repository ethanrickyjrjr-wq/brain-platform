import { test, expect, describe, afterEach } from "bun:test";
import { normalizeListing, type Listing } from "./rentcast";
import { aerialUrl } from "./aerial";
import {
  scopeCity,
  rankListings,
  pickFeatured,
  listingToFigure,
  listingsToFigures,
  renderListingsBlock,
  featuredContextLine,
  attachFeaturedAerial,
} from "./select";
import { DEFAULT_GLOBAL_STYLE, createBlock } from "@/lib/email/doc/default-docs";
import { EmailDocSchema } from "@/lib/email/doc/schema";
import type { EmailDoc } from "@/lib/email/doc/types";
import sample from "./__fixtures__/rentcast-sale-sample.json";

const LISTINGS: Listing[] = (sample as unknown[])
  .map(normalizeListing)
  .filter((l): l is Listing => l !== null);

// ── normalizeListing ─────────────────────────────────────────────────────────
test("normalizeListing parses real RentCast fields and drops agent/office PII", () => {
  const raw = {
    id: "x1",
    formattedAddress: "1 A St, Naples, FL 34102",
    addressLine1: "1 A St",
    city: "Naples",
    state: "FL",
    zipCode: "34102",
    county: "Collier",
    latitude: 26.1,
    longitude: -81.8,
    propertyType: "Single Family",
    bedrooms: 3,
    bathrooms: "2", // string coerces
    price: 500000,
    daysOnMarket: 10,
    lastSeenDate: "2026-06-29T00:00:00.000Z",
    mlsNumber: "M123",
    listingAgent: { name: "Jane", email: "jane@example.com", phone: "239" },
    listingOffice: { name: "Acme", email: "acme@example.com" },
  };
  const l = normalizeListing(raw);
  expect(l).not.toBeNull();
  expect(l!.bathrooms).toBe(2);
  expect(l!.mlsNumber).toBe("M123");
  // PII must not survive onto the Listing.
  expect(JSON.stringify(l)).not.toContain("example.com");
  expect(JSON.stringify(l)).not.toContain("Jane");
});

test("normalizeListing rejects rows with no id or no address", () => {
  expect(normalizeListing({ formattedAddress: "1 A St" })).toBeNull();
  expect(normalizeListing({ id: "x" })).toBeNull();
  expect(normalizeListing(null)).toBeNull();
  expect(normalizeListing("nope")).toBeNull();
});

test("the live sample fixture normalizes cleanly", () => {
  expect(LISTINGS.length).toBe(5);
  expect(LISTINGS.every((l) => l.id && (l.formattedAddress || l.addressLine1))).toBe(true);
});

// ── aerialUrl (Mapbox Static Images) ─────────────────────────────────────────
describe("aerialUrl", () => {
  const ORIG = process.env.MAPBOX_TOKEN;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.MAPBOX_TOKEN;
    else process.env.MAPBOX_TOKEN = ORIG;
  });

  test("builds a satellite URL with lon-first, a pin, and @2x", () => {
    process.env.MAPBOX_TOKEN = "pk.test_token";
    const url = aerialUrl({ lat: 26.695748, lon: -81.983045 });
    expect(url).toContain("/styles/v1/mapbox/satellite-streets-v12/static/");
    expect(url).toContain("pin-l+e11d48(-81.983045,26.695748)"); // lon,lat
    expect(url).toContain("/-81.983045,26.695748,16/"); // center lon,lat,zoom
    expect(url).toContain("600x360@2x");
    expect(url).toContain("access_token=pk.test_token");
  });

  test("returns null with no token or out-of-range coords", () => {
    delete process.env.MAPBOX_TOKEN;
    expect(aerialUrl({ lat: 26.6, lon: -81.9 })).toBeNull();
    process.env.MAPBOX_TOKEN = "pk.test_token";
    expect(aerialUrl({ lat: 999, lon: -81.9 })).toBeNull();
    expect(aerialUrl({ lat: NaN, lon: -81.9 })).toBeNull();
  });

  test("marker:false omits the pin overlay", () => {
    process.env.MAPBOX_TOKEN = "pk.test_token";
    const url = aerialUrl({ lat: 26.6, lon: -81.9, marker: false })!;
    expect(url).not.toContain("pin-l");
    expect(url).toContain("/static/-81.9,26.6,16/");
  });
});

// ── scopeCity ────────────────────────────────────────────────────────────────
test("scopeCity maps county and zip to the city we query", () => {
  expect(scopeCity({ kind: "county", value: "Collier" })).toBe("Naples");
  expect(scopeCity({ kind: "county", value: "Lee County" })).toBe("Cape Coral");
  expect(scopeCity({ kind: "zip", value: "34102" })).toBe("Naples"); // Collier zip → anchor
  expect(scopeCity(undefined)).toBe("Cape Coral");
  expect(scopeCity({ kind: "zip", value: "00000" })).toBe("Cape Coral"); // unknown → default
});

// ── ranking / selection ──────────────────────────────────────────────────────
test("rankListings prefers residential-with-coords; pickFeatured has coordinates", () => {
  const ranked = rankListings(LISTINGS);
  expect(ranked.slice(0, 3).every((l) => l.propertyType === "Single Family")).toBe(true);
  const featured = pickFeatured(LISTINGS)!;
  expect(featured.latitude).not.toBeNull();
  expect(featured.longitude).not.toBeNull();
  expect(featured.propertyType).toBe("Single Family");
});

test("rankListings drops unpriced / zero-price rows", () => {
  const ranked = rankListings([
    ...LISTINGS,
    { ...LISTINGS[0], id: "zero", price: 0 },
    { ...LISTINGS[0], id: "nullprice", price: null },
  ]);
  expect(ranked.some((l) => l.id === "zero" || l.id === "nullprice")).toBe(false);
});

// ── listings → cited figures ─────────────────────────────────────────────────
test("listingToFigure cites SWFL Data Gulf — never a vendor name or the MLS number", () => {
  const f = listingToFigure(LISTINGS[0]);
  expect(f.label).toContain("For sale");
  expect(f.label).toContain("414 Nw 23rd Ter");
  expect(f.value).toContain("$349,000");
  expect(f.value).toContain("125 days on market");
  expect(f.source).toBe("SWFL Data Gulf");
  // No vendor names, no MLS number ever leaks into the user-facing citation.
  expect(f.source).not.toMatch(/RentCast|SteadyAPI|MLS/i);
  expect(f.as_of).toBe("06/29/2026");
});

test("listingsToFigures returns one aggregate + up to 4 concrete, all sourced", () => {
  const figs = listingsToFigures(LISTINGS, new Date(Date.UTC(2026, 5, 30)), "Cape Coral");
  expect(figs.length).toBe(5);
  expect(figs[0].key).toBe("rc_active");
  expect(figs[0].label).toBe("Active for-sale listings — Cape Coral");
  expect(figs[0].value).toContain("5");
  expect(figs[0].value).toContain("median list $349,000");
  expect(figs[0].value).toContain("125 days on market");
  expect(figs[0].as_of).toBe("06/30/2026");
  // Four-lane: every figure names a real source — our platform, never a vendor or MLS number.
  expect(figs.every((f) => f.source === "SWFL Data Gulf")).toBe(true);
  expect(figs.every((f) => !/RentCast|SteadyAPI|MLS/i.test(f.source ?? ""))).toBe(true);
  expect(listingsToFigures([], new Date(), "Cape Coral")).toEqual([]);
});

test("renderListingsBlock wraps the figures under a labeled header (empty → '')", () => {
  const figs = listingsToFigures(LISTINGS, new Date(Date.UTC(2026, 5, 30)), "Cape Coral");
  const block = renderListingsBlock(figs);
  expect(block).toContain("CURRENT FOR-SALE LISTINGS");
  expect(block).toContain("$349,000");
  expect(renderListingsBlock([])).toBe("");
});

test("featuredContextLine names the home and cites SWFL Data Gulf (no vendor / MLS number)", () => {
  const line = featuredContextLine(LISTINGS[0]);
  expect(line).toContain("FEATURED LISTING");
  expect(line).toContain("414 Nw 23rd Ter");
  expect(line).toContain("SWFL Data Gulf");
  expect(line).not.toMatch(/RentCast|SteadyAPI|MLS/i);
});

// ── attachFeaturedAerial (code-set photo) ────────────────────────────────────
describe("attachFeaturedAerial", () => {
  const ORIG = process.env.MAPBOX_TOKEN;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.MAPBOX_TOKEN;
    else process.env.MAPBOX_TOKEN = ORIG;
  });
  const baseDoc = (): EmailDoc => ({
    globalStyle: { ...DEFAULT_GLOBAL_STYLE },
    blocks: [createBlock("hero")],
  });

  test("drops a kind:photo aerial at the top and stays a valid doc", () => {
    process.env.MAPBOX_TOKEN = "pk.test_token";
    const out = attachFeaturedAerial(baseDoc(), LISTINGS[0]);
    expect(EmailDocSchema.safeParse(out).success).toBe(true);
    const hero = out.blocks.find((b) => b.type === "image" && b.props.kind === "photo");
    expect(hero).toBeDefined();
    const props = hero!.props as Record<string, unknown>;
    expect(String(props.url)).toContain("satellite-streets-v12");
    expect(String(props.caption)).toContain("Aerial view");
    expect(out.blocks[0].type).toBe("image"); // leads the card
  });

  test("no token or no coords → card unchanged", () => {
    delete process.env.MAPBOX_TOKEN;
    const d = baseDoc();
    expect(attachFeaturedAerial(d, LISTINGS[0])).toBe(d);
    process.env.MAPBOX_TOKEN = "pk.test_token";
    const noCoords: Listing = { ...LISTINGS[0], latitude: null, longitude: null };
    expect(attachFeaturedAerial(d, noCoords)).toBe(d);
  });
});
