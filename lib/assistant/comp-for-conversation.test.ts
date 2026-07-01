// Precedence coverage for the comp path's wiring seam (conversation-path.ts):
// compForConversation is what the route branches on — `comp.hit ? comp : webFallback`.
// These assert the hit-computation + block/sources selection with injected deps, so no
// Mapbox/SteadyAPI call fires. (The full runConversationPath oracle lives in
// conversation-path.test.ts; this proves the NEW branch behaves.)
import { describe, expect, it } from "bun:test";
import { compForConversation } from "./conversation-path";
import type { CompDeps } from "./comp-helper";
import type { NearbyComp } from "@/lib/listings/steadyapi";

const leeGeo = {
  lat: 26.62,
  lon: -81.99,
  matchedAddress: "Cape Coral",
  zip: "33904",
  county: "Lee",
  countyFips: "12071" as const,
};

const soldComp: NearbyComp = {
  addressLine: "1403 NE 19th Ter",
  city: "Cape Coral",
  state: "FL",
  zip: "33909",
  beds: 3,
  baths: 2,
  sqft: 1850,
  lotSqft: 10000,
  status: "sold",
  listPrice: 415000,
  estimateValue: 428000,
  estimateDate: "2026-05-01",
  propertyId: "M-1",
};

const compDeps = (over: Partial<CompDeps> = {}): CompDeps => ({
  now: new Date(2026, 5, 30),
  geocode: async () => leeGeo,
  fetchNearby: async () => [soldComp],
  fetchSold: async () => ({ soldPrice: 400000, soldDate: "2026-05-12" }),
  ...over,
});

describe("compForConversation — the wiring seam that takes precedence over web-fallback", () => {
  it("is a no-op (hit:false, empty block) for a non-comp ask — the route falls through to web-fallback", async () => {
    const out = await compForConversation("what's driving prices in SWFL?", compDeps());
    expect(out.hit).toBe(false);
    expect(out.block).toBe("");
    expect(out.sources).toEqual([]);
  });

  it("hits (hit:true) with a comp block + two homepage sources for a comp ask", async () => {
    const out = await compForConversation(
      "how much is 1403 NE 19th Ter, Cape Coral worth?",
      compDeps(),
    );
    expect(out.hit).toBe(true);
    expect(out.block).toContain("sold $400,000 on 05/12/2026");
    expect(out.block.toLowerCase()).not.toContain("steadyapi");
    expect(out.sources).toHaveLength(2);
    expect(out.sources.some((s) => s.url === "https://www.realtor.com")).toBe(true);
  });

  it("hits (hit:true) with a needs-block (no sources) when the address is out of footprint", async () => {
    const out = await compForConversation("comps near 1 Infinite Loop, Cupertino", {
      ...compDeps(),
      geocode: async () => ({
        lat: 37.3,
        lon: -122,
        matchedAddress: "Cupertino",
        zip: "95014",
        county: null,
        countyFips: null,
      }),
    });
    expect(out.hit).toBe(true);
    expect(out.block).toMatch(/Lee|Collier/);
    expect(out.sources).toEqual([]); // no comps surfaced → no accordion
  });
});

describe("compForConversation — pasted-link lane takes over when a link is present", () => {
  const pastedFacts = {
    address: "123 Palm Dr, Cape Coral, FL 33914",
    city: "Cape Coral",
    zip: "33914",
    price: "$650,000",
    beds: "3",
    baths: "2",
    sqft: "1900",
    photos: [] as string[],
    sourceUrl: "https://www.beach-homes.com/florida/cape-coral/123-palm-dr",
  };
  const LINK_MSG = `what are comps for ${pastedFacts.sourceUrl}`;

  it("selects the pasted-link branch over the address branch when a link is present and fetch is allowed", async () => {
    let fetchCalls = 0;
    const out = await compForConversation(LINK_MSG, {
      ...compDeps(),
      allowPastedFetch: true,
      fetchPastedFacts: async () => {
        fetchCalls++;
        return pastedFacts;
      },
    });
    expect(fetchCalls).toBe(1);
    expect(out.hit).toBe(true);
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0].url).toBe("https://www.beach-homes.com");
    expect(out.sources[0].url).not.toContain("123-palm-dr"); // homepage only, never the permalink
    expect(out.block).toContain("last listed $650,000");
  });

  it("never invokes the injected fetch when allowPastedFetch is false (the public-path default)", async () => {
    let fetchCalls = 0;
    const out = await compForConversation(LINK_MSG, {
      ...compDeps(),
      fetchPastedFacts: async () => {
        fetchCalls++;
        return pastedFacts;
      },
    });
    expect(fetchCalls).toBe(0);
    expect(out.hit).toBe(true);
    expect(out.block.toLowerCase()).toContain("can't open links");
  });
});

describe("compForConversation — comps chart (Increment 2)", () => {
  it("populates chart when ≥2 priced comps come back from the address lane", async () => {
    const out = await compForConversation("comps near 1403 NE 19th Ter, Cape Coral", {
      ...compDeps(),
      fetchNearby: async () => [
        soldComp,
        { ...soldComp, propertyId: "M-2", addressLine: "1500 NE 20th Ter" },
      ],
    });
    expect(out.chart).toBeTruthy();
    expect(out.chart!.rows.length).toBeGreaterThanOrEqual(2);
  });

  it("leaves chart absent when fewer than 2 priced comps come back", async () => {
    const out = await compForConversation(
      "how much is 1403 NE 19th Ter, Cape Coral worth?",
      compDeps(),
    );
    expect(out.chart).toBeUndefined();
  });
});
