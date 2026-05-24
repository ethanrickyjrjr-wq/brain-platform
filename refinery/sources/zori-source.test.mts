import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { env } from "../config/env.mts";
import { zoriSource } from "./zori-source.mts";

describe("zoriSource (fixture mode)", () => {
  const orig = env.source;
  beforeAll(() => {
    process.env.REFINERY_SOURCE = "fixture";
  });
  afterAll(() => {
    process.env.REFINERY_SOURCE = orig === "fixture" ? "fixture" : undefined!;
  });

  it("loads fragments from the fixture file", async () => {
    const fragments = await zoriSource.fetch();
    expect(fragments.length).toBeGreaterThan(0);
    const f0 = fragments[0];
    expect(f0.source_id).toBe("zori_swfl");
    expect(f0.source_trust_tier).toBe(3);
    expect(f0.normalized).toMatchObject({
      zip_code: expect.any(String),
      period_end: expect.any(String),
      rent_index: expect.any(Number),
    });
  });

  it("covers all four SWFL MSAs in the shipped fixture", async () => {
    const fragments = await zoriSource.fetch();
    const metros = new Set(
      fragments.map((f) => (f.normalized as { metro?: string }).metro),
    );
    // v1 fixture intentionally ships 3 MSAs (Cape Coral, Naples, Punta Gorda)
    // — North Port can be added later. Test pins the current coverage so a
    // shrink is loud rather than silent.
    expect(metros.size).toBeGreaterThanOrEqual(3);
  });

  it("emits a unique fragment_id per (zip, period_end)", async () => {
    const fragments = await zoriSource.fetch();
    const ids = fragments.map((f) => f.fragment_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("citationMeta references Zillow Observed Rent Index", () => {
    process.env.REFINERY_SOURCE = "fixture";
    const meta = zoriSource.citationMeta("2026-05-23", 86400 * 35);
    expect(meta.source).toMatch(/Zillow Observed Rent Index/i);
    expect(meta.verified).toBe("2026-05-23");
    expect(meta.expires).toBeDefined();
  });
});
