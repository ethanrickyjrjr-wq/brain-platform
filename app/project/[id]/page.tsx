import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import type { ProjectItem } from "@/lib/project/items";
import type { ChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import { signedUploadUrls } from "@/lib/project/signed-upload-url";
import { ProjectWorkspace } from "./ProjectWorkspace";
import type { SavedChart, DeliverableRow } from "./workspace/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  title: string | null;
  items: ProjectItem[];
  branding: Record<string, string> | null;
  mcp_key: string | null;
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
    .select("id, title, items, branding, mcp_key")
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

  // Deliverables for this project — table exists after S6 SQL migration; graceful empty on error.
  const { data: deliverableRows } = await supabase
    .from("deliverables")
    .select("id, template, status, created_at, scope_kind, scope_value")
    .eq("project_id", id)
    .order("created_at", { ascending: false });
  const deliverables: DeliverableRow[] = (deliverableRows ?? []) as DeliverableRow[];

  // Mint 1h signed URLs for uploaded files via the OWNER's session client
  // (RLS lets the owner read their own private objects). Never expose raw paths.
  const filePaths = items
    .filter((i): i is Extract<ProjectItem, { kind: "file" }> => i.kind === "file")
    .map((i) => i.storage_path);
  const fileUrls = filePaths.length > 0 ? await signedUploadUrls(supabase, filePaths) : {};

  return (
    <ProjectWorkspace
      id={project.id}
      title={project.title}
      branding={project.branding}
      items={items}
      charts={charts}
      deliverables={deliverables}
      fileUrls={fileUrls}
      mcpKey={project.mcp_key}
    />
  );
}
