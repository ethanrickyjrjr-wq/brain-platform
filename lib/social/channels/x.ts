/**
 * lib/social/channels/x.ts
 *
 * X (Twitter) platform adapter — direct API, no paid middleman.
 *
 * VENDOR-VERIFIED (2026-06-20, re-verified in-session against live docs):
 *   Post endpoint:  POST https://api.x.com/2/tweets
 *   Scopes:         tweet.write tweet.read users.read offline.access media.write
 *                   (media.write is REQUIRED for the v2 media upload below — without it the
 *                    upload 401s even on a valid token; U1's oauth-config must request it.)
 *   Access TTL:     ~2 hours (short-lived OAuth2 bearer)
 *   Refresh:        POST https://api.twitter.com/2/oauth2/token (HTTP Basic; offline.access scope required)
 *   Rate limits:    100 tweet creates / 15 min per user (OAuth2)
 *   Paid tier:      Basic or higher required for meaningful volume. Quote-posting = Enterprise only.
 *   Media upload:   POST https://api.x.com/2/media/upload — v2 chunked (INIT → APPEND → FINALIZE),
 *                   multipart/form-data; media_category=tweet_image; the media id is at `data.id`.
 *                   ⚠ The legacy v1.1 endpoint (upload.twitter.com/1.1/media/upload.json, returning
 *                   media_id_string) was SUNSET 2025-06-09 — using it now hard-fails every image post.
 *   Link tax:       Posting a URL in the tweet body counts toward the 280-char limit and
 *                   may reduce reach. Mitigation: post the link as the FIRST REPLY to the tweet.
 *   Docs:           https://docs.x.com/x-api/posts/creation-of-a-post
 *                   https://docs.x.com/x-api/media/quickstart/media-upload-chunked
 *                   https://docs.x.com/x-api/fundamentals/rate-limits
 *
 * DRY MODE: callers MUST check SOCIAL_PUBLISH_ENABLED before calling this module.
 * This adapter also refuses to post when the flag is false (defensive double-gate).
 */

import type { PublishInput, PublishResult } from "../types";

const TWEET_ENDPOINT = "https://api.x.com/2/tweets";
const MEDIA_UPLOAD_ENDPOINT = "https://api.x.com/2/media/upload";

interface TweetCreateBody {
  text: string;
  media?: { media_ids: string[] };
  reply?: { in_reply_to_tweet_id: string };
}

interface TweetCreateResponse {
  data?: { id: string; text: string };
  errors?: Array<{ message: string; type: string }>;
}

/** v2 media upload responses: the media id lives at `data.id` (NOT the v1.1 `media_id_string`). */
interface MediaCommandResponse {
  data?: { id: string; media_key?: string };
  errors?: Array<{ message: string }>;
}

/** POST one multipart command (INIT/APPEND/FINALIZE) to the v2 media endpoint. */
async function mediaCommand(form: FormData, accessToken: string, label: string): Promise<Response> {
  const res = await fetch(MEDIA_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`X media ${label} failed (${res.status}): ${txt}`);
  }
  return res;
}

/**
 * Upload one image URL → X media asset → return the v2 media id (`data.id`).
 *
 * Uses the X API **v2** chunked upload (INIT → APPEND → FINALIZE) against
 * POST https://api.x.com/2/media/upload. A branded card is a single small image
 * (well under the 5 MB single-chunk limit), so one APPEND at segment_index=0 suffices;
 * images need no FINALIZE status-polling (that is only for async video processing).
 *
 * NOTE: the legacy v1.1 multipart endpoint was sunset 2025-06-09 — see the header block.
 */
