import { describe, expect, it } from "bun:test";
import {
  mapXMetrics,
  mapMetaPostMetrics,
  mapIGMetrics,
  mapLinkedInMetrics,
  mapGBPMetrics,
  type MappedEvent,
} from "./engagement";
import {
  pollEngagement,
  fetchAndMapFor,
  type PollablePost,
  type PollEvent,
  type FetchSeams,
} from "../../scripts/social/poll-engagement.mts";

// ─────────────────────────────────────────────────────────────────────────────
// Per-platform mapper correctness (mock responses → expected SocialEvent rows)
// ─────────────────────────────────────────────────────────────────────────────

describe("mapXMetrics", () => {
  it("maps public_metrics to like/comment/share/impression (no click)", () => {
    const out = mapXMetrics("tweet-1", {
      data: {
        id: "tweet-1",
        public_metrics: {
          like_count: 10,
          reply_count: 3,
          retweet_count: 4,
          quote_count: 2,
          impression_count: 500,
          bookmark_count: 7,
        },
      },
    });
    // share = reposts(4) + quotes(2) = 6; bookmark is NOT in our vocab.
    expect(out).toEqual([
      { platform_post_id: "tweet-1", metric: "like", value: 10, source: "poll" },
      { platform_post_id: "tweet-1", metric: "comment", value: 3, source: "poll" },
      { platform_post_id: "tweet-1", metric: "share", value: 6, source: "poll" },
      { platform_post_id: "tweet-1", metric: "impression", value: 500, source: "poll" },
    ]);
    // X never emits a click from the public read (non_public_metrics is gated).
    expect(out.find((e) => e.metric === "click")).toBeUndefined();
  });

  it("emits only the metrics present (no zero-fill)", () => {
    const out = mapXMetrics("t", { data: { public_metrics: { like_count: 1 } } });
    expect(out).toEqual([{ platform_post_id: "t", metric: "like", value: 1, source: "poll" }]);
  });

  it("returns [] when public_metrics is absent (gated/empty)", () => {
    expect(mapXMetrics("t", { data: {} })).toEqual([]);
    expect(mapXMetrics("t", null)).toEqual([]);
    expect(mapXMetrics("t", undefined)).toEqual([]);
  });
});

describe("mapMetaPostMetrics (Facebook page post)", () => {
  it("sums object-valued reactions into like; maps impression + click", () => {
    const out = mapMetaPostMetrics("fb-1", {
      data: [
        { name: "post_impressions", values: [{ value: 800 }] },
        { name: "post_clicks", values: [{ value: 12 }] },
        { name: "post_reactions_by_type_total", values: [{ value: { like: 9, love: 3, wow: 1 } }] },
      ],
    });
    const byMetric = Object.fromEntries(out.map((e) => [e.metric, e.value]));
    expect(byMetric).toEqual({ like: 13, impression: 800, click: 12 });
  });

  it("returns [] for an empty data array (gated/no insights perm)", () => {
    expect(mapMetaPostMetrics("fb-1", { data: [] })).toEqual([]);
    expect(mapMetaPostMetrics("fb-1", null)).toEqual([]);
  });
});

describe("mapIGMetrics (instagram media)", () => {
  it("maps likes/comments/shares/impressions", () => {
    const out = mapIGMetrics("ig-1", {
      data: [
        { name: "likes", values: [{ value: 40 }] },
        { name: "comments", values: [{ value: 5 }] },
        { name: "shares", values: [{ value: 2 }] },
        { name: "impressions", values: [{ value: 1200 }] },
      ],
    });
    expect(Object.fromEntries(out.map((e) => [e.metric, e.value]))).toEqual({
      like: 40,
      comment: 5,
      share: 2,
      impression: 1200,
    });
  });

  it("falls back to views when impressions is absent", () => {
    const out = mapIGMetrics("ig-2", { data: [{ name: "views", values: [{ value: 333 }] }] });
    expect(out).toEqual([
      { platform_post_id: "ig-2", metric: "impression", value: 333, source: "poll" },
    ]);
  });
});

