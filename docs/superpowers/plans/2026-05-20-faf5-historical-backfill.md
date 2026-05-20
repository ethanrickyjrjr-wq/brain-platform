# FAF5 Historical Backfill (Cold Lane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill FAF5 freight flow data for years 2020–2023 into Cold Lane (`lake-tier1` S3) alongside existing 2024 data, year-partitioned, and update the DuckDB source connector to expose all 5 years as YoY fragments for `logistics-swfl`.

**Architecture:** FAF5.7.1 is a single wide-format CSV — all years (2017–2024 historical + 2030–2050 forecast) are columns in ONE file. There are no per-year download URLs; `FAF5_DOWNLOAD_URL` is unchanged. The existing Parquet at `faf5/2026-05-19/faf_flows.parquet` already contains `tons_2020`…`tons_2023` columns — no second download source exists. The backfill works by: (1) re-downloading the ORNL zip (same URL, ~45 MB), (2) melting wide-format rows into thin per-year Parquets with generic `tons`/`value_musd`/`tmiles` columns, (3) uploading to `faf5/year={year}/faf_flows.parquet` for 2020–2024, (4) running a DuckDB local scan for row-count verification, and (5) updating `faf5-source.mts` to UNION all 5 years. The old vintage path (`faf5/2026-05-19/`) is left intact; only new year-partitioned paths are written.

**Tech Stack:** Python 3.13, duckdb≥1.1 (already in `ingest/requirements.txt`), pyarrow≥14.0, requests, TypeScript/Bun, DuckDB-node

---

## File Map

| File                                               | Change                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ingest/scripts/faf5_to_parquet.py`                | Add `HISTORICAL_YEARS`, `_melt_to_year()`, year-loop upload, DuckDB verification |
| `refinery/sources/faf5-source.mts`                 | Replace single-year view+query with 5-year UNION; add `year` to types            |
| `refinery/__fixtures__/logistics-swfl.sample.json` | Add `"year": 2024` to each row for fixture-mode compat                           |

---

### Task 1: Extend `faf5_to_parquet.py` — year-melt and upload

**Files:**

- Modify: `ingest/scripts/faf5_to_parquet.py`

- [ ] **Step 1: Add `HISTORICAL_YEARS` constant and `_melt_to_year()` function**

In `faf5_to_parquet.py`, after the existing `_YEAR_COLS` block (around line 40), insert:

```python
HISTORICAL_YEARS: list[int] = [2020, 2021, 2022, 2023, 2024]


def _melt_to_year(rows: list[dict], year: int) -> list[dict]:
    """Thin per-year rows — generic column names (no year suffix)."""
    return [
        {
            "dms_orig":   r["dms_orig"],
            "dms_dest":   r["dms_dest"],
            "sctg2":      r["sctg2"],
            "trade_type": r["trade_type"],
            "tons":       r[f"tons_{year}"],
            "value_musd": r[f"value_{year}"],
            "tmiles":     r[f"tmiles_{year}"],
        }
        for r in rows
    ]
```

- [ ] **Step 2: Add year-partitioned upload loop in `main()`**

In `main()`, after the closing of the existing `for table_name, rows in datasets:` block (after the `s3_urls.append` line, roughly line 105), insert:

```python
    print("\n=== Year-partitioned backfill (2020-2024) ===")
    for year in HISTORICAL_YEARS:
        year_rows = _melt_to_year(flows_rows, year)
        object_path = f"faf5/year={year}/faf_flows.parquet"
        print(f"\n  [year={year}] {len(year_rows):,} rows -> {BUCKET}/{object_path}")
        byte_size = upload_parquet(BUCKET, object_path, year_rows)
        print(f"  [year={year}] uploaded {byte_size:,} bytes")
        try:
            write_tier1_pointer(
                None,
                f"faf_flows_year_{year}",
                BUCKET,
                object_path,
                len(year_rows),
                FAF5_DOWNLOAD_URL,
                pack_id="logistics-swfl",
                vintage=str(year),
            )
            print(f"  [year={year}] _tier1_inventory pointer written")
        except Exception as exc:
            print(f"  [year={year}] WARNING: _tier1_inventory write failed (non-fatal) -- {exc}")
        s3_urls.append(f"s3://{BUCKET}/{object_path}")
