// lib/social/lifecycle.ts
//
// Social post state machine + platform-event mapping. Pure, no I/O.
//
// Mirrored from: lib/email/outreach/lifecycle.ts
// KEY DIFFERENCES vs. the email version:
//   - DROP the drip cursor (no step / next_send_at advance — social is one-shot per cadence)
//   - DROP Resend-specific event mapping (social has no webhook; polling fills events)
//   - KEEP shouldPublish(post, now) — gates whether the post is due
//   - KEEP platform-event mapping — but for social platform metrics (like/share/etc.)
//   - ADD freshness gate: skip if freshness_token unchanged (D7 design decision)

export type SocialPostStatus = "queued" | "dry_run" | "published" | "failed";
export type ScheduleStatus = "active" | "paused" | "stopped";

export interface ScheduleRow {
  status: ScheduleStatus;
  /** NULL while claimed (parked) or unset; non-null when due. */
  next_run_at: string | null;
}

/**
 * Should this schedule fire now? Only ACTIVE schedules whose next_run_at is
 * due (or parked = null after claim) are eligible.
 *
 * Note: the claim RPC parks next_run_at = NULL on pickup, so by the time
 * the worker evaluates a row it is already NULL. This function is used
 * PRE-CLAIM (on queried rows before the RPC) or in tests.
 */
export function shouldPublish(row: ScheduleRow, now: Date): boolean {
  if (row.status !== "active") return false;
  if (row.next_run_at == null) return true; // parked = claimed and due
  return new Date(row.next_run_at).getTime() <= now.getTime();
}

/**
 * Freshness gate: skip the post if the brain's freshness_token has not
 * advanced since the last post for this schedule. Never post stale numbers.
 * Returns true when the post SHOULD proceed (data is fresh or gate is off).
 */
export function passesFreshnessGate(
  freshnessGateEnabled: boolean,
  currentToken: string,
  lastPostedToken: string | null,
): boolean {
  if (!freshnessGateEnabled) return true;
  if (!lastPostedToken) return true; // first fire always proceeds
  return currentToken !== lastPostedToken;
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform engagement event mapping (for the polling leg — build 06)
// Social metrics come from polling, not webhooks; these are the canonical
// event names the social_events table stores.
// ─────────────────────────────────────────────────────────────────────────────

export type SocialEngagementMetric = "like" | "comment" | "share" | "impression" | "click";

export interface MappedSocialEvent {
  /** Our normalized metric name, or null to skip this platform metric. */
  metric: SocialEngagementMetric | null;
}

/**
 * Map a raw platform engagement metric key to our canonical metric name.
 * Each platform uses different field names; the adapter normalizes them here
 * before writing to social_events.
 *
 * Unknown metric keys → null (skip logging).
 */
export function mapPlatformMetric(platformKey: string): MappedSocialEvent {
  // Canonical map across X / LinkedIn / Meta / GBP
  const mapping: Record<string, SocialEngagementMetric> = {
    // X / Twitter
    like_count: "like",
    retweet_count: "share",
    reply_count: "comment",
    impression_count: "impression",
    url_link_clicks: "click",
    // LinkedIn
    likeCount: "like",
    commentCount: "comment",
    shareCount: "share",
    impressionCount: "impression",
    clickCount: "click",
    // Meta (Facebook + Instagram)
    likes: "like",
    comments: "comment",
    shares: "share",
    impressions: "impression",
    clicks: "click",
    reach: "impression",
    // Google Business Profile
    CALL_CLICKS: "click",
    WEBSITE_CLICKS: "click",
    BUSINESS_DIRECTION_REQUESTS: "click",
    BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "impression",
    BUSINESS_IMPRESSIONS_MOBILE_MAPS: "impression",
    BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "impression",
    BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "impression",
  };
  return { metric: mapping[platformKey] ?? null };
}
