import { describe, expect, it } from "bun:test";
import { shouldSend, mapResendOutbound, nextStep, extractOutreachAction } from "./lifecycle";

const NOW = new Date("2026-06-20T12:00:00Z");

describe("shouldSend", () => {
  it("sends an active recipient that was never sent (next_send_at null)", () => {
    expect(shouldSend({ status: "active", next_send_at: null }, NOW)).toBe(true);
  });
  it("sends an active recipient whose next send is due", () => {
    expect(shouldSend({ status: "active", next_send_at: "2026-06-20T11:00:00Z" }, NOW)).toBe(true);
  });
  it("skips an active recipient not yet due", () => {
    expect(shouldSend({ status: "active", next_send_at: "2026-06-21T00:00:00Z" }, NOW)).toBe(false);
  });
  it("skips engaged / unsubscribed / bounced regardless of schedule", () => {
    for (const status of ["engaged", "unsubscribed", "bounced"] as const) {
      expect(shouldSend({ status, next_send_at: null }, NOW)).toBe(false);
    }
  });
});

describe("mapResendOutbound", () => {
  it("clicked → log clicked AND suppress to engaged (the click → stop)", () => {
    expect(mapResendOutbound("email.clicked")).toEqual({ event: "clicked", suppressTo: "engaged" });
  });
  it("bounced → bounced, complained → unsubscribed (both suppress)", () => {
    expect(mapResendOutbound("email.bounced")).toEqual({ event: "bounced", suppressTo: "bounced" });
    expect(mapResendOutbound("email.complained")).toEqual({
      event: "unsubscribed",
      suppressTo: "unsubscribed",
    });
  });
  it("delivered/opened → log only, no suppression", () => {
    expect(mapResendOutbound("email.delivered")).toEqual({ event: "delivered", suppressTo: null });
    expect(mapResendOutbound("email.opened")).toEqual({ event: "opened", suppressTo: null });
  });
  it("ignores inbound + unknown types", () => {
    expect(mapResendOutbound("email.received")).toEqual({ event: null, suppressTo: null });
    expect(mapResendOutbound("whatever")).toEqual({ event: null, suppressTo: null });
  });
});

// Resend delivers tags as a plain object {"key":"value"} in webhook payloads
// even though the send API accepts [{name,value}] arrays.
describe("extractOutreachAction", () => {
  const clicked = {
    type: "email.clicked",
    data: { email_id: "re_123", tags: { rid: "rid-abc" } },
  };

  it("maps a tagged clicked event to rid + clicked + engaged suppression", () => {
    expect(extractOutreachAction(clicked)).toEqual({
      rid: "rid-abc",
      emailId: "re_123",
      event: "clicked",
      suppressTo: "engaged",
    });
  });

  it("returns null when the event carries no rid tag (not an outreach send)", () => {
    expect(
      extractOutreachAction({ type: "email.opened", data: { email_id: "x", tags: {} } }),
    ).toBeNull();
  });

  it("returns null for inbound / untracked types even if tagged", () => {
    expect(
      extractOutreachAction({ type: "email.received", data: { tags: { rid: "r" } } }),
    ).toBeNull();
  });

  it("tolerates a missing email_id (emailId null)", () => {
    expect(
      extractOutreachAction({ type: "email.delivered", data: { tags: { rid: "r" } } }),
    ).toEqual({
      rid: "r",
      emailId: null,
      event: "delivered",
      suppressTo: null,
    });
  });
});

describe("nextStep", () => {
  it("bumps step and schedules +intervalDays", () => {
    expect(nextStep({ step: 0 }, 7, NOW)).toEqual({
      step: 1,
      next_send_at: "2026-06-27T12:00:00.000Z",
    });
  });
});
