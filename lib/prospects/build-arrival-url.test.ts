import { test, expect } from "bun:test";
import { buildArrivalUrl } from "./build-arrival-url";
import type { BrandEnrichment } from "./enrich-brand";

const brand = (o: Partial<BrandEnrichment>): BrandEnrichment => ({
  primary: null,
  secondary: null,
  logo_url: null,
  confidence: 0,
  source: "fallback",
  company_name: null,
  ...o,
});

test("full brand → all params, name encoded", () => {
  const url = buildArrivalUrl({
    name: "Joe & Co",
    brand: brand({ primary: "#ff0000", secondary: "#00ff00", logo_url: "https://x.com/l.png" }),
  });
  expect(url).toBe(
    "/welcome?name=Joe+%26+Co&primary=%23ff0000&secondary=%2300ff00&logo=https%3A%2F%2Fx.com%2Fl.png",
  );
});

test("invalid hex and non-http logo are dropped", () => {
  const url = buildArrivalUrl({
    brand: brand({ primary: "rgb(1,2,3)", logo_url: "javascript:alert(1)" }),
  });
  expect(url).toBe("/welcome");
});

test("name falls back to company_name", () => {
  const url = buildArrivalUrl({ brand: brand({ company_name: "Acme" }) });
  expect(url).toBe("/welcome?name=Acme");
});

test("null brand → bare /welcome", () => {
  expect(buildArrivalUrl({ brand: null })).toBe("/welcome");
});

test("base → absolute url", () => {
  const url = buildArrivalUrl({ name: "Z", base: "https://www.swfldatagulf.com" });
  expect(url).toBe("https://www.swfldatagulf.com/welcome?name=Z");
});

test("5-digit zip → adds zip param (carries scope into the arrival)", () => {
  expect(buildArrivalUrl({ name: "Z", zip: "33931" })).toBe("/welcome?name=Z&zip=33931");
});

test("non-5-digit zip is dropped", () => {
  expect(buildArrivalUrl({ name: "Z", zip: "abc" })).toBe("/welcome?name=Z");
  expect(buildArrivalUrl({ name: "Z", zip: "3393" })).toBe("/welcome?name=Z");
});

const RID = "3f6c2a1e-9b4d-4e6f-8a2b-1c5d7e9f0a1b";

test("prompt + ref emitted URL-encoded", () => {
  const url = buildArrivalUrl({
    name: "Z",
    prompt: "What changed in Park Shore this week?",
    ref: `${RID}-t1`,
  });
  expect(url).toBe(`/welcome?name=Z&prompt=What+changed+in+Park+Shore+this+week%3F&ref=${RID}-t1`);
});

test("over-long prompt is DROPPED, not truncated", () => {
  expect(buildArrivalUrl({ name: "Z", prompt: "x".repeat(201) })).toBe("/welcome?name=Z");
});

test("malformed ref is dropped", () => {
  expect(buildArrivalUrl({ name: "Z", ref: "not-a-ref" })).toBe("/welcome?name=Z");
  expect(buildArrivalUrl({ name: "Z", ref: `${RID}-t9` })).toBe("/welcome?name=Z");
});
