import { describe, it, expect } from "bun:test";
import { extractCompositionData, resolveCompositionColors } from "./CompositionFrame";

/**
 * Pure-function tests for CompositionFrame's data-adapter.
 * No jsdom / React rendering — this repo has no DOM test environment by design.
 */

describe("extractCompositionData", () => {
  it("returns correct segments and callout from valid options", () => {
    const result = extractCompositionData({
      segments: [
        { label: "V/VE Zone", valuePct: 3.11, color: "#ef4444" },
        { label: "SFHA (AE/A)", valuePct: 15.82, color: "#f97316" },
        { label: "Non-SFHA", valuePct: 81.07, color: "#22c55e" },
      ],
      callout: "357× AAL multiplier in flood zones",
    });

    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]).toEqual({
      label: "V/VE Zone",
      valuePct: 3.11,
      color: "#ef4444",
    });
    expect(result.segments[1]).toEqual({
      label: "SFHA (AE/A)",
      valuePct: 15.82,
      color: "#f97316",
    });
    expect(result.segments[2]).toEqual({
      label: "Non-SFHA",
      valuePct: 81.07,
      color: "#22c55e",
    });
    expect(result.callout).toBe("357× AAL multiplier in flood zones");
  });

  it("returns empty segments when segments key is missing", () => {
    const result = extractCompositionData({ callout: "some callout" });
    expect(result.segments).toEqual([]);
    expect(result.callout).toBe("some callout");
  });

  it("returns empty segments when segments is not an array", () => {
    const result = extractCompositionData({ segments: "not-an-array" });
    expect(result.segments).toEqual([]);
  });

  it("returns undefined callout when callout key is missing", () => {
    const result = extractCompositionData({
      segments: [{ label: "A", valuePct: 100 }],
    });
    expect(result.callout).toBeUndefined();
  });

  it("returns undefined callout when callout is not a string", () => {
    const result = extractCompositionData({
      segments: [],
      callout: 42,
    });
    expect(result.callout).toBeUndefined();
  });

  it("handles segments without optional color field", () => {
    const result = extractCompositionData({
      segments: [{ label: "Only", valuePct: 100 }],
    });
    expect(result.segments[0].color).toBeUndefined();
    expect(result.segments[0].label).toBe("Only");
    expect(result.segments[0].valuePct).toBe(100);
  });

  it("filters out non-object entries in segments array", () => {
    const result = extractCompositionData({
      segments: [null, "bad", 42, { label: "Good", valuePct: 50, color: "#fff" }],
    });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].label).toBe("Good");
  });

  it("defaults missing label and valuePct fields to empty string and 0", () => {
    const result = extractCompositionData({
      segments: [{}],
    });
    expect(result.segments[0].label).toBe("");
    expect(result.segments[0].valuePct).toBe(0);
  });

  it("handles empty options object", () => {
    const result = extractCompositionData({});
    expect(result.segments).toEqual([]);
    expect(result.callout).toBeUndefined();
  });
});

describe("resolveCompositionColors", () => {
  it("gives distinct on-brand colors when segments have none", () => {
    const segs = [{}, {}, {}, {}].map(() => ({}));
    const colors = resolveCompositionColors(segs, { accent: "#3dc9c0" });
    expect(colors).toHaveLength(4);
    expect(new Set(colors).size).toBe(4);
  });
  it("honors an explicit segment color", () => {
    const colors = resolveCompositionColors([{ color: "#ff0000" }, {}], { accent: "#3dc9c0" });
    expect(colors[0]).toBe("#ff0000");
  });
});
