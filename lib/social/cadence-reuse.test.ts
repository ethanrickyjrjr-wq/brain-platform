/**
 * cadence-reuse.test.ts
 *
 * Smoke test: verify that computeNextRunAt from lib/email/schedule-cadence.ts
 * is importable and works correctly for social scheduling. This is the
 * "cadence reuse" gate required by build 01 — the social engine IMPORTS
 * the email cadence helper unchanged (no reimplementation).
 */
import { describe, expect, it } from "bun:test";
import { computeNextRunAt, type CadenceSpec } from "@/lib/email/schedule-cadence";

const BASE = new Date("2026-06-20T17:00:00Z"); // 1pm ET (UTC-4 in summer)

describe("computeNextRunAt — cadence reuse smoke (social shares email's math)", () => {
  it("daily: returns the next ET 9am occurrence after the base time", () => {
    const spec: CadenceSpec = { cadence: "daily", send_hour_et: 9 };
    const next = computeNextRunAt(spec, BASE);
    expect(next).not.toBeNull();
    // June is EDT (UTC-4). Next 9am EDT from 1pm EDT on 2026-06-20 → 2026-06-21 9am EDT = 13:00 UTC.
    expect(next!.toISOString()).toBe("2026-06-21T13:00:00.000Z");
  });

  it("weekly: returns the correct Tuesday occurrence", () => {
    const spec: CadenceSpec = { cadence: "weekly", day_of_week: 2 /* Tue */, send_hour_et: 9 };
    const next = computeNextRunAt(spec, BASE);
    expect(next).not.toBeNull();
    // 2026-06-20 is Saturday; next Tuesday = 2026-06-23 9am ET
    const nextDate = next!.toISOString().slice(0, 10);
    expect(nextDate).toBe("2026-06-23");
  });

  it("monthly: returns the correct day-of-month occurrence", () => {
    const spec: CadenceSpec = { cadence: "monthly", day_of_month: 1, send_hour_et: 9 };
    const next = computeNextRunAt(spec, BASE);
    expect(next).not.toBeNull();
    // 2026-06-20 → next 1st = 2026-07-01
    const nextDate = next!.toISOString().slice(0, 10);
    expect(nextDate).toBe("2026-07-01");
  });

  it("returns null for invalid specs (weekly without day_of_week)", () => {
    const spec: CadenceSpec = { cadence: "weekly", send_hour_et: 9 };
    expect(computeNextRunAt(spec, BASE)).toBeNull();
  });

  it("DST-correct: the social engine inherits DST safety from the email helper", () => {
    // Spring-forward: 2026-03-08T02:00 ET clocks → 03:00 ET.
    // A 9am ET send on 2026-03-08 must still land at 9am ET (14:00 UTC in EDT).
    const springForwardBase = new Date("2026-03-07T20:00:00Z"); // 3pm ET on Mar 7
    const spec: CadenceSpec = { cadence: "daily", send_hour_et: 9 };
    const next = computeNextRunAt(spec, springForwardBase);
    expect(next).not.toBeNull();
    // 2026-03-08 springs forward at 2am: clocks move EST→EDT (UTC-5→UTC-4).
    // 9am EDT = UTC-4, so 9am EDT = 13:00 UTC. This is correct — NOT 14:00 UTC.
    expect(next!.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });
});
