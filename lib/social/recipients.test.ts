import { describe, expect, test } from "bun:test";
import { buildPostRow } from "./recipients";
import type { PostInsertInput } from "./recipients";

const baseInput: PostInsertInput = {
  scheduleId: 1,
  accountId: "acct-abc",
  platform: "linkedin",
  caption: "SWFL home values up 4%.",
  mediaUrl: "https://cdn.example.com/img.png",
  freshnesToken: "SWFL-7421-v5-20260620",
  idempotencyKey: "post:1:2026-06-20",
  platformPostId: "urn:li:share:123456789",
  status: "published",
  publishedAt: "2026-06-20T13:01:00Z",
};

describe("buildPostRow", () => {
  test("maps a published post with all fields", () => {
    const row = buildPostRow(baseInput);
    expect(row).toEqual({
      post_schedule_id: 1,
      social_account_id: "acct-abc",
      platform: "linkedin",
      platform_post_id: "urn:li:share:123456789",
      freshness_token: "SWFL-7421-v5-20260620",
      caption: "SWFL home values up 4%.",
      media_url: "https://cdn.example.com/img.png",
      status: "published",
      error: null,
      idempotency_key: "post:1:2026-06-20",
      published_at: "2026-06-20T13:01:00Z",
    });
  });

  test("maps a dry_run post (no platform_post_id, no published_at)", () => {
    const row = buildPostRow({
      ...baseInput,
      platformPostId: null,
      status: "dry_run",
      publishedAt: null,
    });
    expect(row.status).toBe("dry_run");
    expect(row.platform_post_id).toBeNull();
    expect(row.published_at).toBeNull();
  });

  test("maps a failed post (error present)", () => {
    const row = buildPostRow({
      ...baseInput,
      status: "failed",
      error: "rate limited",
      platformPostId: null,
    });
    expect(row.status).toBe("failed");
    expect(row.error).toBe("rate limited");
  });

  test("handles a one-off post (null scheduleId)", () => {
    const row = buildPostRow({ ...baseInput, scheduleId: null });
    expect(row.post_schedule_id).toBeNull();
  });

  test("handles missing optional fields → null", () => {
    const row = buildPostRow({
      ...baseInput,
      mediaUrl: null,
      freshnesToken: null,
    });
    expect(row.media_url).toBeNull();
    expect(row.freshness_token).toBeNull();
  });
});
