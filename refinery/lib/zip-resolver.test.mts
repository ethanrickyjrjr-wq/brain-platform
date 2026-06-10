import { describe, expect, it } from "vitest";
import { resolveZip } from "./zip-resolver.mts";

describe("zip-resolver §A spine", () => {
  // ---- Honesty rule: grain is the ZIP; place is human context ----
  it("33913 = Gateway primary + Fort Myers alt → primary-before-alt, Gateway gains corridors via the Fort Myers alt", () => {
    const r = resolveZip("33913");
    expect(r.in_scope).toBe(true);
    expect(r.primary_county).toBe("12071");
    expect(r.county_names).toEqual(["Lee"]);
    // primary before alt, deterministic order
    expect(r.places.map((p) => [p.place, p.match])).toEqual([
      ["Gateway", "primary"],
      ["Fort Myers", "alt"],
    ]);
    // Gateway has no pocket, but the co-resolved Fort Myers alt carries the corridors
    expect(r.corridors.length).toBeGreaterThan(0);
    expect(r.corridors.every((c) => c.pocket === "Fort Myers")).toBe(true);
    expect(r.corridors.map((c) => c.corridor_id)).toContain("cleveland-ave-fort-myers");
    // every place carries its sourced provenance (never an invented ZIP)
    expect(r.places[0].source).toMatch(/USPS/i);
  });

  // ---- Honesty rule: 34134 is alt of BOTH Estero and Bonita Springs; can't flap ----
  it("34134 → alt of both Estero & Bonita Springs in deterministic crosswalk order, and is a genuine 2-county straddler", () => {
    const r = resolveZip("34134");
    expect(r.places.map((p) => p.place)).toEqual(["Estero", "Bonita Springs"]);
    expect(r.places.every((p) => p.match === "alt")).toBe(true);
    // genuine straddle: counties.length === 2, primary is Lee
    expect(r.counties).toEqual(["12071", "12021"]);
    expect(r.primary_county).toBe("12071");
    // determinism: identical on repeat (no flapping)
    expect(resolveZip("34134")).toEqual(r);
  });

  // ---- Honesty rule: Immokalee 34142 → in scope but in NO pocket → corridors:[] + a note ----
  it("34142 Immokalee → in scope, primary Collier, no corridors + a note", () => {
    const r = resolveZip("34142");
    expect(r.in_scope).toBe(true);
    expect(r.primary_county).toBe("12021");
    expect(r.corridors).toEqual([]);
    expect(r.resolution_notes).toContain("No retail-corridor profile covers this ZIP.");
  });

  // ---- Honesty rule: county-spanning ZIP → counties.length === 2 (and pop-override holds) ----
  it("33936 Lehigh Acres → 2-county straddle [Lee, Hendry] with primary corrected to Lee (population override)", () => {
    const r = resolveZip("33936");
    expect(r.counties).toEqual(["12071", "12051"]);
    expect(r.counties.length).toBe(2);
    // land-area alone would rank Hendry first; SOURCED.md override keeps Lee primary
    expect(r.primary_county).toBe("12071");
  });

  // ---- Honesty rule: needs_verification surfaces; and does NOT fire spuriously ----
  it("does not emit a needs_verification note for a clean entry (all current crosswalk entries are false)", () => {
    const r = resolveZip("33913");
    expect(r.resolution_notes.some((n) => n.includes("needs_verification"))).toBe(false);
  });

  // ---- Honesty rule + Pushback-1: out-of-scope ZIP → in_scope:false, everything empty ----
  it("33101 Miami → out of scope, empty places/corridors, null barrier", () => {
    const r = resolveZip("33101");
    expect(r.in_scope).toBe(false);
    expect(r.counties).toEqual([]);
    expect(r.primary_county).toBeNull();
    expect(r.places).toEqual([]);
    expect(r.corridors).toEqual([]);
    expect(r.barrier).toEqual({ classification: null, score: null, name: null });
    expect(r.resolution_notes.join(" ")).toMatch(/outside the 6-county/i);
  });

  // ---- Pushback-1: real SWFL ZIPs absent from the 11-place crosswalk still resolve ----
  it("33924 Captiva → in scope Lee (absent from place crosswalk) and barrier-classified via swfl-geo", () => {
    const r = resolveZip("33924");
    expect(r.in_scope).toBe(true);
    expect(r.primary_county).toBe("12071");
    expect(r.places).toEqual([]); // not in the 11-place crosswalk
    // barrier comes from a different source (swfl-geo) and IS present for Captiva
    expect(r.barrier.classification).toBe("barrier");
    expect(r.barrier.score).toBe(1.0);
    expect(r.barrier.name).toBe("Captiva");
  });

  it("33903 N. Fort Myers → in scope Lee, absent from the place crosswalk", () => {
    const r = resolveZip("33903");
    expect(r.in_scope).toBe(true);
    expect(r.primary_county).toBe("12071");
    expect(r.places).toEqual([]);
  });

  // ---- G6: an in-scope ZIP absent from the barrier table NEVER yields "inland" ----
  it("G6 — 33936 (in scope, absent from barrier table) → barrier null, NEVER 'inland'", () => {
    const r = resolveZip("33936");
    expect(r.barrier.classification).not.toBe("inland");
    expect(r.barrier).toEqual({ classification: null, score: null, name: null });
    expect(r.resolution_notes).toContain(
      "Barrier-island flood classification not assessed for this ZIP.",
    );
  });

  it("a real barrier ZIP (33931 Fort Myers Beach) reports its true classification", () => {
    const r = resolveZip("33931");
    expect(r.in_scope).toBe(true);
    expect(r.primary_county).toBe("12071");
    expect(r.barrier).toEqual({
      classification: "barrier",
      score: 1.0,
      name: "Fort Myers Beach",
    });
  });

  // ---- Naples: a Naples ZIP attaches all three Naples pockets ("Naples-area") ----
  it("34109 (Naples alt) → corridors span all three Naples pockets + a Naples-area note", () => {
    const r = resolveZip("34109");
    expect(r.primary_county).toBe("12021");
    const pockets = new Set(r.corridors.map((c) => c.pocket));
    expect(pockets).toEqual(new Set(["Downtown Naples", "North Naples", "East Naples"]));
    // 1 (Downtown) + 5 (North) + 3 (East) = 9 corridors, de-duplicated
    expect(r.corridors.length).toBe(9);
    expect(r.resolution_notes.join(" ")).toMatch(/Naples area/i);
    // 34109 IS in the barrier table (North Naples, inland record present) — a real
    // record, so "inland" here is honest (G6 only bans the default when record is null)
    expect(r.barrier.classification).toBe("inland");
  });

  // ---- Scope is sourced, 6-county, not Lee+Collier-only: a Charlotte ZIP resolves ----
  it("33950 Punta Gorda → in scope Charlotte (6-county footprint, no place/corridor)", () => {
    const r = resolveZip("33950");
    expect(r.in_scope).toBe(true);
    expect(r.primary_county).toBe("12015");
    expect(r.county_names).toEqual(["Charlotte"]);
    expect(r.corridors).toEqual([]);
  });

  // ---- Input hygiene ----
  it("tolerates surrounding whitespace and reflects the trimmed zip", () => {
    const r = resolveZip("  33931 ");
    expect(r.zip).toBe("33931");
    expect(r.in_scope).toBe(true);
  });
});
