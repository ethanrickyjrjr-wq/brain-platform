/**
 * Best-effort in-memory IP rate limiter for the public, unauthenticated data
 * endpoints (`/api/b/*`, `/api/mcp`). Targets ABUSIVE BURST from a single IP —
 * the trivial "loop the sitemap and clone the whole lake" attack — while
 * leaving normal single-slug reads and uptime/health probes untouched.
 *
 * WHY THIS, AND WHY IT'S DEFENSE-IN-DEPTH (not the ceiling):
 *   Vercel has no `vercel.json` rate-limit surface. The authoritative,
 *   cross-instance, cross-region ceiling is a Vercel WAF custom rule published
 *   in the dashboard (Firewall → Custom Rules → Rate Limit; available on all
 *   plans). The `@vercel/firewall` `checkRateLimit()` SDK is code-callable but
 *   STILL requires that dashboard rule to exist (it returns
 *   `error: "not-found"` and fails open otherwise), so it is not a pure-code
 *   limiter either. See the PR body / SESSION_LOG for the operator runbook.
 *
 *   This module is the immediate, zero-dependency, no-dashboard-required guard
 *   that ships in code today. CAVEAT: middleware runs on Vercel's Edge runtime,
 *   where state lives per-isolate and per-region — a determined attacker spread
 *   across cold isolates can still exceed the limit. That is precisely why the
 *   WAF dashboard rule remains the close-condition for `api_b_open_rate_limit`,
 *   not this file. For a single abusive client hammering one warm isolate (the
 *   common case), this stops the burst cold.
 *
 * Algorithm: fixed-window counter per IP. Cheap, allocation-light, and good
 * enough to break a tight clone loop. Window + limit are env-tunable so the
 * operator can dial them without a redeploy-only code change.
 */

/** Requests allowed per IP per window. Default targets ~60 rpm/IP. */
const LIMIT = Number(process.env.API_RATE_LIMIT_MAX ?? "60");
/** Window length in milliseconds. Default 60s → ~60 rpm/IP. */
const WINDOW_MS = Number(process.env.API_RATE_LIMIT_WINDOW_MS ?? "60000");

type Bucket = { count: number; resetAt: number };

// Module-level Map: survives for the life of the (warm) Edge isolate. Bounded
// by sweeping expired buckets opportunistically so a flood of distinct IPs
// can't grow it without limit.
const buckets = new Map<string, Bucket>();

// Hard cap on tracked IPs per isolate; if exceeded we drop the whole table
// (fail-open) rather than leak memory. A clone loop comes from few IPs, so the
// table normally stays tiny; this only trips under a wide distinct-IP flood,
// which is the WAF/platform-DDoS layer's job anyway.
const MAX_TRACKED_IPS = 50_000;

export type RateLimitResult = {
  /** True when this request should be rejected with 429. */
  limited: boolean;
  /** Requests remaining in the current window (>= 0). */
  remaining: number;
  /** Unix ms when the current window resets. */
  resetAt: number;
  /** The configured per-window ceiling. */
  limit: number;
};

/**
 * Record a hit for `ip` and report whether it is over the limit.
 * `now` is injectable for deterministic tests.
 */
export function checkRateLimit(ip: string, now: number = Date.now()): RateLimitResult {
  // Disabled / misconfigured → fail open (never break reads on a bad env value).
  if (!Number.isFinite(LIMIT) || LIMIT <= 0) {
    return { limited: false, remaining: Infinity, resetAt: now, limit: LIMIT };
  }

  if (buckets.size > MAX_TRACKED_IPS) {
    buckets.clear();
  }

  const existing = buckets.get(ip);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + WINDOW_MS;
    buckets.set(ip, { count: 1, resetAt });
    return { limited: false, remaining: LIMIT - 1, resetAt, limit: LIMIT };
  }

  existing.count += 1;
  const remaining = Math.max(0, LIMIT - existing.count);
  return {
    limited: existing.count > LIMIT,
    remaining,
    resetAt: existing.resetAt,
    limit: LIMIT,
  };
}

/**
 * Resolve the client IP from a Next.js request's headers. Vercel sets
 * `x-forwarded-for` (client first in the comma list) and `x-real-ip`. Falls
 * back to a fixed bucket so a missing header can't bypass the limiter entirely.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test-only: clear all buckets between cases. */
export function __resetRateLimitState(): void {
  buckets.clear();
}
