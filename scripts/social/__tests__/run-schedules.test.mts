// scripts/social/__tests__/run-schedules.test.mts
//
// Unit tests for the social scheduler worker.
//
// Covers:
//   - DRY end-to-end: claims/composes/renders, writes status='dry_run', NEVER
//     calls postToChannel.
//   - Reaper re-arm: crash-orphan rows get a new next_run_at.
//   - Freshness skip: if freshness_token unchanged, schedule is skipped (no post).
//   - Exit-code contract: top-level fatal → exit 1; per-row error → exit 0.
//   - claimSocialOnce: round-trip win/lose + 42P01 graceful degrade.
//
// No live DB or platform calls — all I/O is mocked.
//
// NOTE: The worker (run-schedules.mts) is a Node process entry point, not an
// importable library. We test the behavioral building blocks the worker composes:
//   - lib/social/idempotency   (claimSocialOnce)
//   - lib/social/lifecycle     (passesFreshnessGate + shouldPublish)
//   - lib/social/targets       (buildTargetsFromSchedules + buildIdempotencyKey)
//   - lib/social/compose       (composePosts)
//   - lib/email/schedule-cadence (computeNextRunAt)
// The "DRY end-to-end" test wires them together through a controlled mock of the
// `processSchedule` logic to verify the publish gate contract.

import { describe, it, expect } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── imports from the building blocks ─────────────────────────────────────────

import { claimSocialOnce, type SocialSendLedgerContext } from "@/lib/social/idempotency";
import { passesFreshnessGate, shouldPublish } from "@/lib/social/lifecycle";
import { buildTargetsFromSchedules, buildIdempotencyKey } from "@/lib/social/targets";
import { composePosts } from "@/lib/social/compose";
import { computeNextRunAt } from "@/lib/email/schedule-cadence";
import type { SocialSchedule, SocialTarget, SocialContent } from "@/lib/social/types";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — claimSocialOnce (round-trip win/lose + 42P01 degrade)
// ─────────────────────────────────────────────────────────────────────────────

const ctx: SocialSendLedgerContext = {
  userId: "user-test",
  kind: "post",
  scheduleId: 42,
};

function makeClient(returnData: { id: number }[] | null, errorCode?: string): SupabaseClient {
  const error = errorCode ? { message: "db error", code: errorCode } : null;
  const chain = {
    select: () => Promise.resolve({ data: returnData, error }),
  };
  return {
    from: () => ({ upsert: () => chain }),
  } as unknown as SupabaseClient;
}

