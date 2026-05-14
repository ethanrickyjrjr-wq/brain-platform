/** ISO calendar date (YYYY-MM-DD), UTC. */
export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** ISO timestamp with second precision (no milliseconds), UTC. */
export function isoTimestamp(d: Date = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * verified date + ttl seconds -> precomputed `expires` date.
 *
 * Spec v1.1 stores `expires` as a concrete date, not a `ttl` duration:
 * Phase 0 testing showed Claude reliably compares two dates but
 * unreliably computes `verified + 90d`. The Refinery does the math once.
 */
export function expiresDate(verified: string, ttlSeconds: number): string {
  const base = new Date(`${verified}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) {
    throw new Error(`expiresDate: invalid verified date "${verified}"`);
  }
  base.setUTCSeconds(base.getUTCSeconds() + ttlSeconds);
  return base.toISOString().slice(0, 10);
}
