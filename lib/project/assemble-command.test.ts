import { describe, it, expect } from "bun:test";
import { planAssembly } from "./assemble-command";
import type { ProjectItemsRow } from "./cross-project-index";
import type { ProjectItem } from "./items";

const base = { id: "x", added_at: "2026-06-10T08:00:00Z", origin: "web" as const };

let n = 0;
function metric(label: string, reportId: string): ProjectItem {
  return {
    ...base,
    id: `m${n++}`,
    kind: "metric",
    report_id: reportId,
    label,
    value: "1",
    freshness_token: "SWFL-7421-v5-20260610",
  };
}
function proj(projectId: string, items: ProjectItem[]): ProjectItemsRow {
  return { projectId, title: projectId, items };
}

describe("planAssembly", () => {
  // The user has two 33931 projects + one 34104 project.
  const projects = [
    proj("luxury", [metric("Annual flood loss", "33931"), metric("Median rent", "33931")]),
    proj("starter", [metric("Annual flood loss", "33931"), metric("Permit count", "33931")]),
    proj("naples", [metric("Annual flood loss", "34104")]),
  ];

  it("pulls identity-deduped items from scope-matching projects only", () => {
    const plan = planAssembly(
      "build a project for 33931, pull from my existing projects",
      projects,
    );
    expect(plan.matched).toBe(true);
    expect(plan.scope.zip).toBe("33931");
    // flood (in both 33931 projects → once), rent, permits. The 34104 project contributes nothing.
    expect(
      plan.items.map((i) => (i as Extract<ProjectItem, { kind: "metric" }>).label).sort(),
    ).toEqual(["Annual flood loss", "Median rent", "Permit count"]);
    expect(plan.sourceProjectIds.sort()).toEqual(["luxury", "starter"]);
  });

  it("auto-names the new project from the pulled items", () => {
    const plan = planAssembly("build a project for 33931", projects);
    expect(plan.title).toBe("Fort Myers Beach 33931");
  });

  it("does not pull data from a different ZIP", () => {
    const plan = planAssembly("build a project for 33931", projects);
    expect(plan.sourceProjectIds).not.toContain("naples");
  });

  it("returns an unmatched, empty plan when the command names no scope", () => {
    const plan = planAssembly("build me something useful", projects);
    expect(plan.matched).toBe(false);
    expect(plan.items).toHaveLength(0);
  });

  it("matches even when the user has no projects yet (empty plan, scope still parsed)", () => {
    const plan = planAssembly("build a project for 33931", []);
    expect(plan.scope.zip).toBe("33931");
    expect(plan.items).toHaveLength(0);
    expect(plan.matched).toBe(false);
  });
});