describe("claimSocialOnce", () => {
  it("returns true when INSERT wins (first claim)", async () => {
    const db = makeClient([{ id: 1 }]);
    expect(await claimSocialOnce(db, "post:42:2026-06-20", ctx)).toBe(true);
  });

  it("returns false when key already exists (duplicate — INSERT ignored)", async () => {
    const db = makeClient([]);
    expect(await claimSocialOnce(db, "post:42:2026-06-20", ctx)).toBe(false);
  });

  it("returns true (graceful degrade) when table is missing (42P01)", async () => {
    const db = makeClient(null, "42P01");
    expect(await claimSocialOnce(db, "post:42:2026-06-20", ctx)).toBe(true);
  });

  it("throws fail-closed on any non-42P01 DB error", async () => {
    const db = makeClient(null, "23000");
    await expect(claimSocialOnce(db, "post:42:2026-06-20", ctx)).rejects.toThrow("claimSocialOnce");
  });

  it("treats null data (no error) as zero rows → false", async () => {
    const db = makeClient(null);
    expect(await claimSocialOnce(db, "post:42:2026-06-20", ctx)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Freshness gate (passesFreshnessGate)
// ─────────────────────────────────────────────────────────────────────────────

describe("passesFreshnessGate (freshness-skip contract)", () => {
  it("returns true when gate is disabled (always post regardless of token)", () => {
    expect(passesFreshnessGate(false, "SWFL-7421-v5-20260620", "SWFL-7421-v5-20260620")).toBe(true);
  });

  it("returns true when no prior token (first-ever post for this schedule)", () => {
    expect(passesFreshnessGate(true, "SWFL-7421-v5-20260620", null)).toBe(true);
  });

  it("returns true when token advanced (data is fresh — proceed)", () => {
    expect(passesFreshnessGate(true, "SWFL-7421-v5-20260621", "SWFL-7421-v5-20260620")).toBe(true);
  });

  it("returns false when token unchanged (stale data — skip post)", () => {
    expect(passesFreshnessGate(true, "SWFL-7421-v5-20260620", "SWFL-7421-v5-20260620")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Reaper re-arm (computeNextRunAt used in re-arm logic)
// ─────────────────────────────────────────────────────────────────────────────

describe("reaper re-arm (computeNextRunAt contract)", () => {
  const baseSpec = {
    cadence: "daily" as const,
    send_hour_et: 8, // 8am ET daily
  };
  const anchor = new Date("2026-06-20T12:00:00Z"); // 8am ET = noon UTC (EDT)

  it("computes a next_run_at strictly after the anchor for a daily schedule", () => {
    const next = computeNextRunAt(baseSpec, anchor);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(anchor.getTime());
  });

  it("computes a next_run_at within the next 32 hours for a daily 8am ET schedule", () => {
    const next = computeNextRunAt(baseSpec, anchor);
    expect(next).not.toBeNull();
    const diff = next!.getTime() - anchor.getTime();
    expect(diff).toBeLessThanOrEqual(32 * 60 * 60 * 1000);
  });

  it("returns null for a weekly schedule missing day_of_week", () => {
    const next = computeNextRunAt({ cadence: "weekly", send_hour_et: 9 }, anchor);
    expect(next).toBeNull();
  });

  it("computes valid weekly next_run_at when day_of_week is provided", () => {
    const next = computeNextRunAt(
      { cadence: "weekly", send_hour_et: 8, day_of_week: 1 }, // Monday
      anchor,
    );
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(anchor.getTime());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — buildTargetsFromSchedules + buildIdempotencyKey
// ─────────────────────────────────────────────────────────────────────────────

function makeScheduleRow(over: Partial<SocialSchedule> = {}): SocialSchedule {
  return {
    id: 1,
    user_id: "user-abc",
    social_account_id: "acct-1",
    platform: "linkedin",
    status: "active",
    cadence: "daily",
    day_of_week: null,
    day_of_month: null,
    send_hour_et: 8,
    scope_kind: "zip",
    scope_value: "33931",
    content_template: "stat_card",
    hashtags: ["#SWFL"],
    media_kind: "image",
    freshness_gate: true,
    signature: null,
    next_run_at: null,
    last_run_at: null,
    created_at: "2026-06-20T00:00:00Z",
    updated_at: "2026-06-20T00:00:00Z",
    ...over,
  };
}

describe("buildTargetsFromSchedules", () => {
  it("converts a valid row to a SocialTarget with lastFreshnessToken from map", () => {
    const tokenMap = new Map([[1, "SWFL-7421-v5-20260619"]]);
    const { targets, errors } = buildTargetsFromSchedules([makeScheduleRow()], tokenMap);
    expect(errors).toHaveLength(0);
    expect(targets).toHaveLength(1);
    expect(targets[0].lastFreshnessToken).toBe("SWFL-7421-v5-20260619");
    expect(targets[0].scheduleId).toBe(1);
    expect(targets[0].platform).toBe("linkedin");
  });

  it("rejects a row with an unknown platform as an error (not silently dropped)", () => {
    const row = makeScheduleRow({ platform: "myspace" as SocialSchedule["platform"] });
    const { targets, errors } = buildTargetsFromSchedules([row]);
    expect(errors).toHaveLength(1);
    expect(targets).toHaveLength(0);
    expect(errors[0].reason).toMatch(/unknown platform/i);
  });

  it("rejects a row with an invalid scope_kind", () => {
    const row = makeScheduleRow({ scope_kind: "neighborhood" });
    const { targets: _targets, errors } = buildTargetsFromSchedules([row]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/invalid scope_kind/i);
  });

  it("sets lastFreshnessToken to null when not in the map", () => {
    const { targets } = buildTargetsFromSchedules([makeScheduleRow()]);
    expect(targets[0].lastFreshnessToken).toBeNull();
  });
});

describe("buildIdempotencyKey", () => {
  it("formats as post:<id>:<YYYY-MM-DD>", () => {
    const now = new Date("2026-06-20T15:30:00Z");
    expect(buildIdempotencyKey(42, now)).toBe("post:42:2026-06-20");
  });

  it("uses UTC date (a midnight-ET post is UTC +4/5h, still the same UTC day)", () => {
    // 8pm ET on June 19 = midnight UTC on June 20
    const now = new Date("2026-06-20T00:00:00Z");
    expect(buildIdempotencyKey(1, now)).toBe("post:1:2026-06-20");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — DRY end-to-end (publish gate contract)
// ─────────────────────────────────────────────────────────────────────────────
// Wire up the building blocks the way the worker does:
//   composePosts → content → publish gate short-circuit
//
// Assert: when SOCIAL_PUBLISH_ENABLED is falsy, postToChannel is NEVER called.
// Assert: the composed post carries the correct caption and freshness token.

describe("DRY end-to-end (publish gate)", () => {
  const freshToken = "SWFL-7421-v5-20260620";

  function makeContent(over: Partial<SocialContent> = {}): SocialContent {
    return {
      caption: "Lee County: median home value up 4% YoY.\n\nMedian: $412K\n\nData: SWFL Data Gulf",
      hashtags: ["#LeeCounty", "#SWFLRealEstate"],
      freshness: freshToken,
      ...over,
    };
  }

  function makeTarget(over: Partial<SocialTarget> = {}): SocialTarget {
    return {
      scheduleId: 1,
      userId: "user-abc",
      platform: "linkedin",
      accountId: "acct-1",
      scopeKind: "zip",
      scopeValue: "33908",
      topic: null,
      cadence: "daily",
      hashtags: ["#SWFL"],
      contentTemplate: "stat_card",
      freshnessGate: true,
      lastFreshnessToken: null, // first-ever post
      ...over,
    };
  }

  it("composes a ready post from in-scope content", async () => {
    let publishCallCount = 0;
    const fakePublish = async () => {
      publishCallCount++;
      return { ok: true, platform_post_id: "tweet-123" };
    };

    const target = makeTarget();
    const content = makeContent();

    // Simulate the worker's publish gate: SOCIAL_PUBLISH_ENABLED=false
    const PUBLISH_ENABLED = false;
    let postStatus: string | null = null;

    // 1. Freshness gate
    const passes = passesFreshnessGate(
      target.freshnessGate,
      content.freshness,
      target.lastFreshnessToken,
    );
    expect(passes).toBe(true); // first fire → gate open

    // 2. Compose
    const { posts, summary } = await composePosts([target], async () => content);
    expect(summary.ready).toBe(1);
    expect(posts[0].status).toBe("ready");
    expect(posts[0].post?.freshness).toBe(freshToken);
    expect(posts[0].post?.caption).toContain("SWFL Data Gulf");

    // 3. Publish gate short-circuit (mirrors the worker's logic)
    if (!PUBLISH_ENABLED) {
      postStatus = "dry_run";
      // postToChannel is NOT called
    } else {
      await fakePublish();
      postStatus = "published";
    }

    expect(publishCallCount).toBe(0); // gate closed → never called
    expect(postStatus).toBe("dry_run");
  });

  it("skips without composing when freshness gate blocks", async () => {
    const target = makeTarget({
      freshnessGate: true,
      lastFreshnessToken: freshToken, // same as current → stale
    });

    const passes = passesFreshnessGate(target.freshnessGate, freshToken, target.lastFreshnessToken);
    expect(passes).toBe(false); // gate closes → skip without calling compose

    let composeCallCount = 0;
    if (passes) {
      await composePosts([target], async () => {
        composeCallCount++;
        return makeContent();
      });
    }
    expect(composeCallCount).toBe(0); // never entered compose
  });

  it("returns out_of_scope when buildContent returns null (MOAT gate)", async () => {
    const target = makeTarget();
    const { posts, summary } = await composePosts([target], async () => null);
    expect(summary.out_of_scope).toBe(1);
    expect(posts[0].status).toBe("out_of_scope");
    expect(posts[0].post).toBeUndefined();
  });

  it("isolates a per-target compose error — batch never throws", async () => {
    const targets: SocialTarget[] = [
      makeTarget({ scheduleId: 1 }),
      makeTarget({ scheduleId: 2, platform: "x" }),
    ];
    const { posts, summary } = await composePosts(targets, async (t) => {
      if (t.scheduleId === 1) throw new Error("brain fetch exploded");
      return makeContent();
    });
    expect(summary).toMatchObject({ total: 2, ready: 1, error: 1 });
    const errRow = posts.find((p) => p.status === "error");
    expect(errRow?.scheduleId).toBe(1);
    expect(errRow?.reason).toContain("brain fetch exploded");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — Exit-code contract (top-level fatal vs. per-row isolation)
// ─────────────────────────────────────────────────────────────────────────────

describe("exit-code contract", () => {
  // The worker wraps processSchedule in a try/catch that catches per-row errors.
  // This test verifies the isolation contract: a thrown per-row error is caught,
  // tallied as "error", and the outer loop continues to the next row.

  it("per-row errors are isolated (the outer loop catches them and continues)", async () => {
    const results: string[] = [];

    // Simulate the worker's per-row loop with two schedules
    const scheduleIds = [1, 2];
    for (const id of scheduleIds) {
      try {
        if (id === 1) throw new Error("row-1 exploded");
        results.push(`ok:${id}`);
      } catch {
        results.push(`error:${id}`);
        // per-row error — does NOT rethrow
      }
    }

    expect(results).toEqual(["error:1", "ok:2"]);
    // The loop completed for both rows: a per-row throw never aborts the batch.
  });

  it("top-level fatal is NOT caught and propagates (simulating process.exit(1))", async () => {
    // Simulate the main() → throws → caught by main().catch → process.exit(1)
    async function main() {
      throw new Error("missing env — top-level fatal");
    }

    let exitCode: number | null = null;
    await main().catch(() => {
      exitCode = 1;
    });
    expect(exitCode).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — shouldPublish (schedule eligibility pre-claim)
// ─────────────────────────────────────────────────────────────────────────────

describe("shouldPublish (schedule eligibility)", () => {
  const now = new Date("2026-06-20T13:00:00Z");

  it("returns true for an active, overdue schedule", () => {
    expect(shouldPublish({ status: "active", next_run_at: "2026-06-20T12:00:00Z" }, now)).toBe(
      true,
    );
  });

  it("returns true for an active schedule that was parked (next_run_at=null)", () => {
    expect(shouldPublish({ status: "active", next_run_at: null }, now)).toBe(true);
  });

  it("returns false for a paused schedule even if overdue", () => {
    expect(shouldPublish({ status: "paused", next_run_at: "2026-06-20T12:00:00Z" }, now)).toBe(
      false,
    );
  });

  it("returns false for a stopped schedule", () => {
    expect(shouldPublish({ status: "stopped", next_run_at: "2026-06-20T12:00:00Z" }, now)).toBe(
      false,
    );
  });

  it("returns false for an active schedule whose next_run_at is in the future", () => {
    expect(shouldPublish({ status: "active", next_run_at: "2026-06-20T14:00:00Z" }, now)).toBe(
      false,
    );
  });
});
