# Roadmap Status — Current State (Auto-Generated)

_The descriptive layer. Live brains, sources, edges, and commits since the last `ontology-and-roadmap.md` touch. Hand-edit `docs/ontology-and-roadmap.md` §6–§9 for forward strategy; this file is regenerated from code._

**Generated:** 2026-05-19T17:56:03.617Z (commit `e751eb7`)
**Last roadmap doc touch:** `c6bf675` · 2026-05-19T01:49:45-04:00 · docs(roadmap): cross-tier SQL deferral marker + Tool Placement lock

## Regenerate

```
npm run roadmap:sync
```

## TL;DR

- **15** brains in the runtime registry.
- **35** source connectors across **2** distinct trust tiers (T1, T2).
- **6** distinct domains: `environmental`, `finance`, `hospitality`, `logistics`, `macro`, `real-estate`.
- **20** commits since the last roadmap-doc touch — **3** are trigger-shaped (touched packs/sources/types/constitution/confidence/dag/render/validate).

## Live Brains

| Brain | Domain | Sources | Trust tiers | Input edges |
| --- | --- | ---: | --- | ---: |
| `cre-swfl` | `real-estate` | 1 | T2 | 0 |
| `env-swfl` | `environmental` | 3 | T1 | 0 |
| `franchise-outcomes` | `real-estate` | 1 | T1 | 0 |
| `hurricane-tracks-fl` | `environmental` | 1 | T1 | 0 |
| `logistics-swfl` | `logistics` | 1 | T1 | 0 |
| `logistics-swfl-nowcast` | `logistics` | 2 | T2 | 1 |
| `macro-florida` | `macro` | 3 | T1, T2 | 1 |
| `macro-swfl` | `macro` | 1 | T2 | 1 |
| `macro-us` | `macro` | 1 | T1 | 0 |
| `master` | `real-estate` | 12 | T2 | 12 |
| `properties-lee-value` | `real-estate` | 2 | T1, T2 | 0 |
| `sector-credit-swfl` | `finance` | 4 | T1, T2 | 3 |
| `storm-history-swfl` | `environmental` | 1 | T1 | 0 |
| `tourism-tdt` | `hospitality` | 1 | T1 | 0 |
| `traffic-swfl` | `logistics` | 1 | T2 | 0 |

## Source connectors per brain

### `cre-swfl`

| source_id | trust_tier |
| --- | ---: |
| `corridor_profiles` | T2 |

### `env-swfl`

| source_id | trust_tier |
| --- | ---: |
| `fema_nfhl` | T1 |
| `fema_nfip_claims` | T1 |
| `usgs_water` | T1 |

### `franchise-outcomes`

| source_id | trust_tier |
| --- | ---: |
| `sba_loans_franchise_outcomes` | T1 |

### `hurricane-tracks-fl`

| source_id | trust_tier |
| --- | ---: |
| `hurdat2_fl_x_fema_nfip` | T1 |

### `logistics-swfl`

| source_id | trust_tier |
| --- | ---: |
| `faf5_flows_swfl` | T1 |

### `logistics-swfl-nowcast`

| source_id | trust_tier |
| --- | ---: |
| `fdot_freight_swfl` | T2 |
| `brain-input:logistics-swfl` | T2 |

### `macro-florida`

| source_id | trust_tier |
| --- | ---: |
| `fred_macro_florida` | T1 |
| `census_cbp_fl` | T1 |
| `brain-input:macro-us` | T2 |

### `macro-swfl`

| source_id | trust_tier |
| --- | ---: |
| `brain-input:macro-florida` | T2 |

### `macro-us`

| source_id | trust_tier |
| --- | ---: |
| `fred_macro_us` | T1 |

### `master`

