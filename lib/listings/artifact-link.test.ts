// lib/listings/artifact-link.test.ts
import { describe, it, expect } from "bun:test";
import { resolveArtifactLink, isValidPropertyUrl } from "./artifact-link";

describe("isValidPropertyUrl", () => {
  it("accepts http(s) URLs", () => {
    expect(isValidPropertyUrl("https://myagentsite.com/homes/465-gordonia")).toBe(true);
    expect(isValidPropertyUrl("http://example.com/x")).toBe(true);
  });
  it("rejects non-strings, non-http schemes, and junk", () => {
    expect(isValidPropertyUrl(null)).toBe(false);
    expect(isValidPropertyUrl(42)).toBe(false);
    expect(isValidPropertyUrl("javascript:alert(1)")).toBe(false);
    expect(isValidPropertyUrl("ftp://example.com")).toBe(false);
    expect(isValidPropertyUrl("not a url")).toBe(false);
    expect(isValidPropertyUrl("")).toBe(false);
  });
});

describe("resolveArtifactLink — property_url → feed listing_url → null", () => {
  it("the project's property URL wins when present", () => {
    expect(
      resolveArtifactLink({
        propertyUrl: "https://myagentsite.com/homes/465-gordonia",
        listing: { listingUrl: "https://broker.example.com/listing/1" },
      }),
    ).toBe("https://myagentsite.com/homes/465-gordonia");
  });
  it("falls back to the feed-carried listing URL verbatim", () => {
    expect(
      resolveArtifactLink({
        propertyUrl: null,
        listing: { listingUrl: "https://broker.example.com/listing/1" },
      }),
    ).toBe("https://broker.example.com/listing/1");
  });
  it("returns null when neither exists — render unlinked, never construct", () => {
    expect(resolveArtifactLink({ propertyUrl: null, listing: {} })).toBeNull();
    expect(resolveArtifactLink({})).toBeNull();
  });
  it("an invalid property URL does not shadow the feed fallback", () => {
    expect(
      resolveArtifactLink({
        propertyUrl: "javascript:alert(1)",
        listing: { listingUrl: "https://broker.example.com/listing/1" },
      }),
    ).toBe("https://broker.example.com/listing/1");
  });
  it("trims whitespace on the property URL", () => {
    expect(resolveArtifactLink({ propertyUrl: "  https://a.com/x  " })).toBe("https://a.com/x");
  });
});
