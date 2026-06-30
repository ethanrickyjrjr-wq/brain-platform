# Phase 1 — Inventory cutover (CRITICAL PATH)

**Builder:** `ingest-engineer` (reads `ingest/CLAUDE.md`).
**Goal:** get off the parked Source-B scrape, onto SteadyAPI for-sale, **keep the 10,459** seed rows.

## ✅ BUDGET BOMB — FIXED in code + unit-tested (06/30); live call-count NOT yet proven

Audited 06/30: the uncommitted rewrite would have blown ~4× the monthly cap in a single run. Fixed the
same day, same session. All three defects below are now resolved in `extract_api.py`/`pipeline.py` and
covered by passing tests (`pytest ingest/tests/pipelines/listing_lifecycle/` — **54/54 green**, mocked,
zero network). What's **NOT** yet done: a real live `--dry-run` call-count proof (operator has not yet
authorized the first live call this session), the one-time catch-up run, and `address_key.py` hardening.

1. ~~`enrich_new` does 2 calls per new listing~~ **FIXED:** replaced with `enrich_baths_batched`
   (clustered by lat/lon, one `/nearby-home-values` call covers every new listing in a ~2km cell, up to
   100/call) — `extract_api.py`. Land rows are skipped (baths is meaningless there; cheaper than adding
   a `property_type` filter to `/search`, which the live API only accepts as a single value, not a list —
   filtering at the source would have multiplied search calls 7×, not saved them).
2. ~~`known_ids` is never passed~~ **FIXED:** `pipeline.py` now builds `known_ids` from each county's
   prior `property_id`s (loaded via `distill.load_current_state`) and threads it into `scan_county_api`.
   `property_id` is now a real persisted column (`migrations/20260630b_listing_state_budget_fix_columns.sql`,
   **applied to prod**, verified live) — without it there was no prior identity to diff against.
3. **NEW finding this session, also fixed:** the old `--dry-run` was itself a live-fire trap — it gated
   only the two DB writes, not the network calls, so even a "dry" run detonated the full enrich bomb.
   `dry_run` is now threaded all the way into `enrich_baths_batched`, which makes **zero** network calls
   when `dry_run=True` (two tests assert `mock_get.assert_not_called()`). The cheap `/search` sweep
   (~106 calls/county) still fires live under `--dry-run` by design — that's the real page count the
   gate needs, and it was never the expensive part.

**HARD GATE — still in force:** no cron, no catch-up run, no real `--dry-run` invocation until the
operator explicitly authorizes the first live SteadyAPI call this build makes. The code is no longer
the blocker; authorization is.

The prior session scaffolded an API-fed path (additive columns, parsers, paginated fetchers,
`pipeline --source api`, view re-point) under `source_name='api_feed'`. This phase converted it to
SteadyAPI-sole and fixed the budget defects found in that scaffold.

## Files

- `ingest/pipelines/listing_lifecycle/address_key.py` — harden (see below) + `test_address_key`
- `ingest/pipelines/listing_lifecycle/extract_api.py` — SteadyAPI-sole rewrite
- `ingest/pipelines/listing_lifecycle/constants_api.py` — strip dead RentCast constants
- `ingest/pipelines/listing_lifecycle/pipeline.py` — strip RentCast comments, wire `known_ids`
- `ingest/pipelines/listing_lifecycle/distill.py` — extend `_STATE_COLS`
- `migrations/` — new additive columns on `data_lake.listing_state`
- `ingest/tests/pipelines/listing_lifecycle/test_extract_api.py` — rewrite to SteadyAPI-only surface
- `ingest/cadence_registry.yaml` + a GHA cron wrapper

## Steps

1. ⬜ **Harden `address_key.py`** (must land first — the catch-up match depends on it): NOT done yet.
   - Directionals both ways: `Northeast↔NE`, `North↔N`, `Southwest↔SW`, … (N/S/E/W/NE/NW/SE/SW).
   - Missing suffixes: `WAY, LOOP, PT(Point), CV(Cove), RUN, PASS` (plus the existing AVE/ST/BLVD/… set).
   - Fix unit-smush so `Westwindln202` normalizes the same as the unit-separated form.
   - Tests prove `4th street` / `4th st.` / `4th ST` / `4thST` and `Northeast`/`NE` collapse to one key.

2. ✅ **DONE — migration + `distill._STATE_COLS`:** `migrations/20260630b_listing_state_budget_fix_columns.sql`
   applied to prod (verified live via lake query) — `property_id`, `reduced_amount`, `status`, and the 7
   flag columns (`flag_pending`/`flag_contingent`/`flag_coming_soon`/`flag_foreclosure`/
   `flag_new_construction`/`flag_price_reduced`/`flag_new_listing`). `_STATE_COLS` extended to match.

3. ✅ **DONE — `extract_api.py` rewritten to SteadyAPI-sole, batched:**
   - Pass 1 — `/search` for-sale sweep per seed city, residential, 200/page, paginate to `meta.total`,
     now returns real page counts (`search_calls`) for budget logging.
   - Pass 2 — `enrich_baths_batched`: `/nearby-home-values` clustered by lat/lon (~2km grid cells),
     **only for property_ids not in `known_ids`**, land rows skipped. `dry_run=True` makes zero network
     calls (the dry-run-trap fix).
   - `property_id` persisted as a real column (not stripped). Every RentCast remnant removed from
     `constants_api.py`.

4. ⬜ **One-time catch-up run:** NOT run yet — blocked on operator authorization for the first live call,
   plus step 1 (address_key hardening) for the match. full sweep → address-match the 10,459 (by hardened
   `address_key`, lat/lon tiebreak) → stamp `property_id` + fill `photo_url` on matches. Seed rows **not**
   in the sweep = stale → transition to holding. Sweep rows **not** in the seed = new → insert. The
   10,459 already have baths (10,449/10,459), so no baths enrichment on legacy.

5. ⬜ **Scheduled `pipeline.py` run (every 2–3 days):** code path exists (`known_ids` threaded, budget
   logged) but has never executed against live data — snapshot-diff → upsert `listing_state` + append
   `listing_transitions` is unverified end-to-end.

6. ⬜ **Cadence entry + GHA cron wrapper + `--dry-run`** (pipeline-freshness rule) — NOT done; stays
   parked/manual-dispatch only until the catch-up run is proven.

## Verification

- ✅ `pytest ingest/tests/pipelines/listing_lifecycle/` green — **54/54 passed**, mocked/network-free
  (includes the new batched-enrichment + dry-run-safety tests). `test_address_key` not added yet (step 1).
- ⬜ `--dry-run` prints expected page count without writing — code supports it, **not yet run live.**
- ⬜ Row-count guard after the `data_lake.listing_state` write (Gate 4) — no write has happened yet.
- ⬜ Catch-up asserts (10,459 retained, `property_id` non-null on matches, stale count plausible) —
  blocked on step 4.
- ⬜ Budget log: assert one sweep ≈ 106 calls; assert steady-state projection ≤ ~4,700/mo before enabling
  cron — **the code now prints this** (`[budget] this run = N SteadyAPI calls`), but no live run has
  fired to read the real number yet.
