/**
 * citations/internal-markers — the zero-dependency leaf for citation safety primitives.
 *
 * Lives here (importing NOTHING) so both `lib/welcome/frames.ts` and
 * `lib/citations/clean-url.ts` can import it WITHOUT forming a runtime ES-module cycle
 * (frames → clean-url for cleanCitation; clean-url → here; here → nothing). A cycle
 * between frames ↔ clean-url risked `undefined` live bindings in the webpack client
 * bundle — extracting these breaks it.
 */

/** Substrings that betray an internal/raw source that must never ship to the DOM.
 *  Kept specific — "amazonaws" already covers RDS/S3 hosts and "supabase.co" covers
 *  the pooler, so no loose "rds."/"pooler." marker (which would false-match e.g.
 *  "haza-rds.-fema.gov"). */
export const INTERNAL_SOURCE_MARKERS = [
  "supabase.co",
  "amazonaws",
  "data_lake",
  "localhost",
  "127.0.0.1",
  ".internal",
];

/** True if a URL/domain looks like a raw internal source (data_lake/supabase/etc.). */
export function isInternalSource(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  return INTERNAL_SOURCE_MARKERS.some((m) => v.includes(m));
}

/** Extract a clean display host ("fema.gov") from a URL; "" if unparseable. */
export function hostDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
