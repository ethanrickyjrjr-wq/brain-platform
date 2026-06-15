/**
 * lib/reconcile/render-verdict.ts — Plan C-5, customer-clean verdict prose.
 *
 * Turns a `ReconciliationVerdict` into a one-line read-surface statement obeying
 * the rules of engagement: cite both numbers + the source, NEVER speak an
 * internal slug, and — the prime directive — NEVER echo a withheld (stale) or
 * out-of-grain number as if it were ours. Shared by the keyless `swfl_reconcile`
 * MCP tool and the deliverable verdict section, so both speak identically.
 */

import type { ReconciliationVerdict } from "./types";

/** ISO timestamp → calendar date for prose ("2026-05-01T12:00:00Z" → "2026-05-01"). */
function asDate(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : "an earlier date";
}

/**
 * Treat a snake_case, slug-shaped string as "no human label" — the rules of
 * engagement forbid speaking an internal metric slug to the customer, and a
 * caller may pass only `metric_slug` (no human label). Defense-in-depth so EVERY
 * caller (the MCP tool and the deliverable section) is protected.
 */
function humanLabel(label?: string): string | undefined {
  if (label === undefined) return undefined;
  return /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(label.trim()) ? undefined : label;
}

function fresherClause(side: ReconciliationVerdict["fresher_side"]): string {
  switch (side) {
    case "ours":
      return ", ours fresher";
    case "theirs":
      return ", yours fresher";
    case "tie":
      return ", same vintage";
    default:
      return ""; // "unknown" / undefined — make no freshness claim
  }
}

/**
 * One customer-facing line for a verdict. `label` is the human metric name, used
 * by the statuses that have no number to lead with (`out_of_grain`, `not_found`).
 * `quoteToken` (default true) prints the assertion's freshness token inline for
 * the single-verdict MCP surface; the deliverable section sets it false so the
 * token is quoted ONCE in the section footer instead.
 */
export function renderVerdictLine(
  verdict: ReconciliationVerdict,
  label?: string,
  opts: { quoteToken?: boolean } = {},
): string {
  const quoteToken = opts.quoteToken ?? true;
  const lbl = humanLabel(label); // never speak an internal slug
  const t = verdict.theirs;
  switch (verdict.status) {
    case "verified": {
      const o = verdict.ours;
      const asOf = quoteToken ? `, as of ${t.freshness_token}` : "";
      const cite = o ? ` (${o.source.citation}${asOf})` : "";
      return `Verified — your ${t.value} matches our ${o?.value ?? t.value}${cite}.`;
    }
    case "needs_review": {
      const o = verdict.ours;
      const delta = verdict.delta_pct !== undefined ? ` (Δ ${verdict.delta_pct}%)` : "";
      const cite = o ? ` Source: ${o.source.citation}.` : "";
      return `Needs review — you have ${t.value}; we hold ${o?.value ?? "a different figure"}${delta}${fresherClause(verdict.fresher_side)}.${cite}`;
    }
    case "cannot_assert_stale":
      // NEVER the number — refuse and offer a fresh pull.
      return `Cannot assert — our figure expired ${asDate(verdict.expires_at)}; pull a fresh read before relying on it.`;
    case "out_of_grain": {
      const o = verdict.ours;
      const lake = verdict.grain?.lake ?? "a coarser";
      const asserted = verdict.grain?.asserted ?? "that";
      const held = o ? ` — our ${lake} figure is ${o.value} (${o.source.citation})` : "";
      // Never echo their finer-grain claim as a number we hold.
      return `We hold ${lbl ? `"${lbl}"` : "this"} at ${lake} grain, not ${asserted} grain${held}. We don't hold a ${asserted}-grain figure.`;
    }
    case "not_found":
      return `We don't hold a matching figure for ${lbl ? `"${lbl}"` : "that"} — I can pull a fresh read if you'd like. (No stale or invented number offered.)`;
  }
}

const STATUS_LABEL: Record<ReconciliationVerdict["status"], string> = {
  verified: "verified",
  needs_review: "needs review",
  cannot_assert_stale: "cannot assert (stale)",
  out_of_grain: "out of grain",
  not_found: "not found",
};

/**
 * A deliverable "Reconciliation" section — a one-line headline tally
 * ("X verified, Y needs review, …") followed by one line per verdict, with the
 * freshness token quoted exactly once at the end. Empty input → "" (no section).
 */
export function renderVerdictSection(
  entries: ReadonlyArray<{ verdict: ReconciliationVerdict; label?: string }>,
  freshness_token?: string,
): string {
  if (entries.length === 0) return "";

  const counts = new Map<ReconciliationVerdict["status"], number>();
  for (const { verdict } of entries) {
    counts.set(verdict.status, (counts.get(verdict.status) ?? 0) + 1);
  }
  const headline = (
    ["verified", "needs_review", "cannot_assert_stale", "out_of_grain", "not_found"] as const
  )
    .filter((s) => counts.get(s))
    .map((s) => `${counts.get(s)} ${STATUS_LABEL[s]}`)
    .join(", ");

  const lines = entries.map(
    ({ verdict, label }) => `- ${renderVerdictLine(verdict, label, { quoteToken: false })}`,
  );

  const out = [`Reconciliation — ${headline}.`, ...lines];
  if (freshness_token) out.push(`Freshness: ${freshness_token}`);
  return out.join("\n");
}
