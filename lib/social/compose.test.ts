import { describe, expect, it } from "bun:test";
import { composePosts } from "./compose";
import type { SocialTarget, SocialContent } from "./types";

function makeTarget(over: Partial<SocialTarget> = {}): SocialTarget {
  return {
    scheduleId: 1,
    userId: "user-abc",
    platform: "linkedin",
    accountId: "acct-1",
    scopeKind: "zip",
    scopeValue: "33931",
    topic: null,
    cadence: "weekly",
    hashtags: ["#SWFL"],
    contentTemplate: "stat_card",
    freshnessGate: true,
    lastFreshnessToken: null,
    ...over,
  };
}

function makeContent(over: Partial<SocialContent> = {}): SocialContent {
  return {
    caption: "Fort Myers Beach: home values up 4% YoY.",
    hashtags: ["#FortMyersBeach", "#SWFL"],
    freshness: "SWFL-7421-v5-20260620",
    ...over,
  };
}

describe("composePosts", () => {
  it("returns a ready post for an in-scope target", async () => {
    const { posts, summary } = await composePosts([makeTarget()], async () => makeContent());
    expect(summary).toMatchObject({ total: 1, ready: 1, out_of_scope: 0, error: 0 });
    const p = posts[0];
    expect(p.status).toBe("ready");
    expect(p.post?.caption).toContain("Fort Myers Beach");
    expect(p.post?.freshness).toBe("SWFL-7421-v5-20260620");
  });

  it("marks target out_of_scope when buildContent returns null (MOAT gate)", async () => {
    const { posts, summary } = await composePosts([makeTarget()], async () => null);
    expect(summary.out_of_scope).toBe(1);
    expect(posts[0].status).toBe("out_of_scope");
    expect(posts[0].post).toBeUndefined();
  });

  it("isolates a per-target failure as an error row (never throws the batch)", async () => {
    const targets = [makeTarget({ scheduleId: 1 }), makeTarget({ scheduleId: 2, platform: "x" })];
    const { posts, summary } = await composePosts(targets, async (t) => {
      if (t.scheduleId === 1) throw new Error("brain fetch failed");
      return makeContent();
    });
    expect(summary).toMatchObject({ total: 2, ready: 1, error: 1 });
    const errRow = posts.find((p) => p.status === "error");
    expect(errRow?.scheduleId).toBe(1);
    expect(errRow?.reason).toContain("brain fetch failed");
  });

  it("includes media when content provides an image", async () => {
    const { posts } = await composePosts([makeTarget()], async () =>
      makeContent({ image: { url: "https://cdn.example.com/img.png", ratio: "1:1" } }),
    );
    expect(posts[0].post?.media).toHaveLength(1);
    expect(posts[0].post?.media[0].ratio).toBe("1:1");
  });

  it("handles an empty target list gracefully", async () => {
    const { posts, summary } = await composePosts([], async () => makeContent());
    expect(summary.total).toBe(0);
    expect(posts).toHaveLength(0);
  });

  it("passes the platform through to the composed post", async () => {
    const { posts } = await composePosts([makeTarget({ platform: "x" })], async () =>
      makeContent(),
    );
    expect(posts[0].platform).toBe("x");
  });
});
