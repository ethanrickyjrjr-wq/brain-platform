/**
 * Parse the as-of date out of a freshness token (`SWFL-7421-v{n}-{YYYYMMDD}`)
 * and format it plainly, e.g. "06/10/2026".
 *
 * v1 honesty mechanism (operator 2026-06-10): a filed item shows the date it was
 * captured as a plain citation line — NOT a relative-age / "may have updated"
 * badge, and we never silently re-fetch. The token stays pinned (the moat).
 * Returns null when there's no parseable trailing date.
 */
/** The validated {y,mo,d} of a token's trailing date, or null. ONE parser for
 *  both the display form (`asOfFromToken`) and the compare key (`tokenDayKey`). */
function parseTokenDate(
  token: string | null | undefined,
): { y: string; mo: string; d: string } | null {
  if (!token) return null;
  const m = /(\d{4})(\d{2})(\d{2})\b/.exec(token);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { y, mo, d };
}

export function asOfFromToken(token: string | null | undefined): string | null {
  const p = parseTokenDate(token);
  return p ? `${p.mo}/${p.d}/${p.y}` : null;
}

/**
 * The sortable "YYYYMMDD" day key of a freshness token's trailing date, or null.
 * 8-digit zero-padded → a plain lexical `>` IS chronological (the same day-granular
 * basis as reconcile's `fresher_side`). Use this for "newer than last seen"
 * comparisons; use `asOfFromToken` for display. Piece 2's digest reads it.
 */
export function tokenDayKey(token: string | null | undefined): string | null {
  const p = parseTokenDate(token);
  return p ? `${p.y}${p.mo}${p.d}` : null;
}

/**
 * The numeric refinery version `{n}` from a `SWFL-7421-v{n}-…` token, or null. Used to
 * break a same-DAY tie when picking the newest token (the day tail can't distinguish
 * `v9` from `v10` on the same date, and a lexical compare would order them wrong).
 */
export function tokenVersion(token: string | null | undefined): number | null {
  if (!token) return null;
  const m = /-v(\d+)-/.exec(token);
  return m ? Number(m[1]) : null;
}
