# SWFL Data Gulf — Premise-Engine Data to Self-Ingest (2026-05-27)

> Paste-ready for Notion. Same content as `_AUDIT_AND_ROADMAP/premise-data-replacement.md`.

**Goal:** drop every live runtime dependency on premise-engine's Supabase. Self-ingest each feed; cut over the source connector; close the cross-project tether.

## Live data dependencies (must replace)

| #   | Brain         | Source connector                          | Premise table            | Origin                                                                                                                                                                                                                  | Cadence | Self-ingest plan                                                                                                                                                                                                                                                                   |
| --- | ------------- | ----------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `tourism-tdt` | `refinery/sources/tourism-tdt-source.mts` | `fl_dor_tdt_collections` | **Florida DOR — Tourist Development Tax collections.** Lee County Clerk Doc 328. 103 monthly rows FY2013 → FY2026. Schema: `id, county, county_fips, period, collections_usd, returns_filed, source_url, retrieved_at`. | Monthly | New Tier-2 pipeline `ingest/pipelines/tdt_swfl/` reading Lee Clerk Doc 328 directly via Firecrawl or DOR portal. Promote Collier + Charlotte county equivalents. DDL: `docs/sql/YYYYMMDD_tdt_collections.sql`. Cut over `tourism-tdt-source.mts:TABLE` to brain-platform Supabase. |

## Historical references (not live data — comment cleanups, no ingest needed)

| File                                                | Mention                                                                        | Action                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `refinery/sources/cre-source.mts:23`                | "premise-engine RLAIF Phase D training proposals (mostly unapproved/inactive)" | Comment-only. Leave or trim. No live data.                           |
| `refinery/sources/sector-credit-swfl-source.mts:13` | "Live shape (from premise-engine's `20260509190000_sba_loans_schema.sql`)"     | Schema lineage. SBA loans table is in brain-platform's own Supabase. |
| `refinery/types/scoring.mts:2`                      | "Three-layer scoring vocabulary (adapted from premise-engine's process doc)"   | Concept lineage. No code dependency.                                 |
| `refinery/README.md:30`                             | "reads premise-engine Supabase / Sanity"                                       | Stale doc. Update once tourism-tdt cut-over lands.                   |
| `docs/sql/*_grant.sql` (multiple)                   | References to premise as origin of grant patterns                              | Historical. Leave.                                                   |

## Sanity dataset — needs verification

Per `phase-d-shutdown` memory, brain-platform was reading `corridorProfile` from Sanity dataset `lpyl3q9w/production`. Current code reads `corridor_profiles` from Supabase. Sanity dependency appears dropped already; verify with a `grep -rn "@sanity/client\|sanityClient" app/ refinery/`.

## Sequence

1. Stand up `ingest/pipelines/tdt_swfl/` → `data_lake.tdt_collections`. Ship in same PR as the cut-over edit to `tourism-tdt-source.mts` (Data Tier Policy rule 2 — brain-first gate).
2. Verify Sanity has no live `@sanity/client` reads.
3. Comment cleanup pass; update `refinery/README.md`.
4. Mark premise-engine fully decoupled in SESSION_LOG; date this chart.

## Why

Two projects sharing a runtime Supabase = silent schema-coupling. premise-engine can drop a column tomorrow and our `tourism-tdt` brain breaks. Self-ingest means we own the schema, the cadence, the freshness token, and the citation URL — same as every other brain in the lake.
