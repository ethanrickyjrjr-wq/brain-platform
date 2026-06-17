import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import type { ProjectItem } from "@/lib/project/items";
import type { ChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import { signedUploadUrls } from "@/lib/project/signed-upload-url";
import { parseDeliverableScope } from "@/lib/deliverable/parse-scope";
import { readProjectFeed, type FeedRow } from "@/lib/project/feed";
import { projectScopeSet } from "@/lib/project/project-scope";
import { ProjectWorkspace } from "./ProjectWorkspace";
import type {
  SavedChart,
  DeliverableRow,
  EmailScheduleRow,
  ProjectUiState,
} from "./workspace/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  title: string | null;
  items: ProjectItem[];
  branding: Record<string, string> | null;
  mcp_key: string | null;
  ui_state: ProjectUiState | null;
}

/** A deliverable row as loaded for the workspace (render fields kept server-side). */
interface RawDeliverable {
  id: string;
  template: string;
  status: string;
  created_at: string;
  scope_kind: string | null;
  scope_value: string | null;
  narrative: { exec_summary?: string } | null;
  // A snapshot item is either a resolved `chart` (chart_block) or a resolved `frame`
  // (chart_spec — a ChartBlock superset). Either renders the thumbnail mini-chart.
  items_snapshot: { kind: string; chart_block?: ChartBlock; chart_spec?: ChartBlock }[] | null;
}

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** First renderable chart in a deliverable snapshot — a resolved `chart` (chart_block)
 *  OR a resolved `frame` (chart_spec, a ChartBlock superset). Frames are the flywheel's
 *  primary chart type, so the thumbnail must cover them too. */
function firstSnapshotChart(snapshot: RawDeliverable["items_snapshot"]): ChartBlock | null {
  if (!Array.isArray(snapshot)) return null;
  for (const i of snapshot) {
    if (i.kind === "chart" && i.chart_block) return i.chart_block;
    if (i.kind === "frame" && i.chart_spec) return i.chart_spec;
  }
  return null;
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

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/project/${id}`);

  // RLS scopes this SELECT to the owner — another user's id returns no row → 404.
  const { data } = await supabase
    .from("projects")
    .select("id, title, items, branding, mcp_key, ui_state")
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

  // Deliverables for this project. Pull the render fields too (narrative,
  // items_snapshot) but EXTRACT the thumbnail seed server-side so the client never
  // ships the full snapshot just to draw a card (§D).
  const { data: deliverableRows } = await supabase
    .from("deliverables")
    .select("id, template, status, created_at, scope_kind, scope_value, narrative, items_snapshot")
    .eq("project_id", id)
    .order("created_at", { ascending: false });
  const deliverables: DeliverableRow[] = ((deliverableRows as RawDeliverable[] | null) ?? []).map(
    (d) => ({
      id: d.id,
      template: d.template,
      status: d.status,
      created_at: d.created_at,
      scope_kind: d.scope_kind,
      scope_value: d.scope_value,
      exec_summary: d.narrative?.exec_summary ?? null,
      preview_chart: firstSnapshotChart(d.items_snapshot),
    }),
  );

  // Active email schedules for the project (§D Emailing lane is schedule-driven).
  const { data: scheduleRows } = await supabase
    .from("email_schedules")
    .select(
      "id, cadence, day_of_week, day_of_month, send_hour_et, audience_slug, scope_kind, scope_value, topic, status, last_run_at, next_run_at",
    )
    .eq("project_id", id)
    .neq("status", "stopped")
    .order("created_at", { ascending: false });
  const emailSchedules: EmailScheduleRow[] = (scheduleRows as EmailScheduleRow[] | null) ?? [];

  // Piece 3 — durable context bus: the project's `project_feed` signals (Bound +
  // Tier-2 scope-matched, recency-windowed, unread-first). Read seam is owner-scoped
  // by RLS (cookie client) and never throws → []. The workspace folds these into the
  // digest's `feedSignals`, which the prompt engine ranks into one situational prompt.
  const feedRows: FeedRow[] = await readProjectFeed(id, projectScopeSet(items));

  // Mint 1h signed URLs for uploaded files via the OWNER's session client
  // (RLS lets the owner read their own private objects). Never expose raw paths.
  const filePaths = items
    .filter((i): i is Extract<ProjectItem, { kind: "file" }> => i.kind === "file")
    .map((i) => i.storage_path);
  const fileUrls = filePaths.length > 0 ? await signedUploadUrls(supabase, filePaths) : {};

  // Seed-on-load (§I): an outside "email this" hands off via ?seed=<template>
  // [&scope_kind=&scope_value=]. P1 pre-stages a one-click build (no auto-fire LLM
  // pass — that selective pre-build is P2); the build route re-validates the template.
  const seedTemplate = str(sp.seed);
  const seedScope = parseDeliverableScope(str(sp.scope_kind), str(sp.scope_value));
  const seed = seedTemplate
    ? {
        template: seedTemplate,
        scopeKind: seedScope.scope_kind ?? null,
        scopeValue: seedScope.scope_value ?? null,
      }
    : null;

  return (
    // key={project.id} forces a fresh mount per project: the App Router reuses this
    // client subtree across /project/[id1] → [id2] (dynamic-param nav doesn't remount
    // by default), so without a key the workspace would keep the previous project's
    // useState. This is BELOW the persistent rail/AI (in the layout), so it does not
    // break the "persistent assistant" guard.
    <ProjectWorkspace
      key={project.id}
      id={project.id}
      title={project.title}
      branding={project.branding}
      items={items}
      charts={charts}
      deliverables={deliverables}
      emailSchedules={emailSchedules}
      feedRows={feedRows}
      uiState={project.ui_state ?? {}}
      fileUrls={fileUrls}
      mcpKey={project.mcp_key}
      seed={seed}
    />
  );
}
