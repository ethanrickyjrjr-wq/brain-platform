import { describe, it, expect } from "bun:test";
import {
  LAB_STATUS_LADDER,
  labToScheduleStatus,
  nextLabStatus,
  canAdvance,
  resetToDraft,
  type LabPostStatus,
} from "../lab-status";

describe("LAB_STATUS_LADDER", () => {
  it("is the forward-only authoring ladder, draft → live", () => {
    expect(LAB_STATUS_LADDER).toEqual(["draft", "in_review", "approved", "scheduled", "live"]);
  });
});

describe("labToScheduleStatus — lab authoring state → engine schedule status", () => {
  it("keeps Draft / In review paused (a pre-approval schedule never fires)", () => {
    expect(labToScheduleStatus("draft")).toBe("paused");
    expect(labToScheduleStatus("in_review")).toBe("paused");
  });

  it("activates Approved / Scheduled / Live (the cron flips to published independently)", () => {
    expect(labToScheduleStatus("approved")).toBe("active");
    expect(labToScheduleStatus("scheduled")).toBe("active");
    expect(labToScheduleStatus("live")).toBe("active");
  });

  it("never projects to stopped (stopping is a user action, not a lab authoring state)", () => {
    for (const s of LAB_STATUS_LADDER) {
      expect(labToScheduleStatus(s)).not.toBe("stopped");
    }
  });
});

describe("nextLabStatus — forward-only transition", () => {
  it("advances one rung at each step", () => {
    expect(nextLabStatus("draft")).toBe("in_review");
    expect(nextLabStatus("in_review")).toBe("approved");
    expect(nextLabStatus("approved")).toBe("scheduled");
    expect(nextLabStatus("scheduled")).toBe("live");
  });

  it("returns null at the terminal state (live)", () => {
    expect(nextLabStatus("live")).toBeNull();
  });
});

describe("canAdvance", () => {
  it("is true for every non-terminal state", () => {
    expect(canAdvance("draft")).toBe(true);
    expect(canAdvance("in_review")).toBe(true);
    expect(canAdvance("approved")).toBe(true);
    expect(canAdvance("scheduled")).toBe(true);
  });

  it("is false at the terminal state (live)", () => {
    expect(canAdvance("live")).toBe(false);
  });
});

describe("resetToDraft — the one explicit backward path", () => {
  it("lands on draft from any state (never the previous rung)", () => {
    const states: LabPostStatus[] = ["in_review", "approved", "scheduled", "live"];
    for (const s of states) {
      expect(resetToDraft(s)).toBe("draft");
    }
  });
});
