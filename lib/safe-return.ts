/**
 * lib/safe-return.ts
 *
 * Single source of truth for "is this a safe same-origin return path?" — the
 * guard EVERY post-auth / post-flow redirect must apply before sending a user to
 * a caller-supplied `?next=` / `?return=` value. Rejects the open-redirect class:
 *   - absolute URLs ............. https://evil.com
 *   - protocol-relative ......... //evil.com   (new URL("//evil.com", origin) ESCAPES to evil.com)
 *   - backslash tricks .......... /\evil.com    (the WHATWG URL parser treats `\` as `/`)
 *
 * Pure string ops — no node/next imports — so it is safe in client, server, and
 * edge code alike.
 *
 * Born with the U1 social-connect OAuth flow; wired into /login, /auth/callback,
 * and contacts/upload to close the `next=//evil.com` open redirect those surfaces
 * carried (each had only a `startsWith("/")` check, which a `//` value passes).
 */
export function isSafeReturnPath(p: unknown): p is string {
  return typeof p === "string" && p.startsWith("/") && !p.startsWith("//") && !p.includes("\\");
}
