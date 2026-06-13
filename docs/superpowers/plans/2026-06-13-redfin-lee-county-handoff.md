# Handoff — Redfin Lee County-grain parity build

**For:** a fresh build session (Sonnet). **Author:** Opus session 2026-06-13.
**Status of obligation:** tracked in the `checks` ledger as `redfin_lee_county_parity` (not in this doc — this is a brief, not a status board; RULE 2).

---

## Read this first — what is and isn't the gap

A LittleBird gap audit claimed "DOM / months-of-supply — Missing Lee Redfin ingest." **That is wrong and was retracted by the operator ("little bird made it up").** Verified live from the lake on 2026-06-13:

- **Lee ZIP-level Redfin already works.** All 39 Lee ZIPs are in `s3://lake-tier1/market/redfin_swfl.parquet` under Redfin's `"Cape Coral, FL"` metro. The `housing-swfl` brain reads them and emits a per-ZIP detail table (`housing_by_zip`) covering every SWFL ZIP. Example — **ZIP 33908, latest 90-day window: median DOM 87 days, months-of-supply ≈ 7.2** (derived in-brain: inventory 778 ÷ 90-day sales pace 324; Redfin publishes ZIP-grain MoS as `"NA"`). `housing-source.mts:101` already strips the `"Zip Code: 33908"` prefix to `33908`.
- **DO NOT** try to "add Lee ZIPs" or touch `redfin_swfl` / `housing-swfl` — there is no per-ZIP gap. Anything you build here must not change 33908 or any Lee ZIP output.

**The ONE real Collier-vs-Lee asymmetry:** `data_lake.redfin_collier_market` holds **13 years** of monthly *county-grain* history (2013-05 → 2026-05, 5 property types, 157 "All Residential" rows) feeding `properties-collier-value`'s county trend metrics (`collier_months_of_supply`, `collier_median_sale_price_yoy`, `collier_homes_sold_zscore`, `collier_homes_sold_per_year`). **Lee has no county-grain table**, so no county-level trend series. This build gives Lee that parity.

---

## Scope — clone redfin_collier → redfin_lee + wire into properties-lee-value (ONE PR)

Brain-first gate (CLAUDE.md Data Tier Policy rule 2 / ZIP-gate G3): a new Tier-2 table MUST ship with its consuming brain + vocab in the SAME PR. So pipeline **+** consumer **+** vocab together.

