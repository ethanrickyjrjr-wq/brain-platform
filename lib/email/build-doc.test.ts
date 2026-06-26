import { test, expect } from "bun:test";
import { tryParsePatch } from "./build-doc";

// The resilient content-patch parser: one over-limit field must NOT nuke the whole
// fill (the bug that returned "try rephrasing" on a real Sonnet response with 4 stats).

test("extracts JSON from a ```json-fenced response", () => {
  const r = tryParsePatch('```json\n{ "b1": { "prose": "hi" } }\n```');
  expect(r).toEqual({ b1: { prose: "hi" } });
});

test("clamps a too-long stats array to 3 instead of rejecting the whole patch", () => {
  const r = tryParsePatch(
    JSON.stringify({
      b1: {
        stats: [
          { value: "1", label: "a" },
          { value: "2", label: "b" },
          { value: "3", label: "c" },
          { value: "4", label: "d" },
          { value: "5", label: "e" },
        ],
      },
    }),
  );
  expect(r).not.toBeNull();
  expect(r!.b1.stats!.length).toBe(3);
});

test("keeps valid blocks and drops only the unsalvageable one", () => {
  // b2's value blows past the 24-char max → b2 dropped, b1 kept (never nuke everything)
  const r = tryParsePatch(JSON.stringify({ b1: { prose: "good" }, b2: { value: "x".repeat(50) } }));
  expect(r).toEqual({ b1: { prose: "good" } });
});

test("strips a style/link key but keeps the block (no-restyle held)", () => {
  const r = tryParsePatch(
    JSON.stringify({ b1: { prose: "ok", bgColor: "#000", url: "http://x" } }),
  );
  expect(r).toEqual({ b1: { prose: "ok" } });
});

test("returns null when there is no JSON object at all", () => {
  expect(tryParsePatch("Sorry, I can't help with that.")).toBeNull();
});
