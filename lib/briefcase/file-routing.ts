"use client";

import { useCallback } from "react";
import type { ProjectItem } from "@/lib/project/items";
import { useAiContext } from "@/components/briefcase/use-ai-context";
import { useBriefcase } from "@/components/briefcase/BriefcaseProvider";
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
 * Hook form for call sites that don't already hold the active project + briefcase
 * (the highlighter popup). Reads the same context the pill reads.
 */
export function useFiler(): { file: (item: ProjectItem) => FileTarget; projectId: string | null } {
  const projectId = useAiContext()?.projectId ?? null;
  const briefcase = useBriefcase();
  const file = useCallback(
    (item: ProjectItem): FileTarget =>
      routeFiledItem(item, projectId, (i) => briefcase?.fileItem(i)),
    [projectId, briefcase],
  );
  return { file, projectId };
}
