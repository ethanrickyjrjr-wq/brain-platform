import { test, expect } from "bun:test";
import {
  applyDockDrag,
  applyDockResize,
  clampDockGeom,
  DOCK_MIN,
  type DockGeom,
} from "./dock-geom";

const VP = { width: 1280, height: 800 };

test("drag shifts the panel by the pointer delta when there's room", () => {
  const g: DockGeom = { right: 200, bottom: 200, width: 380, height: 520 };
  const moved = applyDockDrag(g, 50, 30, VP);
  // Pointer moved right+down → right/bottom offsets shrink by the same amount.
  expect(moved).toEqual({ right: 150, bottom: 170, width: 380, height: 520 });
});

test("drag clamps so the panel can't leave the viewport", () => {
  const g: DockGeom = { right: 200, bottom: 200, width: 380, height: 520 };
  // Drag far left/up (negative deltas grow the offsets) → clamp to vw-width / vh-height.
  const moved = applyDockDrag(g, -5000, -5000, VP);
  expect(moved.right).toBe(VP.width - g.width); // 900
  expect(moved.bottom).toBe(VP.height - g.height); // 280
  // Drag far right/down → clamp offsets to 0.
  const moved2 = applyDockDrag(g, 5000, 5000, VP);
  expect(moved2.right).toBe(0);
  expect(moved2.bottom).toBe(0);
});

test("resize from the top-left handle grows up-left, bottom-right anchored", () => {
  const g: DockGeom = { right: 16, bottom: 76, width: 380, height: 520 };
  const sized = applyDockResize(g, -40, -30, VP);
  expect(sized).toEqual({ right: 16, bottom: 76, width: 420, height: 550 });
});

test("resize clamps to the minimum size", () => {
  const g: DockGeom = { right: 16, bottom: 76, width: 380, height: 520 };
  const sized = applyDockResize(g, 5000, 5000, VP);
  expect(sized.width).toBe(DOCK_MIN.width);
  expect(sized.height).toBe(DOCK_MIN.height);
});

test("clampDockGeom refits an oversized geom onto a small screen", () => {
  const g: DockGeom = { right: 16, bottom: 76, width: 900, height: 900 };
  const fit = clampDockGeom(g, { width: 360, height: 640 });
  expect(fit.width).toBeLessThanOrEqual(360);
  expect(fit.height).toBeLessThanOrEqual(640);
  expect(fit.width).toBeGreaterThanOrEqual(DOCK_MIN.width);
  // Stays fully on-screen: offset + size never exceeds the viewport.
  expect(fit.right + fit.width).toBeLessThanOrEqual(360);
  expect(fit.bottom + fit.height).toBeLessThanOrEqual(640);
});
