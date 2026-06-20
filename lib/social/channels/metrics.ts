/**
 * lib/social/channels/metrics.ts
 *
 * Per-platform engagement-metrics FETCHERS (the read side; sibling to the
 * write-side adapters x.ts / meta.ts / linkedin.ts / gbp.ts — this is a NEW file,
 * those are untouched). Given a resolved access token + a platform_post_id, each
 * fetcher calls the platform's live read API and returns the RAW JSON response.
 * The pure mappers in ../engagement.ts turn that raw shape into SocialEvent rows.
 *
 * EMPTY-TOLERANT CONTRACT (Operation Dumbo Drop): a gated / unavailable / errored
 * read returns `null` — never throws. The poller treats null as "this platform
 * told us nothing this cycle" and writes zero rows for that post. A silent
 * platform must never fail the whole poll.
 *
 * VENDOR-VERIFIED (2026-06-20) — endpoints + response shapes confirmed in-session:
 *   X:        GET https://api.x.com/2/tweets/:id?tweet.fields=public_metrics
 *             scope tweet.read; public_metrics has like/reply/retweet/quote/impression/bookmark_count.
 *             Docs: https://docs.x.com/x-api/fundamentals/metrics
 *   Meta FB:  GET https://graph.facebook.com/v19.0/{post-id}/insights?metric=...
 *             perms pages_read_engagement, read_insights.
 *             Docs: https://developers.facebook.com/docs/graph-api/reference/post/insights
 *   Meta IG:  GET https://graph.facebook.com/v19.0/{ig-media-id}/insights?metric=...
 *             perms instagram_basic, instagram_manage_insights, pages_read_engagement.
 *             Docs: https://developers.facebook.com/docs/instagram-api/reference/ig-media/insights
 *   LinkedIn: GET https://api.linkedin.com/rest/organizationalEntityShareStatistics
 *             ?q=organizationalEntity&organizationalEntity={org}&shares=List({urn})  (or ugcPosts[0]=)
 *             perm rw_organization_admin; header LinkedIn-Version: YYYYMM.
 *             Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics
 *   GBP:      NO per-post insights API — v4 localPosts.reportInsights REMOVED, the
 *             Business Performance API is location-grain only. fetchGBPMetrics → null always.
 *             Docs: https://developers.google.com/my-business/content/sunset-dates
 */

import type {
  XTweetMetricsResponse,
  MetaInsightsResponse,
  LinkedInShareStatisticsResponse,
} from "../engagement";

const GRAPH_BASE = "https://graph.facebook.com/v19.0";
const LINKEDIN_API = "https://api.linkedin.com";
// Keep in lockstep with channels/linkedin.ts's LINKEDIN_VERSION (write side).
const LINKEDIN_VERSION = "202501";

/** Per-fetch timeout so one hung read can't stall the sequential poll batch. */
const READ_TIMEOUT_MS = 15_000;

/** Parse a JSON body, returning null on any non-2xx / parse failure (never throws). */
async function readJsonOrNull<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// X (Twitter)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch public engagement metrics for one tweet.
 * GET /2/tweets/:id?tweet.fields=public_metrics. Returns the raw response, or
 * null if gated / errored / unparseable.
 */
export async function fetchXMetrics(
  platformPostId: string,
  accessToken: string,
): Promise<XTweetMetricsResponse | null> {
  try {
    const url = `https://api.x.com/2/tweets/${encodeURIComponent(
      platformPostId,
    )}?tweet.fields=public_metrics`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    return await readJsonOrNull<XTweetMetricsResponse>(res);
  } catch {
    return null; // network/timeout → empty-tolerant
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta — Facebook Page post
// ─────────────────────────────────────────────────────────────────────────────

const FB_POST_METRICS = ["post_impressions", "post_clicks", "post_reactions_by_type_total"];

/**
 * Fetch insights for one Facebook Page post.
 * GET /{post-id}/insights?metric=post_impressions,post_clicks,post_reactions_by_type_total.
 * The Page access token (FB Page tokens are permanent) goes in the query per Graph
 * convention. Returns null if gated (no read_insights) / errored.
 */
export async function fetchMetaPostMetrics(
  platformPostId: string,
  accessToken: string,
): Promise<MetaInsightsResponse | null> {
  try {
    const params = new URLSearchParams({
      metric: FB_POST_METRICS.join(","),
      access_token: accessToken,
    });
    const url = `${GRAPH_BASE}/${encodeURIComponent(platformPostId)}/insights?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    return await readJsonOrNull<MetaInsightsResponse>(res);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta — Instagram media
// ─────────────────────────────────────────────────────────────────────────────

const IG_MEDIA_METRICS = ["likes", "comments", "shares", "impressions"];

/**
 * Fetch insights for one Instagram media object.
 * GET /{ig-media-id}/insights?metric=likes,comments,shares,impressions.
 * Returns null if gated (account not Business/Creator, missing instagram_manage_insights)
 * or errored — empty-tolerant.
 */
export async function fetchIGMetrics(
  platformPostId: string,
  accessToken: string,
): Promise<MetaInsightsResponse | null> {
  try {
    const params = new URLSearchParams({
      metric: IG_MEDIA_METRICS.join(","),
      access_token: accessToken,
    });
    const url = `${GRAPH_BASE}/${encodeURIComponent(platformPostId)}/insights?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    return await readJsonOrNull<MetaInsightsResponse>(res);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LinkedIn — organization share statistics (per share/ugcPost URN)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch share statistics for one LinkedIn post URN.
 *
 * organizationalEntityShareStatistics requires the owning organization URN AND a
 * share/ugcPost URN. `orgUrn` comes from the social_accounts.platform_account_id
 * (the connected org). The post URN form (urn:li:share:… vs urn:li:ugcPost:…)
 * selects the query param. Member-post statistics use a different endpoint and a
 * different permission — not supported here (returns null, empty-tolerant).
 *
 * @param platformPostId  the stored post URN (urn:li:share:… or urn:li:ugcPost:…)
 * @param accessToken     org-admin token
 * @param orgUrn          urn:li:organization:{id} that owns the post
 */
export async function fetchLinkedInMetrics(
  platformPostId: string,
  accessToken: string,
  orgUrn: string | null | undefined,
): Promise<LinkedInShareStatisticsResponse | null> {
  // Org URN is mandatory for this endpoint, and only org shares/ugcPosts are
  // supported. A member post (or a missing org) → nothing we can read.
  if (!orgUrn) return null;
  const isUgc = platformPostId.includes(":ugcPost:");
  const isShare = platformPostId.includes(":share:");
  if (!isUgc && !isShare) return null;

  try {
    const params = new URLSearchParams({
      q: "organizationalEntity",
      organizationalEntity: orgUrn,
    });
    // Restli list syntax differs by URN kind (verified shapes in the docs):
    //   shares=List({shareUrn})   |   ugcPosts[0]={ugcPostUrn}
    if (isUgc) {
      params.set("ugcPosts[0]", platformPostId);
    } else {
      params.set("shares", `List(${platformPostId})`);
    }
    const url = `${LINKEDIN_API}/rest/organizationalEntityShareStatistics?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "LinkedIn-Version": LINKEDIN_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    return await readJsonOrNull<LinkedInShareStatisticsResponse>(res);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Business Profile — no per-post insights API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GBP has NO per-localPost engagement read. Always returns null.
 * Present so the poller's per-platform fetch switch is total; when/if Google
 * ships a per-post surface, wire it here without touching the caller.
 */
export async function fetchGBPMetrics(
  _platformPostId: string,
  _accessToken: string,
): Promise<null> {
  return null;
}
