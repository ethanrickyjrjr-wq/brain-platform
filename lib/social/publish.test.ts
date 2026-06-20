import { describe, expect, it } from "bun:test";
import { buildSocialBatch, publishBatches } from "./publish";
import type { ComposedSocialPost, SocialPublisher } from "./types";

function ready(over: Partial<ComposedSocialPost> = {}): ComposedSocialPost {
  return {
    scheduleId: 1,
    platform: "linkedin",
    accountId: "acct-1",
    status: "ready",
    post: {
      caption: "SWFL market update: home values up 4%.",
      hashtags: ["#SWFL"],
      media: [{ url: "https://cdn.example.com/img.png", ratio: "1:1" }],
      freshness: "SWFL-7421-v5-20260620",
    },
    ...over,
  };
}

describe("buildSocialBatch", () => {
  it("includes only ready posts with a post payload", () => {
    const posts = [
      ready(),
      ready({ status: "out_of_scope", post: undefined }),
      ready({ status: "error", post: undefined }),
    ];
    const batches = buildSocialBatch(posts);
    expect(batches.flat()).toHaveLength(1);
  });

  it("returns empty when all posts are non-ready", () => {
    expect(buildSocialBatch([ready({ status: "out_of_scope", post: undefined })])).toEqual([]);
  });

  it("chunks into batches of 50", () => {
    const posts = Array.from({ length: 120 }, (_, i) =>
      ready({ scheduleId: i, accountId: `acct-${i}` }),
    );
    const batches = buildSocialBatch(posts);
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
  });
});

describe("publishBatches — DRY mode", () => {
  const neverCall: SocialPublisher = {
    post: async () => {
      throw new Error("should not be called in dry mode");
    },
  };

  it("counts dry-run without calling the publisher", async () => {
    const batches = buildSocialBatch([ready(), ready({ scheduleId: 2 })]);
    const result = await publishBatches(neverCall, batches, true);
    expect(result.dryRun).toBe(2);
    expect(result.published).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe("publishBatches — LIVE mode", () => {
  it("counts published across batches on success", async () => {
    const publisher: SocialPublisher = {
      post: async () => ({ ok: true, platform_post_id: "pid-123" }),
    };
    const batches = buildSocialBatch([ready(), ready({ scheduleId: 2 })]);
    const result = await publishBatches(publisher, batches, false);
    expect(result.published).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.dryRun).toBe(0);
  });

  it("counts a failed publish and records the error", async () => {
    const publisher: SocialPublisher = {
      post: async () => ({ ok: false, error: "rate limited" }),
    };
    const batches = buildSocialBatch([ready()]);
    const result = await publishBatches(publisher, batches, false);
    expect(result.failed).toBe(1);
    expect(result.published).toBe(0);
    expect(result.errors).toContain("rate limited");
  });

  it("survives a thrown publisher error as a per-post failure", async () => {
    const publisher: SocialPublisher = {
      post: async () => {
        throw new Error("ECONNRESET");
      },
    };
    const batches = buildSocialBatch([ready()]);
    const result = await publishBatches(publisher, batches, false);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("ECONNRESET");
  });
});
