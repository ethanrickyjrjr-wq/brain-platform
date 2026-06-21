// THE one root for the atoms every grounded assistant prompt shares.
//
// Before this module, the plain-text directive (`FORMAT_RULE`) was copy-pasted
// VERBATIM in three places — lib/grounded-answer.ts, lib/assistant/conversation-path.ts,
// and lib/welcome/grounded.ts — and the internal freshness token was quoted RAW into
// customer-facing prose (so "SWFL-7421-v5-20260612" leaked into answers). Both are
// shared concerns of the one assistant, so they get one home: change the rule here once
// and it changes everywhere; the token is rendered as a clean date in exactly one place.
import { asOfFromToken } from "@/lib/project/as-of";

/** Plain-text-only directive (no markdown). The single source for every grounded surface. */
export const FORMAT_RULE =
  "CRITICAL: Respond in plain text ONLY. " +
  "NEVER use markdown — no asterisks (* or **), no # headers, no - bullet lists, no backticks (`), no > blockquotes. " +
  "Plain prose sentences only. If you use any markdown symbol the answer will be unreadable to the user.\n\n";

/**
 * The customer-facing freshness directive. The raw freshness token
 * (`SWFL-7421-v{n}-{YYYYMMDD}`) is INTERNAL plumbing — it rides on response frames so
 * the client can pin a filed Q&A — and must NEVER appear in prose. The model states the
 * clean "as of MM/DD/YYYY" derived from it (same display form as app/demo + app/c/[id]).
 * Returns "" when there is no parseable token (no freshness line is forced).
 */
export function freshnessDirective(token?: string | null): string {
  const asOf = asOfFromToken(token);
  return asOf
    ? `State the data's recency exactly once, in plain words — "as of ${asOf}". ` +
        "Never print an internal freshness token, code, or version string."
    : "";
}
