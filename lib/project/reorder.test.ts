import { describe, it, expect } from "bun:test";
import { reorderWithinKind } from "./reorder";
import type { ProjectItem } from "./items";

const base = { added_at: "2026-06-17T00:00:00Z", origin: "web" as const };
function note(id: string): ProjectItem {
  return { ...base, id, kind: "note", text: id };
}
function metric(id: string): ProjectItem {
  return {
    ...base,
    id,
    kind: "metric",
    report_id: "env-swfl",
    label: id,
    value: "1",
    freshness_token: "SWFL-7421-v5-20260610",
  };
}
const ids = (xs: ProjectItem[]) => xs.map((x) => x.id);

describe("reorderWithinKind", () => {
  it("moves an item down past its same-kind neighbor", () => {
    expect(ids(reorderWithinKind([metric("m1"), metric("m2")], "m1", 1))).toEqual(["m2", "m1"]);
  });

  it("moves an item up past its same-kind neighbor", () => {
    expect(ids(reorderWithinKind([metric("m1"), metric("m2")], "m2", -1))).toEqual(["m2", "m1"]);
  });

  it("is a no-op at the top of its kind", () => {
    expect(ids(reorderWithinKind([metric("m1"), metric("m2")], "m1", -1))).toEqual(["m1", "m2"]);
  });

  it("is a no-op at the bottom of its kind", () => {
    expect(ids(reorderWithinKind([metric("m1"), metric("m2")], "m2", 1))).toEqual(["m1", "m2"]);
  });

  it("skips a different-kind item to find the nearest same-kind neighbor", () => {
    const out = reorderWithinKind([metric("m1"), note("n1"), metric("m2")], "m1", 1);
    expect(ids(out)).toEqual(["m2", "n1", "m1"]);
  });

  it("returns the array unchanged for an unknown id", () => {
    const items = [metric("m1"), metric("m2")];
    expect(reorderWithinKind(items, "nope", 1)).toBe(items);
  });
});
