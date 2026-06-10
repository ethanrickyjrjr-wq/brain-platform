import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveLocation } from "./location-resolver.mts";

// ---- §E geocoder stub: route the network so the dispatch logic is tested, not
// Mapbox. Bodies mirror the live shapes in 05-geocoding-G4-evidence.md. ----
const FWD_33908 = {
  features: [
    {
      properties: {
        coordinates: { latitude: 26.505664, longitude: -81.906633 },
        match_code: { confidence: "high" },
        context: {
          postcode: { name: "33908" },
          place: { name: "Fort Myers" },
          region: { region_code: "FL" },
        },
      },
    },
  ],
};
const FWD_PELICAN_NO_ZIP = {
  features: [
    {
      properties: {
        feature_type: "locality",
        coordinates: { latitude: 26.230694, longitude: -81.80497 },
        context: { place: { name: "Naples" }, region: { region_code: "FL" } },
      },
    },
  ],
};
const FWD_94043 = {
  features: [
    {
      properties: {
        coordinates: { latitude: 37.422525, longitude: -122.0855 },
        match_code: { confidence: "high" },
        context: {
          postcode: { name: "94043" },
          place: { name: "Mountain View" },
          region: { region_code: "CA" },
        },
      },
    },
  ],
};
// Charlotte County address (Punta Gorda) — exercises the METRO_4 boundary: in_scope
// MUST be true (6-county fixture), proving the gate is NOT keyed to Lee/Collier core.
const FWD_33950 = {
  features: [
    {
      properties: {
        coordinates: { latitude: 26.92978, longitude: -82.05426 },
        match_code: { confidence: "high" },
        context: {
          postcode: { name: "33950" },
          place: { name: "Punta Gorda" },
          region: { region_code: "FL" },
        },
      },
    },
  ],
};
const REV_34108 = { features: [{ properties: { name: "34108" } }] };

const realFetch = globalThis.fetch;
const realToken = process.env.MAPBOX_TOKEN;

beforeEach(() => {
  process.env.MAPBOX_TOKEN = "pk.test";
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url);
    const q = (() => {
      try {
        return new URL(u).searchParams.get("q") ?? "";
      } catch {
        return "";
      }
    })();
    let body: unknown = {};
    if (u.includes("/forward")) {
      if (/rainbow meadows/i.test(q)) body = FWD_33908;
      else if (/pelican bay/i.test(q)) body = FWD_PELICAN_NO_ZIP;
      else if (/marion|punta gorda/i.test(q)) body = FWD_33950;
      else if (/amphitheatre/i.test(q)) body = FWD_94043;
      else body = { features: [] };
    } else if (u.includes("/reverse")) {
      body = REV_34108;
    } else if (u.includes("census.gov")) {
      body = { result: { addressMatches: [] } };
    }
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realToken === undefined) delete process.env.MAPBOX_TOKEN;
  else process.env.MAPBOX_TOKEN = realToken;
});

