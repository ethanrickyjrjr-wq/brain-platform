/**
 * change-detection.ts — Piece 3 (Signal Layer) Track B, the `data-change` cron's
 * PURE decision core (no DB, no disk, no clock except the injectable `now`).
 *
 * The runner (`scripts/project-feed/change-detection.mts`) supplies the live lake
 * fact (lane 1, via the same `loadParsedBrain`→`factFromParsedBrain` path
 * `swfl_reconcile` uses) and the prior snapshot (read off the LAST `data-change`
 * feed row's `payload`). This module decides, deterministically, whether a
 * (user, ZIP, brain) signal is a real move worth surfacing.
 *
 * Design (spec §AUDIT-VERIFIED BUILD CONTRACT, data-change cron):
 *  - The feed row IS the snapshot — there is no last-seen store. `payload` carries
 *    the observed value + token; the next run compares against it.
 *  - Material gate = `reconcileMetric(currentFact, priorAssertion)` → only a
 *    `needs_review` (the value actually moved) emits an UNREAD row. A bare daily
 *    token bump with an unchanged number is `verified` → skip (no noise).
 *  - `title` = the deterministic reconcile `reason` string (no invention).
 *  - Cold start (no prior) → a baseline row with `read_at=now()` (recorded, not
 *    surfaced); a real move later → an unread (live) row.
 *  - Rows are Tier-2 scope-keyed: `project_id=null`, late-bound at read time in
 *    `readProjectFeed` so a project created tomorrow still matches the ZIP.
 */
import { reconcileMetric } from "@/lib/reconcile/reconcile";
import type { LaneOneFact, LaneTwoAssertion, ReconciliationVerdict } from "@/lib/reconcile/types";
import type { FeedRowInput } from "@/lib/project/feed";

/** A brain whose per-ZIP `detail_tables` column we track for movement. */
export interface ZipSignalBrain {
  /** The brain slug (`brains/<report_id>.md`). */
  report_id: string;
  /** The per-ZIP detail-table COLUMN id (`findZipCell` matches `col.id === slug`). */
  metric_slug: string;
  /** Clean human label for deterministic feed `detail` lines. */
  label: string;
}

/**
 * The tracked per-ZIP signals — the two independent property signals (price,
 * rent). Each `metric_slug` was verified against the live brain output as a
 * numeric column in a `grain:"zip"` detail table:
 *   - housing-swfl.median_sale_price  (table `housing_by_zip`, Redfin median, USD)
 *   - rentals-swfl.rent_index_latest  (table `rentals_by_zip`, ZORI, USD/month)
 *
 * LOAD-BEARING: every tracked brain MUST be in `BRAIN_CATALOG`
 * (refinery/packs/catalog.mts) so `factFromParsedBrain` can derive a TTL basis
 * (`expiresFor(refined_at, ttl_seconds)`). Both are (ttl 35d). The obvious ZHVI
 * pick — `home-values-swfl.home_value_zhvi` — is DELIBERATELY NOT used: that brain
 * (and `investor-zip-swfl`) is ABSENT from the catalog AND its committed `.md`
 * carries no stamped `expires`, so `factFromParsedBrain` returns
 * `expires=undefined` → `reconcileMetric` short-circuits to `not_found` → the
 * signal would silently NEVER emit (verified 2026-06-17, the Track-B audit's
 * critical finding). `housing-swfl.median_sale_price` is the catalog-resolvable
 * home-price signal (actual transacted median, not the index). Extend by
 * APPENDING another catalog-resolvable per-ZIP column — no architecture change.
 * The runner LOUD-warns if a tracked brain resolves facts but reconciles
 * `not_found` for all of them (the silent-death tripwire).
 */
export const ZIP_SIGNAL_BRAINS: ZipSignalBrain[] = [
  { report_id: "housing-swfl", metric_slug: "median_sale_price", label: "median sale price" },
  { report_id: "rentals-swfl", metric_slug: "rent_index_latest", label: "rent" },
];

/**
 * Canonical dedup key — one row per (USER, ZIP, brain, freshness token).
 *
 * `user_id` is load-bearing, NOT cosmetic: rows are fanned out per user (each is
 * an owner-RLS-anchored copy), and `project_feed_dedup_uidx` is GLOBALLY UNIQUE —
 * so a user-agnostic key would let one user's row block every other user scoping
 * the same ZIP from ever receiving the signal (`upsert ignoreDuplicates` drops
 * the collision silently). This corrects the spec's `datachange:<scope>:<brain>:
 * <token>`, which omits the user and collapses the fan-out to a single owner.
 */
export function dataChangeDedupKey(
  userId: string,
  zip: string,
  brainId: string,
  token: string,
): string {
  return `datachange:${userId}:${zip}:${brainId}:${token}`;
}

/** A project reduced to its owner + the ZIPs its items scope. */
export interface ProjectZips {
  user_id: string;
  zips: string[];
}

/**
 * Build the `zip → set of user_ids` fan-out map. The cron reads each unique live
 * ZIP once, then writes one row per (ZIP, user) so an owner-RLS read can later
 * bind it. Dedups a user that scopes the same ZIP from multiple projects.
 */
