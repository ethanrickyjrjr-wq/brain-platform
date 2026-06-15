/**
 * Freshness guard — the anti-stale-cache anchor for the SWFL Intelligence Lake.
 *
 * Every brain payload carries the same token in two places: a leading
 * `<!-- FRESHNESS ... -->` HTML comment (human-/curl-readable) and a
 * `freshness_token` frontmatter field (survives WebFetch's HTML→markdown
 * stripping, so an agent can always quote it). This module is the single
 * source of truth for building and parsing that token.
 */

import { isoTimestamp } from "./dates.mts";

/** Fixed SWFL-lake identifier. Stable across every brain in the lake. */
export const LAKE_ID = "7421";

/**
 * Build the freshness token: `SWFL-7421-v{version}-{YYYYMMDD}`.
 * The date segment is the calendar day of `refinedAt` (a refined_at ISO
 * timestamp), so the token changes on every refine.
 */
export function freshnessToken(version: number, refinedAt: string): string {
  const yyyymmdd = refinedAt.slice(0, 10).replace(/-/g, "");
  return `SWFL-${LAKE_ID}-v${version}-${yyyymmdd}`;
}

/** Build the leading HTML comment that wraps the token. */
export function freshnessComment(version: number, token: string): string {
  return `<!-- FRESHNESS: v${version} | Token: ${token} -->`;
}

/**
 * Per-brain output expiry — `refined_at + ttl_seconds`, as a full ISO timestamp.
 *
 * This is the engine-owned `BrainOutput.expires` stamped at Stage 4. It mirrors
 * the staleness math in `dag.mts:brainStatus` (`Date.parse(refined_at) +
 * ttl_seconds*1000`) but, unlike that CLI-only rebuild gate, the value it
 * produces is the self-TTL substrate the reconciliation gate REJECTS against
 * (see `freshnessGate`). Reuses `isoTimestamp` so the ms-stripped format matches
 * `refined_at` exactly (`...T00:00:00Z`, never `...T00:00:00.000Z`).
 *
 * R2 NaN-guard: a corrupt/unparseable `refined_at` returns `undefined` — never
 * `new Date(NaN).toISOString()`, which throws `RangeError`. Downstream a missing
 * `expires` degrades to "no TTL basis" (`not_found`), never a crash.
 */
export function expiresFor(refined_at: string, ttl_seconds: number): string | undefined {
  const refinedMs = Date.parse(refined_at);
  if (Number.isNaN(refinedMs)) return undefined;
  return isoTimestamp(new Date(refinedMs + ttl_seconds * 1000));
}

/** The verdict `freshnessGate` returns. `days_past` is present only when expired. */
export interface FreshnessGateResult {
  /** `true` only when the stamp is parseable AND not past `now`. */
  fresh: boolean;
  /** `true` when expired OR when either timestamp is unparseable (fail-closed). */
  expired: boolean;
  /** Echoes the `expires` argument verbatim (even when unparseable). */
  expires_at: string;
  /** Whole-and-fractional days `now` is past `expires`. Omitted when fresh. */
  days_past?: number;
}

/**
 * The ONLY rejection primitive in the freshness spine — fail-CLOSED.
 *
 * `expiresFor`/`confidence.mts` only ever *cap or decay* a headline; nothing in
 * the live read path REFUSES on a brain's own TTL. This gate does: `now > expires`
 * → `expired`, and the reconciliation comparator withholds the number rather than
 * assert it.
 *
 * N1 — the NaN-guard runs FIRST, as an explicit ordered line, BEFORE the
 * comparison. A bare `now > Date.parse(expires)` would compute `now > NaN`, which
 * is `false`, reporting a corrupt stamp as FRESH — the worst-direction failure.
 * An invalid/unparseable `expires` OR `now` therefore fails closed
 * (`{ fresh:false, expired:true }`): never assert on unknown freshness.
 *
 * An ABSENT (never-stamped) `expires` is resolved upstream (derivation fallback
 * or `not_found`) — never by passing a falsy value into this gate.
 */
export function freshnessGate(
  expires: string,
  now: string = new Date().toISOString(),
): FreshnessGateResult {
  const e = Date.parse(expires);
  const n = Date.parse(now);
  if (Number.isNaN(e) || Number.isNaN(n)) {
    return { fresh: false, expired: true, expires_at: expires };
  }
  const expired = n > e;
  return {
    fresh: !expired,
    expired,
    expires_at: expires,
    days_past: expired ? (n - e) / 86_400_000 : undefined,
  };
}

const COMMENT_RE = /^<!--\s*FRESHNESS:\s*v(\d+)\s*\|\s*Token:\s*(\S+)\s*-->$/;

/**
 * Parse a `<!-- FRESHNESS: v{n} | Token: {token} -->` line.
 * Returns `null` for anything that is not a well-formed freshness comment.
 */
export function parseFreshnessComment(line: string): { version: number; token: string } | null {
  const m = line.trim().match(COMMENT_RE);
  if (!m) return null;
  return { version: parseInt(m[1], 10), token: m[2] };
}
