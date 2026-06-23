"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import type { ProjectItem } from "@/lib/project/items";
import { useBriefcase } from "@/components/briefcase/BriefcaseProvider";
import { projectIdFromPath } from "@/lib/briefcase/pill-mount";
import { dispatchAddItem } from "@/lib/project/add-item-event";

/**
 * F2 — where a filed item LANDS. Inside an open project, file straight into THAT project
 * (the `ADD_ITEM_EVENT` channel the workspace already listens for → it appends to its own
 * items + persists); off a project, the anonymous briefcase tray. This kills the old bug
 * where filing inside a project dumped to the tray, and "build" then spawned a NEW project.
 *
 * The workspace is the sole writer of `projects.items` (see `lib/project/add-item-event.ts`),
 * so we dispatch rather than PATCH here — no dual read-modify-write, no lost items.
 */
export type FileTarget = "project" | "tray";

/** Pure routing: project open → dispatch into the open workspace; else → tray. Returns where it landed. */
export function routeFiledItem(
  item: ProjectItem,
  projectId: string | null,
  fileToTray: (item: ProjectItem) => void,
): FileTarget {
  if (projectId) {
    dispatchAddItem({ projectId, item });
    return "project";
  }
  fileToTray(item);
  return "tray";
}

/**
 * Hook form for all filing call sites (highlighter popup + pill chat).
 *
 * Keys off the URL (`/project/[id]`), NOT the async `useAiContext()` store — the store can
 * be null mid-load, which made filing silently fall back to the tray even on a project page
 * (the F2-not-working bug). The workspace's `ADD_ITEM_EVENT` id is also URL-derived, so the
 * dispatch target always matches the listening workspace.
 */
export function useFiler(): { file: (item: ProjectItem) => FileTarget; projectId: string | null } {
  const pathname = usePathname();
  const projectId = projectIdFromPath(pathname ?? "/");
  const briefcase = useBriefcase();
  const file = useCallback(
    (item: ProjectItem): FileTarget =>
      routeFiledItem(item, projectId, (i) => briefcase?.fileItem(i)),
    [projectId, briefcase],
  );
  return { file, projectId };
}
