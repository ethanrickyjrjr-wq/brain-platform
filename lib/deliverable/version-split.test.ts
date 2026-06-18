import { test, expect } from "bun:test";
import { splitDeliverableVersions, type Versioned } from "./version-split";

const row = (
  id: string,
  supersedes_id: string | null = null,
  deleted_at: string | null = null,
): Versioned => ({
  id,
  supersedes_id,
  deleted_at,
});

test("empty → no heads, no trashed", () => {
  expect(splitDeliverableVersions([])).toEqual({ heads: [], trashed: [] });
});

test("single original → one head with no versions", () => {
  const { heads, trashed } = splitDeliverableVersions([row("a")]);
  expect(heads.map((h) => h.id)).toEqual(["a"]);
  expect(heads[0].versions).toEqual([]);
  expect(trashed).toEqual([]);
});

test("trashed row → goes to trashed, not heads", () => {
  const { heads, trashed } = splitDeliverableVersions([row("a", null, "2026-06-17T00:00:00Z")]);
  expect(heads).toEqual([]);
  expect(trashed.map((t) => t.id)).toEqual(["a"]);
});

test("chain v3→v2→v1 (all live) → one head v3 with versions [v2, v1]", () => {
  // newest-first load order
  const rows = [row("v3", "v2"), row("v2", "v1"), row("v1", null)];
  const { heads } = splitDeliverableVersions(rows);
  expect(heads.map((h) => h.id)).toEqual(["v3"]);
  expect(heads[0].versions.map((v) => v.id)).toEqual(["v2", "v1"]);
});

test("trashing the newest version promotes the prior live version to a head", () => {
  const rows = [
    row("v3", "v2", "2026-06-17T00:00:00Z"), // newest, trashed
    row("v2", "v1"),
    row("v1", null),
  ];
  const { heads, trashed } = splitDeliverableVersions(rows);
  expect(trashed.map((t) => t.id)).toEqual(["v3"]);
  expect(heads.map((h) => h.id)).toEqual(["v2"]);
  expect(heads[0].versions.map((v) => v.id)).toEqual(["v1"]);
});

test("two independent live originals → two heads", () => {
  const { heads } = splitDeliverableVersions([row("b"), row("a")]);
  expect(heads.map((h) => h.id)).toEqual(["b", "a"]);
  expect(heads.every((h) => h.versions.length === 0)).toBe(true);
});

test("a head whose older version is trashed → head with no live versions", () => {
  const rows = [row("v2", "v1"), row("v1", null, "2026-06-17T00:00:00Z")];
  const { heads, trashed } = splitDeliverableVersions(rows);
  expect(heads.map((h) => h.id)).toEqual(["v2"]);
  expect(heads[0].versions).toEqual([]);
  expect(trashed.map((t) => t.id)).toEqual(["v1"]);
});

test("branched lineage (two live rows supersede the same ancestor) attaches it once", () => {
  // diamond: both v3 and v2 supersede v1 (reachable only via a crafted non-head edit)
  const rows = [row("v3", "v1"), row("v2", "v1"), row("v1", null)];
  const { heads } = splitDeliverableVersions(rows);
  // both remain heads, but v1 is attached to exactly one (the newest), never duplicated
  const attachments = heads.flatMap((h) => h.versions.map((v) => v.id));
  expect(attachments).toEqual(["v1"]);
  expect(heads.find((h) => h.id === "v3")?.versions.map((v) => v.id)).toEqual(["v1"]);
  expect(heads.find((h) => h.id === "v2")?.versions).toEqual([]);
});

test("corrupted cycle does not infinite-loop", () => {
  const rows = [row("a", "b"), row("b", "a")];
  const { heads } = splitDeliverableVersions(rows);
  // both are superseded by a live row → neither is a head; no hang
  expect(heads).toEqual([]);
});
