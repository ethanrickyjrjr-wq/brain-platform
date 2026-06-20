import { describe, expect, it } from "bun:test";
import { buildTargetsFromSchedules, buildIdempotencyKey } from "./targets";
import type { SocialSchedule } from "./types";

function makeSchedule(over: Partial<SocialSchedule> = {}): SocialSchedule {
  return {
    id: 1,
    user_id: "user-abc",
    social_account_id: "acct-1",
    platform: "linkedin",
    status: "active",
    cadence: "weekly",
    day_of_week: 2,
    day_of_month: null,
    send_hour_et: 9,
    scope_kind: "zip",
    scope_value: "33931",
    content_template: "stat_card",
    hashtags: ["#SWFL"],
    media_kind: "image",
    freshness_gate: true,
    signature: null,
    next_run_at: "2026-06-20T13:00:00Z",
    last_run_at: null,
    created_at: "2026-06-20T00:00:00Z",
    updated_at: "2026-06-20T00:00:00Z",
    ...over,
  };
}

describe("buildTargetsFromSchedules", () => {
  it("converts a valid schedule row to a SocialTarget", () => {
    const { targets, errors } = buildTargetsFromSchedules([makeSchedule()]);
    expect(errors).toHaveLength(0);
    expect(targets).toHaveLength(1);
    const t = targets[0];
    expect(t.scheduleId).toBe(1);
    expect(t.platform).toBe("linkedin");
    expect(t.scopeKind).toBe("zip");
    expect(t.scopeValue).toBe("33931");
    expect(t.freshnessGate).toBe(true);
    expect(t.hashtags).toEqual(["#SWFL"]);
  });

  it("rejects an unknown platform", () => {
    const { targets, errors } = buildTargetsFromSchedules([
      makeSchedule({ platform: "tiktok" as never }),
    ]);
    expect(targets).toHaveLength(0);
    expect(errors[0].reason).toContain("unknown platform");
  });

  it("rejects an invalid scope_kind", () => {
    const { targets, errors } = buildTargetsFromSchedules([
      makeSchedule({ scope_kind: "neighborhood" }),
    ]);
    expect(targets).toHaveLength(0);
    expect(errors[0].reason).toContain("invalid scope_kind");
  });

  it("accepts a null scope_kind (whole region)", () => {
    const { targets, errors } = buildTargetsFromSchedules([
      makeSchedule({ scope_kind: null, scope_value: null }),
    ]);
    expect(errors).toHaveLength(0);
    expect(targets[0].scopeKind).toBeNull();
    expect(targets[0].scopeValue).toBeNull();
  });

  it("seeds lastFreshnessToken from the provided map", () => {
    const map = new Map([[1, "SWFL-v5-20260619"]]);
    const { targets } = buildTargetsFromSchedules([makeSchedule()], map);
    expect(targets[0].lastFreshnessToken).toBe("SWFL-v5-20260619");
  });

  it("handles all valid platforms", () => {
    const platforms = ["x", "facebook", "instagram", "linkedin", "google_business"] as const;
    for (const platform of platforms) {
      const { errors } = buildTargetsFromSchedules([makeSchedule({ platform })]);
      expect(errors).toHaveLength(0);
    }
  });
});

describe("buildIdempotencyKey", () => {
  it("formats as post:<scheduleId>:<YYYY-MM-DD>", () => {
    const now = new Date("2026-06-20T14:30:00Z");
    expect(buildIdempotencyKey(42, now)).toBe("post:42:2026-06-20");
  });
});
