import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { env } from "../config/env.mts";
import { permitsSource } from "./permits-source.mts";

describe("permitsSource (fixture mode)", () => {
  const orig = env.source;
  beforeAll(() => {
    process.env.REFINERY_SOURCE = "fixture";
  });
  afterAll(() => {
    process.env.REFINERY_SOURCE = orig === "fixture" ? "fixture" : undefined!;
  });

  it("loads fragments from the fixture file", async () => {
    const fragments = await permitsSource.fetch();
    expect(fragments.length).toBeGreaterThan(0);
    const f0 = fragments[0];
    expect(f0.source_id).toBe("lee_building_permits");
    expect(f0.source_trust_tier).toBe(1);
    expect(f0.normalized).toMatchObject({
      permit_id: expect.any(String),
      issued_date: expect.any(String),
      bucket: expect.any(String),
    });
  });

  it("citationMeta contains Lee County reference", () => {
    process.env.REFINERY_SOURCE = "fixture";
    const meta = permitsSource.citationMeta("2026-05-22", 86400);
    expect(meta.source).toContain("Lee County");
    expect(meta.verified).toBe("2026-05-22");
    expect(meta.expires).toBeDefined();
  });
});
