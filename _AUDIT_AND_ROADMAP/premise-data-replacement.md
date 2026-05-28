# Premise-Engine Data — What To Self-Ingest

**Goal:** drop every live runtime dependency on premise-engine's Supabase. Stand up our own ingest for each feed; cut over the source connector; close the cross-project tether.

---

## Live data dependencies (must replace)

| #   | Brain (consumer) | Source connector                          | Premise-engine table                        | Authoritative origin                                                                                                                                                                                                                | Cadence | Self-ingest plan                                                                                                                                                                                                                                                                                   |
| --- | ---------------- | ----------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `tourism-tdt`    | `refinery/sources/tourism-tdt-source.mts` | `fl_dor_tdt_collections` (premise Supabase) | **Florida Dept of Revenue — Tourist Development Tax collections.** Lee County Clerk Doc 328. 103 monthly rows FY2013 → FY2026, schema: `id, county, county_fips, period, collections_usd, returns_filed, source_url, retrieved_at`. | Monthly | New Tier-2 pipeline `ingest/pipelines/tdt_swfl/` reading Lee Clerk Doc 328 directly via Firecrawl or DOR portal. Promote Collier + Charlotte county equivalents if they publish. DDL: `docs/sql/YYYYMMDD_tdt_collections.sql`. Cut over `tourism-tdt-source.mts:TABLE` to brain-platform Supabase. |

---

## Historical references (not live data — comment cleanups, no ingest needed)

| File                                                | Mention                                                                        | Action                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `refinery/sources/cre-source.mts:23`                | "premise-engine RLAIF Phase D training proposals (mostly unapproved/inactive)" | Comment-only. Leave or trim. No live data pulled from premise.                                   |
| `refinery/sources/sector-credit-swfl-source.mts:13` | "Live shape (from premise-engine's `20260509190000_sba_loans_schema.sql`)"     | Schema lineage. SBA loans table is in brain-platform's own Supabase. No live premise dependency. |
| `refinery/types/scoring.mts:2`                      | "Three-layer scoring vocabulary (adapted from premise-engine's process doc)"   | Concept lineage. No code dependency.                                                             |
| `refinery/README.md:30`                             | "reads premise-engine Supabase / Sanity"                                       | Stale doc. Update once tourism-tdt cut-over lands.                                               |
| `docs/sql/*_grant.sql` (multiple)                   | References to premise as origin of grant patterns                              | Historical. Leave.                                                                               |

---

## Sanity dataset — needs verification

Per `phase-d-shutdown` memory, brain-platform was reading `corridorProfile` from Sanity dataset `lpyl3q9w/production`. Current code reads `corridor_profiles` from Supabase (`refinery/sources/cre-source.mts:465`). Sanity dependency appears to be dropped already; verify with a `grep -rn "@sanity/client\|sanityClient" app/ refinery/` before declaring complete.

---

## Sequence

1. **Stand up `ingest/pipelines/tdt_swfl/`** — Firecrawl or DOR API ingest into `data_lake.tdt_collections`. Ship in same PR as brain consumer per Data Tier Policy rule 2. Same PR also lands the cut-over edit to `tourism-tdt-source.mts`.
2. **Verify Sanity** — confirm no live `@sanity/client` reads remain.
3. **Comment cleanup pass** — trim the historical-reference comments in one tiny PR; update `refinery/README.md`.
4. **Mark premise-engine fully decoupled** — log in SESSION_LOG, update this chart with the date.

---

## Why we're doing this

Two projects sharing a runtime Supabase = silent schema-coupling. premise-engine can drop a column tomorrow and our `tourism-tdt` brain breaks. Self-ingest means we own the schema, the cadence, the freshness token, and the citation URL — same as every other brain in the lake.
