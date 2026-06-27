# Design — listing-lifecycle-swfl (property lifecycle state machine: new → active → pending → sold / pulled / back-on-market)

**Date:** 2026-06-26
**Status:** Design — brainstormed + research-grounded (crawl4ai, live). Pending spec review → implementation plan.
**Brain:** `listing-lifecycle-swfl` (NEW)
**Complements (does NOT duplicate):** `seller-stress-swfl` (monthly ZIP-aggregate delisting RATE).

> **Source naming convention (this repo is public).** Listing sources are referenced
> GENERICALLY — **Source A** (incumbent, capped) and **Source B** (candidate, full-coverage). No
> company / portal / feed-provider names, no "MLS"/"IDX" terms, live in the repo. Real identities +
> URLs live in `*_BASE_URL` secrets (the existing incognito-source convention), until we have our
> own licensed listing access.

---

## Problem

The market moves continuously, and we were only photographing one frame of it — the **active** for-sale feed — and *discarding* everything that left. But a listing leaving "active" isn't noise to delete; it **moves to another state** (pending, sold, withdrawn, back-on-market), and **the move itself is the signal**. We were throwing away the most valuable data.

`seller-stress-swfl` has the **macro** view (a monthly ZIP-aggregate delisting %). What's missing is the **live, listing-level lifecycle**: which specific homes just went pending, which deal just collapsed (pending→back-active), which seller just withdrew, which relisted. Tracked by address, this reads the market *as it moves* and hands master continuously-updated absorption / withdrawal / deal-collapse signal. Phase 1 is the intelligence layer; owner-contact lead-gen is **Phase 3, deferred**.

## Research findings (all live via crawl4ai, 2026-06-26 — design rests on these, not memory)

