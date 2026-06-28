import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lintZipLevelFraming } from "./zip-level-framing-lint.mts";

// The operator's locked rule (memory feedback_no-zip-level-intelligence-framing):
// never frame the PRODUCT as "ZIP-level intelligence" — the moat is four-lane at
// ANY grain, and "ZIP-level" framing kills lanes 2-4 (upload / named web / user
// figure). This lint is the structural guarantee ("not AI virtue"): the framing
// physically can't ship in customer-facing copy.
//
// CRITICAL precision: it must NOT flag legitimate GRAIN/CITATION statements like
// "ZIP-level home-value index" or "ZIP-level all-homes" (a source citation). There
// are 79 such honest uses in the corpus — flagging them would force rewording
// source-faithful citations. Only PRODUCT-VALUE framing is forbidden.

// --- it FLAGS product/moat framing ---
test("flags 'ZIP-level intelligence' framing", () => {
  const r = lintZipLevelFraming("Get ZIP-level intelligence for every neighborhood.");
  expect(r.ok).toBe(false);
  expect(r.violations.length).toBeGreaterThan(0);
  expect(r.violations[0].line).toBe(1);
});

test("flags the spaced variant 'ZIP level insights'", () => {
  expect(lintZipLevelFraming("Our ZIP level insights beat the rest.").ok).toBe(false);
});

test("flags 'ZIP-level analytics platform'", () => {
  expect(lintZipLevelFraming("A ZIP-level analytics platform.").ok).toBe(false);
});

test("reports line number + matched pattern for a violation", () => {
  const r = lintZipLevelFraming("line one is clean\nbuy our ZIP-level platform today");
  expect(r.ok).toBe(false);
  expect(r.violations[0].line).toBe(2);
  expect(typeof r.violations[0].pattern).toBe("string");
  expect(r.violations[0].text).toContain("ZIP-level platform");
});

// --- it ALLOWS grain / citation / scope statements (the 79 honest uses) ---
test("allows the data-grain descriptor 'ZIP-level home-value index'", () => {
  expect(lintZipLevelFraming("SWFL ZIP-level home-value index (Zillow ZHVI), monthly.").ok).toBe(
    true,
  );
});

test("allows a source citation that names ZIP-level granularity", () => {
  const cite =
    '"citation": "Zillow Home Value Index (ZHVI), ZIP-level all-homes middle-tier seasonally-adjusted."';
  expect(lintZipLevelFraming(cite).ok).toBe(true);
});

test("allows a plain grain statement 'at the ZIP level'", () => {
  expect(lintZipLevelFraming("We hold data at the ZIP level for Lee and Collier.").ok).toBe(true);
  expect(lintZipLevelFraming("Collier permits have no ZIP-level column.").ok).toBe(true);
});

test("allows clean copy with no ZIP-level mention", () => {
  expect(lintZipLevelFraming("Median sale price is about $400,000 in Cape Coral.").ok).toBe(true);
});

// --- WALL: the live brain corpus must stay clean (structural guarantee) ---
test("WALL: no brain ships ZIP-level product framing", () => {
  const dir = join(import.meta.dir, "..", "..", "brains");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  expect(files.length).toBeGreaterThan(0);
  const offenders: string[] = [];
  for (const f of files) {
    const r = lintZipLevelFraming(readFileSync(join(dir, f), "utf-8"));
    if (!r.ok)
      offenders.push(`${f}: ${r.violations.map((v) => `L${v.line} "${v.text}"`).join("; ")}`);
  }
  expect(offenders).toEqual([]);
});
