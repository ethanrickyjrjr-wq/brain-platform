import { test, expect, mock, afterAll, spyOn, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as realSafeFetch from "@/lib/email/safe-fetch";

// mock.module is process-global (no per-file isolation) — snapshot + restore, same
// pattern as lib/reso/pull-zip-stats.test.ts.
const safeFetchOrig = { ...realSafeFetch };
afterAll(() => {
  mock.module("@/lib/email/safe-fetch", () => safeFetchOrig);
});

const mockSafeFetch = mock(async (_url: string, _opts?: unknown): Promise<Response | null> => null);
mock.module("@/lib/email/safe-fetch", () => ({ safeFetchPublicUrl: mockSafeFetch }));

const { parseListingFacts, fetchListingFacts } = await import("./listing-scrape");

afterEach(() => {
  mockSafeFetch.mockReset();
});

// Deterministic fixture: the REAL Hickory Blvd page, captured via a plain Node
// fetch (the production scrape path), saved under __fixtures__. No live network
// in CI — the parser is pure over saved HTML.
const URL_HICKORY =
  "https://www.beach-homes.com/florida/bonita-springs/27804-hickory-blvd-bonita-springs-fl-34134-lhrmls-03646837";
const html = readFileSync(
  join(import.meta.dir, "__fixtures__", "listing-hickory-blvd.html"),
  "utf8",
);

test("parseListingFacts pulls the real specs from the structured data island", () => {
  const f = parseListingFacts(html, URL_HICKORY);
  expect(f.price).toBe("$20,895,000");
  expect(f.beds).toBe("5");
  expect(f.baths).toBe("7");
  expect(f.sqft).toBe("7453");
  expect(f.lotSize).toBe("0.692");
  expect(f.yearBuilt).toMatch(/^20\d\d$/);
  expect(f.propertyType).toMatch(/single family/i);
  expect(f.city).toBe("BONITA SPRINGS");
  expect(f.state).toBe("FL");
  expect(f.zip).toBe("34134");
  expect(f.sourceUrl).toBe(URL_HICKORY);
});

test("parseListingFacts captures the real marketing remarks — not invented prose", () => {
  const f = parseListingFacts(html, URL_HICKORY);
  expect(f.remarks ?? "").toContain("become the view");
  expect((f.remarks ?? "").length).toBeGreaterThan(200);
});

test("parseListingFacts collects real listing photo URLs", () => {
  const f = parseListingFacts(html, URL_HICKORY);
  expect(f.photos.length).toBeGreaterThan(0);
  expect(f.photos[0]).toContain("cdn.beach-homes.com/images/listings");
  expect(f.photos[0]).toMatch(/\.jpe?g/i);
});

test("parseListingFacts invents NOTHING when the page has no facts", () => {
  const f = parseListingFacts("<html><body>nothing here</body></html>", "https://example.com/x");
  expect(f.price).toBeUndefined();
  expect(f.beds).toBeUndefined();
  expect(f.sqft).toBeUndefined();
  expect(f.remarks).toBeUndefined();
  expect(f.photos).toEqual([]);
  expect(f.sourceUrl).toBe("https://example.com/x");
});

test("fetchListingFacts routes its primary fetch through the SSRF guard, never raw fetch", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("fetchListingFacts must never call raw fetch directly");
  });
  mockSafeFetch.mockImplementation(
    async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
  );
  const out = await fetchListingFacts(URL_HICKORY);
  expect(mockSafeFetch).toHaveBeenCalledTimes(1);
  expect(mockSafeFetch).toHaveBeenCalledWith(URL_HICKORY, expect.anything());
  expect(out?.price).toBe("$20,895,000"); // the guard-passed page still parses correctly
  fetchSpy.mockRestore();
});

test("fetchListingFacts returns null (fail-safe) when the SSRF guard rejects the url", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("fetchListingFacts must never call raw fetch directly");
  });
  mockSafeFetch.mockImplementation(async () => null);
  const out = await fetchListingFacts("https://evil.example.com/listing");
  expect(out).toBeNull();
  fetchSpy.mockRestore();
});
