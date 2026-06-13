/**
 * Multi-tenant override resolution for the broadcast route (Unit B).
 *
 * The live broadcast route is single-tenant: hardcoded to the digest segment
 * (getDigestSegmentId) and the digest sender (DIGEST_SENDER_NAME /
 * DIGEST_SENDER_ADDRESS). The cron worker (Unit F) needs to send per-tenant.
 * These pure resolvers add **optional** overrides with the digest envs as
 * fallback, so omitting them reproduces today's send byte-for-byte.
 *
 * Pure + dependency-free on purpose — deterministically testable without Resend
 * or process.env. The route does the env wiring; this only resolves precedence.
 */

/**
 * The Resend segment to broadcast to. An explicit per-tenant `override` wins;
 * otherwise fall back to the digest default. `digestDefault` is a thunk (not a
 * value) so a tenant send never evaluates getDigestSegmentId() — which throws
 * when RESEND_DIGEST_SEGMENT_ID is unset — when an override is present.
 */
export function resolveSegmentId(override: unknown, digestDefault: () => string): string {
  const id = typeof override === "string" ? override.trim() : "";
  return id || digestDefault();
}

/**
 * The sender identity. Per-tenant `fromName` / `fromEmail` override the digest
 * env defaults (DIGEST_SENDER_NAME / DIGEST_SENDER_ADDRESS — NEVER
 * RESEND_FROM_EMAIL). Returns null when, after fallback, either half is missing
 * so the route can answer `sender_not_configured` (503), exactly as today.
 */
export function resolveSender(
  overrides: { fromName?: unknown; fromEmail?: unknown },
  defaults: { name?: string; address?: string },
): { name: string; address: string } | null {
  const nameOverride = typeof overrides.fromName === "string" ? overrides.fromName.trim() : "";
  const emailOverride = typeof overrides.fromEmail === "string" ? overrides.fromEmail.trim() : "";
  const name = nameOverride || defaults.name || "";
  const address = emailOverride || defaults.address || "";
  if (!name || !address) return null;
  return { name, address };
}

/**
 * The per-tenant reply-to address. There is no env default — a digest send has no
 * reply-to today, so an absent/blank/non-string override returns `undefined` and
 * the route omits the field entirely (byte-for-byte backward compatible). Unit F
 * passes the tenant's `reply_to` here on the unverified-sender path (platform
 * default sender + tenant reply-to), per `lib/email/sender-config.ts#resolveSender`.
 * The Resend SDK field is `replyTo` (verified against the installed `resend` types).
 */
export function resolveReplyTo(override: unknown): string | undefined {
  const replyTo = typeof override === "string" ? override.trim() : "";
  return replyTo || undefined;
}
