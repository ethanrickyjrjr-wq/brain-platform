/**
 * permits-swfl windowing + rate-normalization math.
 *
 * Per spec rev 2026-05-21:
 *  - Historical baseline: 13 trailing 28-day non-overlapping windows
 *    (immediately preceding the current 90d window).
 *  - Current window: 1 x 90-day window ending at NOW.
 *  - Rate-normalize before z-score using OBSERVED days in each window.
 *  - z = (current_rate - mean(historical_rates)) / stdev_pop(historical_rates).
 *  - Guards: stdev == 0 -> z = 0. Empty historical -> z = 0.
 */

export interface PermitWindow {
  start_inclusive: Date;
  end_exclusive: Date;
}

const DAY_MS = 86400_000;

export function generateCurrentWindow(now: Date): PermitWindow {
  return {
    start_inclusive: new Date(now.getTime() - 90 * DAY_MS),
    end_exclusive: new Date(now.getTime()),
  };
}

export function generateHistoricalWindows(now: Date): PermitWindow[] {
  const out: PermitWindow[] = [];
  const ninetyDaysAgo = now.getTime() - 90 * DAY_MS;
  for (let i = 0; i < 13; i++) {
    const end = ninetyDaysAgo - i * 28 * DAY_MS;
    const start = end - 28 * DAY_MS;
    out.push({
      start_inclusive: new Date(start),
      end_exclusive: new Date(end),
    });
  }
  return out;
}

export function countPermitsInWindow<T extends { issued_date: string }>(
  permits: ReadonlyArray<T>,
  w: PermitWindow,
): number {
  const startMs = w.start_inclusive.getTime();
  const endMs = w.end_exclusive.getTime();
  let n = 0;
  for (const p of permits) {
    const t = Date.parse(p.issued_date);
    if (Number.isNaN(t)) continue;
    if (t >= startMs && t < endMs) n++;
  }
  return n;
}

export function observedDaysInWindow(w: PermitWindow): number {
  return (w.end_exclusive.getTime() - w.start_inclusive.getTime()) / DAY_MS;
}

export function rateNormalize(count: number, w: PermitWindow): number {
  const days = observedDaysInWindow(w);
  if (days <= 0) return 0;
  return count / days;
}

export function computeZScore(
  currentRate: number,
  historicalRates: ReadonlyArray<number>,
): number {
  if (historicalRates.length === 0) return 0;
  const mean =
    historicalRates.reduce((a, b) => a + b, 0) / historicalRates.length;
  const variance =
    historicalRates.reduce((s, r) => s + (r - mean) ** 2, 0) /
    historicalRates.length;
  const stdev = Math.sqrt(variance);
  if (stdev === 0) return 0;
  return (currentRate - mean) / stdev;
}
