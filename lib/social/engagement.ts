/**
 * lib/social/engagement.ts
 *
 * PURE mappers: each platform's metrics-API response → SocialEvent rows.
 * No I/O. Fully unit-testable. The poll script (scripts/social/poll-engagement.mts)
 * does the fetch + upsert; this file only translates a raw response into the
 * normalized `metric|value` rows the social_events ledger holds.
 *
 * METRIC vocabulary (closed set, from social_events.metric + types.ts):
 *   like | comment | share | impression | click
 * Every emitted row carries source='poll' (the only source in v1).
 *
 * EMPTY-TOLERANT (Operation Dumbo Drop posture): a null/empty/gated response →
 * an empty array. We never invent a number and never throw on a silent platform;
 * a missing metric simply does not produce a row. A platform that exposes only
 * SOME of the five metrics yields only those — we never zero-fill the rest
 * (a zero-fill would blend "we polled and it was 0" with "the platform doesn't
 * tell us", which the no-invention moat forbids).
 *
 * VENDOR-VERIFIED (2026-06-20) — response shapes confirmed live in-session:
 *   X (Twitter):
 *     GET https://api.x.com/2/tweets/:id?tweet.fields=public_metrics  (scope: tweet.read)
 *     public_metrics = { retweet_count, reply_count, like_count, quote_count,
 *                        impression_count, bookmark_count } — ALL public (any reader).
 *     non_public_metrics (url_link_clicks, user_profile_clicks, engagements) is
 *     author-only / OAuth-1.0a gated → we do NOT map "click" from X public reads.
 *     Docs: https://docs.x.com/x-api/fundamentals/metrics
 *   Meta — Facebook Page post:
 *     GET /v19.0/{post-id}/insights?metric=...  (perms: pages_read_engagement, read_insights)
 *     response: { data: [ { name, period, values: [ { value } ] } ] }
 *     Docs: https://developers.facebook.com/docs/graph-api/reference/post/insights
 *   Meta — Instagram media:
 *     GET /v19.0/{ig-media-id}/insights?metric=likes,comments,shares,impressions,...
 *     (perms: instagram_basic, instagram_manage_insights, pages_read_engagement)
 *     response: { data: [ { name, period, values: [ { value } ] } ] }
 *     Docs: https://developers.facebook.com/docs/instagram-api/reference/ig-media/insights
 *   LinkedIn — organization share statistics (per share/ugcPost URN):
 *     GET https://api.linkedin.com/rest/organizationalEntityShareStatistics
 *         ?q=organizationalEntity&organizationalEntity={org}&shares=List({shareUrn})
 *     (perm: rw_organization_admin; header LinkedIn-Version: YYYYMM)
 *     response: { elements: [ { share|ugcPost, totalShareStatistics:
 *                  { clickCount, commentCount, impressionCount, likeCount, shareCount } } ] }
 *     Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics
 *   Google Business Profile:
 *     NO per-post insights API. v4 accounts.locations.localPosts.reportInsights was
 *     REMOVED; the Business Performance API (fetchMultiDailyMetricsTimeSeries) is
 *     location-grain daily only — no per-localPost engagement. GBP is therefore a
 *     permanently empty platform for per-post metrics (mapGBPMetrics → []).
 *     Docs: https://developers.google.com/my-business/content/sunset-dates
 */

import type { SocialEvent } from "./types";

/** The closed metric vocabulary (matches social_events.metric + SocialEvent). */
export type EngagementMetric = SocialEvent["metric"]; // like|comment|share|impression|click

/**
 * A normalized, storage-ready engagement row WITHOUT the DB-assigned id /
 * captured_at (those are stamped by the poll/upsert). This is the pure output of
 * a mapper. `social_post_id` is null here — the caller binds it from the row it
 * polled (the mappers are platform-response-only and don't know our PK).
 */
export interface MappedEvent {
  platform_post_id: string;
  metric: EngagementMetric;
  value: number;
  source: "poll";
}

/** Coerce an arbitrary metric value to a non-negative integer, or null if not numeric. */
function toCount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.trunc(v));
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Math.max(0, Math.trunc(Number(v)));
  }
  return null;
}

