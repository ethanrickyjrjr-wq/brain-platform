// lib/social/compose.ts
//
// Orchestrate one social posting run over a list of targets: per target,
// build the in-scope content, apply the MOAT .in_scope gate (no invented numbers),
// and compose the per-platform post payload. Pure/DI — all I/O (brain fetch,
// market content) is injected, so this is unit-testable with zero network/DB.
// A single target's failure NEVER throws past its boundary (it lands as an "error" row).
//
// Mirrored from: lib/email/outreach/campaign.ts:85-199 (composeCampaign)
// Key differences:
//   - No brand scrape / arrival URL (social posts to platform, not an email)
//   - No CAN-SPAM postal address / unsubscribe token
//   - Output is ComposedPost (caption + media), not HTML
//   - MOAT .in_scope gate is enforced via buildContent returning null

import type {
  SocialTarget,
  SocialContent,
  ComposedPost,
  ComposedSocialPost,
  ComposedStatus,
} from "./types";

export type { ComposedStatus };

export interface ComposeResult {
  posts: ComposedSocialPost[];
  summary: {
    total: number;
    ready: number;
    out_of_scope: number;
    error: number;
  };
}

/**
 * Compose (never publish) posts for a batch of social targets.
 *
 * - Returns `out_of_scope` when `buildContent` returns null (MOAT gate:
 *   the brain has no data at the requested grain — never invents a number).
 * - Per-target errors are isolated as `error` rows; the batch never throws.
 */
export async function composePosts(
  targets: SocialTarget[],
  buildContent: (target: SocialTarget) => Promise<SocialContent | null>,
): Promise<ComposeResult> {
  const posts: ComposedSocialPost[] = [];

  for (const target of targets) {
    try {
      // 1. Build content: brain dossier + scope → caption + hashtags + image.
      //    Returns null when the target is out of scope (MOAT: no data at this grain).
      const content = await buildContent(target);

      if (!content) {
        posts.push({
          scheduleId: target.scheduleId,
          platform: target.platform,
          accountId: target.accountId,
          status: "out_of_scope",
          reason: "no in-scope market content for this target",
        });
        continue;
      }

      // 2. Assemble the per-platform ComposedPost.
      const post: ComposedPost = {
        caption: content.caption,
        hashtags: content.hashtags,
        media: content.image ? [{ url: content.image.url, ratio: content.image.ratio }] : [],
        freshness: content.freshness,
      };

      posts.push({
        scheduleId: target.scheduleId,
        platform: target.platform,
        accountId: target.accountId,
        status: "ready",
        post,
      });
    } catch (err) {
      posts.push({
        scheduleId: target.scheduleId,
        platform: target.platform,
        accountId: target.accountId,
        status: "error",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary = {
    total: posts.length,
    ready: posts.filter((p) => p.status === "ready").length,
    out_of_scope: posts.filter((p) => p.status === "out_of_scope").length,
    error: posts.filter((p) => p.status === "error").length,
  };

  return { posts, summary };
}
