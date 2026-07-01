import { describe, expect, it } from "bun:test";
import {
  normalizeNearbyComp,
  parseSoldEvent,
  fetchNearbyValues,
  fetchSoldEvent,
  type RawNearbyProperty,
} from "./steadyapi";

// Verbatim doc-JSON shape from the approved spec's contracts section
// (docs/superpowers/specs/2026-06-30-steadyapi-comp-helper-design.md).
const NEARBY_PROP: RawNearbyProperty = {
  property_id: "M5493101642",
  listing_id: "2988776655",
  status: "sold",
  list_price: 415000,
  href: "https://www.realtor.com/realestateandhomes-detail/1403-NE-19th-Ter_Cape-Coral_FL_33909_M54931-01642",
  permalink: "1403-NE-19th-Ter_Cape-Coral_FL_33909_M54931-01642",
  address: { line: "1403 NE 19th Ter", city: "Cape Coral", state_code: "FL", postal_code: "33909" },
  description: { beds: 3, baths: "2.5", sqft: 1850, lot_sqft: 10000 },
  estimates: {
    best: { value: 428000, date: "2026-05-01" },
    all: [{ value: 428000, date: "2026-05-01" }],
  },
};

const NEARBY_BODY = {
  body: {
    statistics: {
      list_price: { min: 300000, max: 900000, avg: 500000, median: 480000 },
      estimated_value: { min: 310000, max: 950000, avg: 520000, median: 495000 },
      status_counts: { for_sale: 10, sold: 12, off_market: 3 },
    },
    properties: [NEARBY_PROP],
  },
};

describe("normalizeNearbyComp — MLS scrub at the boundary (structural, not AI-trust)", () => {
  it("keeps only the comp facts and drops every realtor.com id from the surfaced fields", () => {
    const comp = normalizeNearbyComp(NEARBY_PROP);
    expect(comp).not.toBeNull();
    expect(comp!.addressLine).toBe("1403 NE 19th Ter");
    expect(comp!.city).toBe("Cape Coral");
    expect(comp!.zip).toBe("33909");
    expect(comp!.beds).toBe(3);
    expect(comp!.baths).toBe(2.5); // parsed from the "2.5" string
    expect(comp!.sqft).toBe(1850);
    expect(comp!.status).toBe("sold");
    expect(comp!.listPrice).toBe(415000);
    expect(comp!.estimateValue).toBe(428000);
    expect(comp!.estimateDate).toBe("2026-05-01");

    // Structural scrub: none of the ids/urls are present as keys or values.
    const asJson = JSON.stringify(comp);
    expect(comp as Record<string, unknown>).not.toHaveProperty("permalink");
    expect(comp as Record<string, unknown>).not.toHaveProperty("href");
    expect(comp as Record<string, unknown>).not.toHaveProperty("listing_id");
    expect(comp as Record<string, unknown>).not.toHaveProperty("source");
    expect(asJson).not.toContain("M54931-01642"); // the permalink M-code
    expect(asJson).not.toContain("realtor.com"); // the href host
    expect(asJson).not.toContain("2988776655"); // the listing_id
  });

  it("carries the internal propertyId for the +1 sold-event lookup (never rendered)", () => {
    const comp = normalizeNearbyComp(NEARBY_PROP);
    expect(comp!.propertyId).toBe("M5493101642");
  });

  it("returns null for a property with no usable address", () => {
    expect(normalizeNearbyComp({} as RawNearbyProperty)).toBeNull();
  });
});

describe("parseSoldEvent — latest Sold event from property_history", () => {
  it("returns the most-recent Sold price + date", () => {
    const body = {
      body: {
        property_history: [
          { date: "2020-03-15", event_name: "Listed", price: 250000 },
          { date: "2026-05-12", event_name: "Sold", price: 415000, source_name: "MLS" },
          { date: "2019-01-01", event_name: "Sold", price: 190000 }, // older sale — ignored
          { date: "2026-04-01", event_name: "Price Changed", price: 420000 },
        ],
      },
    };
    expect(parseSoldEvent(body)).toEqual({ soldPrice: 415000, soldDate: "2026-05-12" });
  });

  it("returns null when there is no Sold event", () => {
    const body = {
      body: { property_history: [{ date: "2026-04-01", event_name: "Listed", price: 420000 }] },
    };
    expect(parseSoldEvent(body)).toBeNull();
  });

  it("returns null on a missing/empty history", () => {
    expect(parseSoldEvent({ body: {} })).toBeNull();
    expect(parseSoldEvent({})).toBeNull();
    expect(parseSoldEvent(null)).toBeNull();
  });
});

describe("fetchNearbyValues — empty-tolerant, never throws", () => {
  const okFetch = (body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it("returns [] when PHOTOS_API is unset (no key → no call)", async () => {
    const prev = process.env.PHOTOS_API;
    delete process.env.PHOTOS_API;
    try {
      let called = 0;
      const out = await fetchNearbyValues(
        { lat: 26.6, lon: -81.9 },
        {
          fetchImpl: (async () => {
            called++;
            return new Response("{}", { status: 200 });
          }) as unknown as typeof fetch,
        },
      );
      expect(out).toEqual([]);
      expect(called).toBe(0);
    } finally {
      if (prev !== undefined) process.env.PHOTOS_API = prev;
    }
  });

  it("normalizes properties on a 200 body", async () => {
    process.env.PHOTOS_API = "test-key";
    const out = await fetchNearbyValues(
      { lat: 26.6, lon: -81.9, status: "sold" },
      { fetchImpl: okFetch(NEARBY_BODY) },
    );
    expect(out).toHaveLength(1);
    expect(out[0].addressLine).toBe("1403 NE 19th Ter");
    expect(out[0].propertyId).toBe("M5493101642");
  });

  it("returns [] on a non-200 response", async () => {
    process.env.PHOTOS_API = "test-key";
    const out = await fetchNearbyValues(
      { lat: 26.6, lon: -81.9 },
      { fetchImpl: (async () => new Response("nope", { status: 429 })) as unknown as typeof fetch },
    );
    expect(out).toEqual([]);
  });

  it("returns [] on a malformed body", async () => {
    process.env.PHOTOS_API = "test-key";
    const out = await fetchNearbyValues(
      { lat: 26.6, lon: -81.9 },
      { fetchImpl: okFetch({ body: { properties: "not-an-array" } }) },
    );
    expect(out).toEqual([]);
  });
});

describe("fetchSoldEvent — empty-tolerant, never throws", () => {
  it("returns null when PHOTOS_API is unset", async () => {
    const prev = process.env.PHOTOS_API;
    delete process.env.PHOTOS_API;
    try {
      const out = await fetchSoldEvent("M5493101642", {
        fetchImpl: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
      });
      expect(out).toBeNull();
    } finally {
      if (prev !== undefined) process.env.PHOTOS_API = prev;
    }
  });

  it("parses a live-shaped Sold history", async () => {
    process.env.PHOTOS_API = "test-key";
    const body = {
      body: { property_history: [{ date: "2026-05-12", event_name: "Sold", price: 415000 }] },
    };
    const out = await fetchSoldEvent("M5493101642", {
      fetchImpl: (async () =>
        new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch,
    });
    expect(out).toEqual({ soldPrice: 415000, soldDate: "2026-05-12" });
  });
});
