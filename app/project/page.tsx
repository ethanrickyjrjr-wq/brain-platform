import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import type { ProjectItem } from "@/lib/project/items";
import { ImportDraftOnLogin } from "./_import/ImportDraftOnLogin";
import { NewProjectButton } from "./NewProjectButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your projects — SWFL Data Gulf" };

interface ProjectRow {
  id: string;
  title: string | null;
  items: ProjectItem[];
  updated_at: string;
}

export default async function ProjectListPage() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Middleware already gates /project, but redirect here too (belt + suspenders).
  if (!user) redirect("/login?next=/project");

  const { data } = await supabase
    .from("projects")
    .select("id, title, items, updated_at")
    .order("updated_at", { ascending: false });
  const projects = (data as ProjectRow[] | null) ?? [];

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      {/* Migrates an anonymous localStorage draft into a saved project on arrival. */}
      <ImportDraftOnLogin />

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Your projects</h1>
        <NewProjectButton />
      </div>

      {projects.length === 0 ? (
        <p className="text-sm text-gray-400">
          No projects yet. File figures, charts, and answers as you browse, then save them here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/project/${p.id}`}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0d1e2b]/80 px-4 py-3 transition-colors hover:border-[#00d4aa]/40"
              >
                <span className="text-sm font-medium text-white">
                  {p.title || "Untitled project"}
                </span>
                <span className="text-xs text-gray-500">
                  {p.items?.length ?? 0} {p.items?.length === 1 ? "item" : "items"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
