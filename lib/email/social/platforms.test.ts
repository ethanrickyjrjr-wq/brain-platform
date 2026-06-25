import { test, expect } from "bun:test";
import {
  PLATFORMS,
  KNOWN_PLATFORMS,
  platformMeta,
  domainFromUrl,
  detectPlatform,
} from "./platforms";

test("the 8 known platforms are registered in order", () => {
  expect(KNOWN_PLATFORMS).toEqual([
    "instagram",
    "facebook",
    "linkedin",
    "x",
    "tiktok",
    "youtube",
    "pinterest",
    "threads",
  ]);
  expect(PLATFORMS.length).toBe(8);
});

test("only IG/FB/LI carry a footer prop key (footer holds 3)", () => {
  const withFooter = PLATFORMS.filter((p) => p.footerPropKey).map((p) => p.type);
  expect(withFooter).toEqual(["instagram", "facebook", "linkedin"]);
  expect(platformMeta("instagram").footerPropKey).toBe("instagramUrl");
  expect(platformMeta("x").footerPropKey).toBeUndefined();
});

test("each platform has a token + branding key that mirror each other", () => {
  for (const p of PLATFORMS) {
    expect(p.tokenKey).toBe(p.brandingKey.toUpperCase());
  }
});

test("domainFromUrl normalizes scheme + www, lowercases", () => {
  expect(domainFromUrl("https://www.Instagram.com/me")).toBe("instagram.com");
  expect(domainFromUrl("instagram.com/me")).toBe("instagram.com");
  expect(domainFromUrl("")).toBeNull();
});

test("detectPlatform maps real hostnames, incl. aliases, else null", () => {
  expect(detectPlatform("https://instagram.com/me")).toBe("instagram");
  expect(detectPlatform("https://twitter.com/me")).toBe("x");
  expect(detectPlatform("https://x.com/me")).toBe("x");
  expect(detectPlatform("https://youtu.be/abc")).toBe("youtube");
  expect(detectPlatform("https://fb.com/page")).toBe("facebook");
  expect(detectPlatform("https://substack.com/me")).toBeNull();
});
