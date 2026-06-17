import { describe, it, expect } from "bun:test";
import { deriveProjectName } from "./derive-name";
import type { ProjectItem } from "./items";

const base = { id: "x", added_at: "2026-06-17T08:00:00Z", origin: "web" as const };

describe("deriveProjectName", () => {
  it("resolves a ZIP in report_id to its full place name + the ZIP", () => {
    const items: ProjectItem[] = [
      {
        ...base,
        kind: "qa",
        report_id: "33931",
        question: "What is the annual flood loss here?",
        answer: "About $30,074/yr.",
      },
    ];
    // 33931 is Fort Myers Beach (NOT Lehigh Acres) — grounded crosswalk lookup.
    expect(deriveProjectName(items)).toBe("Fort Myers Beach 33931");
  });

  it("extracts a ZIP embedded in a slug like FMB-33931", () => {
    const items: ProjectItem[] = [{ ...base, kind: "report", slug: "FMB-33931" }];
    expect(deriveProjectName(items)).toBe("Fort Myers Beach 33931");
  });

  it("picks the most-frequent ZIP across items", () => {
    const items: ProjectItem[] = [
      { ...base, id: "a", kind: "report", slug: "33901" },
      { ...base, id: "b", kind: "report", slug: "33901" },
      { ...base, id: "c", kind: "report", slug: "33931" },
    ];
    expect(deriveProjectName(items)).toBe("Fort Myers 33901");
  });

  it("falls back to a place NAME + topic when no ZIP is present", () => {
    const items: ProjectItem[] = [{ ...base, kind: "note", text: "Naples rental comps to review" }];
    expect(deriveProjectName(items)).toBe("Naples Rentals");
  });

  it("uses 'SWFL {topic}' when only a topic is detectable", () => {
    const items: ProjectItem[] = [{ ...base, kind: "report", slug: "permits-swfl" }];
    expect(deriveProjectName(items)).toBe("SWFL Permits");
  });

  it("prefers the most specific place name (Fort Myers Beach over Fort Myers)", () => {
    const items: ProjectItem[] = [
      { ...base, kind: "note", text: "Fort Myers Beach waterfront notes" },
    ];
    expect(deriveProjectName(items)).toBe("Fort Myers Beach");
  });

  it("dates the fallback (UTC) when nothing is detectable", () => {
    const items: ProjectItem[] = [{ ...base, kind: "note", text: "misc thoughts" }];
    expect(deriveProjectName(items)).toBe("Project Jun 17, 2026");
  });

  it("returns 'Untitled project' for an empty project", () => {
    expect(deriveProjectName([])).toBe("Untitled project");
  });

  it("does not read a decimal (e.g. cap rate 33901.5) as a ZIP", () => {
    const items: ProjectItem[] = [{ ...base, kind: "note", text: "cap rate 33901.5 here" }];
    // 33901.5 is rejected as a ZIP; the topic (cap rate → CRE) drives the name.
    expect(deriveProjectName(items)).toBe("SWFL CRE");
  });

  it("does not read a bare 5-digit dollar figure (30074) as a ZIP", () => {
    const items: ProjectItem[] = [{ ...base, kind: "note", text: "rent estimate 30074 monthly" }];
    // 30074 resolves to no SWFL place → not counted; "rent" topic wins.
    expect(deriveProjectName(items)).toBe("SWFL Rentals");
  });

  it("does not mistake an ordinary word for a place ('landscape' ≠ Cape Coral)", () => {
    const items: ProjectItem[] = [{ ...base, kind: "note", text: "office landscape redesign" }];
    expect(deriveProjectName(items)).toBe("Project Jun 17, 2026");
  });
});
