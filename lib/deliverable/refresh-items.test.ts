import { test, expect } from "bun:test";
import { refreshItemSet } from "./refresh-items";
import type { ProjectItem } from "../project/items";

const item = (id: string): ProjectItem =>
  ({
    id,
    added_at: "2026-06-10T00:00:00Z",
    origin: "web",
    kind: "note",
    text: `note ${id}`,
  }) as ProjectItem;

test("returns the project items matching the snapshot, in snapshot order", () => {
  const project = [item("c"), item("a"), item("b")];
  const snapshot = [{ id: "a" }, { id: "b" }, { id: "c" }];
  expect(refreshItemSet(project, snapshot).map((i) => i.id)).toEqual(["a", "b", "c"]);
});

test("drops snapshot items the project no longer holds", () => {
  const project = [item("a"), item("c")];
  const snapshot = [{ id: "a" }, { id: "b" }, { id: "c" }];
  expect(refreshItemSet(project, snapshot).map((i) => i.id)).toEqual(["a", "c"]);
});

test("returns [] when the project holds none of the snapshot's items", () => {
  const project = [item("x"), item("y")];
  const snapshot = [{ id: "a" }, { id: "b" }];
  expect(refreshItemSet(project, snapshot)).toEqual([]);
});

test("returns [] for an empty snapshot", () => {
  expect(refreshItemSet([item("a")], [])).toEqual([]);
});

test("returns the LIVE project item object (so frame binding params are preserved)", () => {
  const frame: ProjectItem = {
    id: "f1",
    added_at: "2026-06-10T00:00:00Z",
    origin: "web",
    kind: "frame",
    brain_id: "rentals-swfl",
    frame_id: "rent-index",
    metric_keys: ["rent_index_latest"],
    title: "Rents",
  } as ProjectItem;
  const out = refreshItemSet([frame], [{ id: "f1" }]);
  expect(out[0]).toBe(frame); // same reference — full recipe intact
});
