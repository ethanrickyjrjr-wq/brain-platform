import { describe, expect, test } from "bun:test";
import { computeNextRunAt, formatScheduleSendTime } from "../schedule-cadence";

// US DST 2026: spring forward Sun Mar 8 (EST→EDT), fall back Sun Nov 1 (EDT→EST).
// EST = UTC-5 (9am ET = 14:00Z), EDT = UTC-4 (9am ET = 13:00Z).

describe("computeNextRunAt — daily", () => {
  test("winter (EST): 9am ET resolves to 14:00 UTC", () => {
    const from = new Date("2026-01-05T00:00:00Z"); // Mon
    const next = computeNextRunAt({ cadence: "daily", send_hour_et: 9 }, from);
    expect(next?.toISOString()).toBe("2026-01-05T14:00:00.000Z");
  });

  test("summer (EDT): 9am ET resolves to 13:00 UTC", () => {
    const from = new Date("2026-07-06T00:00:00Z");
    const next = computeNextRunAt({ cadence: "daily", send_hour_et: 9 }, from);
    expect(next?.toISOString()).toBe("2026-07-06T13:00:00.000Z");
  });

  test("after the day's send hour, rolls to tomorrow", () => {
    const from = new Date("2026-01-05T15:00:00Z"); // past 9am ET (14:00Z)
    const next = computeNextRunAt({ cadence: "daily", send_hour_et: 9 }, from);
    expect(next?.toISOString()).toBe("2026-01-06T14:00:00.000Z");
  });

  test("strictly after: exactly at the send instant moves to the next day", () => {
    const from = new Date("2026-01-05T14:00:00Z");
    const next = computeNextRunAt({ cadence: "daily", send_hour_et: 9 }, from);
    expect(next?.toISOString()).toBe("2026-01-06T14:00:00.000Z");
  });

  test("DST: the day after spring-forward is on EDT", () => {
    const from = new Date("2026-03-09T00:00:00Z"); // Mon, after Mar 8 transition
    const next = computeNextRunAt({ cadence: "daily", send_hour_et: 9 }, from);
    expect(next?.toISOString()).toBe("2026-03-09T13:00:00.000Z"); // EDT
  });
});

describe("computeNextRunAt — weekly", () => {
  test("next Tuesday 7am ET (EST) from a Monday", () => {
    const from = new Date("2026-01-05T12:00:00Z"); // Mon Jan 5
    const next = computeNextRunAt({ cadence: "weekly", day_of_week: 2, send_hour_et: 7 }, from);
    // Tue Jan 6, 7am EST = 12:00Z
    expect(next?.toISOString()).toBe("2026-01-06T12:00:00.000Z");
  });

  test("same weekday but before the hour stays on today", () => {
    const from = new Date("2026-01-06T00:00:00Z"); // Tue, before 7am ET
    const next = computeNextRunAt({ cadence: "weekly", day_of_week: 2, send_hour_et: 7 }, from);
    expect(next?.toISOString()).toBe("2026-01-06T12:00:00.000Z");
  });

  test("same weekday after the hour jumps a full week", () => {
    const from = new Date("2026-01-06T13:00:00Z"); // Tue, past 7am ET
    const next = computeNextRunAt({ cadence: "weekly", day_of_week: 2, send_hour_et: 7 }, from);
    expect(next?.toISOString()).toBe("2026-01-13T12:00:00.000Z");
  });

  test("Sunday (day_of_week 0) is honored", () => {
    const from = new Date("2026-01-05T12:00:00Z"); // Mon
    const next = computeNextRunAt({ cadence: "weekly", day_of_week: 0, send_hour_et: 8 }, from);
    // Next Sunday is Jan 11; 8am EST = 13:00Z
    expect(next?.toISOString()).toBe("2026-01-11T13:00:00.000Z");
  });

  test("missing day_of_week is invalid", () => {
    const next = computeNextRunAt(
      { cadence: "weekly", send_hour_et: 7 },
      new Date("2026-01-05T00:00:00Z"),
    );
    expect(next).toBeNull();
  });
});

describe("computeNextRunAt — monthly", () => {
  test("next day-15 at 9am ET", () => {
    const from = new Date("2026-01-20T00:00:00Z"); // past the 15th
    const next = computeNextRunAt({ cadence: "monthly", day_of_month: 15, send_hour_et: 9 }, from);
    // Feb 15, 9am EST = 14:00Z
    expect(next?.toISOString()).toBe("2026-02-15T14:00:00.000Z");
  });

  test("same-month day-of-month before the hour stays this month", () => {
    const from = new Date("2026-01-15T00:00:00Z");
    const next = computeNextRunAt({ cadence: "monthly", day_of_month: 15, send_hour_et: 9 }, from);
    expect(next?.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  test("missing day_of_month is invalid", () => {
    const next = computeNextRunAt(
      { cadence: "monthly", send_hour_et: 9 },
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(next).toBeNull();
  });
});

describe("formatScheduleSendTime", () => {
  test("formats a UTC instant as an Eastern wall-clock send line (EDT)", () => {
    // 13:00Z in summer = 9:00am EDT (matches the EDT reference at the top of this file).
    expect(formatScheduleSendTime("2026-06-23T13:00:00.000Z")).toMatch(
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) Jun 23, 9:00am ET$/,
    );
  });

  test("winter EST: 14:00Z renders as 9:00am ET", () => {
    expect(formatScheduleSendTime("2026-01-15T14:00:00.000Z")).toMatch(/ 9:00am ET$/);
  });

  test("returns an empty string for an invalid date", () => {
    expect(formatScheduleSendTime("nonsense")).toBe("");
    expect(formatScheduleSendTime("")).toBe("");
  });
});
