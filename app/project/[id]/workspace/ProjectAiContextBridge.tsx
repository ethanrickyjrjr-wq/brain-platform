"use client";

import { useEffect, useState } from "react";
import { setAiContext } from "@/lib/project/ai-context-store";
import type { ProjectDigest } from "@/lib/project/digest";

/**
 * Seeds the module-level context-bus store with this project's digest so the persistent
 * pill (a sibling of the project layout) becomes project-aware on a direct load / deep
 * link. Renders nothing.
 *
 * The seed runs in a lazy `useState` initializer — NOT a `useEffect` (this repo treats
 * `react-hooks/set-state-in-effect` as a hard error; same pattern as
 * `BriefcaseProvider`'s draft load and `BriefcasePanel`'s visit bump). It is guarded to
 * the client so concurrent SSR renders never mutate the module global (which would leak
 * one request's project context into another). Mounted inside `ProjectWorkspace`, which
 * is keyed by project id and so remounts on project switch — re-seeding for the newly
 * opened project. (Client-side rail navigation seeds the store BEFORE this even mounts.)
 */
export function ProjectAiContextBridge({ digest }: { digest: ProjectDigest }) {
  useState(() => {
    if (typeof window !== "undefined") setAiContext(digest);
    return null;
  });
  // Keep the store in sync as the digest changes within the session (item added, title
  // edited → a new digest from `useMemo`). A module-store write, NOT a React setState,
  // so `react-hooks/set-state-in-effect` does not apply; the store's keyed-write no-op
  // makes a same-rev re-sync free. (The lazy seed above already covered first paint.)
  useEffect(() => {
    setAiContext(digest);
  }, [digest]);
  return null;
}
