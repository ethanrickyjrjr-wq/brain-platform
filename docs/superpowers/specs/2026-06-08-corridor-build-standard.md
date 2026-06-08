# Corridor Build Standard — SWFL Data Gulf
**Audited:** 2026-06-08 · 27 corridors · 22 FULL / 4 intentional-NULL / 2 data-gap

This document defines what "fully built" means for every corridor and gives the exact commands to bring any corridor to standard. Read this before touching `corridor_profiles`, adding a new corridor, or re-running the character generator.

---

## The Standard (What FULL Means)

Every verified, non-deleted corridor must have all of the following populated in `corridor_profiles`:

### CRE Metrics
| Field | Type | Source | Exception |
|-------|------|--------|-----------|
| `cap_rate_pct` | NUMERIC | MarketBeat / MHS broker report | Lehigh (no broker coverage) |
| `cap_rate_direction` | TEXT | Editorial (`rising`/`falling`/`stable`) | Lehigh |
| `vacancy_rate_pct` | NUMERIC | MarketBeat / MHS | Lehigh |
| `vacancy_rate_direction` | TEXT | Editorial | Lehigh |
| `asking_rent_psf` | NUMERIC | MarketBeat / MHS (NNN basis) | Lehigh |
| `asking_rent_psf_direction` | TEXT | Editorial | Lehigh |
| `absorption_sqft` | BIGINT | MarketBeat (negative = net contraction) | Lehigh + 4 anchor-centers (see below) |
| `absorption_sqft_direction` | TEXT | Editorial | same |
| `evolution_direction` | TEXT | Editorial (`growing`/`stable`/`repositioning`) | 4 anchor-centers |
| `tenant_mix` | TEXT | Free-form narrative | 4 anchor-centers |
| `metrics_period` | TEXT | e.g. `2026-Q1` | — |
| `metrics_verified_date` | TEXT | ISO date metrics were sourced | — |

### Character Generator Output (Steps 0–4)
| Field | Content |
|-------|---------|
| `character_facts` | 3–5 sentence fact-pack-sourced prose; every number verbatim with inline `[internal-N]`/`[web-N]` citations; lint-strict |
| `character_speculative` | 2–4 sentence AI inference; must end with `_Speculative — based partly on inferred data. Double-check._` |
| `character_chart` | `{title, columns, rows}` JSONB when a comparison is genuinely useful; JSON `null` when no meaningful comparison exists |
| `character_citations` | `{internal: [{ref, source_url}], web: [{ref, url, title, cited_text}]}` |
| `character_generated_at` | UTC timestamp of generator run |
| `character_fact_pack_vintage` | Oldest data source date, e.g. `OLDEST-2026-01` |

### Always Required (no exceptions)
`corridor_name`, `city`, `corridor_type`, `source_url`, `verification_status = 'verified'`, `deleted_at IS NULL`

---

## Documented Exceptions (NOT Gaps)

### 4 Anchor-Dependent Centers — NULL absorption + evolution by design

These corridors are large single-anchor or enclosed-mall contexts. Aggregate absorption is meaningless (multi-owner, zero churn) and repositioning direction is static. The `character_facts` and `character_speculative` blocks are fully populated — only the numeric-aggregation fields are intentionally NULL.

| Corridor | City | Type |
|----------|------|------|
| Coconut Point Mall | Estero | anchor-dependent |
| Gulf Coast Town Center | Fort Myers | anchor-dependent |
| Airport-Pulling Naples | Naples | industrial-flex |
| Waterside Shops | Naples | beachfront-tourism |

**NULL fields (intentional):** `absorption_sqft`, `absorption_sqft_direction`, `evolution_direction`, `tenant_mix`

Do NOT flag these as gaps. Do NOT try to backfill them with invented numbers.

---

### 2 Lehigh Acres Corridors — No Broker Coverage

Lee Blvd and Joel Blvd have no MarketBeat/MHS coverage by design. Lehigh has minimal commercial inventory; MSA-level data is the only broker source and must never be written to corridor metric columns. Tracked in check `lehigh_cre_metrics` (due Sep 29).

| Corridor | Gap |
|----------|-----|
| Lee Blvd Lehigh Acres | `cap_rate_pct`, `vacancy_rate_pct`, `asking_rent_psf`, `absorption_sqft`, `char_chart` |
| Joel Blvd Lehigh Acres | same |

