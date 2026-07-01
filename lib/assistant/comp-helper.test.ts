import { describe, expect, it } from "bun:test";
import {
  looksLikeCompAsk,
  extractAddress,
  compHelper,
  renderCompBlock,
  compSources,
  buildCompsChartSpec,
  resolveCompConfirmReentry,
  type CompDeps,
  type CompResult,
} from "./comp-helper";
import type { NearbyComp } from "@/lib/listings/steadyapi";

// ── the injected fakes (no Mapbox, no SteadyAPI) ──────────────────────────────
const leeGeo = {
  lat: 26.62,
  lon: -81.99,
  matchedAddress: "Cape Coral",
  zip: "33904",
  county: "Lee",
  countyFips: "12071" as const,
};

function comp(over: Partial<NearbyComp>): NearbyComp {
  return {
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
    ...over,
  };
}

const FIXED_NOW = new Date(2026, 5, 30); // 06/30/2026 (local)

function baseDeps(over: Partial<CompDeps> = {}): CompDeps {
  return {
    now: FIXED_NOW,
    geocode: async () => leeGeo,
    fetchNearby: async () => [comp({ propertyId: "M-1" }), comp({ propertyId: "M-2" })],
    fetchSold: async () => ({ soldPrice: 400000, soldDate: "2026-05-12" }),
    ...over,
  };
}

describe("looksLikeCompAsk — cheap gate", () => {
  it("fires on comp / value asks about a specific property", () => {
    expect(looksLikeCompAsk("what are comps near 3412 Atlantic Circle, Cape Coral?")).toBe(true);
    expect(looksLikeCompAsk("how much is 500 5th Ave S worth")).toBe(true);
    expect(looksLikeCompAsk("pull comparables for 16448 Rainbow Meadows Ct")).toBe(true);
    expect(looksLikeCompAsk("comps near my listing")).toBe(true); // comp word alone
  });
  it("stays quiet on region asks and small talk", () => {
    expect(looksLikeCompAsk("what's driving prices in SWFL?")).toBe(false);
    expect(looksLikeCompAsk("what's the median home value in Cape Coral")).toBe(false);
    expect(looksLikeCompAsk("hey, thanks!")).toBe(false);
  });
});

describe("extractAddress — permissive span pull (geocode is the real filter)", () => {
  it("pulls the house-number-led span, trimming lead-in + trailing intent", () => {
    expect(extractAddress("what are comps near 3412 Atlantic Circle, Cape Coral?")).toBe(
      "3412 Atlantic Circle, Cape Coral",
    );
    expect(extractAddress("how much is 500 5th Ave S worth")).toBe("500 5th Ave S");
  });
  it("returns null when there is no address to pull", () => {
    expect(extractAddress("what's my house worth")).toBeNull();
  });
});

