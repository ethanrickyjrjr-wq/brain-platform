// app/api/social/schedule/route.ts
//
// The lab "Schedule this post" write-path. The U2 spec (SOCIAL BUILD/
// U2-ask-ai-schedule-and-compose.md) called for a "confirm → INSERT social_schedules"
// flow that was never shipped — nothing in the product wrote the rows the cron worker
// (scripts/social/run-schedules.mts + social-scheduler.yml) reads. This is that write.
//
// GET  → the caller's connected, publishable social accounts (drives the modal's
//        platform gate + empty state). One row per platform (social_accounts unique
//        index is (user_id, platform, platform_account_id)).
// POST → confirm-only: validate, resolve the connected account PER platform server-side
//        (never trust a client account id), compute next_run_at, INSERT one
//        social_schedules row per platform with a frozen_post snapshot.
//
// Auth: cookie/RLS client (auth.uid() = user_id is the authorization), never
// service-role — same posture as app/api/email/schedule-command/route.ts.
//
// DRY invariant: this writes a recipe + frozen_post ONLY. It NEVER calls postToChannel.
// Live posting happens in the cron worker, gated by SOCIAL_PUBLISH_ENABLED.

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { computeNextRunAt, type CadenceSpec } from "@/lib/email/schedule-cadence";
import { buildSocialScheduleInsert, freezePost } from "@/lib/social/persist-schedule";
import type { Platform } from "@/lib/social/types";
import type { SocialDraft } from "@/lib/email/social-calendar/types";

export const runtime = "nodejs";

// Publish targets = the 5 Platform members with channel adapters. The 8 display
// platforms in lib/email/social/platforms.ts (tiktok/youtube/pinterest/threads) have
// no adapters and are never schedulable.
const PUBLISHABLE: readonly Platform[] = [
  "x",
  "facebook",
  "instagram",
  "linkedin",
  "google_business",
];
const isPublishable = (v: unknown): v is Platform => PUBLISHABLE.includes(v as Platform);

/** GET /api/social/schedule — the caller's connected, publishable accounts. */
export async function GET() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("social_accounts")
    .select("id, platform, account_name")
    .eq("status", "connected");
  if (error) {
    console.error("[social/schedule] accounts lookup failed:", error);
    return NextResponse.json({ error: "accounts_lookup_failed" }, { status: 500 });
  }
  const accounts = (data ?? []).filter((a) => isPublishable(a.platform));
  return NextResponse.json({ accounts });
}

/** POST /api/social/schedule — persist one social_schedules row per platform. */
export async function POST(req: NextRequest) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const projectId = typeof body?.projectId === "string" ? body.projectId : null;
  const post = body?.post as SocialDraft | undefined;
  const rawPlatforms: unknown[] = Array.isArray(body?.platforms) ? body.platforms : [];
  const platforms: Platform[] = [...new Set(rawPlatforms.filter(isPublishable))];
  const cadence = body?.cadence as CadenceSpec["cadence"] | undefined;
  const sendHourEt = typeof body?.send_hour_et === "number" ? body.send_hour_et : null;

  if (!post?.caption) return NextResponse.json({ error: "post required" }, { status: 400 });
  if (platforms.length === 0) {
    return NextResponse.json({ error: "no publishable platform selected" }, { status: 400 });
  }
  if (!cadence || sendHourEt == null) {
    return NextResponse.json({ error: "cadence + time required" }, { status: 400 });
  }

  const spec: CadenceSpec = {
    cadence,
    day_of_week: typeof body?.day_of_week === "number" ? body.day_of_week : null,
    day_of_month: typeof body?.day_of_month === "number" ? body.day_of_month : null,
    send_hour_et: sendHourEt,
  };

  // Guard the silent-dead-row trap: computeNextRunAt returns null for an invalid spec
  // (weekly without day_of_week, monthly without day_of_month). A row written with
  // next_run_at=NULL is never claimed (claim RPC requires next_run_at IS NOT NULL) and
  // never reaped (the reaper needs a stale last_run_at) — it looks scheduled but never
  // fires. Reject it here rather than persist a dead recipe.
  const next = computeNextRunAt(spec);
  if (!next) {
    return NextResponse.json(
      {
        error: "invalid_cadence",
        detail: "weekly needs a day of week; monthly needs a day of month",
      },
      { status: 400 },
    );
  }
  const nextIso = next.toISOString();

  // Resolve the connected account for each requested platform from the caller's OWN rows
  // (RLS-scoped). A platform with no connected account is skipped + reported, never
  // silently dropped under ok:true (e.g. revoked between modal load and POST).
  const { data: accountRows, error: acctErr } = await supabase
    .from("social_accounts")
    .select("id, platform")
    .eq("status", "connected")
    .in("platform", platforms);
  if (acctErr) {
    console.error("[social/schedule] accounts lookup failed:", acctErr);
    return NextResponse.json({ error: "accounts_lookup_failed" }, { status: 500 });
  }
  const accountByPlatform = new Map<Platform, string>();
  for (const a of accountRows ?? []) {
    if (isPublishable(a.platform) && !accountByPlatform.has(a.platform)) {
      accountByPlatform.set(a.platform, a.id);
    }
  }
  const scheduled = platforms.filter((p) => accountByPlatform.has(p));
  const skipped = platforms.filter((p) => !accountByPlatform.has(p));
  if (scheduled.length === 0) {
    return NextResponse.json({ error: "no_connected_account", skipped }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const frozen = freezePost(post, nowIso, {
    mediaUrl: typeof body?.mediaUrl === "string" ? body.mediaUrl : null,
    freshnessToken: typeof body?.freshnessToken === "string" ? body.freshnessToken : null,
    design: body?.design ?? null,
  });

  const rows = scheduled.map((platform) =>
    buildSocialScheduleInsert({
      userId: user.id,
      projectId,
      socialAccountId: accountByPlatform.get(platform)!,
      platform,
      cadence: spec,
      scopeKind: typeof body?.scope_kind === "string" ? body.scope_kind : null,
      scopeValue: typeof body?.scope_value === "string" ? body.scope_value : null,
      hashtags: post.hashtags ?? [],
      mediaKind: frozen.media_url ? "image" : null,
      frozenPost: frozen,
      signature: null,
      nextRunAtIso: nextIso,
    }),
  );

  const { data: inserted, error } = await supabase
    .from("social_schedules")
    .insert(rows)
    .select("id");
  if (error) {
    console.error("[social/schedule] insert failed:", error);
    return NextResponse.json({ error: "schedule_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    scheduleIds: (inserted ?? []).map((r) => r.id),
    scheduled,
    skipped,
    next_run_at: nextIso,
  });
}
