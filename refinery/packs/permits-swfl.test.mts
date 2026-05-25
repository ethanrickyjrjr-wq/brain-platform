import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildSnapshot } from "./permits-swfl.mts";
import { permitsSwfl } from "./permits-swfl.mts";
import type { LeePermitRow } from "../sources/permits-source.mts";
import type { CorridorCentroid } from "../lib/corridor-assignment.mts";
import { readFileSync } from "node:fs";
import path from "node:path";

const NOW = new Date("2026-05-22T00:00:00Z");
const TEST_FIXTURE_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "__fixtures__",
);
const PROD_FIXTURE_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "fixtures",
);

function loadFixtures(): {
  permits: LeePermitRow[];
  corridors: CorridorCentroid[];
} {
  const permits = JSON.parse(
    readFileSync(
      path.join(TEST_FIXTURE_DIR, "permits-swfl.sample.json"),
      "utf-8",
    ),
  );
  const corridors = JSON.parse(
    readFileSync(
      path.join(PROD_FIXTURE_DIR, "corridor-centroids.json"),
      "utf-8",
    ),
  );
  return { permits, corridors };
}

describe("permits-swfl buildSnapshot", () => {
  it("produces per-(corridor, bucket) cells with z-scores", () => {
    const { permits, corridors } = loadFixtures();
    const snap = buildSnapshot(permits, corridors, NOW);
    expect(snap.corridor_cells.length).toBeGreaterThan(0);
    for (const cell of snap.corridor_cells) {
      expect(cell.corridor_id).toBeTruthy();
      expect([
        "commercial_new",
        "commercial_alteration",
        "residential",
        "demolition",
        "other",
      ]).toContain(cell.bucket);
      expect(typeof cell.z).toBe("number");
      expect(Number.isFinite(cell.z)).toBe(true);
      expect(typeof cell.n_current).toBe("number");
    }
  });

  it("produces per-(zip, bucket) cells with z-scores", () => {
    const { permits, corridors } = loadFixtures();
    const snap = buildSnapshot(permits, corridors, NOW);
    expect(snap.zip_cells.length).toBeGreaterThan(0);
    for (const cell of snap.zip_cells) {
      expect(cell.zip_code).toMatch(/^\d{5}$/);
    }
  });

  it("emits a saturation_index in [0, 1]", () => {
    const { permits, corridors } = loadFixtures();
    const snap = buildSnapshot(permits, corridors, NOW);
    expect(snap.saturation_index).toBeGreaterThanOrEqual(0);
    expect(snap.saturation_index).toBeLessThanOrEqual(1);
  });

  it("emits a finite county_weighted_z", () => {
    const { permits, corridors } = loadFixtures();
    const snap = buildSnapshot(permits, corridors, NOW);
    expect(typeof snap.county_weighted_z).toBe("number");
    expect(Number.isFinite(snap.county_weighted_z)).toBe(true);
  });

  it("counts low-n cells for caveat aggregation", () => {
    const { permits, corridors } = loadFixtures();
    const snap = buildSnapshot(permits, corridors, NOW);
    expect(typeof snap.low_n_cell_count).toBe("number");
    expect(snap.low_n_cell_count).toBeGreaterThanOrEqual(0);
    expect(snap.total_cell_count).toBeGreaterThanOrEqual(snap.low_n_cell_count);
  });

  it("computes thin_corridor_share in [0, 1]", () => {
    const { permits, corridors } = loadFixtures();
    const snap = buildSnapshot(permits, corridors, NOW);
    expect(snap.thin_corridor_share).toBeGreaterThanOrEqual(0);
    expect(snap.thin_corridor_share).toBeLessThanOrEqual(1);
  });

  it("computes backfill_days from earliest issued_date in input", () => {
    const { permits, corridors } = loadFixtures();
    const snap = buildSnapshot(permits, corridors, NOW);
    expect(snap.backfill_days).toBeGreaterThan(0);
  });
});

describe("permitsOutputProducer (via pack)", () => {
  beforeAll(() => {
    process.env.REFINERY_SOURCE = "fixture";
  });
  afterAll(() => {
    delete process.env.REFINERY_SOURCE;
  });

  it("returns BrainOutputProducerResult with locked-enum direction", () => {
    const { permits, corridors } = loadFixtures();
    const snap = buildSnapshot(permits, corridors, NOW);

    // Manually drive corpusSummary to set lastSnapshot, then call outputProducer
    const fragments = permits.map((r) => ({
      fragment_id: `lee_building_permits::${r.permit_id}`,
      source_id: "lee_building_permits",
      source_trust_tier: 1 as const,
      fetched_at: NOW.toISOString(),
      raw: {
        permit_id: r.permit_id,
        issued_date: r.issued_date,
        bucket: r.bucket,
      },
      normalized: r,
    }));
    permitsSwfl.corpusSummary!(fragments);

    const result = permitsSwfl.outputProducer!({} as never);
    expect(["bullish", "bearish", "neutral", "mixed"]).toContain(
      result.direction,
    );
    expect(result.magnitude).toBeGreaterThanOrEqual(0);
    expect(result.magnitude).toBeLessThanOrEqual(1);
    expect(
      result.key_metrics.some(
        (m) => m.metric === "permits_lee_saturation_index",
      ),
    ).toBe(true);
    expect(
      result.key_metrics.some(
        (m) => m.metric === "permits_lee_county_weighted_avg_corridor_z",
      ),
    ).toBe(true);
    expect(result.caveats.length).toBeLessThanOrEqual(4);
  });
});
