// lib/email/social/resolve-logo.ts
//
// Resolve a brand logo URL for a "custom" social platform from its domain.
// Verified IN-SESSION (RULE 0.4, 2026-06-25) against the live endpoint:
//   https://img.logo.dev/{domain}?token={pk_...}&size=64&format=png
//   → 200 with a real publishable token; 401 {"msg":"invalid api token"} without.
// So Logo.dev needs a real `LOGODEV_API_KEY` (a pk_ publishable token). Until one
// is set, the keyless Google favicon service is the live fallback (no account,
// returns a generic globe for unknown domains). The render layer (SocialIcon)
// shows our own globe glyph when no logoUrl resolves at all.
//
// PURE: the token is passed in, not read here — the API route reads the env.

const SIZE = 64;

/** Best logo URL for a domain. Logo.dev when a publishable token is given, else
 *  the keyless Google favicon service. */
export function logoUrlForDomain(domain: string, logoDevToken?: string | null): string {
  const d = encodeURIComponent(domain);
  if (logoDevToken) {
    return `https://img.logo.dev/${d}?token=${encodeURIComponent(logoDevToken)}&size=${SIZE}&format=png`;
  }
  return `https://www.google.com/s2/favicons?domain=${d}&sz=${SIZE}`;
}