describe("location-resolver §B dispatcher", () => {
  // ---- 1. bare ZIP → resolveZip ----
  it('"33908" → kind:"zip" with the full ZipResolution attached', async () => {
    const loc = await resolveLocation("33908");
    expect(loc.kind).toBe("zip");
    if (loc.kind !== "zip") throw new Error("narrow");
    expect(loc.resolution.zip).toBe("33908");
    expect(loc.resolution.in_scope).toBe(true);
    expect(loc.resolution.primary_county).toBe("12071"); // Fort Myers alt ZIP, Lee
  });

  // ---- 2. gazetteer place FIRST → primary ZIP, NO geocode (the Immokalee case) ----
  it('"Immokalee" → kind:"place", ZIP 34142, corridors:[] (gazetteer-first, no geocoder)', async () => {
    const loc = await resolveLocation("Immokalee");
    expect(loc.kind).toBe("place");
    if (loc.kind !== "place") throw new Error("narrow");
    expect(loc.matched).toBe("Immokalee");
    expect(loc.resolution.zip).toBe("34142");
    expect(loc.resolution.in_scope).toBe(true);
    expect(loc.resolution.primary_county).toBe("12021"); // Collier
    expect(loc.resolution.corridors).toEqual([]); // Immokalee sits in no pocket
  });

  // ---- 3. county name → kind:"county", NO ZIP ----
  it('"Lee County" → kind:"county" (no ZIP synthesized)', async () => {
    const loc = await resolveLocation("Lee County");
    expect(loc.kind).toBe("county");
    if (loc.kind !== "county") throw new Error("narrow");
    expect(loc.county).toBe("12071");
    expect(loc.county_name).toBe("Lee County");
    expect(loc).not.toHaveProperty("resolution");
  });

  // ---- 4. exact corridor slug → kind:"corridor", NO ZIP ----
  it('"airport-pulling-naples" → kind:"corridor" with pocket+county, no synthesized ZIP', async () => {
    const loc = await resolveLocation("airport-pulling-naples");
    expect(loc.kind).toBe("corridor");
    if (loc.kind !== "corridor") throw new Error("narrow");
    expect(loc.corridor_id).toBe("airport-pulling-naples");
    expect(loc.pocket).toBe("North Naples");
    expect(loc.county).toBe("12021"); // North Naples → Collier
    expect(loc).not.toHaveProperty("resolution");
  });

  // ---- 5. region terms → kind:"region" ----
  it('"SWFL" → kind:"region"', async () => {
    expect((await resolveLocation("SWFL")).kind).toBe("region");
  });
  it('"Southwest Florida" → kind:"region"', async () => {
    expect((await resolveLocation("Southwest Florida")).kind).toBe("region");
  });

  // ---- 6. genuinely out-of-scope place name → kind:"out-of-scope" ----
  it('"Miami" → kind:"out-of-scope" (a real place, just not SWFL — not mislabeled as an address)', async () => {
    const loc = await resolveLocation("Miami");
    expect(loc.kind).toBe("out-of-scope");
    if (loc.kind !== "out-of-scope") throw new Error("narrow");
    expect(loc.raw).toBe("Miami");
  });

  // ---- 7. §E: free-text street address → geocoder → kind:"address", in-scope ZIP ----
  it('"16448 Rainbow Meadows Ct" → kind:"address", in-scope ZIP 33908 (§E geocoder)', async () => {
    const loc = await resolveLocation("16448 Rainbow Meadows Ct");
    expect(loc.kind).toBe("address");
    if (loc.kind !== "address") throw new Error("narrow");
    expect(loc.resolution.zip).toBe("33908");
    expect(loc.resolution.in_scope).toBe(true);
    expect(loc.resolution.primary_county).toBe("12071"); // Lee
  });

  // ---- 7b. §E: long-tail place name the gazetteer lacks → geocoder → kind:"place" ----
  // "Pelican Bay" has no crosswalk/corridor hit; the geocoder rescues it. Mapbox
  // returns the locality with NO postcode, so the reverse fall-through fills 34108.
  it('"Pelican Bay" → kind:"place" via geocoder reverse fall-through, Naples ZIP 34108', async () => {
    const loc = await resolveLocation("Pelican Bay");
    expect(loc.kind).toBe("place");
    if (loc.kind !== "place") throw new Error("narrow");
    expect(loc.resolution.zip).toBe("34108");
    expect(loc.resolution.in_scope).toBe(true);
    expect(loc.resolution.primary_county).toBe("12021"); // Collier
  });

  // ---- 7b-METRO_4: a Charlotte address (housing-covered, Lee/Collier-only for the
  // rest) MUST resolve in_scope=true. in_scope is keyed to the 6-county fixture
  // (⊃ METRO_4), NOT the Lee/Collier core — a false "outside the footprint" here is
  // the silent refusal scope expansion was meant to kill. ----
  it('"350 W Marion Ave, Punta Gorda FL" (Charlotte) → kind:"address", in_scope, county 12015', async () => {
    const loc = await resolveLocation("350 W Marion Ave, Punta Gorda FL");
    expect(loc.kind).toBe("address");
    if (loc.kind !== "address") throw new Error("narrow");
    expect(loc.resolution.zip).toBe("33950");
    expect(loc.resolution.in_scope).toBe(true); // METRO_4 boundary, not Lee/Collier core
    expect(loc.resolution.primary_county).toBe("12015"); // Charlotte
  });

  // ---- 7c. §E scope gate: an address that geocodes OUTSIDE SWFL → out-of-scope ----
  // The geocoder is scope-agnostic; resolveZip is the in-scope gate. A valid hit
  // in Mountain View CA (94043) must NOT be dressed up as a SWFL grain.
  it('"1600 Amphitheatre Pkwy, Mountain View CA" → kind:"out-of-scope" (geocoded but non-SWFL)', async () => {
    const loc = await resolveLocation("1600 Amphitheatre Pkwy, Mountain View CA");
    expect(loc.kind).toBe("out-of-scope");
  });

  // ---- 8. fuzzy-vs-gazetteer: gazetteer WINS ----
  // "Estero" both names a corridor pocket (place-resolver would match) AND is a
  // sourced gazetteer place. Dispatch order resolves it via the gazetteer → an
  // honest primary ZIP, never a no-ZIP corridor.
  it('"Estero" resolves via the gazetteer (kind:"place"), not as a corridor/pocket', async () => {
    const loc = await resolveLocation("Estero");
    expect(loc.kind).toBe("place");
    if (loc.kind !== "place") throw new Error("narrow");
    expect(loc.resolution.zip).toBe("33928"); // Estero primary ZIP
  });

  // ---- gazetteer alias path also lands as kind:"place" ----
  it('"fmb" (gazetteer alias) → kind:"place", ZIP 33931', async () => {
    const loc = await resolveLocation("fmb");
    expect(loc.kind).toBe("place");
    if (loc.kind !== "place") throw new Error("narrow");
    expect(loc.resolution.zip).toBe("33931");
  });

  // ---- input hygiene: whitespace + empty ----
  it("trims surrounding whitespace before dispatch", async () => {
    expect((await resolveLocation("  33908 ")).kind).toBe("zip");
  });
  it('empty / whitespace input → kind:"out-of-scope" (nothing to resolve)', async () => {
    expect((await resolveLocation("   ")).kind).toBe("out-of-scope");
  });

  // ---- pocket-only match (no single corridor_id) is honest, not a crash ----
  // "North Naples" is a pocket name (not a gazetteer place, not a county) → corridor
  // grain, but there is no ONE corridor, so corridor_id is null (documented deviation).
  it('"North Naples" → kind:"corridor", pocket set, corridor_id null (pocket grain)', async () => {
    const loc = await resolveLocation("North Naples");
    expect(loc.kind).toBe("corridor");
    if (loc.kind !== "corridor") throw new Error("narrow");
    expect(loc.pocket).toBe("North Naples");
    expect(loc.corridor_id).toBeNull();
    expect(loc.county).toBe("12021");
  });
});