### A. Ingest pipeline — `ingest/pipelines/redfin_lee/`
Clone `ingest/pipelines/redfin_collier/` (4 files: `constants.py`, `resources.py`, `pipeline.py`, `__init__.py`), changing ONLY:
- `constants.py`: `LEE_REGION = "Lee County, FL"` (replaces `COLLIER_REGION`). **Verify the exact REGION string** is `"Lee County, FL"` against the live county tracker before relying on it — the tracker uses `"<County> County, FL"`, confirmed for Collier; a dry-run row count >0 confirms Lee. Keep the same `REDFIN_COUNTY_TRACKER_URL` and `HEADLINE_PROPERTY_TYPE`.
- `resources.py`: replace every `COLLIER_REGION` → `LEE_REGION`; table name `redfin_collier_market` → `redfin_lee_market`; update docstrings.
- `pipeline.py`: rename `ingest_redfin_collier` → `ingest_redfin_lee`; update docstrings/comments.
- Add `ingest/tests/pipelines/redfin_lee/test_pipeline.py` (copy Collier's test, swap the region string + table name).

### B. Cadence + cron + grant
- `ingest/cadence_registry.yaml`: add a `redfin_lee` entry mirroring `redfin_collier` (lane `tier-2`, `cadence_days: 31`, `tolerance_multiplier: 2.0`, `dlt_schema_name: redfin_lee`, `count_table: data_lake.redfin_lee_market`, `expected_rows_min: ~600`). Confirm the real row count from the first run and set the floor to ~90% of it.
- `.github/workflows/redfin-lee-monthly.yml`: clone `redfin-collier-monthly.yml` verbatim, change the name + the `python -m ingest.pipelines.redfin_lee.pipeline` line. Same `env:` secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DESTINATION__POSTGRES__CREDENTIALS`).
- `docs/sql/redfin_lee_grant.sql`: clone `docs/sql/redfin_collier_grant.sql` → `GRANT SELECT ON data_lake.redfin_lee_market TO service_role; NOTIFY pgrst,'reload schema';`. Run it after the first pipeline run creates the table.

### C. Consumer source — `refinery/sources/lee-market-source.mts`
Clone `refinery/sources/collier-market-source.mts` exactly. Change `SOURCE_ID`/`TABLE` → `redfin_lee_market`, the `kind` discriminants (`collier-sales-year`→`lee-sales-year`, `collier-summary`→`lee-summary`), and the fixture path. It already aggregates monthly → calendar-year HOMES_SOLD totals + a latest-period summary (price YoY % + months_of_supply) — exactly the shape `properties-lee-value` needs.

### D. Wire into `refinery/packs/properties-lee-value.mts`
`properties-lee-value` already has yearly z-score math (collier-market-source's header even says it reuses Lee's). Add `leeMarketSource` to its `sources`, and emit county market metrics mirroring `properties-collier-value`'s `collier_*` set:
- `lee_months_of_supply`, `lee_median_sale_price_yoy`, `lee_homes_sold_zscore`, `lee_homes_sold_per_year`.
Mirror `properties-collier-value.mts` for the exact metric construction, labels, `variable_type`/`units`/`display_format`, and how it composes a market source alongside the existing parcel source. **Keep the existing LeePA parcel metrics untouched** — you are ADDING a market source, not replacing parcels.

### E. Vocab — SAME commit (RULE 1 pre-push gate #2)
Register every new `lee_*` slug in `refinery/vocab/brain-vocabulary.json` (a concept with `prefLabel` + `scope_note`, plus a `slug_index` identity entry) — copy the `collier_*` entries as templates. Then **smoke before pushing**:
```
bun test refinery/lib/corridor-aliases.test.mts
bun refinery/tools/check-vocab-coverage.mts --all      # --all is MANDATORY (catches leaf-emitted orphans)
```

---

## ⚠️ Environment blocker you WILL hit

`.dlt/secrets.toml` currently has **multiple unquoted values** (lines 14, 29, …) that crash dlt's strict TOML loader — so `python -m ingest.pipelines.redfin_lee.pipeline` will fail with `tomlkit ... UnexpectedCharError` BEFORE any work. The Opus session did NOT edit the operator's credentials file. Two ways forward:
1. **Fix `secrets.toml`** (quote every unquoted value, or remove the stray env-var-style lines) — unblocks ALL local dlt runs. Verify with `python -c "import tomlkit; tomlkit.parse(open('.dlt/secrets.toml').read())"`. (The `[destination.postgres.credentials]` SECTION is valid and working — the migration connected with it.)
2. **Zero-touch workaround** — feed dlt the section creds as discrete env vars and run from a clean cwd so it never parses the file. Pattern used this session (now deleted): read `host/port/username/password/database` from the section with a lenient regex, set `DESTINATION__POSTGRES__CREDENTIALS__{HOST,PORT,USERNAME,PASSWORD,DATABASE}` env vars, `os.chdir(tempfile.mkdtemp())`, then import + run. OR just run it in GHA via `workflow_dispatch` on the new `redfin-lee-monthly.yml` (clean secrets there).

ODD (Operation Dumbo Drop): N/A — Redfin's county tracker is an auto-ingestable public S3 TSV.

---

## Verification (end-to-end)
1. Pipeline run → `data_lake.redfin_lee_market` has ~600+ rows spanning ~2013→present, `property_type='All Residential'` present. (`SELECT property_type, COUNT(*), MIN(period_end), MAX(period_end) FROM pg.data_lake.redfin_lee_market GROUP BY 1`.)
2. `bun refinery/tools/check-vocab-coverage.mts --all` is clean (no orphan `lee_*` slug).
3. Local rebuild emits the new metrics with no orphan abort: `npm run refinery -- properties-lee-value --target-only` (use `--target-only`, not `--force`, to avoid clobbering uncommitted brain `.md`s).
4. Spot-check `lee_months_of_supply` against `collier_months_of_supply` for plausibility, and against the Lee per-ZIP MoS (33908 ≈ 7.2) — county figure should be in a sane neighborhood.

## Push gates (CLAUDE.md)
- Writes `data_lake.*` + edits a brain pack/source/vocab → **diff review before push** (RULE 1).
- `bun install` + `git add bun.lock` IF any dep changes (none expected).
- Top-of-file `SESSION_LOG.md` entry + `node scripts/safe-push.mjs`. Reconcile `redfin_lee_county_parity` in the `checks` ledger in the same push.

## Alternative if county *history* isn't wanted — cheaper Lee county CURRENT figure
If the operator only wants a Lee county-level *current* months-of-supply (no 13-yr history), skip A–E entirely: `housing-swfl.mts` already computes per-metro MoS in its `by_metro` map (`buildSnapshot`, ~line 187-196) but never emits it. Emit `by_metro["Cape Coral, FL"].months_of_supply` (and the other metros) as key_metrics — ~20 min, no new pipeline, no new ingest. This does NOT give trend/history.
