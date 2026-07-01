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
