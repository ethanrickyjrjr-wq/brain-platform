/**
 * Build a public, human-readable citation URL pointing at the
 * `/r/source/[table]` provenance page.
 *
 * Pack source connectors call this when emitting `BrainOutputMetricSource.url`
 * so a disputant clicking the citation lands on a page that shows row count,
 * date range, and a sample of the underlying table — backed by a server-only
 * service-role Supabase client. The raw Supabase REST URL the refinery used
 * to emit returns 401 in a browser, which is what this replaces.
 *
 * **Local-dev gotcha:** when refinery runs locally and emits brains/*.md,
 * the URL hard-codes `https://www.swfldatagulf.com` unless
 * `NEXT_PUBLIC_SITE_URL` is set in the refinery's environment. To exercise
 * the page against `localhost:3000`, set `NEXT_PUBLIC_SITE_URL=http://localhost:3000`
 * before regenerating the brain.
 */
export interface SourceCitationParams {
  /** Human-readable label rendered in the page header (e.g. "Florida DOR TDT collections"). */
  label: string;
  /** Upstream source name shown in the meta grid (e.g. "Florida DOR"). */
  source: string;
  /** Consuming brain id; the page links back to `/r/{brain}`. */
  brain: string;
  /**
   * Optional column to order the sample query by, descending. When absent the
   * page falls back to a prioritized walk of common date columns. Supply the
   * name the pack normalizes to (e.g. `period_yyyymm`), not the raw DB column.
   */
  date_col?: string;
  /** Optional external doc/PDF URL surfaced as a "Source documentation" link. */
  doc?: string;
}

const FALLBACK_ORIGIN = "https://www.swfldatagulf.com";

function resolveOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return FALLBACK_ORIGIN;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export function buildSourceCitationUrl(
  table: string,
  params: SourceCitationParams,
): string {
  const origin = resolveOrigin();
  const qs = new URLSearchParams();
  qs.append("label", params.label);
  qs.append("source", params.source);
  qs.append("brain", params.brain);
  if (params.date_col) qs.append("date_col", params.date_col);
  if (params.doc) qs.append("doc", params.doc);
  return `${origin}/r/source/${table}?${qs.toString()}`;
}
