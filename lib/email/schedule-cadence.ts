/**
 * Cadence math for the multi-tenant email scheduler.
 *
 * SHARED SEAM between Unit G (the AI command route — sets the initial
 * `next_run_at` when a schedule is created or its cadence changes) and Unit F
 * (the cron worker — advances `next_run_at` after each send). Keep both lanes on
 * this one helper so the ET→UTC conversion is identical on create and on advance.
 *
 * `send_hour_et` is an EASTERN wall-clock hour. The worker ticks in UTC, so every
 * computation converts ET→UTC honoring EST/EDT. Conversion uses `Intl`
 * (`America/New_York`) — no dependency, DST-correct.
 */

export type Cadence = "daily" | "weekly" | "monthly";

export interface CadenceSpec {
  cadence: Cadence;
  /** 0 = Sunday … 6 = Saturday. Required for `weekly`. */
  day_of_week?: number | null;
  /** 1–28. Required for `monthly`. The 28 cap avoids short-month gaps. */
  day_of_month?: number | null;
  /** Eastern wall-clock hour, 0–23. */
  send_hour_et: number;
}

const NY_TZ = "America/New_York";

const SEND_TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * "Tue Jun 23, 9:00am ET" — a UTC instant rendered as the Eastern wall-clock send line
 * for the schedule confirm card (so the user sees the concrete first send, not just the
 * cadence). DST-correct via Intl(`America/New_York`). Returns "" on an invalid date.
 */
export function formatScheduleSendTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts: Record<string, string> = {};
  for (const p of SEND_TIME_FMT.formatToParts(d)) parts[p.type] = p.value;
  const ampm = (parts.dayPeriod ?? "").toLowerCase();
  return `${parts.weekday} ${parts.month} ${parts.day}, ${parts.hour}:${parts.minute}${ampm} ET`;
}

/** NY-local calendar parts for a UTC instant. */
function nyParts(d: Date): { year: number; month: number; day: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) map[p.type] = p.value;
  const weekday =
    ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[
      map.weekday
    ] ?? 0;
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day), weekday };
}

/** (NY-local − UTC) offset in milliseconds at the given instant (negative west of UTC). */
function nyOffsetMs(utc: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(utc)) map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - utc.getTime();
}

/** UTC instant at which the NY wall clock reads (y, m1, d, hour:00). m1 is 1–12. */
function nyWallToUtc(y: number, m1: number, d: number, hour: number): Date {
  const wall = Date.UTC(y, m1 - 1, d, hour, 0, 0);
  // Guess UTC == wall, then correct by the NY offset; one refinement pass settles
  // the DST-boundary case where the guess and the target fall on different sides
  // of a transition.
  let utc = wall - nyOffsetMs(new Date(wall));
  utc = wall - nyOffsetMs(new Date(utc));
  return new Date(utc);
}

/**
 * First UTC instant STRICTLY AFTER `fromUtc` that matches the cadence at
 * `send_hour_et` Eastern. Returns `null` only on an invalid spec (a weekly without
 * `day_of_week`, or a monthly without `day_of_month`).
 *
 * Implementation walks forward one NY calendar day at a time (up to ~400 days, so
 * monthly always resolves) and returns the first matching send instant after
 * `fromUtc`. Sampling by +24h never skips a calendar day (a DST day is 23/25h, well
 * under 48h), so no occurrence is missed.
 */
export function computeNextRunAt(spec: CadenceSpec, fromUtc: Date = new Date()): Date | null {
  const { cadence, send_hour_et } = spec;
  if (cadence === "weekly" && spec.day_of_week == null) return null;
  if (cadence === "monthly" && spec.day_of_month == null) return null;

  for (let i = 0; i < 400; i++) {
    const probe = new Date(fromUtc.getTime() + i * 86_400_000);
    const { year, month, day, weekday } = nyParts(probe);
    if (cadence === "weekly" && weekday !== spec.day_of_week) continue;
    if (cadence === "monthly" && day !== spec.day_of_month) continue;
    const candidate = nyWallToUtc(year, month, day, send_hour_et);
    if (candidate.getTime() > fromUtc.getTime()) return candidate;
  }
  return null;
}
