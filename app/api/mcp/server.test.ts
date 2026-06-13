import { describe, it, expect, beforeAll } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildMcpServer } from "./server";
import type { LocationDossier } from "@/lib/zip-dossier";
import { type GeographyGazetteer, resolvePlaceZip } from "@/refinery/lib/geography-gazetteer.mts";

/**
 * D1 — the `swfl_fetch` location fan-out. A ZIP with no pinned (non-master)
 * report must return the SAME multi-brain dossier the GET /api/z/{zip} route
 * serves, NOT just the single housing row. A pinned non-master report keeps the
 * back-compat single-brain detail-row path.
 *
 * These are integration tests: the handler reads the real `brains/*.md` on disk
 * through `assembleLocationDossier`, so the asserted shapes track the live lake.
 */

type ToolHandler = (args: { report_id?: string; tier?: 1 | 2 | 3; zip?: string }) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
  _meta?: {
    freshness_token?: string;
    dossier?: LocationDossier;
    geography?: GeographyGazetteer;
  };
}>;

/** Capture the `swfl_fetch` handler `buildMcpServer` registers on a fake
 *  McpServer. buildMcpServer now registers four tools (swfl_fetch + three
 *  project write tools), so capture by name rather than last-write-wins. */
function captureHandler(): ToolHandler {
  const byName = new Map<string, ToolHandler>();
  const fake = {
    registerTool(name: string, _config: unknown, cb: ToolHandler) {
      byName.set(name, cb);
    },
  } as unknown as McpServer;
  buildMcpServer(fake);
  const handler = byName.get("swfl_fetch");
  if (!handler) throw new Error("buildMcpServer did not register swfl_fetch");
  return handler;
}

describe("swfl_fetch — D1 location fan-out", () => {
  let handler: ToolHandler;
  beforeAll(() => {
    handler = captureHandler();
  });

  it("(1) zip=33931, no report_id → multi-brain grain-labeled dossier (not just housing)", async () => {
    const res = await handler({ zip: "33931" });
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;

    // True-ZIP answer present...
    expect(text).toContain("ZIP 33931");
    // ...AND labeled non-ZIP coverage lines (only the fan-out emits these; the
    // old single-housing path never did) — proves it is multi-brain.
    expect(text).toContain("covers 33931");

    // The structured dossier carries many covering reads, not one.
    const dossier = res._meta?.dossier;
    expect(dossier).toBeDefined();
    expect(dossier!.lines.length).toBeGreaterThan(1);
    // More than one distinct brain answered.
    expect(new Set(dossier!.lines.map((l) => l.brain_id)).size).toBeGreaterThan(1);
    // A representative freshness token is surfaced for capable hosts.
    expect(res._meta?.freshness_token).toMatch(/^SWFL-/);
  });

  it("(2) zip=33908 → includes a corridor line labeled corridor-grain", async () => {
    const res = await handler({ zip: "33908" });
    expect(res.isError).toBeFalsy();
    const dossier = res._meta?.dossier;
    expect(dossier).toBeDefined();
    const corridorLines = dossier!.lines.filter((l) => l.grain === "corridor");
    expect(corridorLines.length).toBeGreaterThan(0);
    // The corridor line is labeled at corridor grain (never as a bare ZIP).
    expect(corridorLines[0].is_true_zip).toBe(false);
    expect(corridorLines[0].coverage_label).toContain("covers 33908");
  });

  it("(3) report_id=master is treated as 'no pin' → fan-out, not the drill", async () => {
    const res = await handler({ zip: "33931", report_id: "master" });
    expect(res.isError).toBeFalsy();
    // Fan-out path always attaches the structured location dossier.
    expect(res._meta?.dossier).toBeDefined();
    expect(res._meta?.dossier?.lines.length).toBeGreaterThan(1);
  });

  it("(4) pinned non-master report_id → single-brain drill (back-compat, no location dossier)", async () => {
    const res = await handler({ zip: "33913", report_id: "housing-swfl" });
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    // The single housing row for 33913...
    expect(text).toContain("33913");
    // ...with NO multi-brain county-rollup labels (those are fan-out only).
    expect(text).not.toContain("county-wide — covers");
    // The drill path returns the lean _meta (token + rules), never the
    // location dossier — the discriminator between the two paths.
    expect(res._meta?.dossier).toBeUndefined();
  });

  it("(5) out-of-scope ZIP → honest 'outside footprint' text, no lines", async () => {
    const res = await handler({ zip: "90210" });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text.toLowerCase()).toContain("outside");
    expect(res._meta?.dossier?.lines.length).toBe(0);
  });
});

/**
 * Anti-gloss guard — the served payload must carry the deterministic ZIP↔place
 * crosswalk in `_meta.geography`, so a DOWNSTREAM Claude resolves a SWFL place
 * from ground truth instead of glossing it from its own weights. The bug class:
 * ZIP 33931 is "Fort Myers Beach"; a model naming it from memory has mislabeled
 * it "Lehigh Acres" (which is 33936). With the crosswalk in the payload, that
 * cannot happen. These assert the crosswalk is PRESENT on the `_meta`-bearing
 * paths — they do NOT change the payload shape (read-only regression lock).
 *
 * Truth values come from `resolvePlaceZip` (the gazetteer's own resolver) — no
 * hardcoded ZIP↔place pairs in this test.
 */
describe("swfl_fetch — _meta.geography carries the ZIP↔place crosswalk", () => {
  let handler: ToolHandler;
  beforeAll(() => {
    handler = captureHandler();
  });

  // The exact gloss the bug class produces, resolved from the gazetteer itself.
  const fmb = resolvePlaceZip("Fort Myers Beach");
  const lehigh = resolvePlaceZip("Lehigh Acres");

  it("the crosswalk resolver itself separates 33931 (FMB) from 33936 (Lehigh)", () => {
    // Sanity-guard the fixture the payload ships — if these flip, the gloss the
    // downstream model would otherwise make is exactly what's at stake.
    expect(fmb?.zip).toBe("33931");
    expect(fmb?.place).toBe("Fort Myers Beach");
    expect(lehigh?.zip).toBe("33936");
    expect(lehigh?.place).toBe("Lehigh Acres");
  });

  it("(in-scope ZIP fan-out) _meta.geography.place_zip_crosswalk holds ZIP↔place entries", async () => {
    const res = await handler({ zip: "33931" });
    expect(res.isError).toBeFalsy();

    const crosswalk = res._meta?.geography?.place_zip_crosswalk;
    expect(crosswalk).toBeDefined();
    expect(Array.isArray(crosswalk!.entries)).toBe(true);
    expect(crosswalk!.entries.length).toBeGreaterThan(0);

    // Every entry pairs a real ZIP with a place name (the moat: a model can't
    // invent the mapping when the sourced pair rides in the payload).
    const byZip = new Map(crosswalk!.entries.map((e) => [e.zip, e.place]));
    expect(byZip.get("33931")).toBe("Fort Myers Beach");
    expect(byZip.get("33936")).toBe("Lehigh Acres");

    // The crosswalk is sourced (not LLM knowledge) — provenance travels too.
    const fmbEntry = crosswalk!.entries.find((e) => e.zip === "33931");
    expect(fmbEntry?.source).toBeTruthy();
  });

  it("(in-scope ZIP fan-out, report_id=master) the crosswalk still rides in _meta", async () => {
    const res = await handler({ zip: "33931", report_id: "master" });
    expect(res.isError).toBeFalsy();
    const entries = res._meta?.geography?.place_zip_crosswalk?.entries;
    expect(entries?.some((e) => e.zip === "33931" && e.place === "Fort Myers Beach")).toBe(true);
  });
});
