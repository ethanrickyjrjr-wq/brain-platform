import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  POCKETS,
  POCKET_COUNTY,
  pocketFor,
  corridorsInPocket,
  allPockets,
} from "./pockets.mts";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "..", "..", "fixtures");

interface CentroidRow {
  corridor_id: string;
  county?: "lee" | "collier";
}

const centroids: CentroidRow[] = JSON.parse(
  readFileSync(path.join(FIXTURES_DIR, "corridor-centroids.json"), "utf-8"),
);

describe("pockets", () => {
  it("every centroid corridor_id is in exactly one pocket", () => {
    const assignmentCount = new Map<string, number>();
    for (const ids of Object.values(POCKETS)) {
      for (const id of ids) {
        assignmentCount.set(id, (assignmentCount.get(id) ?? 0) + 1);
      }
    }
    const orphans = centroids
      .map((c) => c.corridor_id)
      .filter((id) => !assignmentCount.has(id));
    const doubles = [...assignmentCount.entries()]
      .filter(([, n]) => n > 1)
      .map(([id]) => id);
    expect({ orphans, doubles }).toEqual({ orphans: [], doubles: [] });
  });

  it("no pocket references a corridor_id that is not a real centroid", () => {
    const realIds = new Set(centroids.map((c) => c.corridor_id));
    const phantom = Object.values(POCKETS)
      .flat()
      .filter((id) => !realIds.has(id));
    expect(phantom).toEqual([]);
  });

  it("pocket totals add up to all 26 corridors", () => {
    const total = Object.values(POCKETS).reduce((n, ids) => n + ids.length, 0);
    expect(total).toBe(centroids.length);
    expect(total).toBe(26);
  });

  it("a pocket's county matches its corridors' centroid county", () => {
    const countyById = new Map(centroids.map((c) => [c.corridor_id, c.county]));
    const mismatches: string[] = [];
    for (const pocket of allPockets()) {
      for (const id of corridorsInPocket(pocket)) {
        if (countyById.get(id) !== POCKET_COUNTY[pocket]) {
          mismatches.push(`${id} in ${pocket}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("pocketFor round-trips known slugs and rejects unknown", () => {
    expect(pocketFor("vanderbilt-beach-rd-mercato")).toBe("North Naples");
    expect(pocketFor("tamiami-naples")).toBe("East Naples");
    expect(pocketFor("cleveland-ave-fort-myers")).toBe("Fort Myers");
    expect(pocketFor("not-a-real-slug")).toBeUndefined();
  });
});
