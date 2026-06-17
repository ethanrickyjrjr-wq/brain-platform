import { describe, it, expect } from "bun:test";
import { projectScopeSet, zipsForPlace } from "./project-scope";
import type { ProjectItem } from "./items";

const base = { id: "x", added_at: "2026-06-17T08:00:00Z", origin: "web" as const };

// --- zipsForPlace ---

describe("zipsForPlace", () => {
  it("returns primary + alt ZIPs for a known place (case-insensitive)", () => {
    const zips = zipsForPlace("Lehigh Acres");
    expect(zips).toContain("33936"); // primary
    expect(zips).toContain("33971");
    expect(zips).toContain("33972");
    expect(zips).toContain("33973");
    expect(zips).toContain("33974");
    expect(zips).toContain("33976");
  });

  it("matches lowercase input", () => {
    const zips = zipsForPlace("lehigh acres");
    expect(zips).toContain("33936");
  });

  it("matches an alias ('lehigh')", () => {
    const zips = zipsForPlace("lehigh");
    expect(zips).toContain("33936");
  });

  it("returns [] for an unknown place", () => {
    expect(zipsForPlace("Atlantis")).toEqual([]);
  });

  it("returns primary ZIP for a single-ZIP place (Fort Myers Beach)", () => {
    const zips = zipsForPlace("Fort Myers Beach");
    expect(zips).toContain("33931");
  });
});

// --- projectScopeSet ---

describe("projectScopeSet", () => {
  it("returns [] for empty items", () => {
    expect(projectScopeSet([])).toEqual([]);
  });

  it("returns a zip scope for a zip-only project", () => {
    const items: ProjectItem[] = [
      {
        ...base,
        kind: "qa",
        report_id: "33931",
        question: "Flood loss?",
        answer: "$30k",
      },
    ];
    const scopes = projectScopeSet(items);
    expect(scopes).toContainEqual({ scope_kind: "zip", scope_value: "33931" });
    // Only one scope (no place inferred separately when zip is the signal)
    expect(scopes.length).toBe(1);
  });

  it("returns place scope + ZIP scopes for a place-only project (Lehigh Acres)", () => {
    const items: ProjectItem[] = [{ ...base, kind: "note", text: "Lehigh Acres rental notes" }];
    const scopes = projectScopeSet(items);
    // place scope entry
    expect(scopes).toContainEqual({ scope_kind: "place", scope_value: "lehigh acres" });
    // all ZIPs for Lehigh Acres
    expect(scopes).toContainEqual({ scope_kind: "zip", scope_value: "33936" });
    expect(scopes).toContainEqual({ scope_kind: "zip", scope_value: "33971" });
  });

  it("returns no scope for topic-only project", () => {
    const items: ProjectItem[] = [{ ...base, kind: "report", slug: "permits-swfl" }];
    const scopes = projectScopeSet(items);
    expect(scopes).toEqual([]);
  });

  it("deduplicates when the inferred ZIP equals the place's primary ZIP", () => {
    // A project about Fort Myers Beach where the ZIP 33931 was inferred.
    // inferScopeFromItems returns {zip:'33931', place:'Fort Myers Beach'}
    // In the zip branch we only emit one zip scope — ensure no dup.
    const items: ProjectItem[] = [
      {
        ...base,
        kind: "qa",
        report_id: "33931",
        question: "flood?",
        answer: "yes",
      },
    ];
    const scopes = projectScopeSet(items);
    const zipScopes = scopes.filter((s) => s.scope_kind === "zip" && s.scope_value === "33931");
    expect(zipScopes.length).toBe(1);
  });

  it("scope_values are lowercase+trimmed", () => {
    const items: ProjectItem[] = [{ ...base, kind: "note", text: "Naples flood risk" }];
    const scopes = projectScopeSet(items);
    for (const s of scopes) {
      expect(s.scope_value).toBe(s.scope_value.toLowerCase().trim());
    }
  });

  it("place-scoped project: Naples → place scope + Naples ZIP(s)", () => {
    const items: ProjectItem[] = [{ ...base, kind: "note", text: "Naples rental comps to review" }];
    const scopes = projectScopeSet(items);
    expect(scopes).toContainEqual({ scope_kind: "place", scope_value: "naples" });
    // Naples has at least one ZIP in the crosswalk
    const zipScopes = scopes.filter((s) => s.scope_kind === "zip");
    expect(zipScopes.length).toBeGreaterThan(0);
  });
});
