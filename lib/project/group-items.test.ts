import { describe, it, expect } from "bun:test";
import { groupItemsByKind } from "./group-items";
import type { ProjectItem } from "./items";

const base = { id: "x", added_at: "2026-06-17T00:00:00Z", origin: "web" as const };

function note(text: string, id = "n"): ProjectItem {
  return { ...base, id, kind: "note", text };
}
function metric(label: string, id = "m"): ProjectItem {
  return {
    ...base,
    id,
    kind: "metric",
    report_id: "env-swfl",
    label,
    value: "1",
    freshness_token: "SWFL-7421-v5-20260610",
  };
}
function qa(question: string, id = "q"): ProjectItem {
  return { ...base, id, kind: "qa", report_id: "env-swfl", question, answer: "a" };
}

describe("groupItemsByKind", () => {
  it("returns only the kinds that have items", () => {
    const groups = groupItemsByKind([note("hi"), metric("Rent")]);
    expect(groups.map((g) => g.kind)).toEqual(["metric", "note"]);
  });

  it("orders groups by the fixed kind sequence (not insertion order)", () => {
    // filed note → metric → qa, but the fixed order is qa, metric, …, note
    const groups = groupItemsByKind([note("hi"), metric("Rent"), qa("Why?")]);
    expect(groups.map((g) => g.kind)).toEqual(["qa", "metric", "note"]);
  });

  it("preserves input order within a group", () => {
    const groups = groupItemsByKind([metric("Rent", "m1"), metric("Value", "m2")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(["m1", "m2"]);
  });

  it("empty input → empty array", () => {
    expect(groupItemsByKind([])).toEqual([]);
  });
});