async function uploadMedia(imageUrl: string, accessToken: string): Promise<string> {
  // 1. Fetch the image bytes
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to fetch media from ${imageUrl}: ${imgRes.status}`);
  const imgBuffer = await imgRes.arrayBuffer();
  const totalBytes = imgBuffer.byteLength;
  const mediaType = imgRes.headers.get("content-type") ?? "image/png";

  // 2. INIT — declare the upload; the media id comes back at data.id
  const initForm = new FormData();
  initForm.append("command", "INIT");
  initForm.append("media_type", mediaType);
  initForm.append("total_bytes", String(totalBytes));
  initForm.append("media_category", "tweet_image");
  const initRes = await mediaCommand(initForm, accessToken, "INIT");
  const initJson = (await initRes.json()) as MediaCommandResponse;
  const mediaId = initJson.data?.id;
  if (!mediaId) throw new Error("X media INIT response missing data.id");

  // 3. APPEND — upload the single chunk (segment_index=0)
  const appendForm = new FormData();
  appendForm.append("command", "APPEND");
  appendForm.append("media_id", mediaId);
  appendForm.append("segment_index", "0");
  appendForm.append("media", new Blob([imgBuffer], { type: mediaType }), "media");
  await mediaCommand(appendForm, accessToken, "APPEND");

  // 4. FINALIZE — completes the upload; data.id is the id to attach to the tweet
  const finalizeForm = new FormData();
  finalizeForm.append("command", "FINALIZE");
  finalizeForm.append("media_id", mediaId);
  const finalizeRes = await mediaCommand(finalizeForm, accessToken, "FINALIZE");
  const finalizeJson = (await finalizeRes.json()) as MediaCommandResponse;
  return finalizeJson.data?.id ?? mediaId;
}

/**
 * Post a tweet (text only, or text + media IDs).
 * Returns the created tweet ID.
 */
async function createTweet(body: TweetCreateBody, accessToken: string): Promise<string> {
  const res = await fetch(TWEET_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`X tweet creation failed (${res.status}): ${txt}`);
  }

  const json = (await res.json()) as TweetCreateResponse;
  if (json.errors?.length) {
    throw new Error(`X tweet error: ${json.errors.map((e) => e.message).join(", ")}`);
  }
  if (!json.data?.id) throw new Error("X tweet response missing data.id");
  return json.data.id;
}

/**
 * X publish adapter.
 *
 * Strategy:
 *   1. Upload media assets (if any) → collect media_ids
 *   2. Post the tweet body (caption only, NO link in body — link tax avoidance)
 *   3. If a link is present in the caption, strip it from the tweet and
 *      post it as the FIRST REPLY to the tweet (link-in-first-reply pattern)
 *
 * Link-in-first-reply: avoids the ~$0.20 X link-post fee and reach penalty
 * for tweets containing URLs. The caller (compose.ts) should emit `link`
 * separately from `caption` when this applies; for now we detect a trailing URL.
 *
 * The caller is responsible for providing a valid (non-expired) access_token.
 * The dispatcher (channels/index.ts) handles refresh-before-post.
 */
export async function postToX(input: PublishInput, accessToken: string): Promise<PublishResult> {
  // DRY MODE guard — defensive second check
  if (!process.env.SOCIAL_PUBLISH_ENABLED || process.env.SOCIAL_PUBLISH_ENABLED !== "true") {
    return { ok: false, error: "SOCIAL_PUBLISH_ENABLED is not true — DRY MODE, no post made" };
  }

  try {
    // 1. Upload media (if any — X supports up to 4 images per tweet)
    const mediaIds: string[] = [];
    for (const m of input.media.slice(0, 4)) {
      const id = await uploadMedia(m.url, accessToken);
      mediaIds.push(id);
    }

    // 2. Detect link-in-caption (trailing URL pattern)
    const urlRegex = /https?:\/\/\S+$/;
    const urlMatch = input.caption.match(urlRegex);
    const linkUrl = urlMatch ? urlMatch[0] : null;
    const tweetText = linkUrl ? input.caption.replace(urlRegex, "").trim() : input.caption;

    // 3. Post the main tweet (caption without URL)
    const body: TweetCreateBody = { text: tweetText };
    if (mediaIds.length > 0) body.media = { media_ids: mediaIds };

    const tweetId = await createTweet(body, accessToken);

    // 4. Link-in-first-reply: post the link as a reply (avoids link tax)
    if (linkUrl) {
      await createTweet(
        {
          text: linkUrl,
          reply: { in_reply_to_tweet_id: tweetId },
        },
        accessToken,
      );
    }

    return { ok: true, platform_post_id: tweetId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