export function buildScopeUserMap(projects: ProjectZips[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const p of projects) {
    for (const zip of p.zips) {
      let users = map.get(zip);
      if (users === undefined) {
        users = new Set();
        map.set(zip, users);
      }
      users.add(p.user_id);
    }
  }
  return map;
}

/** The prior snapshot for a (user, ZIP, brain), read off the last data-change row. */
export interface PriorSnapshot {
  value: number | string;
  token: string;
}

/** Minimal shape of a `project_feed` row the prior-snapshot index reads. */
export interface PriorFeedRow {
  user_id: string;
  scope_value: string | null;
  payload: Record<string, unknown>;
}

/**
 * Index the latest data-change snapshot per `${user}|${zip}|${brain}`. Rows MUST
 * arrive newest-first (the runner orders by `created_at DESC`) — the first
 * occurrence of a key is therefore its latest snapshot. A baseline row is a valid
 * prior (it records a value+token); rows missing brain/value/token/scope are
 * skipped (can't form a comparable snapshot).
 */
export function indexPriorSnapshots(rows: PriorFeedRow[]): Map<string, PriorSnapshot> {
  const map = new Map<string, PriorSnapshot>();
  for (const r of rows) {
    const brain = typeof r.payload?.brain === "string" ? r.payload.brain : null;
    const value = r.payload?.value;
    const token = typeof r.payload?.token === "string" ? r.payload.token : null;
    if (brain === null || r.scope_value === null || token === null) continue;
    if (typeof value !== "number" && typeof value !== "string") continue;
    const key = `${r.user_id}|${r.scope_value}|${brain}`;
    if (!map.has(key)) map.set(key, { value, token });
  }
  return map;
}

export interface DecideArgs {
  /** Current lake fact for (ZIP, brain), or null if the lake holds no such row. */
  fact: LaneOneFact | null;
  /** The last recorded snapshot for this (user, ZIP, brain), or null on cold start. */
  prior: PriorSnapshot | null;
  /** Current brain freshness token (the dedup-key suffix). */
  token: string;
  brain: ZipSignalBrain;
  zip: string;
  userId: string;
  now?: Date;
}

export type DecideAction = "skip" | "baseline" | "emit";

export interface DecideResult {
  action: DecideAction;
  row?: FeedRowInput;
  verdict?: ReconciliationVerdict;
}

/**
 * Decide whether a (user, ZIP, brain) reading produces a feed row.
 *
 *  - fact null                     → skip (lake holds no row for this ZIP)
 *  - prior null                    → baseline (record snapshot, read_at=now)
 *  - reconcile `needs_review`      → emit (value moved; unread row)
 *  - reconcile anything else       → skip (verified=unchanged; stale/not_found/
 *                                    out_of_grain = cannot assert a move)
 */
export function decideDataChange(args: DecideArgs): DecideResult {
  const { fact, prior, token, brain, zip, userId } = args;
  const now = args.now ?? new Date();

  if (fact === null) return { action: "skip" };

  const dedup_key = dataChangeDedupKey(userId, zip, brain.report_id, token);
  const common = {
    user_id: userId,
    project_id: null as string | null,
    kind: "data-change",
    scope_kind: "zip" as const,
    scope_value: zip,
    ref_url: `/r/${brain.report_id}`,
    dedup_key,
  };

  // Cold start — record the baseline, muted (read_at set so P2 never surfaces it).
  if (prior === null) {
    return {
      action: "baseline",
      row: {
        ...common,
        title: `baseline ${brain.label} snapshot`,
        read_at: now.toISOString(),
        payload: {
          brain: brain.report_id,
          metric_slug: brain.metric_slug,
          value: fact.value,
          token,
          baseline: true,
        },
      },
    };
  }

  // Material gate — current fact (lane 1) vs the prior snapshot (lane 2).
  const assertion: LaneTwoAssertion = {
    report_id: brain.report_id,
    label: brain.label,
    value: String(prior.value),
    freshness_token: prior.token,
    origin: "web",
  };
  const verdict = reconcileMetric(fact, assertion, now.toISOString());

  if (verdict.status !== "needs_review") {
    // verified (unchanged), cannot_assert_stale, not_found, out_of_grain → no move.
    return { action: "skip", verdict };
  }

  // Correctly-signed "change since the last recorded snapshot" for P2 to phrase.
  // reconcile's delta_pct uses ours=current/theirs=prior, so a RISE reads negative
  // there — we keep that verbatim in the title (contract: title = reconcile reason)
  // but expose this natural (current − prior)/prior so a price rise is +%, not −%.
  const priorNum = Number(prior.value);
  const curNum = Number(fact.value);
  const change_pct =
    Number.isFinite(priorNum) && priorNum !== 0 && Number.isFinite(curNum)
      ? Math.round(((curNum - priorNum) / priorNum) * 10000) / 100
      : undefined;

  return {
    action: "emit",
    verdict,
    row: {
      ...common,
      title: verdict.reason, // deterministic reconcile reason — no invention
      detail: `${brain.label}: ${prior.value} → ${fact.value}`,
      payload: {
        brain: brain.report_id,
        metric_slug: brain.metric_slug,
        value: fact.value,
        prior_value: prior.value,
        token,
        ...(verdict.delta_pct !== undefined ? { delta_pct: verdict.delta_pct } : {}),
        ...(change_pct !== undefined ? { change_pct } : {}),
      },
    },
  };
}