```

- [ ] **Step 3: Add DuckDB row-count verification block in `main()`**

Immediately after the year-loop above (still inside `main()`), insert:

```python
    print("\n=== DuckDB row-count verification (local Parquet scan) ===")
    import duckdb as _ddb
    import tempfile
    import pyarrow as _pa
    import pyarrow.parquet as _pq
    _conn = _ddb.connect()
    for year in HISTORICAL_YEARS:
        year_rows_v = _melt_to_year(flows_rows, year)
        with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as _tmp:
            _pq.write_table(_pa.Table.from_pylist(year_rows_v), _tmp.name)
            _total = _conn.execute(
                f"SELECT COUNT(*) FROM read_parquet('{_tmp.name}')"
            ).fetchone()[0]
            _swfl = _conn.execute(
                f"SELECT COUNT(*) FROM read_parquet('{_tmp.name}') "
                f"WHERE dms_dest = 129 AND trade_type = 1 AND tons > 0"
            ).fetchone()[0]
        print(
            f"  year={year}: {_total:,} total FL-zone rows "
            f"| {_swfl:,} SWFL inbound (dms_dest=129 trade_type=1 tons>0)"
        )
    _conn.close()
```

- [ ] **Step 4: Commit the upload script changes**

```bash
git add ingest/scripts/faf5_to_parquet.py
git commit -m "feat(faf5): year-partitioned backfill 2020-2024 — melt wide-format to thin Parquet per year"
```

---

### Task 2: Update `faf5-source.mts` — multi-year UNION query

**Files:**

- Modify: `refinery/sources/faf5-source.mts`

- [ ] **Step 5: Update the constants block**

Replace lines 22–35 (the block from `const FAF5_VINTAGE` through `const VALUE_COL`):

```typescript
const FAF5_VINTAGE = "2026-05-19"; // legacy; zone/sctg lookup Parquets still live here
const FAF5_BUCKET = "lake-tier1";
const FAF5_LEGACY_S3_BASE = `s3://${FAF5_BUCKET}/faf5/${FAF5_VINTAGE}`;
export const FAF5_ORNL_URL = "https://faf.ornl.gov/faf5/";

const SOURCE_ID = "faf5_flows_swfl";
const SWFL_DEST_ZONE = 129;
const DOMESTIC_TRADE_TYPE = 1;
/** Latest historical year in FAF5.7.1 — bump when ORNL publishes the next vintage. */
export const LATEST_HISTORICAL_FAF_YEAR = 2024;
const HISTORICAL_YEARS = [2020, 2021, 2022, 2023, 2024] as const;
```

- [ ] **Step 6: Add `year` to `FafDuckRow`**

Replace the `FafDuckRow` interface:

```typescript
interface FafDuckRow {
  dms_orig: number;
  zone_name: string;
  state_abbr: string;
  sctg2: number;
  commodity_name: string;
  tons: number;
  value_m: number;
  year: number;
}
```

- [ ] **Step 7: Replace the full `faf5Source` connector block**

Replace from `export const faf5Source: SourceConnector = makeDuckDBSource<FafDuckRow>({` through the closing `});` with:

```typescript
const _yearViews = HISTORICAL_YEARS.map((y) => ({
  name: `faf_flows_${y}` as const,
  s3_url: `s3://${FAF5_BUCKET}/faf5/year=${y}/faf_flows.parquet`,
}));

const _yearUnion = HISTORICAL_YEARS.map(
  (y) => `
    SELECT f.dms_orig, z.zone_name, z.state_abbr, f.sctg2, s.commodity_name,
           f.tons, f.value_musd AS value_m, ${y} AS year
    FROM faf_flows_${y} f
    JOIN faf_zone_lookup z ON f.dms_orig = z.zone_id
    JOIN faf_sctg_lookup s ON f.sctg2 = s.sctg_code
    WHERE f.dms_dest = ${SWFL_DEST_ZONE}
      AND f.trade_type = ${DOMESTIC_TRADE_TYPE}
      AND f.tons > 0`,
).join("\n    UNION ALL");

