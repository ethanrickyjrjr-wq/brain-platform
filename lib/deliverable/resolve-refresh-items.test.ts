import { test, expect } from "bun:test";
import { resolveRefreshItems } from "./resolve-refresh-items";
import type { SupabaseClient } from "@supabase/supabase-js";

function fakeDb(projectItems: unknown | "no-project"): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: projectItems === "no-project" ? null : { items: projectItems },
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const snapshot = [{ id: "a" }, { id: "b" }];
const liveItems = [
  { id: "a", added_at: "x", origin: "web", kind: "note", text: "A" },
  { id: "b", added_at: "x", origin: "web", kind: "note", text: "B" },
  { id: "c", added_at: "x", origin: "web", kind: "note", text: "C" },
];

test("returns the project items matching the snapshot, snapshot order", async () => {
  const out = (await resolveRefreshItems(fakeDb(liveItems), "p1", snapshot)) as { id: string }[];
  expect(out.map((i) => i.id)).toEqual(["a", "b"]);
});

test("falls back to the frozen snapshot when the project is gone", async () => {
  expect(await resolveRefreshItems(fakeDb("no-project"), "p1", snapshot)).toEqual(snapshot);
});

test("falls back to the snapshot when no items overlap", async () => {
  const noOverlap = [{ id: "z", added_at: "x", origin: "web", kind: "note", text: "Z" }];
  expect(await resolveRefreshItems(fakeDb(noOverlap), "p1", snapshot)).toEqual(snapshot);
});

test("falls back to the snapshot when the project items fail validation", async () => {
  expect(await resolveRefreshItems(fakeDb([{ bogus: true }]), "p1", snapshot)).toEqual(snapshot);
});
