"use client";

import { usePathname } from "next/navigation";
import { AiBriefcasePill } from "@/components/briefcase/AiBriefcasePill";
import { pageFromPath, shouldRenderStandalone } from "@/lib/briefcase/pill-mount";

/**
 * A-3 — mounts the ONE standalone AI+Briefcase pill at the app root (inside
 * BriefcaseProvider, so it files into the global draft). It renders everywhere
 * EXCEPT on /r/* while the highlighter is enabled — there the per-page BRIDGED pill
 * (rendered by HighlighterLayer, which knows the reportId) takes over, so this one
 * suppresses to keep exactly one visible pill. On /r/* with the flag OFF it is the
 * fallback. `highlighterEnabled` is read server-side in the root layout (a plain
 * env read — does not make the layout dynamic).
 */
export function AppShell({ highlighterEnabled }: { highlighterEnabled: boolean }) {
  const pathname = usePathname() ?? "/";
  if (!shouldRenderStandalone(pathname, highlighterEnabled)) return null;
  return <AiBriefcasePill page={pageFromPath(pathname)} />;
}
