// lib/social/targets.ts
//
// Parse + validate social post targets from schedule rows.
// Pure — no I/O, no network. The runner reads the schedule rows and hands them here.
//
// Mirrored from: lib/email/outreach/targets.ts
// KEY DIFFERENCES:
//   - Input is social_schedules DB rows (not CSV)
//   - Targets are per-schedule, per-platform (one account per target)
//   - Validation gates: platform is a known value; scope_kind is valid if present

import type { SocialTarget, SocialSchedule, Platform } from "./types";

const VALID_PLATFORMS: Set<Platform> = new Set([
  "x",
  "facebook",
  "instagram",
  "linkedin",
  "google_business",
]);

const VALID_SCOPE_KINDS = new Set(["zip", "place", "county"]);

export interface ParsedTargets {
  targets: SocialTarget[];
  errors: Array<{ scheduleId: number; reason: string }>;
}

/**
 * Convert claimed social_schedules rows into SocialTarget objects.
 * Invalid rows (unknown platform, bad scope) are returned as errors — never silently
 * dropped or corrected. The caller decides whether to skip or alarm.
 *
 * `lastFreshnessToken` is passed in from the caller (the runner looks up the last
 * social_posts row for each schedule to seed the freshness gate).
 */
export function buildTargetsFromSchedules(
  rows: SocialSchedule[],
  lastTokenByScheduleId: Map<number, string | null> = new Map(),
): ParsedTargets {
  const targets: SocialTarget[] = [];
  const errors: ParsedTargets["errors"] = [];

  for (const row of rows) {
    if (!VALID_PLATFORMS.has(row.platform as Platform)) {
      errors.push({ scheduleId: row.id, reason: `unknown platform "${row.platform}"` });
      continue;
    }

    if (row.scope_kind != null && !VALID_SCOPE_KINDS.has(row.scope_kind)) {
      errors.push({
        scheduleId: row.id,
        reason: `invalid scope_kind "${row.scope_kind}" (must be zip|place|county)`,
      });
      continue;
    }

    targets.push({
      scheduleId: row.id,
      userId: row.user_id,
      platform: row.platform as Platform,
      accountId: row.social_account_id,
      scopeKind: row.scope_kind,
      scopeValue: row.scope_value,
      topic: null, // extended in a future build; schedule rows don't carry topic yet
      cadence: row.cadence as SocialTarget["cadence"],
      hashtags: row.hashtags ?? [],
      contentTemplate: row.content_template,
      freshnessGate: row.freshness_gate,
      lastFreshnessToken: lastTokenByScheduleId.get(row.id) ?? null,
    });
  }

  return { targets, errors };
}

/**
 * Canonical schedule key for the idempotency ledger.
 * Key = `post:<scheduleId>:<YYYY-MM-DD>` (UTC date).
 * Matches the pattern from the spec: "post:<id>:<date>".
 */
export function buildIdempotencyKey(scheduleId: number, now: Date): string {
  const d = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return `post:${scheduleId}:${d}`;
}