describe("compHelper — orchestrator (DI, ≤3 Steady calls, price_kind tags)", () => {
  it("returns a no-op for a non-comp ask (no geocode, no fetch)", async () => {
    let geocoded = 0;
    const out = await compHelper("what's driving prices?", {
      ...baseDeps(),
      geocode: async () => {
        geocoded++;
        return leeGeo;
      },
    });
    expect(out.comps).toEqual([]);
    expect(out.needs).toEqual([]);
    expect(geocoded).toBe(0);
  });

  it("enriches the top ≤2 sold comps and tags the rest by kind; ≤3 Steady calls", async () => {
    let nearbyCalls = 0;
    let soldCalls = 0;
    const out = await compHelper("comps near 3412 Atlantic Circle, Cape Coral", {
      ...baseDeps(),
      fetchNearby: async () => {
        nearbyCalls++;
        return [
          comp({ propertyId: "M-1" }),
          comp({ propertyId: "M-2" }),
          comp({ propertyId: "M-3" }), // 3rd sold comp — NOT enriched (cap 2)
        ];
      },
      fetchSold: async (id) => {
        soldCalls++;
        return { soldPrice: id === "M-1" ? 400000 : 390000, soldDate: "2026-05-12" };
      },
    });
    expect(nearbyCalls).toBe(1);
    expect(soldCalls).toBe(2); // hard cap — never 3
    expect(out.comps).toHaveLength(3);
    expect(out.comps[0].priceKind).toBe("sold");
    expect(out.comps[0].price).toBe(400000);
    expect(out.comps[0].priceDate).toBe("2026-05-12");
    expect(out.comps[2].priceKind).toBe("estimate"); // un-enriched → AVM, not a sale
    expect(out.comps[2].price).toBe(428000);
    expect(out.asOf).toBe("06/30/2026");
    // The internal join key never rides on a surfaced comp.
    expect(out.comps[0] as Record<string, unknown>).not.toHaveProperty("propertyId");
  });

  it("asks for the address when geocoding misses — no Steady call", async () => {
    let nearbyCalls = 0;
    const out = await compHelper("comps near 3412 Atlantic Circle", {
      ...baseDeps(),
      geocode: async () => null,
      fetchNearby: async () => {
        nearbyCalls++;
        return [];
      },
    });
    expect(out.comps).toEqual([]);
    expect(out.needs.length).toBeGreaterThan(0);
    expect(out.needs.join(" ").toLowerCase()).toContain("address");
    expect(nearbyCalls).toBe(0);
  });

  it("asks for a Lee/Collier address when the point is out of footprint — no Steady call", async () => {
    let nearbyCalls = 0;
    const out = await compHelper("comps near 1 Infinite Loop, Cupertino", {
      ...baseDeps(),
      geocode: async () => ({
        lat: 37.3,
        lon: -122,
        matchedAddress: "Cupertino",
        zip: "95014",
        county: null,
        countyFips: null,
      }),
      fetchNearby: async () => {
        nearbyCalls++;
        return [];
      },
    });
    expect(out.comps).toEqual([]);
    expect(out.needs.join(" ")).toMatch(/Lee|Collier/);
    expect(nearbyCalls).toBe(0);
  });

  it("confirms the saved project address (instead of guessing) when no address is typed — no fetch", async () => {
    let geocoded = 0;
    let nearbyCalls = 0;
    const out = await compHelper("what are comps for my listing?", {
      ...baseDeps(),
      projectAddress: "500 5th Ave S, Naples",
      geocode: async () => {
        geocoded++;
        return leeGeo;
      },
      fetchNearby: async () => {
        nearbyCalls++;
        return [];
      },
    });
    expect(out.comps).toEqual([]);
    expect(out.needs).toHaveLength(1);
    expect(out.needs[0]).toContain("500 5th Ave S, Naples");
    expect(out.needs[0].toLowerCase()).toContain("yes");
    expect(geocoded).toBe(0); // pure confirm — no geocode, no Steady call
    expect(nearbyCalls).toBe(0);
  });

  it("uses a typed address and ignores the project address when the question has one", async () => {
    let geocodedArg = "";
    const out = await compHelper("comps near 456 Oak St, Cape Coral", {
      ...baseDeps(),
      projectAddress: "500 5th Ave S, Naples",
      geocode: async (text) => {
        geocodedArg = text;
        return leeGeo;
      },
    });
    expect(geocodedArg).toBe("456 Oak St, Cape Coral"); // typed wins; project address unused
    expect(out.comps.length).toBeGreaterThan(0);
  });

  it("keeps the plain cold-ask (no regression) when there is no typed AND no project address", async () => {
    let geocoded = 0;
    const out = await compHelper("what are comps for my listing?", {
      ...baseDeps(),
      geocode: async () => {
        geocoded++;
        return leeGeo;
      },
    });
    expect(out.comps).toEqual([]);
    expect(out.needs).toHaveLength(1);
    expect(out.needs[0].toLowerCase()).toContain("address");
    expect(out.needs[0]).not.toContain("500 5th Ave S"); // not a confirm — no saved address to echo
    expect(geocoded).toBe(0);
  });

  it("offers to widen when no nearby comps come back (1 nearby call, 0 sold)", async () => {
    let soldCalls = 0;
    const out = await compHelper("comps near 3412 Atlantic Circle, Cape Coral", {
      ...baseDeps(),
      fetchNearby: async () => [],
      fetchSold: async () => {
        soldCalls++;
        return null;
      },
    });
    expect(out.comps).toEqual([]);
    expect(out.needs.length).toBeGreaterThan(0);
    expect(soldCalls).toBe(0);
  });
});

