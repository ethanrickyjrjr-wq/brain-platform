// Pure geometry for the draggable/resizable Ask-AI dock. The panel is anchored
// by its distance from the viewport's bottom-right corner (right/bottom offsets)
// plus a width/height, so resizing from the top-left handle keeps the bottom-
// right corner pinned. Kept framework-free and unit-tested (dock-geom.test.ts);
// AskAiDock only wires pointer events to these functions + localStorage.

export interface DockGeom {
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const DOCK_DEFAULT: DockGeom = {
  right: 16,
  bottom: 76, // clears the ~56px FAB + gap
  width: 380,
  height: 520,
};

export const DOCK_MIN = { width: 300, height: 380 };

/** Upper size bound for the current viewport (never larger than ~the screen). */
export function dockMax(vp: Viewport) {
  return {
    width: Math.min(480, Math.round(vp.width * 0.92)),
    height: Math.min(640, Math.round(vp.height * 0.8)),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Drag by a pointer delta (px). Moving the pointer right/down shrinks the
 * right/bottom offsets (the panel follows the pointer). Clamped so the panel
 * stays fully on-screen.
 */
export function applyDockDrag(
  g: DockGeom,
  dx: number,
  dy: number,
  vp: Viewport,
): DockGeom {
  return {
    ...g,
    right: clamp(g.right - dx, 0, Math.max(0, vp.width - g.width)),
    bottom: clamp(g.bottom - dy, 0, Math.max(0, vp.height - g.height)),
  };
}

/**
 * Resize from the top-left handle: the bottom-right corner is pinned, so only
 * width/height change. Negative deltas (handle moved up/left) grow the panel.
 * Clamped to [DOCK_MIN, min(dockMax, remaining viewport)].
 */
export function applyDockResize(
  g: DockGeom,
  dx: number,
  dy: number,
  vp: Viewport,
): DockGeom {
  const max = dockMax(vp);
  return {
    ...g,
    width: clamp(
      g.width - dx,
      DOCK_MIN.width,
      Math.max(DOCK_MIN.width, Math.min(max.width, vp.width - g.right)),
    ),
    height: clamp(
      g.height - dy,
      DOCK_MIN.height,
      Math.max(DOCK_MIN.height, Math.min(max.height, vp.height - g.bottom)),
    ),
  };
}

/**
 * Re-fit a (possibly persisted) geom to the current viewport so a panel
 * restored on a smaller screen can't sit off-screen or exceed bounds.
 */
export function clampDockGeom(g: DockGeom, vp: Viewport): DockGeom {
  const max = dockMax(vp);
  const width = clamp(
    g.width,
    DOCK_MIN.width,
    Math.max(DOCK_MIN.width, Math.min(max.width, vp.width)),
  );
  const height = clamp(
    g.height,
    DOCK_MIN.height,
    Math.max(DOCK_MIN.height, Math.min(max.height, vp.height)),
  );
  return {
    width,
    height,
    right: clamp(g.right, 0, Math.max(0, vp.width - width)),
    bottom: clamp(g.bottom, 0, Math.max(0, vp.height - height)),
  };
}
