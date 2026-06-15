/**
 * lib/reconcile/reconcile.ts — Plan C, the lane-3 deterministic comparator.
 *
 * `reconcileMetric(fact | null, assertion, now?)` compares our cited lake fact
 * (lane 1) against the user's-AI assertion (lane 2) under a HARD self-TTL gate,
 * in STRICT order (first failing gate wins): resolve → no-TTL-basis → TTL gate →
 * grain → value. Pure: no LLM, no I/O, no `Date.now` except via the injectable
 * `now` (defaulting to the live clock only when omitted).
 *
 * Prime directive — never assert a stale or invented figure:
 *   • past TTL        → `cannot_assert_stale`, the value is WITHHELD (ours omitted).
 *   • finer than lake → `out_of_grain`, never fabricated below grain.
 *   • no TTL basis    → `not_found` ("no TTL basis"), NOT a false "expired".
 *
 * Reuses the ONE normalizer (`normalizeNumber`) and the ONE reject primitive
 * (`freshnessGate`) — never a parallel implementation of either.
 */

import { normalizeNumber } from "../deliverable/narrative-lint";
import { freshnessGate } from "../../refinery/lib/freshness.mts";
import type { LaneOneFact, LaneTwoAssertion, ReconciliationVerdict } from "./types";

// ---------------------------------------------------------------------------
// Grain fineness
// ---------------------------------------------------------------------------

/**
 * Spatial-unit fineness, finest → coarsest (lower rank = finer). Mirrors the
 * canonical `Grain` order in refinery/lib/zip-resolver.mts
 * (zip < corridor < city < county < msa < region < state < national), EXTENDED
 * below `zip` with the sub-ZIP units a brain never holds — the exact case
 * `out_of_grain` exists to fence (a parcel assertion vs a ZIP-grain lake fact).
 * Keep in sync if that enum is reordered.
 */
const GRAIN_RANK: Record<string, number> = {
  parcel: 0,
  address: 0,
  zip: 1,
  corridor: 2,
  city: 3,
  place: 3,
  county: 4,
  msa: 5,
  metro: 5,
  region: 6,
  state: 7,
  national: 8,
  us: 8,
};

/** First segment of a "<unit>-<period>" grain (or a bare unit), lowercased. */
function grainUnit(grain: string): string {
  return grain.trim().toLowerCase().split("-")[0];
}

/**
 * True ONLY when we can positively determine the assertion is finer than the
 * lake. An unknown unit on either side → `false` (do not fence on an
 * un-rankable grain; fall through to the value compare).
 */
function assertedFinerThanLake(asserted: string | undefined, lake: string): boolean {
  if (asserted === undefined) return false;
  const a = GRAIN_RANK[grainUnit(asserted)];
  const l = GRAIN_RANK[grainUnit(lake)];
  if (a === undefined || l === undefined) return false;
  return a < l;
}

// ---------------------------------------------------------------------------
// fresher_side — day-granular (the token only carries YYYYMMDD)
// ---------------------------------------------------------------------------

/** "YYYYMMDD" from an ISO timestamp's calendar day, or null if unparseable. */
function isoDay(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
}

/** The validated "YYYYMMDD" tail of a SWFL-7421-v{n}-{YYYYMMDD} token, or null. */
function tokenDay(token: string): string | null {
  const m = token.match(/-(\d{8})$/);
  if (!m) return null;
  const day = m[1];
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
  return Number.isNaN(Date.parse(iso)) ? null : day;
}

function fresherSide(fetchedAt: string, token: string): "ours" | "theirs" | "tie" | "unknown" {
  const ours = isoDay(fetchedAt);
  const theirs = tokenDay(token);
  if (ours === null || theirs === null) return "unknown";
  if (ours > theirs) return "ours"; // 8-digit zero-padded → lexical == chronological
  if (ours < theirs) return "theirs";
  return "tie";
}

// ---------------------------------------------------------------------------
// Value compare — verbatim-or-fail, one normalizer
// ---------------------------------------------------------------------------

