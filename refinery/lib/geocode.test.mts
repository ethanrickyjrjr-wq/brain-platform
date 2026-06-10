import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { geocodeAddress } from "./geocode.mts";

/**
 * Fixtures are trimmed copies of the REAL live responses recorded in
 * docs/superpowers/plans/2026-06-09-universal-location-search/05-geocoding-G4-evidence.md
 * (field paths verified in-session 2026-06-10). Network is stubbed; we test the
 * parser + the forward→reverse fall-through + the Census fallback, not Mapbox.
 */
const FWD_ADDRESS = {
  features: [
    {
      properties: {
        feature_type: "address",
        coordinates: { latitude: 26.505664, longitude: -81.906633, accuracy: "rooftop" },
        match_code: { confidence: "high" },
        context: {
          postcode: { name: "33908" },
          place: { name: "Fort Myers" },
          region: { region_code: "FL", name: "Florida" },
          district: { name: "Lee County" },
        },
      },
    },
  ],
};

// locality hit (Pelican Bay): lat/lon present, NO postcode, NO match_code.
const FWD_LOCALITY = {
  features: [
    {
      properties: {
        feature_type: "locality",
        coordinates: { latitude: 26.230694, longitude: -81.80497 },
        context: {
          place: { name: "Naples" },
          region: { region_code: "FL", name: "Florida" },
          district: { name: "Collier County" },
        },
      },
    },
  ],
};

const REV_POSTCODE = {
  features: [{ properties: { name: "34108", context: { postcode: { name: "34108" } } } }],
};

const CENSUS_MATCH = {
  result: {
    addressMatches: [
      {
        coordinates: { x: -81.907022, y: 26.504635 }, // x=lon, y=lat
        addressComponents: { zip: "33908", city: "FORT MYERS", state: "FL" },
      },
    ],
  },
};

const realFetch = globalThis.fetch;
const realToken = process.env.MAPBOX_TOKEN;

interface Captured {
  url: string;
  referer: string | null;
}
let calls: Captured[] = [];

/** Route the stubbed fetch by URL substring; `undefined` slot → 404. */
function route(map: {
  forward?: unknown;
  reverse?: unknown;
  census?: unknown;
  forwardStatus?: number;
}) {
  calls = [];
  globalThis.fetch = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
    const u = String(url);
    const referer = init?.headers?.Referer ?? init?.headers?.referer ?? null;
    calls.push({ url: u, referer });
    let body: unknown;
    let status = 200;
    if (u.includes("/forward")) {
      body = map.forward;
      if (map.forwardStatus) status = map.forwardStatus;
    } else if (u.includes("/reverse")) {
      body = map.reverse;
    } else if (u.includes("census.gov")) {
      body = map.census;
    }
    if (body === undefined || status >= 400) {
      return new Response(body === undefined ? "" : JSON.stringify(body), {
        status: status >= 400 ? status : 404,
      });
    }
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.MAPBOX_TOKEN = "pk.test";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realToken === undefined) delete process.env.MAPBOX_TOKEN;
  else process.env.MAPBOX_TOKEN = realToken;
});

describe("geocodeAddress §E", () => {
  it("address hit → 33908, provider mapbox, high confidence, no reverse call", async () => {
    route({ forward: FWD_ADDRESS });
    const r = await geocodeAddress("16448 Rainbow Meadows Ct, Fort Myers FL");
    expect(r).not.toBeNull();
    expect(r!.zip).toBe("33908");
    expect(r!.provider).toBe("mapbox");
    expect(r!.lat).toBeCloseTo(26.505664, 4);
    expect(r!.lon).toBeCloseTo(-81.906633, 4);
    expect(r!.place).toBe("Fort Myers");
    expect(r!.region).toBe("FL");
    expect(r!.confidence).toBeCloseTo(0.9, 5);
    // address-level postcode present → reverse must NOT be called
    expect(calls.some((c) => c.url.includes("/reverse"))).toBe(false);
  });

  it("every Mapbox call carries the swfldatagulf Referer (URL-restricted token)", async () => {
    route({ forward: FWD_ADDRESS });
    await geocodeAddress("16448 Rainbow Meadows Ct, Fort Myers FL");
    const mapboxCalls = calls.filter((c) => c.url.includes("mapbox.com"));
    expect(mapboxCalls.length).toBeGreaterThan(0);
    for (const c of mapboxCalls) {
      expect(c.referer).toBe("https://www.swfldatagulf.com/");
    }
  });

  it("locality hit (Pelican Bay, no postcode) → reverse-geocode fills 34108", async () => {
    route({ forward: FWD_LOCALITY, reverse: REV_POSTCODE });
    const r = await geocodeAddress("Pelican Bay, Naples FL");
    expect(r).not.toBeNull();
    expect(r!.zip).toBe("34108");
    expect(r!.provider).toBe("mapbox");
    expect(r!.place).toBe("Naples");
    // the fall-through actually hit the reverse endpoint
    expect(calls.some((c) => c.url.includes("/reverse"))).toBe(true);
  });

  it("Mapbox 403 (token forbidden) → Census fallback returns 33908 (x=lon,y=lat)", async () => {
    route({ forwardStatus: 403, census: CENSUS_MATCH });
    const r = await geocodeAddress("16448 Rainbow Meadows Ct, Fort Myers FL");
    expect(r).not.toBeNull();
    expect(r!.provider).toBe("census");
    expect(r!.zip).toBe("33908");
    expect(r!.lat).toBeCloseTo(26.504635, 4); // y
    expect(r!.lon).toBeCloseTo(-81.907022, 4); // x
  });

  it("Mapbox returns zero features → Census fallback", async () => {
    route({ forward: { features: [] }, census: CENSUS_MATCH });
    const r = await geocodeAddress("somewhere ambiguous");
    expect(r!.provider).toBe("census");
    expect(r!.zip).toBe("33908");
  });

  it("both providers miss → null", async () => {
    route({ forward: { features: [] }, census: { result: { addressMatches: [] } } });
    expect(await geocodeAddress("nowhere at all")).toBeNull();
  });

  it("empty / whitespace query → null, no network call", async () => {
    route({});
    expect(await geocodeAddress("   ")).toBeNull();
    expect(calls.length).toBe(0);
  });

  it("missing MAPBOX_TOKEN → skip Mapbox, still try Census", async () => {
    delete process.env.MAPBOX_TOKEN;
    route({ census: CENSUS_MATCH });
    const r = await geocodeAddress("16448 Rainbow Meadows Ct, Fort Myers FL");
    expect(r!.provider).toBe("census");
    expect(calls.some((c) => c.url.includes("mapbox.com"))).toBe(false);
  });
});
