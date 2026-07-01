# Wire active-listings-swfl + investor-zip-swfl into master

**Date:** 2026-07-01

## Problem

Auditing why `/graph` shows so many disconnected nodes (see SESSION_LOG "graphify: fixed 3 real
edge-extraction bugs") surfaced 6 Tier-1 brains that build and publish to `brains/*.md` daily but
that `master.mts` never consumes: `investor-zip-swfl`, `active-listings-swfl`, `active-rentals-swfl`,
`price-distribution-swfl`, `listing-momentum-swfl`, `market-temperature-swfl`. A separate session
(`c1afc357`) already wired the last 3 (the market-cadence tier) the same day. This spec covers the
remaining 2 that are ready now; `active-rentals-swfl` is deliberately excluded (see Scope).

Both remaining brains are fully built, tested, registered in `catalog.mts`/`index.mts`, and already
producing live output — this is a pure wiring gap, not a build gap. Master's synthesis simply never
sees them, so nothing downstream (the assistant, deliverables, `/r/*` pages) can reason over their
data even though it exists.

## Goal

`master.mts` fans `investor-zip-swfl` and `active-listings-swfl` into its upstream corpus the same
way it already does for every other Tier-1 reporter, so their facts are available to synthesis and
citable downstream — with zero risk of skewing master's direction vote (verified: both are
deterministic, magnitude-0, `direction: "neutral"` reporters, same class as `price-distribution-swfl`).

## Scope

**In scope:**
- `investor-zip-swfl` — ZIP-grain investor composite (flood-adjusted gross rent yield), joins
  `home-values-swfl` + `rentals-swfl` + `env-swfl` in code. `skipSynthesisAgent`, always emits
  `direction: "neutral", magnitude: 0` (confirmed in `refinery/packs/investor-zip-swfl.mts:340-341,502-503`).
  Its one incomplete column (`str_revenue_est_monthly`, AirDNA-gated) is null-tolerant and unrelated
  to this wiring — not a blocker.
- `active-listings-swfl` — for-sale inventory reporter, live-wired to the `listing_active_stats` view
  and cron since 2026-06-27. `skipSynthesisAgent`, always emits `direction: "neutral"`/`"stable"`
  (confirmed in `refinery/packs/active-listings-swfl.mts:59,205`).

**Explicitly out of scope:**
- `active-rentals-swfl` — held out on operator decision. It has an open, operator-run
  `active_rentals_swfl_live_verify` check (not yet closed); the market-cadence precedent (`c1afc357`)
  was itself gated on its equivalent check closing first (`market_cadence_three_tier_live_verify`), so
  this follows the same rule rather than an exception. Wire it in a follow-up spec once that check closes.
- No new vocab slugs, no catalog.mts changes, no new tests — both brains are already fully registered;
  this is additive-only to `master.mts`.
- No changes to either brain's own internals, caveats, or output shape.

## What we're building

Mirror the exact pattern `c1afc357` used to wire the market-cadence tier — the only precedent for this
exact operation in this codebase, already reviewed and shipped.

In `refinery/packs/master.mts`:

1. Add to the `sources[]` array (after the existing `makeBrainInputSource(...)` calls, alongside the
   three already added by `c1afc357`):
   ```
   makeBrainInputSource("investor-zip-swfl"),
   makeBrainInputSource("active-listings-swfl"),
   ```
2. Add to the `input_brains[]` array:
   ```
   { id: "investor-zip-swfl", edge_type: "input" },
   { id: "active-listings-swfl", edge_type: "input" },
   ```
   Both plain `input`, non-critical — consistent with how every other factual (non-directional)
   reporter is wired, including the three `c1afc357` just added. No `critical: true` flag (master
   should never block/degrade on either of these being stale — same reasoning as `market-heat-swfl`/
   `seller-stress-swfl`).

That's the entire code change — 4 lines total, 2 files touched (just `master.mts`; no second file this
time since there's no accompanying pipeline/cron graduation like `c1afc357` had).

### Why plain `input`, not `modifier`

`env-swfl` is the only `modifier` in master's current upstream list, and it's `modifier` because it
adjusts the override cascade (flood-barrier-mode-1), not just because it's read-only informational.
Neither `investor-zip-swfl` nor `active-listings-swfl` touches the override cascade or vote weighting
logic — they're pure factual add-ons. `input` is correct, and since both always emit magnitude 0 /
neutral direction, they contribute nothing to the direction vote regardless of edge_type — this was
the one real risk worth checking (ZIP-grain investor composite double-counting against its own
upstream `rentals-swfl`/`env-swfl`, which are already master inputs) and it's structurally impossible
given how `voteDirection` in `refinery/lib/synth.mts` treats magnitude-0 fragments.

## Verification

1. `bun run refinery -- master --target-only` — rebuild master only (per the `--target-only` rule,
   never a full `pack_id=master --force` cascade). Confirm both new upstreams resolve without error and
   their facts appear in master's corpus summary / `brains/master.md`.
2. Gate 5 pre-push (fires automatically since `refinery/packs/**` is touched): catalog-mirror test +
   master's own `bun:test` suite. No new tests to write — this is additive wiring, not new behavior.
3. Close `wire_listings_investor_master_live_verify` (opened alongside this spec) once step 1's output
   is confirmed against the live rebuild, not just "code looks right" (per the standing rule that
   `checks` are prod evidence, not dev attestation).

## Follow-up (not this spec)

Open a matching spec for `active-rentals-swfl` once `active_rentals_swfl_live_verify` closes — same
2-line pattern, same file, same edge_type. Don't bundle it into this change; keep the gate meaningful.