export const faf5Source: SourceConnector = makeDuckDBSource<FafDuckRow>({
  source_id: SOURCE_ID,
  trust_tier: 1,
  parquetViews: [
    ..._yearViews,
    {
      name: "faf_zone_lookup",
      s3_url: `${FAF5_LEGACY_S3_BASE}/faf_zone_lookup.parquet`,
    },
    {
      name: "faf_sctg_lookup",
      s3_url: `${FAF5_LEGACY_S3_BASE}/faf_sctg_lookup.parquet`,
    },
  ],
  query: _yearUnion,
  rowShape: (r) => ({
    dms_orig: toNum(r["dms_orig"]),
    zone_name: String(r["zone_name"] ?? ""),
    state_abbr: String(r["state_abbr"] ?? ""),
    sctg2: toNum(r["sctg2"]),
    commodity_name: String(r["commodity_name"] ?? ""),
    tons: toNum(r["tons"]),
    value_m: toNum(r["value_m"]),
    year: toNum(r["year"]),
  }),
  normalize: (rows, { fetched_at }): RawFragment[] =>
    rows.map(
      (r): RawFragment<FafFlowNormalized> => ({
        fragment_id: fragmentId(
          SOURCE_ID,
          `${r.dms_orig}-${r.sctg2}-${r.year}`,
        ),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: r,
        normalized: {
          kind: "faf5-flow",
          origin_zone_id: r.dms_orig,
          origin_zone_name: r.zone_name,
          origin_state_abbr: r.state_abbr,
          sctg_code: r.sctg2,
          commodity_name: r.commodity_name,
          tons_thousand: r.tons,
          value_musd: r.value_m,
          year: r.year,
        },
      }),
    ),
  citation: (verifiedDate, ttlSeconds): Omit<CitationRow, "id"> => ({
    source: `FAF5.7.1 freight flows (ORNL/FHWA Cold Lane Parquet; years ${HISTORICAL_YEARS.join(",")}; dms_dest=${SWFL_DEST_ZONE} trade_type=${DOMESTIC_TRADE_TYPE}) — ${FAF5_ORNL_URL}`,
    verified: verifiedDate,
    expires: expiresDate(verifiedDate, ttlSeconds),
  }),
  fixturePath: FIXTURE_PATH,
});
```

- [ ] **Step 8: Type-check**

```bash
npx tsc --noEmit
```

Expected: 0 errors. If `TONS_COL`/`VALUE_COL` appear in any error message, search for remaining references (`grep -n "TONS_COL\|VALUE_COL" refinery/sources/faf5-source.mts`) and delete those lines.

- [ ] **Step 9: Commit source connector**

```bash
git add refinery/sources/faf5-source.mts
git commit -m "feat(faf5-source): multi-year UNION 2020-2024 — YoY fragments for logistics-swfl"
```

---

### Task 3: Fix fixture for `REFINERY_SOURCE=fixture` compatibility

**Files:**

- Modify: `refinery/__fixtures__/logistics-swfl.sample.json`

The fixture was recorded with single-year 2024 rows. After the source change, each row must have a `year` field or `rowShape` will return `year: 0`.

- [ ] **Step 10: Add `"year": 2024` to each fixture row**

On Windows PowerShell (requires Node `jq` equivalent — use node instead):

```bash
node -e "
const fs = require('fs');
const p = 'refinery/__fixtures__/logistics-swfl.sample.json';
const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
const updated = rows.map(r => ({ ...r, year: 2024 }));
fs.writeFileSync(p, JSON.stringify(updated, null, 2));
console.log('Updated', updated.length, 'rows');
"
```

- [ ] **Step 11: Smoke-test fixture mode**

```bash
$env:REFINERY_SOURCE="fixture"; npm run refinery logistics-swfl 2>&1 | Select-Object -Last 30
```

Expected: refinery completes with no `year` undefined errors. The brain output will show 2024 data only (fixture contains only 2024 rows — that's correct for fixture mode).

- [ ] **Step 12: Commit fixture update**

```bash
git add refinery/__fixtures__/logistics-swfl.sample.json
git commit -m "fix(faf5-fixture): add year=2024 field to fixture rows for multi-year source compat"
```

---

### Task 4: Run the upload and report row counts

- [ ] **Step 13: Verify `.env` has required vars**

```bash
grep -E "BRAINS_SUPABASE_URL|BRAINS_SUPABASE_SERVICE_KEY|DESTINATION__POSTGRES__CREDENTIALS" ingest/.env | cut -d= -f1
```

Expected: all three keys present.

- [ ] **Step 14: Run the upload script**

```bash
python -m ingest.scripts.faf5_to_parquet
```

Expected terminal output (abbreviated):

```
  Downloading FAF5 zip from ORNL...
  Downloaded N bytes. Parsing CSV...
  Parsed 284,239 FL-zone flow rows.

  [faf_flows] 284,239 rows -> lake-tier1/faf5/2026-05-19/faf_flows.parquet
  ...

