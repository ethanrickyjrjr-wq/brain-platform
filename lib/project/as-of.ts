/**
 * Parse the as-of date out of a freshness token (`SWFL-7421-v{n}-{YYYYMMDD}`)
 * and format it plainly, e.g. "Jun 10, 2026".
 *
 * v1 honesty mechanism (operator 2026-06-10): a filed item shows the date it was
 * captured as a plain citation line — NOT a relative-age / "may have updated"
 * badge, and we never silently re-fetch. The token stays pinned (the moat).
 * Returns null when there's no parseable trailing date.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function asOfFromToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const m = /(\d{4})(\d{2})(\d{2})\b/.exec(token);
  if (!m) return null;
  const [, y, mo, d] = m;
  const mi = Number(mo) - 1;
  const day = Number(d);
  if (mi < 0 || mi > 11 || day < 1 || day > 31) return null;
  return `${MONTHS[mi]} ${day}, ${y}`;
}