describe("resolveCompConfirmReentry — the confirm-turn re-entry (caller-level)", () => {
  const PROJ = "500 5th Ave S, Naples";
  // The confirm was triggered by a comp ask with NO typed address.
  const confirmed = (reply: string) => [
    { role: "user" as const, content: "what are comps for my listing?" },
    { role: "assistant" as const, content: `Is this comp for ${PROJ}? Reply "yes" ...` },
    { role: "user" as const, content: reply },
  ];

  it("resolves an affirmation to the saved project address", () => {
    expect(resolveCompConfirmReentry(confirmed("yes"), PROJ)).toBe(PROJ);
    expect(resolveCompConfirmReentry(confirmed("yes please"), PROJ)).toBe(PROJ);
    expect(resolveCompConfirmReentry(confirmed("yep, go ahead"), PROJ)).toBe(PROJ);
  });

  it("resolves a newly typed address (project address ignored)", () => {
    expect(resolveCompConfirmReentry(confirmed("3412 Atlantic Circle, Cape Coral"), PROJ)).toBe(
      "3412 Atlantic Circle, Cape Coral",
    );
  });

  it("returns '' when there is no saved project address", () => {
    expect(resolveCompConfirmReentry(confirmed("yes"), "")).toBe("");
  });

  it("returns '' when the prior user turn already carried an address (no confirm was shown)", () => {
    const msgs = [
      { role: "user" as const, content: "comps near 456 Oak St, Cape Coral" },
      { role: "assistant" as const, content: "Here are nearby comps ..." },
      { role: "user" as const, content: "yes" },
    ];
    expect(resolveCompConfirmReentry(msgs, PROJ)).toBe("");
  });

  it("returns '' when the prior user turn was not a comp ask", () => {
    const msgs = [
      { role: "user" as const, content: "what's driving prices in SWFL?" },
      { role: "assistant" as const, content: "..." },
      { role: "user" as const, content: "yes" },
    ];
    expect(resolveCompConfirmReentry(msgs, PROJ)).toBe("");
  });

  it("returns '' when the reply is neither an affirmation nor an address", () => {
    expect(resolveCompConfirmReentry(confirmed("what about schools?"), PROJ)).toBe("");
  });

  it("returns '' when the last turn is not from the user", () => {
    const msgs = [
      { role: "user" as const, content: "what are comps?" },
      { role: "assistant" as const, content: `Is this comp for ${PROJ}? ...` },
    ];
    expect(resolveCompConfirmReentry(msgs, PROJ)).toBe("");
  });
});

describe("renderCompBlock — grounding text (label figures by kind, no vendor name)", () => {
  it("labels a sale as sold, an AVM as estimate, and never calls an estimate a sale", async () => {
    const result = await compHelper("comps near 3412 Atlantic Circle, Cape Coral", {
      ...baseDeps(),
      fetchNearby: async () => [
        comp({ propertyId: "M-1" }),
        comp({
          propertyId: "M-x",
          status: "off_market",
          estimateValue: 500000,
          estimateDate: "2026-04-15",
        }),
      ],
      fetchSold: async () => ({ soldPrice: 400000, soldDate: "2026-05-12" }),
    });
    const block = renderCompBlock(result);
    expect(block).toContain("06/30/2026"); // as-of date
    expect(block).toContain("sold $400,000 on 05/12/2026");
    expect(block).toContain("estimated value $500,000");
    // no vendor strings, no distance, no MLS id
    expect(block.toLowerCase()).not.toContain("steadyapi");
    expect(block.toLowerCase()).not.toContain("realtor.com");
    expect(block).not.toMatch(/\bmi\b/); // no fabricated distance
    expect(block).not.toContain("M-1");
  });

  it("renders a needs-only block when nothing was found", () => {
    const block = renderCompBlock({
      comps: [],
      asOf: "06/30/2026",
      needs: ["Send the full street address."],
    });
    expect(block).toContain("Send the full street address.");
    expect(block).not.toBe("");
  });

  it("renders nothing when there are no comps and no needs (non-comp ask)", () => {
    expect(renderCompBlock({ comps: [], asOf: "06/30/2026", needs: [] })).toBe("");
  });
});

