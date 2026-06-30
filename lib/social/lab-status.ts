// lib/social/lab-status.ts
//
// The LAB-SIDE authoring status for a social post — the front half of the
// status spine. The publish engine already owns the back half
// (PostStatus = queued | dry_run | published | failed, lib/social/types.ts);
// this is the state a user drives in the lab BEFORE a post reaches a schedule.
//
// Status ladder (Hootsuite's calendar spine, handoff REVIEW B3):
//   Draft → In review → Approved → Scheduled → Live
// Forward-only. The single backward path is an explicit resetToDraft.
//
// "In review / Approved" are single-user lab states (no multi-reviewer system —
// that axis is explicitly deferred). Pure module: NO I/O, no UI.

import type { ScheduleStatus } from "@/lib/social/types";

export type LabPostStatus = "draft" | "in_review" | "approved" | "scheduled" | "live";

/** Single source of truth for ordering. nextLabStatus / canAdvance derive from this. */
export const LAB_STATUS_LADDER: readonly LabPostStatus[] = [
  "draft",
  "in_review",
  "approved",
  "scheduled",
  "live",
] as const;

/**
 * Project a lab authoring state onto the engine's schedule status.
 *
 * draft | in_review → "paused" — a pre-approval schedule row exists but NEVER fires.
 * approved | scheduled | live → "active" — eligible for the cron; the cron flips the
 * post to published independently (this projection never returns "stopped", which is a
 * user stop action, not an authoring state).
 *
 * A Record (not a switch) so adding a sixth status is a compile error until it is mapped.
 */
const LAB_TO_SCHEDULE: Record<LabPostStatus, ScheduleStatus> = {
  draft: "paused",
  in_review: "paused",
  approved: "active",
  scheduled: "active",
  live: "active",
};

export function labToScheduleStatus(s: LabPostStatus): ScheduleStatus {
  return LAB_TO_SCHEDULE[s];
}

/** The next rung up the ladder, or null at the terminal state (live). */
export function nextLabStatus(s: LabPostStatus): LabPostStatus | null {
  const i = LAB_STATUS_LADDER.indexOf(s);
  if (i < 0) return null;
  return LAB_STATUS_LADDER[i + 1] ?? null;
}

/** True while there is a forward rung; false at the terminal state. */
export function canAdvance(s: LabPostStatus): boolean {
  return nextLabStatus(s) !== null;
}

/** The one explicit backward transition — always lands on draft, never the previous rung. */
export function resetToDraft(_s: LabPostStatus): LabPostStatus {
  return "draft";
}
