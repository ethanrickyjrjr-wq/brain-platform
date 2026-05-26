import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  MARKETBEAT_SUBMARKET_MAP,
  submarketFor,
  corridorsForSubmarket,
  submarketSlug,
} from "./marketbeat-submarket-aliases.mts";

// --- fixtures ---

interface CorridorRentRow {
  id: string;
  name: string;
  submarket: string;
}

async function loadCorridorRents(): Promise<CorridorRentRow[]> {
  const raw = await readFile(
    path.join(process.cwd(), "fixtures", "corridor-rents.json"),
    "utf-8",
  );
  return JSON.parse(raw) as CorridorRentRow[];
}

// --- coverage: every corridor-rents.json name has a map entry ---

test("every corridor in corridor-rents.json is covered by the submarket map", async () => {
  const rows = await loadCorridorRents();
  const missing: string[] = [];
  for (const row of rows) {
    if (submarketFor(row.name) === undefined) missing.push(row.name);
  }
  assert.deepEqual(
    missing,
    [],
    `These corridor names are not in MARKETBEAT_SUBMARKET_MAP:\n${missing.join("\n")}`,
  );
});

// --- no orphans: every name in the map exists in corridor-rents.json ---

test("no name in MARKETBEAT_SUBMARKET_MAP is absent from corridor-rents.json", async () => {
  const rows = await loadCorridorRents();
  const knownNames = new Set(rows.map((r) => r.name));
  const orphans: string[] = [];
  for (const corridors of Object.values(MARKETBEAT_SUBMARKET_MAP)) {
    for (const name of corridors) {
      if (!knownNames.has(name)) orphans.push(name);
    }
  }
  assert.deepEqual(
    orphans,
    [],
    `These names in MARKETBEAT_SUBMARKET_MAP are missing from corridor-rents.json:\n${orphans.join("\n")}`,
  );
});

// --- total coverage ---

test("MARKETBEAT_SUBMARKET_MAP covers all 26 corridors", () => {
  const total = Object.values(MARKETBEAT_SUBMARKET_MAP).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  assert.equal(total, 26);
});

// --- submarket counts ---

test("Naples maps to 10 corridors", () => {
  assert.equal(corridorsForSubmarket("Naples").length, 10);
});

test("Fort Myers maps to 7 corridors", () => {
  assert.equal(corridorsForSubmarket("Fort Myers").length, 7);
});

test("Cape Coral maps to 3 corridors", () => {
  assert.equal(corridorsForSubmarket("Cape Coral").length, 3);
});

test("Bonita Springs maps to 2 corridors", () => {
  assert.equal(corridorsForSubmarket("Bonita Springs").length, 2);
});

test("Estero maps to 3 corridors", () => {
  assert.equal(corridorsForSubmarket("Estero").length, 3);
});

test("Fort Myers Beach maps to 1 corridor", () => {
  assert.equal(corridorsForSubmarket("Fort Myers Beach").length, 1);
});

// --- round-trips ---

test("submarketFor returns correct submarket for a known corridor", () => {
  assert.equal(submarketFor("Pine Ridge Rd Naples"), "Naples");
  assert.equal(submarketFor("US-41 / Cleveland Ave Fort Myers"), "Fort Myers");
  assert.equal(submarketFor("Cape Coral Pkwy E"), "Cape Coral");
});

test("submarketFor returns undefined for an unknown corridor name", () => {
  assert.equal(submarketFor("Nonexistent Corridor"), undefined);
});

test("corridorsForSubmarket returns empty array for unknown submarket", () => {
  assert.deepEqual(corridorsForSubmarket("Miami"), []);
});

// --- submarketSlug ---

test("submarketSlug produces the expected snake_case for each known submarket", () => {
  assert.equal(submarketSlug("Naples"), "naples");
  assert.equal(submarketSlug("Fort Myers"), "fort_myers");
  assert.equal(submarketSlug("Cape Coral"), "cape_coral");
  assert.equal(submarketSlug("Bonita Springs"), "bonita_springs");
  assert.equal(submarketSlug("Estero"), "estero");
  assert.equal(submarketSlug("Fort Myers Beach"), "fort_myers_beach");
});

test("submarketSlug is idempotent on its own output for the 6 known submarkets", () => {
  for (const submarket of Object.keys(MARKETBEAT_SUBMARKET_MAP)) {
    const once = submarketSlug(submarket);
    const twice = submarketSlug(once);
    assert.equal(twice, once, `slug not idempotent for ${submarket}`);
  }
});

test("submarketSlug produces no collisions across MARKETBEAT_SUBMARKET_MAP keys", () => {
  const slugs = Object.keys(MARKETBEAT_SUBMARKET_MAP).map(submarketSlug);
  const unique = new Set(slugs);
  assert.equal(
    unique.size,
    slugs.length,
    `Collision detected: ${slugs.join(", ")}`,
  );
});

test("submarketSlug collapses double-space (known lossy edge case)", () => {
  // Documented: "Fort  Myers" (two spaces) collapses to "fort_myers"
  // — same slug as "Fort Myers". Future submarket additions must avoid
  // whitespace-only variants of an existing name.
  assert.equal(submarketSlug("Fort  Myers"), "fort_myers");
});
