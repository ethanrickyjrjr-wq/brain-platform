// GET /api/cron/data-readiness
//
// Vercel Cron fires this hourly. It finds any email_schedules whose next_run_at
// is within the next 75 minutes and runs the verification ladder for
// every metric item in those projects. Results are logged to data_readiness_alerts
// so the blast route can surface honest sourcing notes on stale values.
//
// Never cancels a send — substitutes values or marks as omitted.

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { verifyMetricItem, logVerificationResult } from "@/lib/email/data-readiness";
import type { ProjectItem } from "@/lib/project/items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  // Vercel Cron auth.
  // Fail-closed in production: a missing secret is a misconfiguration, not an
  // open door (L2). In dev/preview the secret is optional so local runs work.
  const cronSecret = process.env.CRON_SECRET;
  if (process.env.VERCEL_ENV === "production" && !cronSecret) {
    return NextResponse.json({ error: "Cron secret not configured" }, { status: 503 });
  }
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createServiceRoleClient();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 75 * 60 * 1000);

  // Find upcoming scheduled sends within the 75-min look-ahead window
  const { data: schedules, error: schedErr } = await supabase
    .from("email_schedules")
    .select("id, project_id, next_run_at")
    .gte("next_run_at", now.toISOString())
    .lte("next_run_at", windowEnd.toISOString())
    .eq("status", "active");

  if (schedErr) {
    console.error("[data-readiness cron] schedule query error:", schedErr.message);
    return NextResponse.json({ error: "Schedule query failed" }, { status: 500 });
  }

  if (!schedules?.length) {
    return NextResponse.json({ checked: 0, message: "No upcoming sends in window" });
  }

  let checkedMetrics = 0;
  let substitutions = 0;

  for (const schedule of schedules) {
    const { data: project } = await supabase
      .from("projects")
      .select("items")
      .eq("id", schedule.project_id)
      .maybeSingle();

    const items: ProjectItem[] = Array.isArray(project?.items) ? project.items : [];
    const metricItems = items.filter(
      (i): i is Extract<ProjectItem, { kind: "metric" }> => i.kind === "metric",
    );

    for (const item of metricItems) {
      checkedMetrics++;
      try {
        const result = await verifyMetricItem(item, new Date(schedule.next_run_at));
        await logVerificationResult(
          supabase,
          schedule.project_id,
          schedule.id,
          result,
          schedule.next_run_at,
        );
        if (result.tier_used !== "brain_fresh" && result.tier_used !== "omitted") {
          substitutions++;
        }
      } catch (err) {
        // Isolate per metric: one bad item must not abort the rest of this
        // schedule (or any remaining schedules) and leave a silent gap.
        console.error(
          `[data-readiness cron] verify failed for metric "${item.metric_slug ?? item.label}" in project ${schedule.project_id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return NextResponse.json({
    checked: checkedMetrics,
    substitutions,
    upcoming_sends: schedules.length,
  });
}