describe("compSources — the collapsed accordion (homepage only, never SteadyAPI)", () => {
  it("returns exactly SWFL Data Gulf + realtor.com homepage when comps exist", async () => {
    const result = await compHelper("comps near 3412 Atlantic Circle, Cape Coral", baseDeps());
    const sources = compSources(result);
    expect(sources).toHaveLength(2);
    const byLabel = Object.fromEntries(sources.map((s) => [s.label, s]));
    expect(byLabel["realtor.com"].url).toBe("https://www.realtor.com"); // homepage, not a permalink
    expect(byLabel["realtor.com"].url).not.toContain("realestateandhomes-detail");
    expect(byLabel["SWFL Data Gulf"]).toBeTruthy();
    expect(JSON.stringify(sources).toLowerCase()).not.toContain("steadyapi");
  });

  it("returns no sources when nothing was surfaced", () => {
    expect(compSources({ comps: [], asOf: "06/30/2026", needs: ["x"] })).toEqual([]);
  });
});

describe("buildCompsChartSpec — the comps bar chart (comps-only, no subject bar)", () => {
  const baseResult: CompResult = {
    asOf: "06/30/2026",
    matchedAddress: "Cape Coral",
    needs: [],
    comps: [
      {
        addressLine: "100 A St",
        city: "Cape Coral",
        beds: 3,
        baths: 2,
        sqft: 1500,
        status: "sold",
        price: 400000,
        priceKind: "sold",
        priceDate: "2026-05-12",
      },
      {
        addressLine: "200 B St",
        city: "Cape Coral",
        beds: 3,
        baths: 2,
        sqft: 1600,
        status: "active",
        price: 450000,
        priceKind: "last_list",
        priceDate: null,
      },
      {
        addressLine: "300 C St",
        city: "Cape Coral",
        beds: 3,
        baths: 2,
        sqft: 1550,
        status: "off_market",
        price: 420000,
        priceKind: "estimate",
        priceDate: "2026-04-01",
      },
    ],
  };

  it("returns null when fewer than 2 comps carry a price", () => {
    expect(buildCompsChartSpec({ ...baseResult, comps: [baseResult.comps[0]] })).toBeNull();
    expect(
      buildCompsChartSpec({
        ...baseResult,
        comps: [
          { ...baseResult.comps[0], price: null },
          { ...baseResult.comps[1], price: null },
        ],
      }),
    ).toBeNull();
  });

  it("sorts price-desc and suffixes labels honestly by priceKind", () => {
    const spec = buildCompsChartSpec(baseResult)!;
    expect(spec).not.toBeNull();
    expect(spec.rows.map((r) => r[0])).toEqual([
      "200 B St (list)", // 450000 — highest
      "300 C St (est.)", // 420000
      "100 A St", // 400000 — sold, no suffix
    ]);
    expect(spec.rows.map((r) => r[1])).toEqual([450000, 420000, 400000]);
  });

  it("carries the correct title/columns/source/asOf conversion", () => {
    const spec = buildCompsChartSpec(baseResult)!;
    expect(spec.title).toBe("Nearby comparable prices near Cape Coral");
    expect(spec.columns).toEqual(["Property", "Price"]);
    expect(spec.value_format).toBe("usd");
    expect(spec.chart_type).toBe("bar");
    expect(spec.frameId).toBe("bar-table");
    expect(spec.asOf).toBe("2026-06-30"); // MM/DD/YYYY -> ISO
    expect(spec.source).toEqual({
      citation: "Nearby comps, SWFL Data Gulf + realtor.com",
      url: "https://www.realtor.com",
    });
  });

  it("falls back to a plain title when matchedAddress is absent", () => {
    const spec = buildCompsChartSpec({ ...baseResult, matchedAddress: undefined })!;
    expect(spec.title).toBe("Nearby comparable prices");
  });
});