**`char_chart` is NULL because there are no metrics to chart** — this is correct, not a failure. `character_facts` and `character_speculative` are populated.

**Resolution path:** ODD-ready scaffold exists. Manual quarterly drop from LoopNet active-listing data is the intended path when broker coverage materializes. No code change needed.

---

## Live Status — All 27 Corridors

Queried live from `corridor_profiles` (2026-06-08).

| Corridor | City | Type | Gen Date | Status |
|----------|------|------|----------|--------|
| Bonita Beach Rd / Bonita Beach | Bonita Springs | beachfront-tourism | 2026-05-27 | **FULL** |
| Bonita Trail | Bonita Springs | highway-strip-mall | 2026-05-27 | **FULL** |
| Cape Coral – Coral Pointe | Cape Coral | — | 2026-05-27 | **FULL** |
| Cape Coral Pkwy E | Cape Coral | suburban-residential | 2026-05-27 | **FULL** |
| Pine Island Rd Cape Coral | Cape Coral | suburban-residential | 2026-05-27 | **FULL** |
| Ben Hill Griffin Pkwy | Estero | anchor-dependent | 2026-05-27 | **FULL** |
| Coconut Point Mall | Estero | anchor-dependent | 2026-05-27 | **INTENTIONAL NULL** (absorption + evo) |
| Three Oaks Pkwy / Coconut Rd | Estero | highway-strip-mall | 2026-05-27 | **FULL** |
| Cleveland Ave Fort Myers | Fort Myers | mixed-use-downtown | 2026-05-27 | **FULL** |
| Colonial East | Fort Myers | highway-strip-mall | 2026-05-27 | **FULL** |
| Daniels Pkwy | Fort Myers | anchor-dependent | 2026-05-27 | **FULL** |
| Gulf Coast Town Center | Fort Myers | anchor-dependent | 2026-05-27 | **INTENTIONAL NULL** (absorption + evo) |
| Midpoint Bridge Corridor | Fort Myers | highway-strip-mall | 2026-06-07 | **FULL** |
| Six Mile Cypress Pkwy | Fort Myers | medical-anchored | 2026-05-27 | **FULL** |
| Summerlin Rd Fort Myers | Fort Myers | medical-anchored | 2026-05-27 | **FULL** |
| Estero Blvd Fort Myers Beach | Fort Myers Beach | beachfront-tourism | 2026-05-27 | **FULL** |
| Joel Blvd Lehigh Acres | Lehigh Acres | highway-strip-mall | 2026-06-07 | **DATA GAP** (no broker; char_chart NULL by design) |
| Lee Blvd Lehigh Acres | Lehigh Acres | highway-strip-mall | 2026-06-07 | **DATA GAP** (no broker; char_chart NULL by design) |
| 5th Ave South / 3rd Street South | Naples | mixed-use-downtown | 2026-05-27 | **FULL** |
| Airport-Pulling Naples | Naples | industrial-flex | 2026-05-27 | **INTENTIONAL NULL** (absorption + evo) |
| Collier Blvd / CR-951 | Naples | highway-strip-mall | 2026-05-27 | **FULL** |
| Davis Blvd East Naples | Naples | highway-strip-mall | 2026-05-27 | **FULL** |
| Immokalee Rd North Naples | Naples | highway-strip-mall | 2026-05-27 | **FULL** |
| Pine Ridge Rd Naples | Naples | highway-strip-mall | 2026-05-27 | **FULL** |
| Tamiami Naples | Naples | highway-strip-mall | 2026-05-27 | **FULL** |
| Vanderbilt Beach Rd / Mercato | Naples | beachfront-tourism | 2026-05-27 | **FULL** |
| Waterside Shops | Naples | beachfront-tourism | 2026-05-27 | **INTENTIONAL NULL** (absorption + evo) |

**Summary:** 22 FULL · 4 Intentional NULL · 2 Data Gap (Lehigh, no code fix available)

---

## How to Build / Re-run a Corridor