| source_id | trust_tier |
| --- | ---: |
| `brain-input:franchise-outcomes` | T2 |
| `brain-input:cre-swfl` | T2 |
| `brain-input:macro-us` | T2 |
| `brain-input:macro-florida` | T2 |
| `brain-input:macro-swfl` | T2 |
| `brain-input:sector-credit-swfl` | T2 |
| `brain-input:tourism-tdt` | T2 |
| `brain-input:env-swfl` | T2 |
| `brain-input:logistics-swfl` | T2 |
| `brain-input:logistics-swfl-nowcast` | T2 |
| `brain-input:traffic-swfl` | T2 |
| `brain-input:properties-lee-value` | T2 |

### `properties-lee-value`

| source_id | trust_tier |
| --- | ---: |
| `leepa_value_lee` | T2 |
| `fhfa_hpi` | T1 |

### `sector-credit-swfl`

| source_id | trust_tier |
| --- | ---: |
| `sba_loans_by_naics_county` | T1 |
| `brain-input:franchise-outcomes` | T2 |
| `brain-input:macro-us` | T2 |
| `brain-input:macro-florida` | T2 |

### `storm-history-swfl`

| source_id | trust_tier |
| --- | ---: |
| `noaa_storm_events_swfl` | T1 |

### `tourism-tdt`

| source_id | trust_tier |
| --- | ---: |
| `fl_dor_tdt` | T1 |

### `traffic-swfl`

| source_id | trust_tier |
| --- | ---: |
| `fdot_aadt_swfl` | T2 |

## Brain DAG (edges)

Every edge: `upstream → downstream (edge_type)`. Edge types: `input | constraint | veto | modifier` (`refinery/types/pack.mts` → `BrainEdgeType`).

| Upstream | Downstream | Edge type |
| --- | --- | --- |
| `cre-swfl` | `master` | **input** |
| `env-swfl` | `master` | **veto** |
| `franchise-outcomes` | `master` | **input** |
| `franchise-outcomes` | `sector-credit-swfl` | **input** |
| `logistics-swfl-nowcast` | `master` | **input** |
| `logistics-swfl` | `logistics-swfl-nowcast` | **input** |
| `logistics-swfl` | `master` | **input** |
| `macro-florida` | `macro-swfl` | **input** |
| `macro-florida` | `master` | **input** |
| `macro-florida` | `sector-credit-swfl` | **input** |
| `macro-swfl` | `master` | **input** |
| `macro-us` | `macro-florida` | **input** |
| `macro-us` | `master` | **input** |
| `macro-us` | `sector-credit-swfl` | **input** |
| `properties-lee-value` | `master` | **input** |
| `sector-credit-swfl` | `master` | **input** |
| `tourism-tdt` | `master` | **input** |
| `traffic-swfl` | `master` | **input** |

## Domain coverage

| Domain | Brain count | Brain IDs |
| --- | ---: | --- |
| `environmental` | 3 | `env-swfl`, `hurricane-tracks-fl`, `storm-history-swfl` |
| `finance` | 1 | `sector-credit-swfl` |
| `hospitality` | 1 | `tourism-tdt` |
| `logistics` | 3 | `logistics-swfl`, `logistics-swfl-nowcast`, `traffic-swfl` |
| `macro` | 3 | `macro-florida`, `macro-swfl`, `macro-us` |
| `real-estate` | 4 | `cre-swfl`, `franchise-outcomes`, `master`, `properties-lee-value` |

_The `BrainDomain` union (`real-estate | finance | environmental | demographics | logistics | hospitality | macro`) defines the seven roadmap slots. Any domain not listed above is currently empty._

## Commits since last roadmap doc touch

