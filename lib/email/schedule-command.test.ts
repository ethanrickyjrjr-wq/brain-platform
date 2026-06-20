/**
 * Unit tests for the pure email-schedule command parser (Unit G), focused on the
 * additive "scope" capability: scope_kind / scope_value / topic.
 *
 * Canonical-form contract (THE thing these tests pin):
 *  - scope_value and topic are normalized to lowercase + trimmed by the zod
 *    transforms — this is the canonical contract form the future build-time ZIP
 *    expander reads. NULL+NULL (absence) is the valid default => today's global
 *    digest; there is deliberately NO 'general' magic value.
 *
 * Pure logic, no DB, no network — run with `bun test lib/email/schedule-command.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
  validateToolInput,
  summarizeCommand,
  hourClarifyCandidates,
  type ParsedCommand,
} from "./schedule-command";

describe("schedule-command scope capability", () => {
  test("validateToolInput normalizes scope_value and topic to lowercase+trimmed (canonical form)", () => {
    const v = validateToolInput({
      action: "create",
      cadence: "weekly",
      day_of_week: 2,
      send_hour_et: 7,
      scope_kind: "place",
      scope_value: "  Cape Coral ",
      topic: "Flood",
    });
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error("expected ok");
    expect(v.command.scope_value).toBe("cape coral");
    expect(v.command.topic).toBe("flood");
    expect(v.command.scope_kind).toBe("place");
  });

  test("canonical scoped create => ok with normalized scope", () => {
    const v = validateToolInput({
      action: "create",
      cadence: "weekly",
      day_of_week: 2,
      send_hour_et: 7,
      scope_kind: "place",
      scope_value: "Cape Coral",
      topic: "flood",
    });
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error("expected ok");
    expect(v.command.scope_kind).toBe("place");
    expect(v.command.scope_value).toBe("cape coral");
    expect(v.command.topic).toBe("flood");
  });

  test("ZIP scope => ok, scope_value preserved as '33904'", () => {
    const v = validateToolInput({
      action: "create",
      cadence: "daily",
      send_hour_et: 7,
      scope_kind: "zip",
      scope_value: "33904",
    });
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error("expected ok");
    expect(v.command.scope_kind).toBe("zip");
    expect(v.command.scope_value).toBe("33904");
    expect(v.command.topic).toBeUndefined();
  });

  test("NO-SCOPE create is still valid (NULL+NULL default => global digest)", () => {
    const v = validateToolInput({
      action: "create",
      cadence: "weekly",
      day_of_week: 1,
      send_hour_et: 8,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error("expected ok");
    expect(v.command.scope_kind).toBeUndefined();
    expect(v.command.scope_value).toBeUndefined();
    expect(v.command.topic).toBeUndefined();
  });

  test("invalid scope_kind is rejected", () => {
    const v = validateToolInput({
      action: "create",
      cadence: "daily",
      send_hour_et: 7,
      scope_kind: "state",
    });
    expect(v.ok).toBe(false);
  });

  test("summarizeCommand for a scoped create contains both scope_value and topic", () => {
    const command: ParsedCommand = {
      action: "create",
      cadence: "weekly",
      day_of_week: 2,
      send_hour_et: 7,
      scope_kind: "place",
      scope_value: "cape coral",
      topic: "flood",
    };
    const summary = summarizeCommand(command);
    expect(summary).toContain("cape coral");
    expect(summary).toContain("flood");
  });
});

describe("schedule-command pre-existing behavior (no regression)", () => {
  test("plain create with no scope still valid + summarized", () => {
    const v = validateToolInput({
      action: "create",
      cadence: "daily",
      send_hour_et: 9,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error("expected ok");
    const summary = summarizeCommand(v.command);
    expect(summary).toContain("Create a daily schedule");
  });

  test("pause summary unchanged", () => {
    const summary = summarizeCommand({ action: "pause", schedule_id: 5 });
    expect(summary).toBe("Pause schedule #5.");
  });

  test("create missing send_hour_et still rejected", () => {
    const v = validateToolInput({ action: "create", cadence: "daily" });
    expect(v.ok).toBe(false);
  });
});

describe("hourClarifyCandidates (bare-hour disambiguation)", () => {
  test("a bare 6 yields 6am (06:00) and 6pm (18:00)", () => {
    expect(hourClarifyCandidates(6)).toEqual([
      { hour: 6, label: "6am" },
      { hour: 18, label: "6pm" },
    ]);
  });

  test("a bare 12 yields 12am (midnight, 00:00) and 12pm (noon, 12:00)", () => {
    expect(hourClarifyCandidates(12)).toEqual([
      { hour: 0, label: "12am" },
      { hour: 12, label: "12pm" },
    ]);
  });

  test("returns null for an out-of-range or non-integer bare hour", () => {
    expect(hourClarifyCandidates(0)).toBeNull();
    expect(hourClarifyCandidates(13)).toBeNull();
    expect(hourClarifyCandidates(6.5)).toBeNull();
    expect(hourClarifyCandidates(undefined)).toBeNull();
  });
});
