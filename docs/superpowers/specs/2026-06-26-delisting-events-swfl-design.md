# Design — delisting-events-swfl (listing-level withdrawn/relisted seller-motivation signal)

**Date:** 2026-06-26
**Status:** Design — brainstormed + research-grounded (crawl4ai, live). Pending spec review → implementation plan.
**Brain:** `delisting-events-swfl` (NEW) · **Source:** `palmparadiserealty.com` (Sierra Interactive IDX)
**Complements (does NOT duplicate):** `seller-stress-swfl` (Redfin monthly ZIP-aggregate delisting RATE).

---

## Problem

When a home leaves the active market, *why* it left is a strong signal — and we throw it away. A seller who **withdraws** in frustration, **relists** repeatedly without dropping price, or **flips from sale to rent** is motivated; a home that goes **pending/sold** is the opposite. Today:
- `seller-stress-swfl` has the **macro** view: Redfin's monthly *share_delisted_pct* per ZIP. It can't name a single property.
- Our active-listings scrape sees only the **active** feed; a listing that leaves just vanishes, and the per-county recency view (shipped 2026-06-26) *filters those stale rows out*. The signal is in the discard pile.

Goal: a **listing-level** brain that names which homes withdrew / relisted / flipped, with last price, DOM, and price-cut-before-delist — cited facts, motivation tagged `[INFERENCE]`. Phase 1 is a market-intelligence signal; owner-contact lead-gen is **Phase 3, deferred** (needs a skip-trace data lane we don't have).

## Research findings (all live via crawl4ai, 2026-06-26 — the design rests on these, not memory)

1. **A vanished listing's reason is NOT knowable from the active feed alone.** The first "delisted" home we checked (28571 Calabria Court, $1.25M) was `<div class="bdg pen">Pending</div>` — a sale in progress, not a withdrawal. Naively counting disappearances as "delistings" is mostly counting *successful sales*.
2. **johnrwood (the current source) is unusable for this**, two ways: (a) it caps each `?county=` query at ~2,400 results, sorted price-descending, so we hold only the most expensive slice (every Lee ZIP floored at ~$255k while the market has sub-$200k homes — confirmed by sorting ascending: johnrwood *does* have $110k homes, our walk just never reaches them); (b) its cards carry **no status badge** — reason resolution would require a detail fetch per vanished listing.
3. **palmparadiserealty is the right source.** Sierra Interactive IDX, full MLS (a card listed by "Sellstate 5 Star Realty" — not their own listing), server-rendered, crawl4ai HTTP-strategy scrapable via `/{county}/?pg=N` (20 listings/page, paginates to natural exhaustion). Coverage ~2x johnrwood: **Lee 7,447 · Sarasota 5,272 · Charlotte 3,337 · Collier 2,758**, including the affordable inventory (page 2 of Lee led with a $264,999 Lehigh Acres home). It **prints the total count** per county page (the coverage-guard target).
4. **The killer feature: status is on the card, full MLS taxonomy.** `is-sold · is-pending · is-coming-soon · is-under-contract · is-contingent · is-back-on-market · is-temp-off-market · is-active-no-showing`. This **eliminates the detail-fetch reason-resolver**: `is-temp-off-market` ≈ withdrawn, `is-back-on-market` ≈ relisted (labeled explicitly), `is-pending`/`is-sold` = the sale path. We read the reason straight off the daily snapshot.
5. **The property identity is the ADDRESS, not the MLS number.** A relisting usually gets a *new* MLS#; keying on mls_id reads a relist as two unrelated events. Confirmed in our own data: 11145 2nd Ave listed under `2025000595` AND `C7499863`, same $294,900, 344 vs 599 DOM (unrealistic seller); 14150 Ostrom Ave `$1,290,000`→`$895,000` across a relist; 27196 Belle Rio listed **for sale at $1.05M AND for rent at $5,000/mo** simultaneously (a motivated/flexible seller — so the key must span sale and rent).

## Source connector — palmparadise (Sierra Interactive)

`ingest/pipelines/listings_palmparadise/` (new), crawl4ai per Bible §0.3.

- **JSON-API-first (Bible §0.3.7, the Crexi lesson).** SIS backs the search with a JSON results endpoint (`/property-search/results/?searchid=…&pageSize=140&pageNumber=N` — `pageSize:140` seen in the page config; ~54 requests/county vs ~373 at 20/page). Investigate + prefer the typed JSON API first. **Proven fallback:** the server-rendered vanity pages `/{county}/?pg=N` (HTTP strategy, 20/page) — already confirmed scrapable end-to-end, so the build is never blocked on cracking the API.
- **HTTP strategy, not browser** (§0.3.2) — the vanity pages are server-rendered; the browser would virtualize.
- **Page to natural exhaustion, no silent cap** (§0.3.6) — walk `?pg=` until a page yields no new key. palmparadise's default sort is "Days on Site (Newest)", not price — a cap wouldn't price-bias, but exhaustion is still the rule.
- **Per-listing fields** off the card: address, city, ZIP, list_price, beds, baths, sqft, **status badge**, listing brokerage, detail URL (carries mls_id + address slug), and (sale vs rent — likely sale-only; **confirm at implementation**).
- **Coverage gate input:** capture the page-printed county total (e.g. "7,447 Properties") for the guard below.
- **Cron PARKED until runner-IP WAF-proven** (§0.3.3): ship `schedule:` commented + `probe_mode: odd_window` in the cadence registry, seed locally from the home IP (proven clear this session), open a tracking `check`, `CRAWL4AI_PROXY` already wired for escalation. **Fail loud on total-empty (exit 1)** (§0.3.4). **MERGE, never replace** on `(source_name, mls_id)` (§0.3.5).

## Data model — snapshot + address-keyed event log

1. **`data_lake.listings_palmparadise` (snapshot, MERGE).** One row per (source_name, mls_id), every daily field incl. `status`, `list_price`, `days_on_market`, `scraped_at`, `zip_code`, `county`, normalized `address_key`. PK `(source_name, mls_id)`; **verify mls_id stability** before relying on the merge (Bible §0.2.3) — MLS numbers are stable per listing, but confirm across two pulls.
2. **`data_lake.listing_events` (the durable history — ODD-ready, empty-tolerant).** One row per *transition*, keyed on **`address_key`** (zip + canonical street+unit), NOT mls_id and NOT listing_type:
   - `came_on` (with mls_id, listing_type, price), `came_off` (last price, DOM, status-at-disappearance), `status_change` (active→pending/withdrawn/etc., read off the card), `relisted` (address reappears after a came_off, or an `is-back-on-market` badge), `price_change`, `sale_to_rent_flip`.
   - The snapshot table overwrites `scraped_at`, so it can't see a relisting gap — the event log is what makes relisting, stuck-price-across-relists, and flips detectable.
   - **Address normalization:** within palmparadise the rendering is internally consistent, so exact `(zip, street_address)` works today; canonicalize (ordinals, Ave/Avenue, unit) when the RESO feed mixes sources. Note, don't over-build now.

## Coverage guard (the precondition — Bible §0.3.4/§0.3.6)

A county's daily diff is **trustworthy only when the snapshot is complete**, else a WAF-truncated scrape reads as a mass delisting (we proved this: a partial June-26 pull made Lee look like 1,683 homes "came off"). Gate the diff on:
1. **Natural exhaustion** — the `?pg=` walk ended on an empty/no-new page, not an early 403 (the pipeline already distinguishes these).
2. **Self-referential stability** — today's county count is within a few percent of our own last *trusted* pull (real daily churn is small; our pulls match tightly, external sites do not — Zillow 21,032 vs Homes.com 27,538 for Lee, so external counts are a ±10% baseline sanity check ONLY, never the ±-few gate).
3. **Baseline seed** — the page-printed county total (7,447) sanity-checks the very first complete pull.

If a county fails the gate, **skip its diff for the day** (emit no events for it) and log it — never publish events from an incomplete snapshot.

## Reason resolver (status-on-card — no detail fetch)

Map the card status badge → event reason at snapshot time:
- `is-temp-off-market` (and a disappearance with no pending/sold/contract status) → **withdrawn / expired** (the signal).
- `is-back-on-market` → **relisted** (frustration tell).
- `is-pending` / `is-under-contract` / `is-contingent` → **sale in progress** (filtered out of the stress signal; optionally tracked as absorption).
- `is-sold` → **sold** (filtered out).
- `is-coming-soon` → pre-market (not a delisting).

## The brain — `delisting-events-swfl`

A Tier-1 reporter (deterministic, `skipSynthesisAgent`/`skipTriageAgent`), reads `listing_events`. Master forms any direction call.
- **`key_metrics` (region/county/ZIP):** count of withdrawn/expired this period, relisting count, sale→rent flips, median DOM-at-withdrawal, median price-cut-before-withdrawal — each cited, each with its as-of (MM/DD/YYYY), aggregated **at source / in code** (Bible §6, the aggregate-at-source decree).
- **`detail_tables` (grain "address"):** the individual events — address, last price, DOM, status, # of relistings, price-cut-on-relist, sale↔rent flag — scrub-exempt lookup rows (the `housing_by_zip` exemplar) so a downstream Claude answers a specific property.
- **No-invention:** every number is a real scraped value (lane 1, our data). Seller *motivation* is `[INFERENCE]` with the cited base fact + a falsifier ("superseded if it returns active / goes pending"). Never assert *why* beyond the labeled status.
- **Scope honesty:** "within our tracked palmparadise set" (now ~full MLS, far better than johnrwood's slice) — stated, not implied. Complements `seller-stress-swfl`; the master dossier can carry both (macro rate + named micro events).

## Bible / standards compliance checklist

- crawl4ai-only via `crawl_client`, HTTP strategy, parked cron + tracking check, merge-not-replace, fail-loud-empty, natural-exhaustion, JSON-API-first (§0.3). ✓
- **Brain-first gate** (§1): `delisting-events-swfl` `PackDefinition` + every vocab slug (incl. conditionals) in `brain-vocabulary.json` ship in the **same PR** as the ingest; ODD-ready empty-tolerant connector so it renders before data accumulates. ✓
- Pipeline-freshness: `--dry-run` + GHA cron wrapper + cadence registry entry (daily — listings change daily), `ttl_seconds` = 1 day. ✓
- Deterministic math; thin pipe; validators gate writes; freshness token quoted (§6). ✓
- ZIP gate G1: `zip_code` from the listing's own address, never mailing. ✓

## Phasing

- **Phase 0 — source.** palmparadise connector → `listings_palmparadise` snapshot (JSON-API-first, vanity-page fallback). Also unblocks re-sourcing `active-listings-swfl` off capped johnrwood (recommended follow-up; deprecate johnrwood once palmparadise proves out — not ripped out mid-flight).
- **Phase 1 — diff + event log + coverage guard.** Daily snapshot → `listing_events`; the guard voids incomplete-county diffs.
- **Phase 2 — the brain.** `delisting-events-swfl` over `listing_events`.
- **Phase 3 — deferred.** Owner-contact lead-gen (needs a skip-trace/owner data lane).

## Open questions (resolve at implementation, not blocking)

- Confirm palmparadise is sale-only (it's a "Homes For Sale" search) — if so, the rental-contamination class of bug doesn't exist here.
- JSON results API (pageSize=140) vs server-rendered `?pg=` (20/page) — prefer JSON if it's clean; HTML is the proven fallback.
- Exact `is-*` badge-class → reason mapping (confirm the full set live, e.g. is `is-temp-off-market` distinct from a plain disappearance?).
- mls_id stability across two consecutive pulls (Bible §0.2.3) before trusting the merge key.

## Non-goals

- No owner contact / skip-tracing (Phase 3).
- No motivation asserted beyond the labeled status (`[INFERENCE]` only, cited base fact + falsifier).
- Not a replacement for `seller-stress-swfl` — the macro rate stays; this is the named-property micro layer.
- No ripping out johnrwood in this work — palmparadise is added; the active-listings migration is a separate, sequenced decision.