| SHA | Date | Subject |
| --- | --- | --- |
| `e751eb7` | 2026-05-19 | feat(notes): notes:sync script — reality-dump for LittleBird |
| `98babd2` | 2026-05-19 | feat(brains): live renders — properties-lee-value v10 + master v46 |
| `9ee892e` | 2026-05-19 | fix(leepa): factory fn to avoid dlt dataclass mutable-default error |
| `bc263ab` | 2026-05-19 | fix(tier1-inventory): replace dlt write with direct psycopg2 insert |
| `e1722a5` | 2026-05-19 | fix(leepa): chunked merge writes to survive Supabase pooler |
| `3025553` | 2026-05-19 | feat(logistics-swfl): v10 live Cold Lane render — 253,486K tons $124,972M (FAF5.7.1 Parquet) |
| `f1efbac` | 2026-05-19 | chore(ingest): add _run_tombstone.py — drops FAF5 tombstone tables + seeds _tier1_inventory |
| `fce5517` | 2026-05-19 | fix(tier1-inventory): fresh pipeline per write + non-fatal pointer + null-row cleanup SQL |
| `303cf02` | 2026-05-19 | chore: gitignore ephemeral directories and update docs for Cold Lane |
| `7e198d4` | 2026-05-19 | feat(ingest/faf5): Cold Lane migration — FAF5 to S3 Parquet + DuckDB source rewrite |
| `23f27b9` | 2026-05-19 | feat(refinery/packs): hurricane-tracks-fl — first cross-tier brain (HURDAT2 × NFIP) |
| `4579edb` | 2026-05-19 | feat(refinery/sources): makeDuckDBSource cross-tier connector + 6-concept hurricane vocab |
| `25e6561` | 2026-05-19 | feat(ingest/hurdat2): NOAA NHC HURDAT2 Florida-filter pipeline → Tier 1 Parquet |
| `86a3e3d` | 2026-05-19 | feat(refinery/env): SUPABASE_PG_* surface + requirePgEnv() for cross-tier DuckDB |
| `d60813c` | 2026-05-19 | test(usgs/duckdb): integration tests for pipeline.run() with mocked HTTP |
| `65793d1` | 2026-05-19 | feat(usgs/duckdb): DuckDB backfill pipeline — year-chunked fetch + S3 Parquet write |
| `13af0b9` | 2026-05-19 | test(usgs/duckdb): unit tests for fetch.py parse + coerce functions |
| `a06e624` | 2026-05-19 | feat(usgs/duckdb): add fetch.py — pure parse + HTTP wrappers |
| `53a37b4` | 2026-05-19 | feat(usgs/duckdb): add package skeleton + Tier 1 constants |
| `03ffdaf` | 2026-05-19 | chore(usgs): tombstone dlt pipeline — superseded by DuckDB lane |

## Trigger-shaped commits since last roadmap doc touch

Per §10 of `ontology-and-roadmap.md`, commits that touch `refinery/packs/`, `refinery/sources/`, `refinery/types/`, `refinery/constitution/`, `refinery/lib/confidence`, `refinery/lib/dag`, `refinery/render/`, or `refinery/validate/` *should have* triggered a roadmap update. The list below is what's currently un-reflected in the prescriptive doc.

| SHA | Date | Subject | Trigger files (sample) |
| --- | --- | --- | --- |
| `7e198d4` | 2026-05-19 | feat(ingest/faf5): Cold Lane migration — FAF5 to S3 Parquet + DuckDB source rewrite | `refinery/packs/logistics-swfl.mts`, `refinery/sources/faf5-source.mts` |
| `23f27b9` | 2026-05-19 | feat(refinery/packs): hurricane-tracks-fl — first cross-tier brain (HURDAT2 × NFIP) | `refinery/packs/hurricane-tracks-fl.mts`, `refinery/packs/hurricane-tracks-fl.test.mts`, `refinery/packs/index.mts` |
| `4579edb` | 2026-05-19 | feat(refinery/sources): makeDuckDBSource cross-tier connector + 6-concept hurricane vocab | `refinery/sources/duckdb-source.mts`, `refinery/sources/duckdb-source.test.mts` |

---

**Notes**

- This file is generated; do not edit by hand.
- Hand-edit `docs/ontology-and-roadmap.md` §6 (NOW), §7 (NEAR-TERM), §8 (LONG-TERM) for forward strategy.
- Regenerate after any roadmap-shaped commit: `npm run roadmap:sync`.
