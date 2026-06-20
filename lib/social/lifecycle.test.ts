import { describe, expect, it } from "bun:test";
import { shouldPublish, passesFreshnessGate, mapPlatformMetric } from "./lifecycle";

const NOW = new Date("2026-06-20T12:00:00Z");

describe("shouldPublish", () => {
  it("publishes an active schedule with no next_run_at (parked after claim)", () => {
    expect(shouldPublish({ status: "active", next_run_at: null }, NOW)).toBe(true);
  });
  it("publishes an active schedule whose next_run_at is past-due", () => {
    expect(shouldPublish({ status: "active", next_run_at: "2026-06-20T11:00:00Z" }, NOW)).toBe(
      true,
    );
  });
  it("skips an active schedule not yet due", () => {
    expect(shouldPublish({ status: "active", next_run_at: "2026-06-21T00:00:00Z" }, NOW)).toBe(
      false,
    );
  });
  it("skips paused / stopped schedules regardless of schedule", () => {
    for (const status of ["paused", "stopped"] as const) {
      expect(shouldPublish({ status, next_run_at: null }, NOW)).toBe(false);
    }
  });
});

describe("passesFreshnessGate", () => {
  it("passes when gate is disabled", () => {
    expect(passesFreshnessGate(false, "token-v2", "token-v1")).toBe(true);
  });
  it("passes on first fire (no lastPostedToken)", () => {
    expect(passesFreshnessGate(true, "token-v1", null)).toBe(true);
  });
  it("passes when freshness_token has advanced (new data)", () => {
    expect(passesFreshnessGate(true, "SWFL-v6-20260620", "SWFL-v5-20260619")).toBe(true);
  });
  it("blocks when freshness_token is unchanged (stale data — never post stale)", () => {
    expect(passesFreshnessGate(true, "SWFL-v5-20260619", "SWFL-v5-20260619")).toBe(false);
  });
});

describe("mapPlatformMetric", () => {
  it("maps X/Twitter engagement keys", () => {
    expect(mapPlatformMetric("like_count").metric).toBe("like");
    expect(mapPlatformMetric("retweet_count").metric).toBe("share");
    expect(mapPlatformMetric("impression_count").metric).toBe("impression");
  });
  it("maps LinkedIn engagement keys", () => {
    expect(mapPlatformMetric("likeCount").metric).toBe("like");
    expect(mapPlatformMetric("commentCount").metric).toBe("comment");
    expect(mapPlatformMetric("shareCount").metric).toBe("share");
  });
  it("maps Meta (Facebook/Instagram) engagement keys", () => {
    expect(mapPlatformMetric("likes").metric).toBe("like");
    expect(mapPlatformMetric("impressions").metric).toBe("impression");
    expect(mapPlatformMetric("clicks").metric).toBe("click");
  });
  it("returns null for unknown platform keys (skip logging)", () => {
    expect(mapPlatformMetric("unknown_metric").metric).toBeNull();
  });
});