### Step 1 — Ground (web context capture, quarterly)
```bash
# Single corridor
python -m ingest.pipelines.corridor_grounded.pipeline --corridor "Pine Ridge Rd Naples"

# All corridors
python -m ingest.pipelines.corridor_grounded.pipeline --all

# Dry run (no Tier-1 upload)
python -m ingest.pipelines.corridor_grounded.pipeline --corridor "Pine Ridge Rd Naples" --dry-run
```

Writes NDJSON to `lake-tier1/corridor_grounded/{slug}/year=YYYY/month=MM/run-{iso}.ndjson`.

### Step 2 — Build Fact Pack
```bash
bun refinery/tools/build-corridor-fact-pack.mts --corridor "Pine Ridge Rd Naples"
```

Pulls rows from `corridor_profiles` + `data_lake.marketbeat_swfl` + `data_lake.bls_laus` + FDOT/ZORI/FEMA. Outputs structured JSON with `current` values and `important_math` deltas. Missing data surfaces as `{value: null, gap_reason: "..."}`.

### Step 3 — Synthesize Character (preview)
```bash
bun refinery/tools/synthesize-corridor-character.mts --corridor "Pine Ridge Rd Naples" --preview
```

Runs the full generation stack (facts block + chart block + speculative block) and prints JSON to stdout without writing to DB. Use for operator review before committing.

### Step 4 — Write to DB
```bash
bun refinery/tools/synthesize-corridor-character.mts --corridor "Pine Ridge Rd Naples"

# All corridors (re-run entire fleet)
bun refinery/tools/synthesize-corridor-character.mts
```

Lints output through `spec-validator` + `facts-only-lint` + `inference-bait-lint` + `numeric_softening` ban before DB write. Failure aborts — no partial writes.

### Step 5 — Verify
After a write, confirm in DB:
```sql
SELECT corridor_name, character_generated_at, character_fact_pack_vintage,
       character_facts IS NOT NULL, character_speculative IS NOT NULL, character_chart
FROM corridor_profiles
WHERE corridor_name = 'Pine Ridge Rd Naples';
```

---

## Adding a New Corridor

1. Insert row in `corridor_profiles` with `verification_status = 'verified'`, `corridor_type`, `city`, `source_url`.
2. Add CRE metrics (`cap_rate_pct`, `vacancy_rate_pct`, `asking_rent_psf`, `metrics_period`, `metrics_verified_date`) sourced from MarketBeat/MHS.
3. Add alias to `refinery/lib/corridor-aliases.mts`.
4. Update `lib/city-matrix.ts` in `swfldatagulf-ops` — bump `corridorCount` for the city, bump `MATRIX_AUDITED`.
5. Run Steps 1–4 above to generate character.
6. If the corridor city is new (not in the 13 on the matrix), add a row to `corridor_profiles` city list too.

---

## Quarterly Refresh Cadence

| Task | Cadence | Command |
|------|---------|---------|
| Web context re-capture | Quarterly | `corridor_grounded/pipeline.py --all` |
| Character re-generation | Quarterly (after re-capture) | `synthesize-corridor-character.mts` |
| CRE metrics update | Quarterly (MarketBeat/MHS drop) | Manual → `__scratch__/populate-corridor-metrics.mts` |
| `metrics_period` bump | Same session as metrics update | Inline SQL: `UPDATE corridor_profiles SET metrics_period='2026-Q2', metrics_verified_date='2026-06-08'` |

Next re-gen due: **Q3 2026** (current vintage: 2026-Q1 metrics, character gen 2026-05-27).

---

## Lint Rules (Character Generator)

**Facts block** — must pass all 5:
- `spec-validator` (shape, required fields)
- `facts-only-lint` (no claims without `[internal-N]` or `[web-N]` citation)
- `inference-bait-lint` (no speculative language in the facts block)
- `numeric_softening` ban (no re-encoding numbers into vague English)
- Provenance: every `[internal-N]` ref maps to a data row with `source_url`; every `[web-N]` ref maps to a citation URL

**Speculative block** — must pass 3:
- `spec-validator` (shape)
- Verbatim disclaimer present: `_Speculative — based partly on inferred data. Double-check._`
- Inferred numerics carry hedging language (not the softening ban — hedging is required here)

**Chart block** — structural only:
- Shape: `{title: string, columns: string[], rows: cell[][]}` or JSON `null`
- Values must come from fact pack only (no invented numbers in the chart)
