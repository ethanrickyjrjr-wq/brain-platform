# Roadmap Status — Current State (Auto-Generated)

_The descriptive layer. Live brains, sources, edges, and commits since the last `ontology-and-roadmap.md` touch. Hand-edit `docs/ontology-and-roadmap.md` §6–§9 for forward strategy; this file is regenerated from code._

**Generated:** 2026-05-26T01:17:02.389Z (commit `f815c58`)
**Last roadmap doc touch:** `e312a24` · 2026-05-21T00:35:33-04:00 · Reshape roadmap as post-LittleBird reset (v1.5)

## Regenerate

```
npm run roadmap:sync
```

## TL;DR

- **17** brains in the runtime registry.
- **42** source connectors across **3** distinct trust tiers (T1, T2, T3).
- **6** distinct domains: `environmental`, `finance`, `hospitality`, `logistics`, `macro`, `real-estate`.
- **96** commits since the last roadmap-doc touch — **23** are trigger-shaped (touched packs/sources/types/constitution/confidence/dag/render/validate).

## Live Brains

| Brain | Domain | Sources | Trust tiers | Input edges |
| --- | --- | ---: | --- | ---: |
| `cre-swfl` | `real-estate` | 3 | T2 | 1 |
| `env-swfl` | `environmental` | 3 | T1 | 0 |
| `franchise-outcomes` | `real-estate` | 1 | T1 | 0 |
| `hurricane-tracks-fl` | `environmental` | 1 | T1 | 0 |
| `logistics-swfl` | `logistics` | 1 | T1 | 0 |
| `logistics-swfl-nowcast` | `logistics` | 2 | T2 | 1 |
| `macro-florida` | `macro` | 3 | T1, T2 | 1 |
| `macro-swfl` | `macro` | 2 | T1, T2 | 1 |
| `macro-us` | `macro` | 1 | T1 | 0 |
| `master` | `real-estate` | 14 | T2 | 14 |
| `permits-swfl` | `real-estate` | 1 | T1 | 1 |
| `properties-lee-value` | `real-estate` | 2 | T1, T2 | 0 |
| `rentals-swfl` | `real-estate` | 1 | T3 | 0 |
| `sector-credit-swfl` | `finance` | 4 | T1, T2 | 3 |
| `storm-history-swfl` | `environmental` | 1 | T1 | 0 |
| `tourism-tdt` | `hospitality` | 1 | T1 | 0 |
| `traffic-swfl` | `logistics` | 1 | T2 | 0 |

## Source connectors per brain

### `cre-swfl`

| source_id | trust_tier |
| --- | ---: |
| `corridor_profiles` | T2 |
| `marketbeat_swfl` | T2 |
| `brain-input:permits-swfl` | T2 |

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
| `bls_laus` | T1 |

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
| `brain-input:permits-swfl` | T2 |
| `brain-input:rentals-swfl` | T2 |

### `permits-swfl`

| source_id | trust_tier |
| --- | ---: |
| `lee_building_permits` | T1 |

### `properties-lee-value`

| source_id | trust_tier |
| --- | ---: |
| `leepa_value_lee` | T2 |
| `fhfa_hpi` | T1 |

### `rentals-swfl`

| source_id | trust_tier |
| --- | ---: |
| `zori_swfl` | T3 |

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
| `env-swfl` | `master` | **modifier** |
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
| `permits-swfl` | `cre-swfl` | **input** |
| `permits-swfl` | `master` | **input** |
| `properties-lee-value` | `master` | **input** |
| `rentals-swfl` | `master` | **input** |
| `sector-credit-swfl` | `master` | **input** |
| `storm-history-swfl` | `permits-swfl` | **modifier** |
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
| `real-estate` | 6 | `cre-swfl`, `franchise-outcomes`, `master`, `permits-swfl`, `properties-lee-value`, `rentals-swfl` |

_The `BrainDomain` union (`real-estate | finance | environmental | demographics | logistics | hospitality | macro`) defines the seven roadmap slots. Any domain not listed above is currently empty._

## Commits since last roadmap doc touch