describe("mapLinkedInMetrics", () => {
  it("maps totalShareStatistics for the matching share URN", () => {
    const out = mapLinkedInMetrics("urn:li:share:1000000", {
      elements: [
        {
          share: "urn:li:share:1000000",
          totalShareStatistics: {
            clickCount: 78,
            commentCount: 24,
            impressionCount: 5287,
            likeCount: 14,
            shareCount: 5,
            engagement: 0.02,
            uniqueImpressionsCount: 4000,
          },
        },
      ],
    });
    expect(Object.fromEntries(out.map((e) => [e.metric, e.value]))).toEqual({
      like: 14,
      comment: 24,
      share: 5,
      impression: 5287,
      click: 78,
    });
  });

  it("returns [] when no elements (URN absent = zero engagement, never invented)", () => {
    expect(mapLinkedInMetrics("urn:li:share:x", { elements: [] })).toEqual([]);
    expect(mapLinkedInMetrics("urn:li:share:x", null)).toEqual([]);
  });
});

describe("mapGBPMetrics", () => {
  it("always returns [] (no per-post insights API)", () => {
    expect(mapGBPMetrics("gbp-post", {})).toEqual([]);
    expect(mapGBPMetrics("gbp-post", { anything: 1 })).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchAndMapFor — per-platform dispatch is empty-tolerant
// ─────────────────────────────────────────────────────────────────────────────

/** Seams that all return null — simulating a fully gated/silent platform read. */
const nullSeams: FetchSeams = {
  fetchX: async () => null,
  fetchMetaPost: async () => null,
  fetchIG: async () => null,
  fetchLinkedIn: async () => null,
  fetchGBP: async () => null,
};

function post(over: Partial<PollablePost> = {}): PollablePost {
  return {
    id: "sp-1",
    user_id: "user-1",
    platform: "x",
    platform_post_id: "pid-1",
    account_id: "acct-1",
    org_urn: null,
    ...over,
  };
}

describe("fetchAndMapFor — empty-tolerant dispatch", () => {
  it("a gated read on every platform yields zero events, no throw", async () => {
    for (const platform of ["x", "facebook", "instagram", "linkedin", "google_business"] as const) {
      const events = await fetchAndMapFor(post({ platform }), "tok", nullSeams);
      expect(events).toEqual([]);
    }
  });

  it("routes X through mapXMetrics on a real response", async () => {
    const seams: FetchSeams = {
      ...nullSeams,
      fetchX: async () => ({ data: { public_metrics: { like_count: 9 } } }),
    };
    const events = await fetchAndMapFor(post({ platform: "x" }), "tok", seams);
    expect(events).toEqual([
      { platform_post_id: "pid-1", metric: "like", value: 9, source: "poll" },
    ]);
  });

  it("passes the org URN through to the LinkedIn fetcher", async () => {
    let seenOrg: string | null | undefined = "UNSET";
    const seams: FetchSeams = {
      ...nullSeams,
      fetchLinkedIn: async (_id, _tok, org) => {
        seenOrg = org;
        return null;
      },
    };
    await fetchAndMapFor(
      post({ platform: "linkedin", org_urn: "urn:li:organization:42" }),
      "tok",
      seams,
    );
    expect(seenOrg).toBe("urn:li:organization:42");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pollEngagement core — empty-tolerance + dry_run + dedup-via-upsert
// ─────────────────────────────────────────────────────────────────────────────

describe("pollEngagement — empty-platform tolerance", () => {
  it("a gated platform produces zero events and never throws (counted as empty)", async () => {
    const upserted: PollEvent[][] = [];
    const summary = await pollEngagement([post(), post({ id: "sp-2" })], {
      getToken: async () => "tok",
      fetchAndMap: async () => [], // every platform gated/silent
      upsert: async (events) => {
        upserted.push(events);
      },
    });
    expect(summary.empty).toBe(2);
    expect(summary.polled).toBe(0);
    expect(summary.events).toBe(0);
    expect(summary.errors).toBe(0);
    expect(upserted).toHaveLength(0); // nothing to write for a silent platform
  });

  it("isolates a per-post token failure without failing the batch", async () => {
    const summary = await pollEngagement([post({ id: "ok" }), post({ id: "bad" })], {
      getToken: async (p) => {
        if (p.id === "bad") throw new Error("token revoked");
        return "tok";
      },
      fetchAndMap: async () => [
        { platform_post_id: "pid-1", metric: "like", value: 1, source: "poll" },
      ],
      upsert: async () => {},
    });
    expect(summary.errors).toBe(1);
    expect(summary.polled).toBe(1); // the good post still polled
  });
});

describe("pollEngagement — DRY_RUN skips writes", () => {
  it("maps + counts but never calls upsert in dry mode", async () => {
    let upsertCalls = 0;
    const summary = await pollEngagement([post()], {
      getToken: async () => "tok",
      fetchAndMap: async () => [
        { platform_post_id: "pid-1", metric: "like", value: 5, source: "poll" },
      ],
      upsert: async () => {
        upsertCalls += 1;
      },
      dryRun: true,
    });
    expect(upsertCalls).toBe(0);
    expect(summary.polled).toBe(1);
    expect(summary.events).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dedup: re-polling the same metric updates ONE row (never duplicates).
// Simulate the (social_post_id, metric) ON CONFLICT upsert the DB enforces.
// ─────────────────────────────────────────────────────────────────────────────

/** A tiny in-memory store keyed on (social_post_id, metric) — the dedup key. */
function makeDedupStore() {
  const rows = new Map<string, PollEvent>();
  return {
    rows,
    upsert: async (events: PollEvent[]) => {
      for (const e of events) rows.set(`${e.social_post_id}|${e.metric}`, e); // last write wins
    },
    count: () => rows.size,
    valueOf: (postId: string, metric: string) => rows.get(`${postId}|${metric}`)?.value,
  };
}

describe("dedup on (social_post_id, metric)", () => {
  it("polling the same post twice updates the row in place — one effective row per metric", async () => {
    const store = makeDedupStore();
    const p = post();

    // First poll: like=10, impression=100.
    let response: MappedEvent[] = [
      { platform_post_id: "pid-1", metric: "like", value: 10, source: "poll" },
      { platform_post_id: "pid-1", metric: "impression", value: 100, source: "poll" },
    ];
    const deps = {
      getToken: async () => "tok",
      fetchAndMap: async () => response,
      upsert: store.upsert,
    };
    await pollEngagement([p], deps);
    expect(store.count()).toBe(2);
    expect(store.valueOf("sp-1", "like")).toBe(10);

    // Second poll (engagement grew): like=25, impression=300.
    response = [
      { platform_post_id: "pid-1", metric: "like", value: 25, source: "poll" },
      { platform_post_id: "pid-1", metric: "impression", value: 300, source: "poll" },
    ];
    await pollEngagement([p], deps);

    // Still exactly two rows — re-poll updated values in place, did NOT duplicate.
    expect(store.count()).toBe(2);
    expect(store.valueOf("sp-1", "like")).toBe(25);
    expect(store.valueOf("sp-1", "impression")).toBe(300);
  });

  it("two different posts keep separate rows for the same metric", async () => {
    const store = makeDedupStore();
    await pollEngagement([post({ id: "A" }), post({ id: "B" })], {
      getToken: async () => "tok",
      fetchAndMap: async () => [
        { platform_post_id: "pid", metric: "like", value: 1, source: "poll" },
      ],
      upsert: store.upsert,
    });
    expect(store.count()).toBe(2); // (A,like) and (B,like) are distinct keys
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Poller skips dry_run rows: a row with no platform_post_id is never pollable.
// (The adapter's candidate query filters `platform_post_id IS NOT NULL`; this
//  asserts the contract that PollablePost always carries a non-null id, so a
//  dry_run / queued post can never enter the poll set.)
// ─────────────────────────────────────────────────────────────────────────────

describe("poller skips dry_run / unpublished rows", () => {
  it("simulates the candidate filter: rows without platform_post_id are excluded", async () => {
    // Mirror the adapter's filter (status='published' AND platform_post_id NOT NULL).
    const raw = [
      { id: "live", status: "published", platform_post_id: "pid-live" },
      { id: "dry", status: "dry_run", platform_post_id: null },
      { id: "queued", status: "queued", platform_post_id: null },
    ];
    const pollable: PollablePost[] = raw
      .filter((r) => r.status === "published" && r.platform_post_id != null)
      .map((r) => post({ id: r.id, platform_post_id: r.platform_post_id! }));

    expect(pollable.map((p) => p.id)).toEqual(["live"]);

    const polledIds: string[] = [];
    await pollEngagement(pollable, {
      getToken: async () => "tok",
      fetchAndMap: async (p) => {
        polledIds.push(p.id);
        return [{ platform_post_id: p.platform_post_id, metric: "like", value: 1, source: "poll" }];
      },
      upsert: async () => {},
    });
    // Only the published row with a platform_post_id was ever polled.
    expect(polledIds).toEqual(["live"]);
  });
});
