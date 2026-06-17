import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { ProjectItem } from "@/lib/project/items";
import { ProjectsRail, type RailProject } from "./ProjectsRail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Persistent project-area layout (Piece 1 §A — the architecture spine). Holds the
 * left projects rail; `{children}` is the selected project's world (or the list
 * landing). Clicking a project navigates to its own URL `/project/[id]`, but
 * because the rail lives HERE it does not unmount — only the right side swaps, and
 * the root-mounted AI (`app/layout.tsx`) keeps its context across the switch.
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

  return (
    <div className="flex w-full">
      <ProjectsRail projects={projects} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
