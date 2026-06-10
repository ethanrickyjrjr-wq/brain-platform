import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import type { ProjectItem } from "@/lib/project/items";
import type { ChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import { ProjectDetail, type SavedChart } from "./ProjectDetail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  title: string | null;
  items: ProjectItem[];
  branding: Record<string, string> | null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = createClient(await cookies());
  const { data } = await supabase.from("projects").select("title").eq("id", id).maybeSingle();
  return { title: `${(data as { title?: string } | null)?.title || "Project"} — SWFL Data Gulf` };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/project/${id}`);

  // RLS scopes this SELECT to the owner — another user's id returns no row → 404.
  const { data } = await supabase
    .from("projects")
    .select("id, title, items, branding")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const project = data as ProjectRow;
  const items = project.items ?? [];

  // Resolve chart refs → their frozen chart_block in saved_charts (public-select).
  const chartIds = items.filter((i) => i.kind === "chart").map((i) => i.chart_id);
  const charts: Record<string, SavedChart> = {};
  if (chartIds.length > 0) {
    const { data: rows } = await supabase
      .from("saved_charts")
      .select("id, chart_block, freshness_token")
      .in("id", chartIds);
    for (const r of (rows as
      | { id: string; chart_block: ChartBlock; freshness_token: string | null }[]
      | null) ?? []) {
      charts[r.id] = { block: r.chart_block, freshness_token: r.freshness_token };
    }
  }

  return (
    <ProjectDetail
      id={project.id}
      title={project.title}
      branding={project.branding}
      items={items}
      charts={charts}
    />
  );
}
