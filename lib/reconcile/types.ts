/**
 * lib/reconcile/types.ts — Plan C, lane-3 reconciliation contract.
 *
 * Lane 1 (our cited lake fact) vs lane 2 (the user's-AI assertion), compared by
 * the deterministic `reconcileMetric` comparator under a HARD self-TTL gate.
 * Every shape here is lane-tagged so a reader (and the fixtures) can never
 * confuse a synthetic input with a live one.
 *
 * Prime directive: the comparator NEVER asserts a stale or invented figure. A
 * lake fact past its `expires` is withheld (`cannot_assert_stale`); an assertion
 * finer than the lake grain is never fabricated (`out_of_grain`); a fact with no
 * TTL basis at all is `not_found`, never falsely "expired".
 */

export type VerdictStatus =
  | "verified" //            value matches at the same grain AND the lake fact is fresh
  | "needs_review" //        both present & fresh, but the values differ (the discrepancy case)
  | "cannot_assert_stale" // lake fact HELD but past TTL (C-1 gate) — refuse to assert; offer re-pull
  | "out_of_grain" //        assertion is finer-grained than the lake holds — never fabricate
  | "not_found"; //          no lake metric resolves (missing/ambiguous label) OR no TTL basis (uncataloged)

/** A source receipt — the same disputable shape a `BrainOutputMetric.source` carries. */
export interface LaneOneSource {
  url: string;
  fetched_at: string;
  tier: 1 | 2 | 3 | 4;
  citation: string;
}

/** Lane 1 — our cited lake fact (resolved from a brain's `key_metrics` by C-3). */
export interface LaneOneFact {
  brain_id: string;
  metric_slug: string;
  label: string;
  value: number | string;
  /** Lake grain, "<unit>-<period>" e.g. "zip-month" (or a bare unit, "county"). */
  grain: string;
  source: LaneOneSource;
  /**
   * Per-brain output expiry (C-1 `expiresFor`), resolved by C-3. ABSENT
   * (`=== undefined`) means NO TTL basis (the brain is uncataloged) ⇒ `not_found`.
   * A present-but-corrupt value is NOT absent — it falls through to the gate,
   * which fail-closes garbage to expired (`cannot_assert_stale`).
   */
  expires?: string;
  /** Brain output freshness token (e.g. `SWFL-7421-v5-20260619`). Used by the
   *  refresh route to detect data-vintage changes since the item was filed. */
  freshness_token?: string;
}

/** Lane 2 — the user's-AI assertion (a filed `ProjectItem{kind:"metric"}`, bridged by C-3). */
export interface LaneTwoAssertion {
  report_id: string;
  label: string;
  value: string;
  /** `SWFL-7421-v{n}-{YYYYMMDD}` — quoted verbatim from the payload at file time. */
  freshness_token: string;
  source_url?: string;
  source_label?: string;
  /** Forward path: when present, C-3 resolves the slug directly (wins over label). */
  metric_slug?: string;
  /** "<unit>-<period>" or a bare unit, e.g. "parcel". Finer than lake ⇒ out_of_grain. */
  asserted_grain?: string;
  origin: "mcp" | "web";
}

export interface ReconciliationVerdict {
  status: VerdictStatus;
  /**
   * Our side of the receipt. OMITTED ENTIRELY when the value is withheld — i.e.
   * for `cannot_assert_stale` (held but expired) and `not_found` (no fact / no
   * basis). Present for `verified`, `needs_review`, and `out_of_grain` (the lake
   * value is real and fresh; only its grain differs).
   */
  ours?: {
    value: number | string;
    metric_slug: string;
    expires: string;
    source: LaneOneSource;
  };
  /** Their side — always present; the assertion is the thing being checked. */
  theirs: { value: string; freshness_token: string; source_url?: string };
  /**
   * The lake fact's expiry (ISO), surfaced as NON-VALUE metadata whenever a TTL
   * basis exists — notably on `cannot_assert_stale`, so a read surface can say
   * "expired {date}" without leaking the withheld number. Absent on `not_found`
   * (no basis). Never the metric value.
   */
  expires_at?: string;
  /** Signed `(theirs − ours) / ours × 100`, 2dp. Numeric `needs_review` only. */
  delta_pct?: number;
  /** Which side is fresher. `"unknown"` when `ours` is withheld OR a date is unparseable. */
  fresher_side?: "ours" | "theirs" | "tie" | "unknown";
  /** Grain comparison. `mismatch` is true ONLY on `out_of_grain` (asserted strictly finer). */
  grain?: { lake: string; asserted?: string; mismatch: boolean };
  /** Deterministic, prose-free machine reason. Never carries the withheld number. */
  reason: string;
}
