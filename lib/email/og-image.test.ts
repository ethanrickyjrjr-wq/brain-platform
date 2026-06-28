import { describe, it, expect } from "bun:test";
import { extractUrls, parseOgImage, parseTitle } from "./og-image";

describe("extractUrls", () => {
  it("pulls http(s) urls in order, de-duped, trimming trailing punctuation", () => {
    expect(extractUrls("see https://a.com/x and http://b.io/y.")).toEqual([
      "https://a.com/x",
      "http://b.io/y",
    ]);
  });
  it("returns [] when there is no url", () => {
    expect(extractUrls("just an email about 33901 homes")).toEqual([]);
  });
  it("de-dupes a repeated url", () => {
    expect(extractUrls("https://a.com https://a.com")).toEqual(["https://a.com"]);
  });
});

describe("parseOgImage", () => {
  const base = "https://realty.example/listing/123";
  it("reads an absolute og:image", () => {
    expect(
      parseOgImage(`<meta property="og:image" content="https://cdn.example/hero.jpg">`, base),
    ).toBe("https://cdn.example/hero.jpg");
  });
  it("resolves a relative og:image against the page url", () => {
    expect(parseOgImage(`<meta property="og:image" content="/img/hero.jpg">`, base)).toBe(
      "https://realty.example/img/hero.jpg",
    );
  });
  it("falls back to twitter:image", () => {
    expect(
      parseOgImage(`<meta name="twitter:image" content="https://cdn.example/tw.png">`, base),
    ).toBe("https://cdn.example/tw.png");
  });
  it("decodes &amp; entities in the url", () => {
    expect(
      parseOgImage(
        `<meta property="og:image" content="https://cdn.example/h.jpg?a=1&amp;b=2">`,
        base,
      ),
    ).toBe("https://cdn.example/h.jpg?a=1&b=2");
  });
  it("is attribute-order agnostic (content before property)", () => {
    expect(
      parseOgImage(`<meta content="https://cdn.example/h.jpg" property="og:image" />`, base),
    ).toBe("https://cdn.example/h.jpg");
  });
  it("returns null when no image meta is present", () => {
    expect(parseOgImage(`<title>hi</title>`, base)).toBeNull();
    expect(parseOgImage("", base)).toBeNull();
  });
});

describe("parseTitle", () => {
  it("prefers og:title, then <title>, else undefined", () => {
    expect(parseTitle(`<meta property="og:title" content="3BR Pool Home">`)).toBe("3BR Pool Home");
    expect(parseTitle(`<title>123 Main St, Fort Myers</title>`)).toBe("123 Main St, Fort Myers");
    expect(parseTitle(`<p>nope</p>`)).toBeUndefined();
  });
});
