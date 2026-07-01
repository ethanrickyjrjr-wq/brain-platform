# Organic sold capture — property-tax-history off-market hook + holding re-check

**Date:** 2026-07-01 · **Check:** `steadyapi_sold_capture_live_verify` · **Plan:** Phase-2 Part A
(`docs/superpowers/plans/2026-06-30-steadyapi-sole-spine/phase-2-sold-lake-and-comps.md`)

## Problem

There is **no bulk sold-search** on SteadyAPI (`/search` is for-sale only; `/price-histogram?status=sold`
→ 422). Sold is reachable only per-property. But the listing-lifecycle machine already tracks every
for-sale listing and knows the moment one **leaves the active sweep** — it just can't say *why* (it marks
the departure ambiguously as `holding`, claiming nothing). That "why" (sold at what price/date, vs
withdrawn) is exactly the SWFL sold-price signal we lack, and it's reachable one property at a time.

## Goal

When a tracked listing leaves the sweep, spend **one** `/property-tax-history?propertyId=` probe (budget-
sampled) to resolve the departure into `sold` (with real sale price + close date) or `withdrawn` — and,
because most listings leave at *pending* (which closes weeks later), **re-check** aged `holding` listings
so the eventual close is captured too. Over months this accretes a genuine, legitimately-sourced SWFL
sold-price dataset for the inventory we already hold. Never invent a number; an API failure claims nothing.

## Verified vendor contract (crawl4ai, docs.steadyapi.com/collection.json, 07/01/2026 — RULE 0.4)

`GET {base}/property-tax-history?propertyId=` → 200:
```
meta.current_status                     # AUTHORITATIVE now-status: for_sale | pending | sold | ...
meta.total_transactions / sales_count
body.status                             # mirrors current_status
body.property_history[] = {
  date: "YYYY-MM-DD", event_name: "Listed" | ... , price: int, price_change, price_sqft,
  source_name (board), listing: { listing_id, list_price, status, list_date, ... }
}
body.statistics.transactions = { total, sales_count, listings_count, current_price, first_price, ... }
```
The history holds the **entire** ownership history (example: `sales_count: 3`, sales going back years).

**⚠ PARKED enum gap (why the live-verify check exists):** the docs example only ever shows
`event_name: "Listed"` and `current_status: "for_sale"`. The exact string a **Sold** event uses, and the
`current_status`/off-market enum values, are **not** shown in the collection and were **not** confirmed
with a live paid call (operator approval required). The classifier is written defensively around this gap;
the live-verify check must confirm the verbatim values against a real SWFL sold property, then tighten
`_SALE_EVENT_RE` / `PENDING_STATUSES` / `OFF_MARKET_STATUSES` in `extract_api.py`.

## Design (the moat-safe classifier — advisor fix)

`current_status` is the **authority** (it asserts *that* it sold / is pending / is off-market);
`property_history` only supplies the sale **price + date**. The load-bearing rule: **"no sold event" is
NOT a withdrawal** — a listing that went pending simply hasn't closed yet, so it stays `holding`.

`classify_off_market(history, since, at)` →
- recent `Sold` event in `[since−45d .. at+7d]` **or** `current_status == sold` → **`sold`** (+ price/date)
- `current_status` pending/contingent/under_contract/coming_soon → **`holding`** (claim nothing)
- `current_status` positively off_market/removed/expired/withdrawn/delisted, no recent sale → **`withdrawn`**
- still `for_sale` / unknown / a `gap` (non-200, no key, bad body) → **`holding`**

The `[since .. at]` window rejects a decades-old prior-owner sale from reading as "just sold".

## Two hooks, one budget

- **Departure check** — a listing that flipped to `holding` **this run**. Freshest shot; `since = today`.
- **Holding re-check** — a prior `holding` aged into `[21..180]` days, not probed within 30 days. Catches
  pending-then-closed sales; `since = day it left active`.

**Holding-age anchor = `last_seen`, NOT `days_in_state` (advisor blocker fix).** `diff_states` never
re-upserts a still-absent `holding` row (the absent→X branch guards on `prev.state in _LIVE_STATES`, and
`holding` isn't in that set), so `days_in_state` **freezes at 0** and never reaches the `21`-day floor —
the re-check would find zero candidates in production. `last_seen` is stamped once when the departure
upsert lands and then frozen the same way, so `today − last_seen` **is** the holding age. Consequently
`sold_check_at` must be written by a **targeted `UPDATE` (`distill.stamp_sold_checked`) that does not
touch `last_seen`** — routing the stamp through the MERGE would reset the age anchor. Both facts verified
against the live DB (load returns the columns; the stamp preserves `last_seen`).

Sampling (`plan_off_market_checks`): priority = **list_price desc** (operator's explicit "higher-value"
instruction — the resulting sold set therefore **skews expensive**; the pipeline logs that bias), tie-
broken by days desc. Departures get first claim but reserve ~40% for re-checks; leftover budget is never
stranded. Cap = `SOLD_CHECK_CAP` (default 8/run → ~480/mo across Lee+Collier daily crons; env-tunable).
`dry_run` and seed/catch-up runs fire **zero** probes.

## Files

- `migrations/20260701_listing_transitions_sold_capture.sql` — `+sold_price bigint`, `+sold_date date`
  on `listing_transitions`; `+sold_check_at timestamptz` on `listing_state` (applied + verified 07/01).
- `ingest/pipelines/listing_lifecycle/extract_api.py` — `classify_off_market` (pure) + `fetch_sold_event`.
- `ingest/pipelines/listing_lifecycle/transitions.py` — `plan_off_market_checks` +
  `apply_off_market_resolutions` (pure: sample, then mutate the departure `holding` transition in place /
  append re-check rows). Keeps the diff engine pure; network stays in the pipeline.
- `ingest/pipelines/listing_lifecycle/pipeline.py` — the off-market hook (LIVE api runs only).
- `ingest/pipelines/listing_lifecycle/distill.py` — `_TRANS_COLS` gains sold_price/sold_date; `last_seen`
  + `sold_check_at` added to the read-only load list (not the MERGE write list); `stamp_sold_checked`
  writes the probe timestamp via a targeted UPDATE that preserves `last_seen` (verified live).
- `ingest/pipelines/listing_lifecycle/constants_api.py` — `SOLD_CHECK_CAP`.

## Verification

- **Offline (the completion bar):** `ingest/tests/pipelines/listing_lifecycle/test_sold_capture.py` — 27
  tests (classifier cases incl. the pending≠withdrawn guard and the stale-sale guard; the re-check
  ages-off-last_seen regression; sampling cap + priority + reserve; departure/recheck fold-back;
  dry-run/seed gating). Full listing_lifecycle suite 93 passed. Migration applied + columns confirmed.
  `load_current_state` reads the new columns and `stamp_sold_checked` preserves `last_seen` — both
  round-tripped on live-DB sentinels.
- **Live (operator-run, gated on paid calls — `steadyapi_sold_capture_live_verify`):** confirm the sold
  `event_name` + `current_status` enum verbatim against a real SWFL sold property; run one live sweep and
  assert a known departed-and-closed listing produces a `sold` transition with price+date; assert the
  per-run probe count ≤ `SOLD_CHECK_CAP`.

## Out of scope

Part B (the on-demand comp helper / `nearby-home-values`) — separate builder/PR. The `sold_price`/
`sold_date` columns are consumed there + by a future sold-price brain; no consumer ships in this PR.
