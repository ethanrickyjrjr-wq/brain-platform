import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildSnapshot } from "./permits-swfl.mts";
import { permitsSwfl } from "./permits-swfl.mts";
import type {
  LeePermitRow,
  NormalizedPermitRow,
} from "../sources/permits-source.mts";
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

function leeToNormalized(row: LeePermitRow): NormalizedPermitRow {
  return {
    permit_uid: `lee:${row.permit_id}`,
    county: "lee",
    issued_date: row.issued_date,
    bucket: row.bucket,
    address: row.address,
    zip_code: row.zip_code,
    lat: row.lat,
    lon: row.lon,
    declared_value_usd: row.declared_value_usd,
    status: row.status,
    permit_type_raw: row.permit_type_raw,
    permit_description_raw: row.permit_description_raw,
  };
}

function loadFixtures(): {
  permits: NormalizedPermitRow[];
  rawLee: LeePermitRow[];
  corridors: CorridorCentroid[];
} {
  const rawLee: LeePermitRow[] = JSON.parse(
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
  return { permits: rawLee.map(leeToNormalized), rawLee, corridors };
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
      expect(["lee", "collier"]).toContain(cell.county);
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

  it("emits SWFL + Lee + Collier saturation indices in [0, 1]", () => {
    const { permits, corridors } = loadFixtures();
    const snap = buildSnapshot(permits, corridors, NOW);
    for (const v of [
      snap.swfl_saturation_index,
      snap.lee_saturation_index,
      snap.collier_saturation_index,
    ]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("emits a finite SWFL + Lee weighted z (Collier 0 when only Lee fixture supplied)", () => {
    const { permits, corridors } = loadFixtures();
    const snap = buildSnapshot(permits, corridors, NOW);
    expect(Number.isFinite(snap.swfl_weighted_z)).toBe(true);
    expect(Number.isFinite(snap.lee_weighted_z)).toBe(true);
    expect(Number.isFinite(snap.collier_weighted_z)).toBe(true);
    // Lee-only fixture should yield zero Collier rows and a zero Collier weighted z.
    expect(snap.collier_row_count).toBe(0);
    expect(snap.collier_weighted_z).toBe(0);
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

  it("returns BrainOutputProducerResult with locked-enum direction + Lee + SWFL metrics", () => {
    const { permits, rawLee } = loadFixtures();

    const fragments = rawLee.map((r, i) => ({
      fragment_id: `lee_building_permits::${r.permit_id}`,
      source_id: "lee_building_permits",
      source_trust_tier: 1 as const,
      fetched_at: NOW.toISOString(),
      raw: {
        permit_id: r.permit_id,
        issued_date: r.issued_date,
        bucket: r.bucket,
      },
      normalized: permits[i],
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
    expect(
      result.key_metrics.some(
        (m) => m.metric === "permits_swfl_saturation_index",
      ),
    ).toBe(true);
    expect(
      result.key_metrics.some(
        (m) => m.metric === "permits_swfl_county_weighted_avg_corridor_z",
      ),
    ).toBe(true);
    // Collier metrics should be absent when the Lee-only fixture is loaded.
    expect(
      result.key_metrics.some(
        (m) => m.metric === "permits_collier_county_weighted_avg_corridor_z",
      ),
    ).toBe(false);
  });
});

describe("permitsSidecarProducer (via pack)", () => {
  beforeAll(() => {
    process.env.REFINERY_SOURCE = "fixture";
  });
  afterAll(() => {
    delete process.env.REFINERY_SOURCE;
  });

  it("emits per-corridor headline_z weighted by n_current across non-other buckets", async () => {
    const { permits, rawLee } = loadFixtures();
    const fragments = rawLee.map((r, i) => ({
      fragment_id: `lee_building_permits::${r.permit_id}`,
      source_id: "lee_building_permits",
      source_trust_tier: 1 as const,
      fetched_at: new Date().toISOString(),
      raw: {
        permit_id: r.permit_id,
        issued_date: r.issued_date,
        bucket: r.bucket,
      },
      normalized: permits[i],
    }));
    permitsSwfl.corpusSummary!(fragments);

    const sidecars = await permitsSwfl.sidecarProducer!({} as never, fragments);
    expect(sidecars).toHaveLength(1);
    expect(sidecars[0].name).toBe("corridor-permits");

    const rows = sidecars[0].data as Array<{
      corridor_id: string;
      headline_z: number;
      n_current: number;
      last_refined_at: string;
    }>;
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      expect(typeof row.corridor_id).toBe("string");
      expect(Number.isFinite(row.headline_z)).toBe(true);
      expect(row.n_current).toBeGreaterThanOrEqual(10);
      expect(row.last_refined_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    // alphabetical, no duplicates
    const ids = rows.map((r) => r.corridor_id);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns empty array when no snapshot is available (Accela 0-fact run)", async () => {
    permitsSwfl.corpusSummary!([]);
    const sidecars = await permitsSwfl.sidecarProducer!({} as never, []);
    expect(sidecars).toEqual([]);
  });
});
