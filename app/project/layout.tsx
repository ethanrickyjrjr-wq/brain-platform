import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { ProjectItem } from "@/lib/project/items";
import { BRAIN_CATALOG } from "@/refinery/packs/catalog.mts";
import { ProjectsRail, type RailProject } from "./ProjectsRail";
import { ProjectSearch } from "@/components/project/ProjectSearch";
import type { SearchEntry } from "./[id]/workspace/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Persistent project-area layout (Piece 1 §A/§F — the architecture spine). Holds the
 * left projects rail and the pinned bottom search bar; `{children}` is the selected
 * project's world (or the list landing). Clicking a project navigates to its own URL
 * `/project/[id]`, but because the rail + search live HERE they do not unmount — only
 * the right side swaps, and the root-mounted AI (`app/layout.tsx`) keeps its context.
 *
 * HARD GUARD: never add `key={pathname}` here — it would remount the subtree (and,
 * combined with the root AI, defeat the "persistent, prepared assistant" premise).
 * The AI is NOT mounted in this layout; it persists from the root.
 */
export default async function ProjectAreaLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unauthenticated: render children plain — the child page redirects to /login.
  if (!user) return <>{children}</>;

  const { data } = await supabase
    .from("projects")
    .select("id, title, items, updated_at")
    .order("updated_at", { ascending: false });

  const projects: RailProject[] = (
    (data as { id: string; title: string | null; items: ProjectItem[] | null }[] | null) ?? []
  ).map((p) => ({ id: p.id, title: p.title, itemCount: p.items?.length ?? 0 }));

  // Bottom-bar search index (§F): reports from BRAIN_CATALOG + recent titled saved
  // charts. Built server-side so the client filters a plain array (no catalog bundle).
  const reportEntries: SearchEntry[] = BRAIN_CATALOG.map((b) => ({
    kind: "report",
    ref: b.id,
    label: b.id,
    haystack: `${b.id} ${b.domain} ${b.scope}`.toLowerCase(),
  }));
  const { data: chartRows } = await supabase
    .from("saved_charts")
    .select("id, chart_block")
    .order("created_at", { ascending: false })
    .limit(200);
  const chartEntries: SearchEntry[] = (
    (chartRows as { id: string; chart_block: { title?: string } | null }[] | null) ?? []
  ).flatMap((r) => {
    const title = r.chart_block?.title;
    return title
      ? [{ kind: "chart" as const, ref: r.id, label: title, haystack: title.toLowerCase() }]
      : [];
  });
  const searchIndex = [...reportEntries, ...chartEntries];

  return (
    <div className="flex w-full">
      <ProjectsRail projects={projects} />
      <div className="flex min-h-[calc(100dvh-3.5rem)] min-w-0 flex-1 flex-col">
        <div className="flex-1">{children}</div>
        <ProjectSearch entries={searchIndex} />
      </div>
    </div>
  );
}