/** Build one MappedEvent, or null when the value is absent/non-numeric (skip it). */
function row(platformPostId: string, metric: EngagementMetric, value: unknown): MappedEvent | null {
  const n = toCount(value);
  if (n === null) return null;
  return { platform_post_id: platformPostId, metric, value: n, source: "poll" };
}

// ─────────────────────────────────────────────────────────────────────────────
// X (Twitter)
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of GET /2/tweets/:id?tweet.fields=public_metrics (the parts we read). */
export interface XPublicMetrics {
  retweet_count?: number;
  reply_count?: number;
  like_count?: number;
  quote_count?: number;
  impression_count?: number;
  bookmark_count?: number;
}
export interface XTweetMetricsResponse {
  data?: { id?: string; public_metrics?: XPublicMetrics };
}

/**
 * Map an X tweet-lookup response → SocialEvent rows.
 *   like        ← public_metrics.like_count
 *   comment     ← public_metrics.reply_count
 *   share       ← public_metrics.retweet_count + quote_count (reposts + quote-posts)
 *   impression  ← public_metrics.impression_count
 * NO click: url_link_clicks lives in non_public_metrics (author/OAuth-1.0a gated),
 * not in the public read. Absent fields → no row (empty-tolerant).
 */
export function mapXMetrics(
  platformPostId: string,
  resp: XTweetMetricsResponse | null | undefined,
): MappedEvent[] {
  const pm = resp?.data?.public_metrics;
  if (!pm) return [];
  const out: (MappedEvent | null)[] = [];
  out.push(row(platformPostId, "like", pm.like_count));
  out.push(row(platformPostId, "comment", pm.reply_count));
  // X "share" = reposts + quote-posts. Sum only the parts that are present.
  const reposts = toCount(pm.retweet_count);
  const quotes = toCount(pm.quote_count);
  if (reposts !== null || quotes !== null) {
    out.push(row(platformPostId, "share", (reposts ?? 0) + (quotes ?? 0)));
  }
  out.push(row(platformPostId, "impression", pm.impression_count));
  return out.filter((r): r is MappedEvent => r !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta — shared insights envelope (Facebook Page post + Instagram media)
// ─────────────────────────────────────────────────────────────────────────────

/** Graph insights response: { data: [ { name, values: [ { value } ] } ] }. */
export interface MetaInsightValue {
  value?: number | Record<string, number>;
}
export interface MetaInsightNode {
  name?: string;
  period?: string;
  values?: MetaInsightValue[];
}
export interface MetaInsightsResponse {
  data?: MetaInsightNode[];
}

/** Pull the first scalar value for a metric name out of the insights data array. */
function metaValue(resp: MetaInsightsResponse | null | undefined, name: string): unknown {
  const node = resp?.data?.find((d) => d.name === name);
  const v = node?.values?.[0]?.value;
  // Only scalar values map to a count; object-valued metrics (e.g. reactions
  // broken out by type) need a dedicated summing path (see post_reactions below).
  return typeof v === "number" || typeof v === "string" ? v : undefined;
}

/** Sum an object-valued Meta metric (e.g. post_reactions_by_type_total → {like:N,love:M}). */
function metaObjectSum(resp: MetaInsightsResponse | null | undefined, name: string): number | null {
  const node = resp?.data?.find((d) => d.name === name);
  const v = node?.values?.[0]?.value;
  if (v && typeof v === "object") {
    let sum = 0;
    let any = false;
    for (const n of Object.values(v)) {
      const c = toCount(n);
      if (c !== null) {
        sum += c;
        any = true;
      }
    }
    return any ? sum : null;
  }
  return null;
}

/**
 * Map a Facebook Page-post insights response → SocialEvent rows.
 *   like        ← post_reactions_by_type_total (summed across reaction types)
 *   impression  ← post_impressions
 *   click       ← post_clicks
 * comment/share have no first-party post-insights metric on the Page Insights
 * endpoint, so they are not emitted here (empty-tolerant: a missing surface is
 * simply absent, never zero-filled). Absent metrics → no row.
 */
export function mapMetaPostMetrics(
  platformPostId: string,
  resp: MetaInsightsResponse | null | undefined,
): MappedEvent[] {
  if (!resp?.data?.length) return [];
  const out: (MappedEvent | null)[] = [];
  const reactions = metaObjectSum(resp, "post_reactions_by_type_total");
  if (reactions !== null) out.push(row(platformPostId, "like", reactions));
  out.push(row(platformPostId, "impression", metaValue(resp, "post_impressions")));
  out.push(row(platformPostId, "click", metaValue(resp, "post_clicks")));
  return out.filter((r): r is MappedEvent => r !== null);
}

/**
 * Map an Instagram media insights response → SocialEvent rows.
 *   like        ← likes
 *   comment     ← comments
 *   share       ← shares
 *   impression  ← impressions  (older media) — newer media use "views"; we map
 *                 whichever is present, preferring impressions.
 * IG has no post-level "click" metric, so none is emitted. Absent → no row.
 */
export function mapIGMetrics(
  platformPostId: string,
  resp: MetaInsightsResponse | null | undefined,
): MappedEvent[] {
  if (!resp?.data?.length) return [];
  const out: (MappedEvent | null)[] = [];
  out.push(row(platformPostId, "like", metaValue(resp, "likes")));
  out.push(row(platformPostId, "comment", metaValue(resp, "comments")));
  out.push(row(platformPostId, "share", metaValue(resp, "shares")));
  // Prefer "impressions"; fall back to "views" (newer IG media surface impressions as views).
  const impressions = metaValue(resp, "impressions") ?? metaValue(resp, "views");
  out.push(row(platformPostId, "impression", impressions));
  return out.filter((r): r is MappedEvent => r !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// LinkedIn — organizationalEntityShareStatistics (per share/ugcPost URN)
// ─────────────────────────────────────────────────────────────────────────────

export interface LinkedInTotalShareStatistics {
  clickCount?: number;
  commentCount?: number;
  engagement?: number;
  impressionCount?: number;
  likeCount?: number;
  shareCount?: number;
  uniqueImpressionsCount?: number;
}
export interface LinkedInShareStatElement {
  share?: string;
  ugcPost?: string;
  organizationalEntity?: string;
  totalShareStatistics?: LinkedInTotalShareStatistics;
}
export interface LinkedInShareStatisticsResponse {
  elements?: LinkedInShareStatElement[];
}

/**
 * Map a LinkedIn share-statistics response → SocialEvent rows for ONE post URN.
 * We poll one URN at a time, so we take the element matching `platformPostId`
 * (the stored share/ugcPost URN), else the first element. A URN absent from
 * `elements` means zero engagement (docs: "can be assumed to have counts of 0")
 * — that legitimately yields zero rows (empty-tolerant), not invented zeros.
 *   like        ← totalShareStatistics.likeCount
 *   comment     ← totalShareStatistics.commentCount
 *   share       ← totalShareStatistics.shareCount
 *   impression  ← totalShareStatistics.impressionCount
 *   click       ← totalShareStatistics.clickCount
 */
export function mapLinkedInMetrics(
  platformPostId: string,
  resp: LinkedInShareStatisticsResponse | null | undefined,
): MappedEvent[] {
  const els = resp?.elements;
  if (!els?.length) return [];
  const el = els.find((e) => e.share === platformPostId || e.ugcPost === platformPostId) ?? els[0];
  const s = el?.totalShareStatistics;
  if (!s) return [];
  const out: (MappedEvent | null)[] = [
    row(platformPostId, "like", s.likeCount),
    row(platformPostId, "comment", s.commentCount),
    row(platformPostId, "share", s.shareCount),
    row(platformPostId, "impression", s.impressionCount),
    row(platformPostId, "click", s.clickCount),
  ];
  return out.filter((r): r is MappedEvent => r !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Business Profile — no per-post insights API (permanently empty)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a GBP response → SocialEvent rows.
 * GBP has NO per-localPost engagement API (v4 reportInsights removed; the
 * Business Performance API is location-grain only). This always returns [].
 * Kept as a first-class mapper so the poller's per-platform switch is total and
 * a future GBP per-post surface slots in here without touching the caller.
 */
export function mapGBPMetrics(_platformPostId: string, _resp: unknown): MappedEvent[] {
  return [];
}
