# Brain Factory — State of the Engine (2026-05-15, Phase E)

Phases A → E shipped in one session. Lake grew from 3 brains to 5. Every brain
emits a standardized `--- OUTPUT ---` JSON block consumed via thin pipes.

## Commits

| SHA       | Phase | What                                                                                                                                              |
| --------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ff79b08` | A/B   | Atomic type-lift (`BrainDomain`, `TrustTier`, `input_brains`, `outputProducer?`) + standardized `--- OUTPUT ---` block + deterministic confidence |
| `52b7a47` | C     | DAG resolver + `--force` + scaffold CLI + `brain_registry.sql` + first scaffolded brain (`macro-swfl`)                                            |
| `e2aef82` | D1    | Multiplicative upstream-confidence propagation (replaces `min()`); shared `lib/brain-output-reader.mts`                                           |
| `f707737` | E     | Live FRED + trust-tier double-counting fix + `skipTriageAgent` + `sector-credit-swfl`                                                             |

## Lake snapshot (post-Phase E, all live data)

| Brain                | v   | Domain      | Confidence | Source                                                        |
| -------------------- | --- | ----------- | ---------- | ------------------------------------------------------------- |
| `franchise-outcomes` | 8   | real-estate | 1.00       | Supabase RPC `get_franchise_outcomes_aggregated` (275 brands) |
| `cre-swfl`           | 5   | real-estate | 0.80       | Supabase `corridor_profiles` (25 corridors)                   |
| `master`             | 7   | real-estate | 0.72       | reads franchise + cre via bespoke `master-source.mts`         |
| `macro-swfl`         | 4   | finance     | 0.72       | live FRED (SOFR, FLUR, CPI YoY, LBSSA12)                      |
| `sector-credit-swfl` | 1   | finance     | 0.86       | Supabase `sba_loans_by_naics_county` (893 rows)               |

## Key infrastructure landed

- **`lib/confidence.mts`** — `confidence = avg(direct_tier_score) × freshness × avg(upstream_confidences)`. `brain-input:*` sources excluded from tier avg to prevent double-counting.
- **`lib/dag.mts`** — pure in-memory topological sort + three-color cycle detection + `walkConsumers` + `brainStatus` (missing / stale / fresh).
- **`lib/brain-output-reader.mts`** — shared parser used by both `brain-input-source.mts` and Stage 4's upstream-confidence harvest.
- **`sources/brain-input-source.mts`** — generic `makeBrainInputSource(upstreamId)` for thin-pipe consumption.
- **`scaffold.mts`** — `--id=foo --domain=finance --input-brains=master` atomically writes source + pack + signal SQL + appends to `packs/index.mts`.
- **`docs/sql/brain_registry.sql`** — paste-and-run Supabase catalog with `CHECK` on `BrainDomain`, `consumer_brains` trigger, upsert-safe seed.
- **`skipTriageAgent`** — new flag, parallel to `skipSynthesisAgent`; pure-deterministic packs skip the Haiku content-score call (required for sector-credit's 893 raw rows).

## Verification

- Typecheck clean across all phases.
- 12 / 12 refinery tests pass.
- Full 5-brain DAG rebuilds end-to-end against live Supabase + live FRED (`--force`).
- Confidence math verified empirically across the full chain.

## Live findings (first real refine, sector-credit-swfl)

- Safest 2-digit NAICS sectors in SWFL by SBA resolved-loan charge-off rate: **Real Estate (0%), Arts & Recreation (0%), Finance & Insurance (0%)**.
- Riskiest: **Transportation & Warehousing 57.1%, Retail (NAICS 45) 44.4%, Personal Services 21.2%**.
- Macro overlay: SOFR 3.59 % stable, US CPI YoY 3.78 % rising, FL unemployment 4.7 % rising.

## Notion

Blueprint page `36135f3b-7faf-813d-b9b8-dfc16ee7da0b` is at v1.1 LOCKED with the CT Review v1.0 block.

## What's queued

- TDT (Tourist Development Tax) PDF extraction → future `tourism-tdt` brain (premise-engine has `tdt-ingest`).
- NAICS 44/45 ("Retail Trade") and 31-33 ("Manufacturing") show as separate rows in `sector-credit-swfl` — disambiguated by the `(NAICS XX)` suffix but could be collapsed in a future refine.
- macro-swfl `domain: finance` propagates through the SWFL-prefixed freshness token (`SWFL-7421-v4-...`) — per-domain `LAKE_ID` (Q2 LOCKED) is still pending; rename-only refactor.
