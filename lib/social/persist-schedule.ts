// lib/social/persist-schedule.ts
//
// Pure builders for the lab "Schedule this post" flow. NO I/O — the route handler
// (app/api/social/schedule/route.ts) does auth + the DB INSERT. Freezing mirrors the
// U2 spec (SOCIAL BUILD/U2-ask-ai-schedule-and-compose.md) and the FrozenPost contract
// in lib/social/types.ts. The DRY invariant lives one layer up: persisting a schedule
// NEVER fires a live post — the cron worker does, gated by SOCIAL_PUBLISH_ENABLED.

import type { CadenceSpec } from "@/lib/email/schedule-cadence";
import type { FrozenPost, Platform } from "@/lib/social/types";
import type { SocialDraft } from "@/lib/email/social-calendar/types";
import type { SocialDesign } from "@/lib/social/design/types";

export interface SocialScheduleInput {
  userId: string;
  projectId: string | null;
  socialAccountId: string;
  platform: Platform;
  /** cadence + day_of_week/day_of_month + send_hour_et (Eastern wall-clock). */
  cadence: CadenceSpec;
  scopeKind: string | null;
  scopeValue: string | null;
  hashtags: string[];
  /** "image" | "carousel" | null. */
  mediaKind: string | null;
  frozenPost: FrozenPost;
  signature: string | null;
  nextRunAtIso: string | null;
}

/** Exactly the columns of a `social_schedules` INSERT (status seeded "active"). */
export interface SocialScheduleInsert {
  user_id: string;
  project_id: string | null;
  social_account_id: string;
  platform: Platform;
  status: "active";
  cadence: CadenceSpec["cadence"];
  day_of_week: number | null;
  day_of_month: number | null;
  send_hour_et: number;
  scope_kind: string | null;
  scope_value: string | null;
  content_template: string | null;
  hashtags: string[];
  media_kind: string | null;
  freshness_gate: boolean;
  signature: string | null;
  frozen_post: FrozenPost;
  next_run_at: string | null;
}

/**
 * Freeze the artifact the FIRST fire posts verbatim. No invention: an empty/blank
 * media URL or freshness token becomes null (never an empty string) so nothing
 * downstream paints a placeholder.
 */
export function freezePost(
  draft: SocialDraft,
  nowIso: string,
  opts: { mediaUrl?: string | null; freshnessToken?: string | null; design?: SocialDesign | null },
): FrozenPost {
  return {
    caption: draft.caption,
    media_url: opts.mediaUrl && opts.mediaUrl.trim() ? opts.mediaUrl : null,
    hashtags: draft.hashtags ?? [],
    freshness_token: opts.freshnessToken && opts.freshnessToken.trim() ? opts.freshnessToken : null,
    composed_at: nowIso,
    design: opts.design ?? null,
  };
}

/** Map a confirmed lab recipe to the `social_schedules` column shape. Status seeds
 *  "active"; the lab status model (Task 2) may down-rank a Draft to "paused" upstream. */
export function buildSocialScheduleInsert(input: SocialScheduleInput): SocialScheduleInsert {
  return {
    user_id: input.userId,
    project_id: input.projectId,
    social_account_id: input.socialAccountId,
    platform: input.platform,
    status: "active",
    cadence: input.cadence.cadence,
    day_of_week: input.cadence.day_of_week ?? null,
    day_of_month: input.cadence.day_of_month ?? null,
    send_hour_et: input.cadence.send_hour_et,
    scope_kind: input.scopeKind,
    scope_value: input.scopeValue,
    content_template: "stat_card",
    hashtags: input.hashtags,
    media_kind: input.mediaKind,
    // A frozen canvas image is static (v1) — cron's frozen branch ignores the gate;
    // record freshness_gate:false for honesty. Template posts keep the gate on.
    freshness_gate: input.frozenPost.design ? false : true,
    signature: input.signature,
    frozen_post: input.frozenPost,
    next_run_at: input.nextRunAtIso,
  };
}