=== Year-partitioned backfill (2020-2024) ===

  [year=2020] 284,239 rows -> lake-tier1/faf5/year=2020/faf_flows.parquet
  [year=2020] uploaded N bytes
  [year=2020] _tier1_inventory pointer written
  [year=2021] 284,239 rows -> lake-tier1/faf5/year=2021/faf_flows.parquet
  ...

=== DuckDB row-count verification (local Parquet scan) ===
  year=2020: 284,239 total FL-zone rows | N SWFL inbound (dms_dest=129 trade_type=1 tons>0)
  year=2021: 284,239 total FL-zone rows | N SWFL inbound
  year=2022: 284,239 total FL-zone rows | N SWFL inbound
  year=2023: 284,239 total FL-zone rows | N SWFL inbound
  year=2024: 284,239 total FL-zone rows | 686 SWFL inbound
```

Row counts must be consistent: all years should show 284,239 total (same flow pairs; some have tons=0 for older years). The 2024 SWFL inbound count (686) is the authoritative baseline.

- [ ] **Step 15: Test live refinery run**

```bash
$env:REFINERY_SOURCE="live"; npm run refinery logistics-swfl 2>&1 | Select-Object -Last 40
```

Expected: refinery completes. Output will now show fragment counts ~5× higher than before (one fragment per year per flow pair). Confirm no DuckDB S3 auth errors.

---

## Self-Review

**Spec coverage:**

- ✅ 2020, 2021, 2022, 2023 landed (Task 1 step 2 + Task 4 step 14)
- ✅ Year-partitioned: `faf5/year={year}/faf_flows.parquet`
- ✅ 2024 not re-fetched/overwritten: new path `faf5/year=2024/`, old `faf5/2026-05-19/` unchanged
- ✅ No new Tier 2 (Postgres) tables — only `_tier1_inventory` pointer rows
- ✅ No LLM in math path — pure Python column extraction
- ✅ DuckDB row-count sanity check per year (Task 1 step 3 / Task 4 step 14)
- ✅ URL Rule 3: FAF5.7.1 has one archive with all years as columns — no per-year URLs exist. `FAF5_DOWNLOAD_URL` is unchanged (verified 2026-05-17 per `constants.py` comment). No new fetch logic written.

**Placeholder scan:** No TBDs. All code blocks are complete and self-contained.

**Type consistency:**

- `_melt_to_year()` produces `value_musd` key → SQL aliases `f.value_musd AS value_m` → `FafDuckRow.value_m` → `normalized.value_musd`. Chain is consistent.
- `year` field: added to `FafDuckRow`, `rowShape`, `normalize`, `fragment_id`. Consistent end-to-end.
- `TONS_COL`/`VALUE_COL` constants from old code are implicitly removed by the full block replacement in Step 7. Step 8 (`tsc --noEmit`) catches any missed reference.
- `HISTORICAL_YEARS` used as `const` tuple — TypeScript spread into `parquetViews` array is valid.
- `FAF5_S3_BASE` renamed to `FAF5_LEGACY_S3_BASE` in Step 5. No other file references `FAF5_S3_BASE` (it was local to this file).
