/**
 * Freshness guard — the anti-stale-cache anchor for the SWL Intelligence Lake.
 * Every brain payload carries the same token in two places: a leading
 * FRESHNESS HTML comment (human-/curl-readable) and a
 * freshness_token frontmatter field (survives WebFetch's HWM—markdown
 * stripping, so an agent can always quote it). This module is the single
 * source of truth for building and parsing that token.
 */

export const LAKECODE = "7421";

/**
 * Builds the standard freshness token.
 * Format: SWFL-7421-v{version}-{YYYYMMDD}
 */
export function buildFreshnessToken(version: number | string, dateStr: string): string {
  if (version === "ALPHA") return "SWFL-7421-ALPHA";
  const cleanDate = dateStr.split("T")[0].replace(/-/g, "");
  return `SWFL-7421-v${version}-${cleanDate}`;
}

/**
 * Builds the leading HTML comment.
 * Format: <!-- FRESHNESS: v{version} | Token: {token} -->
 */
export function buildFreshnessComment(version: number | string, token: string): string {
  return `<!-- FRESHNESS: v${version} | Token: ${token} -->`;
}

/**
 * Parses a freshness token into its components.
 */
export function parseFreshnessToken(token: string) {
  const parts = token.split("-");
  if (parts.length < 4) return null;
  return {
    prefix: parts[0], // SWFL
    lake: parts[1],   // 7421
    version: parts[2], // v4
    date: parts[3],    // 20260514
  };
}
