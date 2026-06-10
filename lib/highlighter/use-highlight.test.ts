import { describe, it, expect } from "bun:test";
import { pickDominantCell, classifyFact } from "./use-highlight";

/**
 * The cross-cell snap DECISION is pure (pickDominantCell) and tested here. The
 * DOM-walking wrapper `snapCrossCellSelection` (and the sibling
 * `snapCrossRowSelection`) need a real Range/document — this repo has no DOM
 * test environment by design, so those are exercised by the task's manual smoke.
 * pickDominantCell carries the dominance + suppression logic that matters.
 */
describe("pickDominantCell", () => {
  it("snaps to the start cell when it dominates >= 1.5x", () => {
    expect(pickDominantCell(30, 5)).toBe("start");
  });

  it("snaps to the end cell when it dominates >= 1.5x", () => {
    expect(pickDominantCell(5, 30)).toBe("end");
  });

  it("suppresses (null) a balanced label+value mix", () => {
    expect(pickDominantCell(10, 9)).toBe(null);
    expect(pickDominantCell(8, 8)).toBe(null);
    // 1.5x exactly is dominant; just under is not.
    expect(pickDominantCell(12, 8)).toBe("start"); // 12 >= 8*1.5 (=12)
    expect(pickDominantCell(11, 8)).toBe(null); // 11 < 12
  });

  it("suppresses an empty selection", () => {
    expect(pickDominantCell(0, 0)).toBe(null);
  });

  it("treats a one-sided selection (other cell empty) as dominant", () => {
    expect(pickDominantCell(12, 0)).toBe("start");
    expect(pickDominantCell(0, 12)).toBe("end");
  });
});

describe("classifyFact (regression — same module)", () => {
  it("reads a currency/percent token as a metric", () => {
    expect(classifyFact("$30,074/yr")).toBe("metric");
    expect(classifyFact("6.2%")).toBe("metric");
  });
  it("reads a place name as a place", () => {
    expect(classifyFact("Fort Myers Beach")).toBe("place");
  });
});
