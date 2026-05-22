import { describe, it, expect } from "vitest";
import {
  assignCorridor,
  type CorridorCentroid,
} from "./corridor-assignment.mts";

const CENTROIDS: CorridorCentroid[] = [
  {
    corridor_id: "a",
    corridor_label: "A",
    center_lat: 26.64,
    center_lon: -81.87,
  },
  {
    corridor_id: "b",
    corridor_label: "B",
    center_lat: 26.57,
    center_lon: -81.79,
  },
];

describe("assignCorridor", () => {
  it("assigns to the nearest centroid within max-radius", () => {
    const r = assignCorridor(26.641, -81.871, CENTROIDS, { maxRadiusMi: 1.5 });
    expect(r?.corridor_id).toBe("a");
    expect(r!.distance_mi).toBeLessThan(0.5);
  });

  it("returns null when no centroid within max-radius", () => {
    const r = assignCorridor(27.5, -82.5, CENTROIDS, { maxRadiusMi: 1.5 });
    expect(r).toBeNull();
  });

  it("returns null on missing lat", () => {
    expect(
      assignCorridor(null as unknown as number, -81.87, CENTROIDS, {
        maxRadiusMi: 1.5,
      }),
    ).toBeNull();
  });

  it("returns null on missing lon", () => {
    expect(
      assignCorridor(26.64, null as unknown as number, CENTROIDS, {
        maxRadiusMi: 1.5,
      }),
    ).toBeNull();
  });

  it("returns null on empty centroid list", () => {
    expect(assignCorridor(26.64, -81.87, [], { maxRadiusMi: 1.5 })).toBeNull();
  });

  it("picks the closer centroid when multiple are within radius", () => {
    const r = assignCorridor(26.572, -81.792, CENTROIDS, { maxRadiusMi: 10 });
    expect(r?.corridor_id).toBe("b");
  });
});
