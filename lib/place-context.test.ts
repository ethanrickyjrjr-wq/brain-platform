import { test, expect } from "bun:test";
import { buildPlaceContext } from "./place-context";

test("injects deterministic ZIP->place ground truth from the crosswalk, SWFL only", () => {
  // 33931 = Fort Myers Beach, NOT Lehigh Acres — the exact gloss the un-grounded model botched.
  const fmb = buildPlaceContext("is 33931 a good buy?");
  expect(fmb).toContain("Fort Myers Beach");
  expect(fmb).not.toContain("Lehigh");

  // The neighboring Lehigh code resolves to the right town.
  expect(buildPlaceContext("what about 33936?")).toContain("Lehigh Acres");

  // A non-SWFL ZIP injects nothing — no fabricated identity.
  expect(buildPlaceContext("tell me about 90210")).toBe("");
});

test("primary/dedicated ZIP wins over a place that lists it as an alt", () => {
  // 33913 is Gateway's dedicated code; Fort Myers lists it only as an alt_zip.
  expect(buildPlaceContext("permits in 33913?")).toContain("Gateway");
});

test("longest place-name match wins and is not double-counted", () => {
  const out = buildPlaceContext("thinking about fort myers beach");
  expect(out).toContain("Fort Myers Beach");
  // "fort myers beach" must not also fire the shorter "Fort Myers" entry.
  expect(out).not.toContain("primary ZIP 33901");
});

test("no place named -> empty, no noise", () => {
  expect(buildPlaceContext("what can you do?")).toBe("");
  expect(buildPlaceContext("")).toBe("");
});
