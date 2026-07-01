import { describe, expect, it } from "bun:test";
import { geocodeAddress, type GeocodeFn } from "./geocode-address";

// A fake geocoder (the injected dep) so this test never touches Mapbox/Census.
const fakeGeocoder =
  (result: Awaited<ReturnType<GeocodeFn>>): GeocodeFn =>
  async () =>
    result;

describe("geocodeAddress — county-enriching wrapper over the Mapbox/Census geocoder", () => {
  it("enriches a Lee-county hit with county + FIPS", async () => {
    const out = await geocodeAddress("3412 Atlantic Circle, Cape Coral", {
      geocode: fakeGeocoder({
        lat: 26.62,
        lon: -81.99,
        zip: "33904",
        place: "Cape Coral",
        region: "FL",
        confidence: 0.9,
        provider: "mapbox",
      }),
    });
    expect(out).not.toBeNull();
    expect(out?.lat).toBe(26.62);
    expect(out?.lon).toBe(-81.99);
    expect(out?.zip).toBe("33904");
    expect(out?.countyFips).toBe("12071"); // Lee
    expect(out?.county).toBe("Lee");
    expect(out?.matchedAddress).toBe("Cape Coral");
  });

  it("resolves a Collier hit to 12021", async () => {
    const out = await geocodeAddress("500 5th Ave S, Naples", {
      geocode: fakeGeocoder({
        lat: 26.14,
        lon: -81.79,
        zip: "34102",
        place: "Naples",
        region: "FL",
        confidence: 0.9,
        provider: "mapbox",
      }),
    });
    expect(out?.countyFips).toBe("12021"); // Collier
    expect(out?.county).toBe("Collier");
  });

  it("returns the point with null county for an out-of-footprint hit (so the caller can ask for a Lee/Collier address)", async () => {
    const out = await geocodeAddress("1 Infinite Loop, Cupertino CA", {
      geocode: fakeGeocoder({
        lat: 37.33,
        lon: -122.03,
        zip: "95014",
        place: "Cupertino",
        region: "CA",
        confidence: 0.9,
        provider: "mapbox",
      }),
    });
    expect(out).not.toBeNull();
    expect(out?.countyFips).toBeNull();
    expect(out?.county).toBeNull();
  });

  it("returns null when the geocoder finds nothing", async () => {
    const out = await geocodeAddress("asdkjfhaskdjfh", { geocode: fakeGeocoder(null) });
    expect(out).toBeNull();
  });

  it("returns null (never throws) when the geocoder throws", async () => {
    const out = await geocodeAddress("boom", {
      geocode: async () => {
        throw new Error("network down");
      },
    });
    expect(out).toBeNull();
  });

  it("returns null on empty input without calling the geocoder", async () => {
    let called = 0;
    const out = await geocodeAddress("   ", {
      geocode: async () => {
        called++;
        return null;
      },
    });
    expect(out).toBeNull();
    expect(called).toBe(0);
  });
});
