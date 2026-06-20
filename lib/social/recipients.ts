// lib/social/recipients.ts
//
// Pure helpers for the social_posts ledger: normalize the schedule key and
// build the insert row from a publish result. Kept PURE (no DB) so it's unit
// tested; the actual upsert I/O lives in the cron worker (build 04).
//
// Mirrored from: lib/email/outreach/recipients.ts
// KEY DIFFERENCES:
//   - No campaign_id / email / brand columns
//   - Records platform_post_id (returned by publisher) + freshness_token
//   - Status tracks publish state (queued | dry_run | published | failed)

import type { SocialPost, PostStatus, Platform } from "./types";

/** Build a social_posts insert payload from a publish result. Pure. */
export interface PostInsertInput {
  scheduleId: number | null;
  accountId: string;
  platform: Platform;
  caption: string;
  mediaUrl: string | null;
  freshnesToken: string | null;
  idempotencyKey: string;
  platformPostId?: string | null;
  status: PostStatus;
  error?: string | null;
  publishedAt?: string | null;
}

/** Columns written on insert. Mirrors social_posts table DDL. */
export type PostInsertRow = Omit<SocialPost, "id" | "created_at" | "updated_at">;

/** Build the social_posts insert payload. Pure. */
export function buildPostRow(input: PostInsertInput): PostInsertRow {
  return {
    post_schedule_id: input.scheduleId,
    social_account_id: input.accountId,
    platform: input.platform,
    platform_post_id: input.platformPostId ?? null,
    freshness_token: input.freshnesToken,
    caption: input.caption,
    media_url: input.mediaUrl,
    status: input.status,
    error: input.error ?? null,
    idempotency_key: input.idempotencyKey,
    published_at: input.publishedAt ?? null,
  };
}
