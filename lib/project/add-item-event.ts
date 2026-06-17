import type { ProjectItem } from "./items";

/**
 * In-session channel from the layout's bottom-bar search (§F) to the currently-open
 * ProjectWorkspace. The search bar lives in `app/project/layout.tsx` (a different,
 * never-unmounting subtree from the project page), so it cannot share the workspace's
 * in-memory items directly. Routing the Add through this event makes the WORKSPACE
 * the sole writer of the items array — eliminating the dual read-modify-write that
 * (search PATCH vs workspace PATCH) could otherwise lose items last-writer-wins.
 *
 * The workspace appends to its OWN current items (merging any unsaved reorder/edits)
 * and persists — never a blind server overwrite. The detail carries `projectId` so a
 * workspace only handles adds aimed at the project it is showing.
 */
export const ADD_ITEM_EVENT = "swfl:project-add-item";

export interface AddItemDetail {
  projectId: string;
  item: ProjectItem;
}

export function dispatchAddItem(detail: AddItemDetail): void {
  window.dispatchEvent(new CustomEvent<AddItemDetail>(ADD_ITEM_EVENT, { detail }));
}
