/**
 * lib/deliverable/refresh-items.ts — FINAL BOSS Piece 4 (refresh with current data).
 *
 * "Refresh THIS deliverable with today's data" means: keep the SAME items the
 * deliverable was built from, but re-resolve them against today's lake. The cleanest
 * source for that is the PROJECT's current items restricted to the deliverable's
 * original snapshot (matched by item id) — NOT the frozen snapshot itself, because
 * `freezeSnapshot` drops a frame item's `frame_id`/`metric_keys`/`table_id` binding
 * params, so re-freezing the snapshot would auto-pick a (possibly different) frame.
 * Pulling from `projects.items` keeps those params intact, so a refreshed frame
 * re-binds to the exact same recipe against fresh brain data.
 *
 * Returns [] when the project no longer holds any of the snapshot's items (project
 * deleted, or every item removed) — the caller then falls back to the frozen snapshot
 * so a refresh never hard-fails.
 */

import type { ProjectItem } from "../project/items";

export function refreshItemSet(
  projectItems: ProjectItem[],
  snapshot: ReadonlyArray<{ id: string }>,
): ProjectItem[] {
  const byId = new Map(projectItems.map((i) => [i.id, i]));
  const out: ProjectItem[] = [];
  for (const s of snapshot) {
    const match = byId.get(s.id);
    if (match) out.push(match);
  }
  return out;
}