1. **Status is on the card, full taxonomy.** Every Source-B card is labeled: `active · new · pending · under-contract · contingent · coming-soon · back-on-market · sold · temporarily-off-market`. We read each listing's *current category* directly — no inference from disappearance, no detail fetch.
2. **Categories are queryable.** Source B's search supports status filtering (status inputs in the search form). So each category can be pulled as its own (small) query — the basis for a cheap daily category scan rather than a full-market re-pull. (Pretty category URLs like `/sold/` 404; the queries route through the search/results endpoint with status params — to nail at implementation.)
3. **The property identity is the ADDRESS, not the listing id.** A relisting gets a *new* listing id; keying on the id reads a relist as two unrelated events. Proven in our own data: 11145 2nd Ave under two listing ids, same $294,900, 344 vs 599 days-on-market (won't drop price); 14150 Ostrom Ave `$1,290,000`→`$895,000` across a relist; 27196 Belle Rio listed for sale at $1.05M AND for rent at $5,000/mo (so the key spans sale and rent).
4. **Source B is the right feed** (full regional coverage, ~2x Source A: Lee 7,447 · Sarasota 5,272 · Charlotte 3,337 · Collier 2,758, incl. affordable inventory; prints the county total; server-rendered, crawl4ai HTTP-scrapable). **Source A is unusable** — caps each county query at ~2,400 sorted price-desc (we hold only the luxury slice; sub-$200k homes exist but our walk never reaches them) and carries no card status.

## The lifecycle state machine (the core model)

Every property (by `address_key`) is in exactly one **state** at a time; the engine records every **transition**. States and their meaning:

| State | Meaning | Typical dwell |
|---|---|---|
| **New** | freshly listed | first ~10–20 days, then → Active |
| **Active** | on market, for sale | until it moves |
| **Pending / Under-contract / Contingent** | under contract | until Sold / Back-on-market / Pulled |
| **Coming-soon** | pre-market | until Active |
| **Sold** | closed | terminal |
| **Pulled (temporarily-off-market)** | withdrawn / expired | until relisted (→ Active) or gone |
| **Back-on-market** | returned after pending/pulled | transient → Active |

**The transitions ARE the signal** (each feeds master):
- `new → pending` fast = hot submarket · `new → pulled` = mispriced from day one
- `active → pending` = absorbing · `pending → sold` = closed absorption
- **`pending → active` / `back-on-market` = a DEAL COLLAPSED** (strong, time-sensitive) · `active → pulled` = withdrawal (seller stress) · `pulled → active` = relisting (frustration) · price-cut within Active.

## Daily flow — scan the categories, move the listing, never discard

For each county, daily:
1. **Scan each category** via the source's status-filtered queries (each a fraction of the ~7k total — the small dynamic ones, New / Pending / Sold / recently-changed, are what move). Every card carries its status, so a scan returns each address's *current* state.
2. **Compare to our stored state** per `address_key`. Unchanged → touch `last_seen`. Changed → **record the transition** and move the property to its new state. Appeared → `New`. In our Active set but in *no* returned category → resolve (see below).
3. **Append the transition to `listing_transitions`.** Nothing is deleted; a change is a move, not a discard.

This is the "scan in ~2 minutes, notice changes, update automatically" model — we watch the *small, moving* categories, not re-pull the whole market.

**The one dependency (open question, resolved at implementation):** does a **Pulled** listing stay visible as a queryable `temporarily-off-market` category, or fully drop off the portal?
- If it stays queryable → we scan it as a category and never need a full pull. Full state machine on small scans.
- If it fully drops → a property in our Active set that appears in *no* category today = Pulled by elimination; to be sure it isn't just a scrape miss, re-confirm against the Active feed (the bulk pull) on the **coverage-guard** schedule (below), not necessarily daily. Either way the model holds; only the daily fetch cost changes.

## Data model

1. **`data_lake.listing_state` (current state, MERGE on `(source_name, address_key)`).** One row per property, **capturing every field the card/detail exposes** (wide — see Dimensions): `state`, `listing_id`, `list_price`, `beds`, `baths`, `sqft`, `lot_acres`, `property_type`, `zip_code`, `county`, `city`, `subdivision`, `days_on_market`, `days_in_state`, `brokerage`, `listed_date`, `sale_or_rent`, `first_seen`, `last_seen`. **Verify `listing_id` / `address_key` stability** across two pulls before trusting the key (Bible §0.2.3).
2. **`data_lake.listing_transitions` (the durable history — ODD-ready, empty-tolerant).** One row per state change, keyed on `address_key`: `from_state`, `to_state`, `at` (date), `listing_id`, `price`, `price_delta`, `days_in_prev_state`. This is what makes relisting, deal-collapse, stuck-price-across-relists, and sale↔rent flips queryable — the current-state table alone would overwrite the history.

## Dimensions — capture wide, build narrow, slice late

The scope-control principle (the answer to "what do we set up up front without over-building"). The fragility worry — *every brain falls with the pipeline* — comes from building a **lane per dimension**. We don't. Instead:

- **Price range, sqft, ZIP, property type, beds are COLUMNS, not lanes.** Capture every field the card/detail exposes *once* — it is free (already on the page) and future-proofs us against re-scraping to add a dimension.
- **Slice at QUERY time.** Price tiers, sqft bands, ZIP rollups, property-type splits are derived in each brain's SQL from the raw columns. Adding a cut is a new query, **never a new pipeline** — which is exactly what keeps brains decoupled from the pipeline (thin pipe). One pipeline fills one wide table; brains read and slice.
- **Property type** is a column (single-family / condo / townhouse / land), from the card/detail or derived (no beds + "land" ⇒ land — the existing rule). Not a lane.

**Sold is the one genuine lane decision, and it is two different things:**
- The **sold STATE** (a listing transitions to `sold`) is captured by the lifecycle scrape now, with its last *asking* price — free, day one, the terminal state of the machine.
- The **sold PRICE** (actual close) is the for-sale feed's blind spot (it is list-side). Real close prices come from a **separate lane** — public county records / a transaction feed — added *later* as an enrichment that joins the close price onto the sold-state event. NOT day one; but the sold STATE we capture now is the hook it joins to.

So Phase 0 captures wide (all columns) and builds exactly one pipeline + one state engine. Everything else is query-time. That is the whole over-building guard.

## Coverage guard (the precondition — Bible §0.3.4/§0.3.6)

A category scan is **trustworthy only when complete**, else a WAF-truncated pull reads as mass movement (we proved this: a partial pull made Lee look like 1,683 homes "came off"). Gate each category's diff on: (1) **natural exhaustion** (the page-param walk ended on a no-new page, not an early 403); (2) **self-referential stability** (today's category count within a few percent of our last *trusted* scan — our pulls match tightly; external estimates disagree 21,032 vs 27,538, so they're a ±10% baseline sanity check only); (3) **baseline seed** from the page-printed county total. A category that fails the gate is **skipped for the day** (no transitions emitted from an incomplete scan), logged loud.

## The brain — `listing-lifecycle-swfl`

Tier-1 reporter (deterministic, `skipSynthesisAgent`/`skipTriageAgent`), reads `listing_state` + `listing_transitions`. Master forms the direction call.
- **`key_metrics` (region/county/ZIP):** current count per state (new/active/pending/sold/pulled) + period transition counts (withdrawals, relistings, **deal-collapses (pending→active)**, absorptions (active→pending), price-cuts) + medians (DOM-at-pending, price-cut-before-pull). Each cited, each with its as-of (MM/DD/YYYY), aggregated **in code / at source** (Bible §6).
- **`detail_tables` (grain "address"):** properties currently in each state + recent movers — address, state, price, DOM, days-in-state, # relistings, price-cut-on-relist, sale↔rent flag. Scrub-exempt lookup (the `housing_by_zip` exemplar) so a downstream Claude answers a specific property.
- **No-invention:** every number is a real scraped value (lane 1, our data). The *state* is the source's own label; seller *motivation* is `[INFERENCE]` with the cited base fact + a falsifier. Never assert *why* beyond the labeled transition.
- **Scope honesty:** "within our tracked Source-B feed" (now ~full regional coverage). Complements `seller-stress-swfl`; the master dossier carries both (macro rate + live named transitions).

## Bible / standards compliance

- crawl4ai-only via `crawl_client`, HTTP strategy, parked cron + tracking check, **merge-not-replace**, fail-loud-on-empty, natural-exhaustion, **backing-JSON-first** for the category queries (§0.3). Real base URL in a `*_BASE_URL` secret.
- **Brain-first gate** (§1): `listing-lifecycle-swfl` `PackDefinition` + every vocab slug (incl. conditionals) in `brain-vocabulary.json`, **same PR** as the ingest; ODD-ready empty-tolerant connector.
- Pipeline-freshness: `--dry-run` + GHA cron wrapper + cadence registry (daily; `ttl_seconds` = 1 day).
- Deterministic math; thin pipe; validators gate writes; freshness token quoted; ZIP gate G1 (zip from the listing's own address). ✓

## Phasing

- **Phase 0 — source + category access.** Source-B connector; crack the status-filtered category queries (backing-JSON-first, server-rendered listing-page fallback); confirm the Pulled-visibility question. Also unblocks re-sourcing `active-listings-swfl` off capped Source A (recommended follow-up).
- **Phase 1 — state engine.** `listing_state` + `listing_transitions`; the daily category scan → transition recorder; coverage guard.
- **Phase 2 — the brain.** `listing-lifecycle-swfl` over the two tables.
- **Phase 3 — deferred.** Owner-contact lead-gen (needs a skip-trace/owner data lane).

## Open questions (resolve at implementation, not blocking)

- **Pulled-visibility:** does `temporarily-off-market` stay a queryable category, or fully drop? (Decides whether any full pull is ever needed.)
- Exact status-filter params on the search/results endpoint (and whether the backing JSON honors a large page size — a 140 was seen).
- Confirm Source B is sale-only vs sale+rent (the 27196 Belle Rio dual-listing suggests both appear).
- `listing_id` / `address_key` stability across two consecutive pulls (Bible §0.2.3).
- New-state window (10–20 days) — source-of-truth (the source's own "new" flag vs days-on-market threshold).

## Non-goals

- No owner contact / skip-tracing (Phase 3).
- No motivation asserted beyond the labeled state/transition (`[INFERENCE]` only, cited base fact + falsifier).
- Not a replacement for `seller-stress-swfl` — the macro rate stays; this is the live named-transition layer.
- No ripping out Source A in this work — Source B is added; the active-listings migration is a separate, sequenced decision.
