import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CORRIDOR_ALIASES, aliasFor } from "./corridor-aliases.mts";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "..", "..", "fixtures");

interface RentRow {
  id: string;
}
interface CentroidRow {
  corridor_id: string;
}

const rentRows: RentRow[] = JSON.parse(
  readFileSync(path.join(FIXTURES_DIR, "corridor-rents.json"), "utf-8"),
);
const centroidRows: CentroidRow[] = JSON.parse(
  readFileSync(path.join(FIXTURES_DIR, "corridor-centroids.json"), "utf-8"),
);

describe("corridor-aliases coverage", () => {
  it("every alias key matches a corridor-rents.json id (no orphan aliases)", () => {
    const rentIds = new Set(rentRows.map((r) => r.id));
    const orphans = Object.keys(CORRIDOR_ALIASES).filter(
      (slug) => !rentIds.has(slug),
    );
    expect(orphans).toEqual([]);
  });

  it("every non-null alias value matches a corridor-centroids.json corridor_id (no orphan centroid pointers)", () => {
    const centroidIds = new Set(centroidRows.map((c) => c.corridor_id));
    const broken: string[] = [];
    for (const [slug, target] of Object.entries(CORRIDOR_ALIASES)) {
      if (target == null) continue;
      if (!centroidIds.has(target)) broken.push(`${slug} → ${target}`);
    }
    expect(broken).toEqual([]);
  });

  it("every corridor-rents.json row has an alias entry (no coverage holes)", () => {
    const aliasKeys = new Set(Object.keys(CORRIDOR_ALIASES));
    const missing = rentRows
      .map((r) => r.id)
      .filter((id) => !aliasKeys.has(id));
    expect(missing).toEqual([]);
  });

  it("every corridor-centroids.json entry is reachable from at least one alias", () => {
    const reachable = new Set(
      Object.values(CORRIDOR_ALIASES).filter((v): v is string => v != null),
    );
    const unreachable = centroidRows
      .map((c) => c.corridor_id)
      .filter((id) => !reachable.has(id));
    expect(unreachable).toEqual([]);
  });

  it("aliasFor returns string for a known Lee corridor", () => {
    expect(aliasFor("us-41-cleveland-ave-fort-myers")).toBe(
      "us-41-cleveland-ave-fort-myers",
    );
  });

  it("aliasFor returns null for a known Collier corridor (explicit no-coverage)", () => {
    expect(aliasFor("5th-ave-south-3rd-street-south")).toBeNull();
  });

  it("aliasFor returns undefined for an unknown slug (signals coverage hole, not no-coverage)", () => {
    expect(aliasFor("not-a-real-corridor-slug")).toBeUndefined();
  });
});
