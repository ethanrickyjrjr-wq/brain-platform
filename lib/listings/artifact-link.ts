// lib/listings/artifact-link.ts — THE one root for listing artifact links.
// Chain (spec 2026-07-02-listing-link-photo-root): the project's own property_url
// (user-input lane) → the feed-carried listing_url VERBATIM → null (render unlinked).
// Nothing anywhere else may build a listing href; a URL constructed from an id is
// an invented fact that 404s (handoff §2.3). The wave-1 URL-allowlist lint admits
// exactly: payload URLs, brand-record URLs, property_url, and email-media URLs.
import type { Listing } from "./rentcast";

const HTTP_RE = /^https?:\/\//i;

/** Shape-only validation (no reachability probe): a real http(s) URL. */
export function isValidPropertyUrl(u: unknown): u is string {
  if (typeof u !== "string") return false;
  const s = u.trim();
  if (!s || !HTTP_RE.test(s)) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

export function resolveArtifactLink(args: {
  propertyUrl?: string | null;
  listing?: Pick<Listing, "listingUrl"> | null;
}): string | null {
  if (isValidPropertyUrl(args.propertyUrl)) return (args.propertyUrl as string).trim();
  const feed = args.listing?.listingUrl;
  if (typeof feed === "string" && HTTP_RE.test(feed.trim())) return feed.trim();
  return null;
}