| SHA | Date | Subject |
| --- | --- | --- |
| `f815c58` | 2026-05-25 | feat(cre): MarketBeat Flow 3 — per-submarket key_metrics in cre-swfl (#18) |
| `2df58bc` | 2026-05-25 | feat(gha): add cron wrappers for 6 dlt ingest pipelines |
| `cf1c8d7` | 2026-05-25 | refactor: consolidate medianOf + numeric helpers into stats.mts |
| `73b96ce` | 2026-05-25 | feat(cre): MarketBeat submarket → corridor alias table |
| `93b778b` | 2026-05-25 | feat(ingest): firecrawl pipelines as GitHub Actions cron (#17) |
| `73ff704` | 2026-05-25 | fix(waitlist): lazy-init Resend client to unblock Vercel build (#16) |
| `b2fa78e` | 2026-05-25 | feat(cre-swfl): firecrawl pipeline skeleton — MarketBeat source + broker narrative consumer + n8n workflow drafts (#15) |
| `b9fa5f9` | 2026-05-25 | feat(macro-swfl): ship BLS LAUS county ingest + wire real key_metrics (#14) |
| `ecc7d0f` | 2026-05-25 | feat: provenance page, permits-swfl ingest fix, fixture tfctr alignment (#13) |
| `48b955f` | 2026-05-25 | fix(fdot): correct yearx column name and county casing; switch freight filter to tfctr >= 5% |
| `833293c` | 2026-05-25 | feat(legal): add terms of service page at /terms |
| `7150e6a` | 2026-05-25 | fix(fdot): column year_ renamed to year in Supabase — alias in select |
| `8b9958c` | 2026-05-25 | fix(triage): batch fragments 50 at a time to avoid token overflow |
| `8caf6f1` | 2026-05-25 | fix(mcp): ban internal brain IDs and routing logic from tool responses |
| `44da9df` | 2026-05-25 | fix(report): white background on report page, remove dark mode override |
| `160262c` | 2026-05-25 | feat(connect): update hero copy + center + teal data/AI accents |
| `66ffdce` | 2026-05-25 | feat(brand): centered wave logo v2 |
| `7f5ad7c` | 2026-05-25 | feat(brand): replace logo with Claude Design SVG (512px, pure black bg) |
| `10eb350` | 2026-05-25 | fix(brand): add dark background to logo.svg |
| `38addd1` | 2026-05-25 | feat(brand): add wave SVG logo + favicon |
| `40c5e08` | 2026-05-25 | fix(mcp): add readOnlyHint annotation to swfl_fetch tool |
| `9c2ba74` | 2026-05-25 | fix(speaker): normalize CRLF before parsing brain markdown |
| `2f3dd22` | 2026-05-25 | feat(connect): Step 3 — /connect landing page + waitlist already_subscribed fix |
| `36ab4aa` | 2026-05-25 | chore(lint): ignore docs/design-reference/ in eslint |
| `ac45e62` | 2026-05-25 | feat(mcp): wire chart widget via real MCP Apps SDK |
| `db3b83f` | 2026-05-24 | feat(mcp): Step 2 — MCP server route, server, inventory, auth |
| `f81c462` | 2026-05-24 | fix(deps): legacy-peer-deps for mcp-handler sdk peer conflict |
| `0ae1bba` | 2026-05-24 | feat(mcp): add mcp-handler zod + inspector devdep |
| `1385c58` | 2026-05-24 | feat: migrate all URLs to www.swfldatagulf.com + Resend waitlist email |
| `429bd1c` | 2026-05-24 | docs(coverage): Step 7 — data-coverage doc + remove superseded fixtures |
| `2582db0` | 2026-05-24 | feat(viz): Step 6 — consumer migration to split-fixture join |
| `f69e9b1` | 2026-05-24 | feat(permits-swfl): Step 5 — sidecarProducer (corridor-permits.json contract) |
| `0236c51` | 2026-05-24 | feat(refinery): Step 4 — corridor alias table + coverage test |
| `4cc0be6` | 2026-05-24 | feat(fixtures): Step 3 — corridor-rents.json (cre-swfl-domain, rent-only) |
| `0b52c87` | 2026-05-24 | feat(fixtures): Step 2 — promote corridor-centroids.json (4 → 16 Lee corridors) |
| `c73e0b3` | 2026-05-24 | feat(refinery): Step 1 — sidecarProducer type-lift + writeJsonAtomic helper |
| `48e07ab` | 2026-05-24 | feat(viz): asking-rent embed card + corridor fixture regen tool |
| `cd23e36` | 2026-05-24 | feat(mcp-v1): step 1 foundation — catalog leaf + shared fetch + waitlist fix + privacy stub |
| `49b3219` | 2026-05-24 | fix(cre-swfl): brain v37 — all 26 corridors cited, no null source_urls |
| `182fefa` | 2026-05-24 | fix(cre-swfl): regenerate brain v35 — real source citations replace notion.so placeholders |
| `75a98b4` | 2026-05-24 | chore: gitignore design-reference/, add Saimum repo link, drop stale package-lock.json |
| `ca59d5d` | 2026-05-24 | fix(fixtures): replace example.notion.so with real C&W source URLs |
| `856e81d` | 2026-05-24 | feat(cre): per-metric source_url provenance + fallback chain |
| `a5d4a28` | 2026-05-24 | docs(sql): migration files for absorption_rent (retroactive) + per-metric source_url columns |
| `648c09a` | 2026-05-24 | docs(fiverr-briefs): complete Saimum handoff — assets + updated doc |
| `729927f` | 2026-05-24 | docs(fiverr-briefs): rename Nora -> Noor (contractor's actual name) |
| `b3d21fc` | 2026-05-24 | docs(fiverr-briefs): Nora data exploration brief + portfolio notes |
| `c902add` | 2026-05-24 | feat(embed): landing-page iframe embeds + waitlist endpoint |
| `e83268b` | 2026-05-23 | ci: relax eslint for fiverr viz + auto-open PR on any branch push (#11) |
| `5ee4800` | 2026-05-23 | fix(viz): filter ZHVI nulls + harden tooltip label typing (#10) |
| `3c776c6` | 2026-05-23 | chore(deps): sync bun.lock after rentals-swfl merge |
| `a638426` | 2026-05-23 | feat(rentals-swfl): v1 — Zillow ZORI ZIP-level rent index brain (#9) |
| `3f834fe` | 2026-05-23 | chore: sync housekeeping — gitignore data/, tsconfig tools exclusion, plan status updates |
| `6af9d31` | 2026-05-23 | Merge branch 'claude/redfin-data-center-K76eU' |
| `b01d118` | 2026-05-23 | fix(ingest/redfin-swfl): extend metro filter to all four SWFL MSAs |
| `d2f501b` | 2026-05-23 | feat(ingest): Redfin SWFL ZIP market tracker — Tier 1 ingest pipeline |
| `0392a35` | 2026-05-23 | Implement viz components from Fiverr delivery (4 components) |
| `8094d85` | 2026-05-23 | feat(viz): wire scaffold for Fiverr dev delivery |
| `87bd6fa` | 2026-05-22 | docs: add fiverr briefs for data viz + landing page builds |
| `23b3d7e` | 2026-05-22 | design: move reference-builds into the GitHub-attached folder |
| `a59c6c4` | 2026-05-22 | design: assets — fonts, inspiration screenshots, notes, figma-leads |
| `2ff4327` | 2026-05-22 | design: polish pass — voice doc, quick reference, prompts in repo |
| `d9f8c63` | 2026-05-22 | design: lift maps/3D restriction; add three-context motion model |
| `edba857` | 2026-05-22 | fix(lake-mcp): close mainConn on exit; correct list_views field list in spec |
| `6daf318` | 2026-05-22 | chore(mcp): wire lake MCP server in .mcp.json |
| `835f76b` | 2026-05-22 | refactor(lake-mcp): replace filter closure with ternary in registeredViews |
| `7c82741` | 2026-05-22 | feat(tools): lake MCP server — read-only Parquet + Postgres exploration |
| `d1c1d1e` | 2026-05-22 | test(lake-mcp): failing tests for pure helpers (TDD red phase) |
| `d8ac649` | 2026-05-22 | chore(deps): add @modelcontextprotocol/sdk |
| `5cd95e2` | 2026-05-22 | feat(duckdb-source): add readOnly ATTACH support + export sqlEscape |
| `5720450` | 2026-05-22 | docs(plans): DuckDB lake MCP server implementation plan |
| `61cccae` | 2026-05-22 | docs(specs): DuckDB lake MCP server design — cross-tier read-only exploration |
| `7c823ad` | 2026-05-22 | docs(specs): asset-management schema constraint — client-configurable asset IDs |
| `3f68d27` | 2026-05-22 | chore: gitignore .claude/handoffs/ |
| `5a93731` | 2026-05-22 | docs(specs): asset-management brain metrics reference + data tracker |
| `dded9d1` | 2026-05-22 | fix(orphan-triage): strip git SHA from generated header; gitignore __scratch__ |
| `8f01153` | 2026-05-22 | feat(permits-swfl): implement Firecrawl interact recipe + document in README |
| `1dc11fc` | 2026-05-22 | feat(permits-swfl): v1 — Lee building permits, saturation index, cre-swfl thin-pipe |
| `a8526b4` | 2026-05-21 | feat(cre-swfl): split Naples Airport-Pulling into north/south corridor rows (#7) |
| `b24752f` | 2026-05-21 | Merge pull request #6 from ethanrickyjrjr-wq/feature/cre-large-format-rent |
| `24257f6` | 2026-05-21 | feat(cre-swfl): populate submarket asking rent for 4 large-format centers (v29) |
| `08ccf98` | 2026-05-21 | Merge pull request #5 from ethanrickyjrjr-wq/feature/cre-corridor-absorption-rent |
| `8ad4f37` | 2026-05-21 | merge: resolve cre-swfl.md conflict — keep v33 with real CW cap/vacancy data |
| `8820b34` | 2026-05-21 | feat(cre-swfl): populate real CW MarketBeat cap rate + vacancy data (v33) |
| `f43bb9a` | 2026-05-21 | feat(cre-swfl): add absorption + asking rent metrics, fix direction fabrication (#4) |
| `5d4eb19` | 2026-05-21 | feat(cre-swfl): add absorption + asking rent metrics, fix direction fabrication |
| `05b7d29` | 2026-05-21 | refactor(packs): extract cre-swfl from monolithic packs.mts (#3) |
| `b4f380b` | 2026-05-21 | chore: scrub dead premise-migration plumbing |
| `dea0f96` | 2026-05-21 | chore: update bun lockfile |
| `d4b57b9` | 2026-05-21 | Merge claude/github-branch-update-Sy8Li into main |
| `cbf8f80` | 2026-05-21 | hi |
| `d8dc296` | 2026-05-21 | fix(middleware): exclude /api/b/* and guard missing env vars |
| `7a1b151` | 2026-05-21 | fix(build): exclude docs/ from root tsconfig |
| `9b986ec` | 2026-05-21 | fix(auth): strip next param from emailRedirectTo to fix 403 |
| `2ea3304` | 2026-05-21 | Add .vscode/settings.json to prevent VS Code freezing |
| `7938d8c` | 2026-05-21 | Ship speaker layer + v3 consumption contract |

## Trigger-shaped commits since last roadmap doc touch

Per §10 of `ontology-and-roadmap.md`, commits that touch `refinery/packs/`, `refinery/sources/`, `refinery/types/`, `refinery/constitution/`, `refinery/lib/confidence`, `refinery/lib/dag`, `refinery/render/`, or `refinery/validate/` *should have* triggered a roadmap update. The list below is what's currently un-reflected in the prescriptive doc.

| SHA | Date | Subject | Trigger files (sample) |
| --- | --- | --- | --- |
| `f815c58` | 2026-05-25 | feat(cre): MarketBeat Flow 3 — per-submarket key_metrics in cre-swfl (#18) | `refinery/packs/cre-swfl.mts`, `refinery/packs/cre-swfl.test.mts`, `refinery/sources/cre-source.mts` |
| `cf1c8d7` | 2026-05-25 | refactor: consolidate medianOf + numeric helpers into stats.mts | `refinery/packs/env-swfl.mts` |
| `b2fa78e` | 2026-05-25 | feat(cre-swfl): firecrawl pipeline skeleton — MarketBeat source + broker narrative consumer + n8n workflow drafts (#15) | `refinery/packs/cre-swfl.mts`, `refinery/sources/cre-source.mts`, `refinery/sources/cre-source.test.mts` |
| `b9fa5f9` | 2026-05-25 | feat(macro-swfl): ship BLS LAUS county ingest + wire real key_metrics (#14) | `refinery/packs/catalog.mts`, `refinery/packs/macro-swfl.mts`, `refinery/sources/bls-laus-source.mts` |
| `ecc7d0f` | 2026-05-25 | feat: provenance page, permits-swfl ingest fix, fixture tfctr alignment (#13) | `refinery/packs/permits-swfl.mts`, `refinery/packs/traffic-swfl.mts`, `refinery/sources/permits-source.mts` |
| `48b955f` | 2026-05-25 | fix(fdot): correct yearx column name and county casing; switch freight filter to tfctr >= 5% | `refinery/sources/fdot-freight-source.mts`, `refinery/sources/fdot-source.mts`, `refinery/sources/fdot-source.test.mts` |
| `7150e6a` | 2026-05-25 | fix(fdot): column year_ renamed to year in Supabase — alias in select | `refinery/sources/fdot-freight-source.mts` |
| `9c2ba74` | 2026-05-25 | fix(speaker): normalize CRLF before parsing brain markdown | `refinery/render/speaker.mts` |
| `1385c58` | 2026-05-24 | feat: migrate all URLs to www.swfldatagulf.com + Resend waitlist email | `refinery/packs/logistics-swfl-nowcast.mts`, `refinery/sources/brain-input-source.mts`, `refinery/sources/master-source.mts` |
| `f69e9b1` | 2026-05-24 | feat(permits-swfl): Step 5 — sidecarProducer (corridor-permits.json contract) | `refinery/packs/permits-swfl.mts`, `refinery/packs/permits-swfl.test.mts` |
| `0b52c87` | 2026-05-24 | feat(fixtures): Step 2 — promote corridor-centroids.json (4 → 16 Lee corridors) | `refinery/packs/permits-swfl.mts`, `refinery/packs/permits-swfl.test.mts` |
| `c73e0b3` | 2026-05-24 | feat(refinery): Step 1 — sidecarProducer type-lift + writeJsonAtomic helper | `refinery/packs/logistics-swfl-nowcast.test.mts`, `refinery/types/pack.mts` |
| `cd23e36` | 2026-05-24 | feat(mcp-v1): step 1 foundation — catalog leaf + shared fetch + waitlist fix + privacy stub | `refinery/packs/catalog.mts`, `refinery/packs/catalog.test.mts` |
| `856e81d` | 2026-05-24 | feat(cre): per-metric source_url provenance + fallback chain | `refinery/packs/cre-swfl.mts`, `refinery/sources/cre-source.mts` |
| `a638426` | 2026-05-23 | feat(rentals-swfl): v1 — Zillow ZORI ZIP-level rent index brain (#9) | `refinery/packs/index.mts`, `refinery/packs/master.mts`, `refinery/packs/rentals-swfl.mts` |
| `5cd95e2` | 2026-05-22 | feat(duckdb-source): add readOnly ATTACH support + export sqlEscape | `refinery/sources/duckdb-source.mts`, `refinery/sources/duckdb-source.test.mts` |
| `1dc11fc` | 2026-05-22 | feat(permits-swfl): v1 — Lee building permits, saturation index, cre-swfl thin-pipe | `refinery/constitution/real-estate.mts`, `refinery/constitution/real-estate.test.mts`, `refinery/packs/cre-swfl.mts` |
| `24257f6` | 2026-05-21 | feat(cre-swfl): populate submarket asking rent for 4 large-format centers (v29) | `refinery/packs/cre-swfl.mts` |
| `f43bb9a` | 2026-05-21 | feat(cre-swfl): add absorption + asking rent metrics, fix direction fabrication (#4) | `refinery/packs/cre-swfl.mts`, `refinery/packs/index.mts`, `refinery/sources/cre-source.mts` |
| `5d4eb19` | 2026-05-21 | feat(cre-swfl): add absorption + asking rent metrics, fix direction fabrication | `refinery/packs/cre-swfl.mts`, `refinery/packs/index.mts`, `refinery/sources/cre-source.mts` |
| `05b7d29` | 2026-05-21 | refactor(packs): extract cre-swfl from monolithic packs.mts (#3) | `refinery/packs/cre-swfl.mts`, `refinery/packs/index.mts` |
| `b4f380b` | 2026-05-21 | chore: scrub dead premise-migration plumbing | `refinery/sources/supabase.mts` |
| `7938d8c` | 2026-05-21 | Ship speaker layer + v3 consumption contract | `refinery/render/speaker.mts`, `refinery/render/speaker.test.mts`, `refinery/validate/consumption-contract.test.mts` |

---

**Notes**

- This file is generated; do not edit by hand.
- Hand-edit `docs/ontology-and-roadmap.md` §6 (NOW), §7 (NEAR-TERM), §8 (LONG-TERM) for forward strategy.
- Regenerate after any roadmap-shaped commit: `npm run roadmap:sync`.