function compareValues(
  ours: number | string,
  theirs: string,
): { verified: boolean; delta_pct?: number } {
  const oursN = normalizeNumber(String(ours));
  const theirsN = normalizeNumber(theirs);
  const bothNumeric = oursN !== "" && theirsN !== "";

  if (bothNumeric) {
    if (oursN === theirsN) return { verified: true }; // verbatim match
    const oursNum = Number.parseFloat(oursN);
    const theirsNum = Number.parseFloat(theirsN);
    if (oursNum === 0 || !Number.isFinite(oursNum) || !Number.isFinite(theirsNum)) {
      return { verified: false }; // no meaningful delta against a 0/non-finite base
    }
    const delta = ((theirsNum - oursNum) / oursNum) * 100;
    return { verified: false, delta_pct: Math.round(delta * 100) / 100 };
  }

  // Categorical / non-numeric: exact case/space-normalized string compare. (A
  // numeric-only path would normalize two distinct labels both to "" and falsely
  // "verify" them.)
  const oursS = String(ours).trim().toLowerCase();
  const theirsS = theirs.trim().toLowerCase();
  return { verified: oursS === theirsS };
}

// ---------------------------------------------------------------------------
// The comparator
// ---------------------------------------------------------------------------

export function reconcileMetric(
  fact: LaneOneFact | null,
  assertion: LaneTwoAssertion,
  now: string = new Date().toISOString(),
): ReconciliationVerdict {
  const theirs = {
    value: assertion.value,
    freshness_token: assertion.freshness_token,
    ...(assertion.source_url !== undefined ? { source_url: assertion.source_url } : {}),
  };

  // 1. Resolve — no lake metric resolved (missing/ambiguous label).
  if (fact === null) {
    return {
      status: "not_found",
      theirs,
      reason: `no lake metric resolves for "${assertion.label}"`,
    };
  }

  const grain = {
    lake: fact.grain,
    ...(assertion.asserted_grain !== undefined ? { asserted: assertion.asserted_grain } : {}),
    mismatch: false,
  };

  // 2. No TTL basis (catalog gap). Test `=== undefined`, NOT `!expires`: a
  //    present-but-corrupt value is a stamped value, not a missing basis — it
  //    falls through to the gate below, which fail-closes garbage to expired.
  if (fact.expires === undefined) {
    return {
      status: "not_found",
      theirs,
      grain,
      reason: `no TTL basis — "${fact.brain_id}" absent from catalog`,
    };
  }
  const expires: string = fact.expires;

  // 3. Hard TTL gate (C-1). Stale → withhold the number entirely (no `ours`,
  //    no value in the reason); offer a re-pull. fresher_side is "unknown".
  if (freshnessGate(expires, now).expired) {
    return {
      status: "cannot_assert_stale",
      theirs,
      fresher_side: "unknown",
      grain,
      reason: `lake fact expired ${expires} — refuse to assert; offer re-pull`,
    };
  }

  // The lake value is real and fresh — surface our side of the receipt.
  const ours = {
    value: fact.value,
    metric_slug: fact.metric_slug,
    expires,
    source: fact.source,
  };
  const fresher_side = fresherSide(fact.source.fetched_at, assertion.freshness_token);

  // 4. Grain — assertion strictly finer than the lake holds → never fabricate.
  if (assertedFinerThanLake(assertion.asserted_grain, fact.grain)) {
    return {
      status: "out_of_grain",
      ours,
      theirs,
      fresher_side,
      grain: { ...grain, mismatch: true },
      reason: `asserted grain "${assertion.asserted_grain}" finer than lake grain "${fact.grain}" — not held`,
    };
  }

  // 5. Value compare — verbatim-or-fail; signed delta on a numeric mismatch.
  const cmp = compareValues(fact.value, assertion.value);
  if (cmp.verified) {
    return {
      status: "verified",
      ours,
      theirs,
      fresher_side,
      grain,
      reason: `value matches at "${fact.grain}" and the lake fact is fresh`,
    };
  }
  return {
    status: "needs_review",
    ours,
    theirs,
    fresher_side,
    grain,
    ...(cmp.delta_pct !== undefined ? { delta_pct: cmp.delta_pct } : {}),
    reason: cmp.delta_pct !== undefined ? `values differ by ${cmp.delta_pct}%` : `values differ`,
  };
}
