// lib/social/publish.ts
//
// Turn composed social posts into platform-publish batches, and publish them.
// The BATCH BUILDING is pure + tested (chunked, filtered to ready posts only).
// The PUBLISH is a thin I/O wrapper over the injected SocialPublisher.
//
// Mirrored from: lib/email/outreach/send.ts:38-98 (buildBatchMessages / sendBatches)
// KEY DIFFERENCES vs. the email version:
//   - DROP unsubscribe tokens / CAN-SPAM List-Unsubscribe headers
//   - DROP per-recipient rid tags (no webhook; polling tracks engagement)
//   - ADD DRY_RUN short-circuit: when dryRun=true, record without calling publisher
//   - Input is ComposedSocialPost[], not ComposedMessage[]

import type { ComposedSocialPost, SocialPublisher, SocialBatch, BatchPublishResult } from "./types";

const CHUNK = 50; // social posts are heavier (image upload) — smaller chunk than email

/** Build ready posts into flat batches of ≤CHUNK. Pure. */
export function buildSocialBatch(posts: ComposedSocialPost[]): SocialBatch[][] {
  const ready = posts.filter(
    (p): p is ComposedSocialPost & { post: NonNullable<typeof p.post> } =>
      p.status === "ready" && p.post != null,
  );

  const flat: SocialBatch[] = ready.map((p) => ({
    target: {
      scheduleId: p.scheduleId,
      platform: p.platform,
      accountId: p.accountId,
      // These fields are needed downstream for the publish call; compose already
      // has them bound in the target. We carry just what's needed for the publish.
      scopeKind: null,
      scopeValue: null,
      topic: null,
      userId: "", // filled by caller from SocialTarget before batching
      cadence: "daily", // filled by caller
      hashtags: p.post.hashtags,
      contentTemplate: null,
      freshnessGate: false,
      lastFreshnessToken: null,
    },
    post: p.post,
  }));

  const batches: SocialBatch[][] = [];
  for (let i = 0; i < flat.length; i += CHUNK) batches.push(flat.slice(i, i + CHUNK));
  return batches;
}

/**
 * Publish pre-built batches via the injected SocialPublisher.
 *
 * DRY_RUN mode (dryRun=true): the platform call is short-circuited; the
 * result is recorded as `dryRun` count. Zero platform API calls, zero cost.
 * This is the default state until SOCIAL_PUBLISH_ENABLED is flipped.
 *
 * A failed post counts as `failed`; it does NOT throw past this boundary.
 */
export async function publishBatches(
  publisher: SocialPublisher,
  batches: SocialBatch[][],
  dryRun = true,
): Promise<BatchPublishResult> {
  let published = 0;
  let dryRunCount = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const batch of batches) {
    for (const item of batch) {
      if (dryRun) {
        // Short-circuit: record intent, never call the platform
        dryRunCount++;
        continue;
      }
      try {
        const result = await publisher.post({
          platform: item.target.platform,
          accountId: item.target.accountId,
          caption: item.post.caption,
          media: item.post.media,
        });
        if (result.ok) {
          published++;
        } else {
          failed++;
          errors.push(result.error ?? "unknown publish error");
        }
      } catch (err) {
        failed++;
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  return { published, dryRun: dryRunCount, failed, errors };
}
