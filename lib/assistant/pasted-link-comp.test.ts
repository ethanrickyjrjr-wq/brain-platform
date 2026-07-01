import { describe, it, expect } from "bun:test";
import { looksLikePastedListingLink, pastedLinkComp } from "./pasted-link-comp";
import type { ListingFacts } from "@/lib/email/listing-scrape";

const LINK = "https://www.beach-homes.com/florida/cape-coral/123-palm-dr";

function facts(over: Partial<ListingFacts> = {}): ListingFacts {
  return {
    address: "123 Palm Dr, Cape Coral, FL 33914",
    city: "Cape Coral",
    state: "FL",
    zip: "33914",
    price: "$650,000",
    beds: "3",
    baths: "2",
    sqft: "1900",
    photos: [],
    sourceUrl: LINK,
    ...over,
  };
}

describe("looksLikePastedListingLink — comp-ish wording + a pasted URL", () => {
  it("fires when a comp ask carries a link", () => {
    expect(looksLikePastedListingLink(`what are comps for ${LINK}`)).toBe(true);
    expect(looksLikePastedListingLink(`pull comparables for ${LINK} please`)).toBe(true);
  });
  it("stays quiet on a bare link with no comp-ish wording", () => {
    expect(looksLikePastedListingLink(LINK)).toBe(false);
  });
  it("stays quiet on comp-ish wording with no link", () => {
    expect(looksLikePastedListingLink("what are comps near 3412 Atlantic Circle")).toBe(false);
  });
});

describe("pastedLinkComp — gate order (fetch-free by construction)", () => {
  it("no-ops on a non-pasted-link ask (caller falls through)", async () => {
    const out = await pastedLinkComp("what's driving prices?", true, {});
    expect(out).toEqual({ comp: null, source: null, needs: [] });
  });

  it("asks to type it in instead — and NEVER calls the injected fetch — when allowFetch is false", async () => {
    let calls = 0;
    const out = await pastedLinkComp(`what are comps for ${LINK}`, false, {
      fetchPastedFacts: async () => {
        calls++;
        return facts();
      },
    });
    expect(calls).toBe(0);
    expect(out.comp).toBeNull();
    expect(out.needs).toEqual([
      "I can't open links directly here — reply with the address and price and I'll add it as a comp.",
    ]);
  });

  it("asks to type it in when the fetch returns nothing", async () => {
    const out = await pastedLinkComp(`what are comps for ${LINK}`, true, {
      fetchPastedFacts: async () => null,
    });
    expect(out.comp).toBeNull();
    expect(out.needs[0]).toContain("couldn't read that link");
  });

  it("asks to type it in when the fetch returns no price", async () => {
    const out = await pastedLinkComp(`what are comps for ${LINK}`, true, {
      fetchPastedFacts: async () => facts({ price: undefined }),
    });
    expect(out.comp).toBeNull();
    expect(out.needs[0]).toContain("couldn't read that link");
  });

  it("asks the footprint question when the zip is out of Lee/Collier", async () => {
    const out = await pastedLinkComp(`what are comps for ${LINK}`, true, {
      fetchPastedFacts: async () => facts({ zip: "33101" }), // Miami-Dade — outside the fixture
    });
    expect(out.comp).toBeNull();
    expect(out.needs[0]).toContain("Lee or Collier");
  });

  it("asks the footprint question when the fetch returned no zip at all", async () => {
    const out = await pastedLinkComp(`what are comps for ${LINK}`, true, {
      fetchPastedFacts: async () => facts({ zip: undefined }),
    });
    expect(out.comp).toBeNull();
    expect(out.needs[0]).toContain("Lee or Collier");
  });

  it("builds one RenderComp + a homepage-only source for a valid Lee/Collier listing", async () => {
    const out = await pastedLinkComp(`what are comps for ${LINK}`, true, {
      fetchPastedFacts: async () => facts(),
    });
    expect(out.needs).toEqual([]);
    expect(out.comp).toEqual({
      addressLine: "123 Palm Dr, Cape Coral, FL 33914",
      city: "Cape Coral",
      beds: 3,
      baths: 2,
      sqft: 1900,
      status: "active",
      price: 650000,
      priceKind: "last_list",
      priceDate: null,
    });
    expect(out.source).toEqual({
      label: "beach-homes.com",
      domain: "beach-homes.com",
      url: "https://www.beach-homes.com",
    });
  });
});
