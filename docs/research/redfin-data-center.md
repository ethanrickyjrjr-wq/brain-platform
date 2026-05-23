# Redfin Data Center — Schedule & Source Notes

Source: https://www.redfin.com/news/data-center/downloads/
Methodology: https://www.redfin.com/news/data-center/methodology/
Investigated: 2026-05-23

## S3 Public Bucket

Base URL: `https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/`

All files are TSV (tab-delimited), gzip-compressed, 58 columns, same schema.

| File | Grain | Compressed size | HTTP status |
|------|-------|-----------------|-------------|
| `redfin_metro_market_tracker.tsv000.gz` | Metro MSA | ~105 MB | 200 public |
| `state_market_tracker.tsv000.gz` | State | ~8.5 MB | 200 public |
| `county_market_tracker.tsv000.gz` | County | ~227 MB | 200 public |
| `city_market_tracker.tsv000.gz` | City | ~946 MB | 200 public |
| `zip_code_market_tracker.tsv000.gz` | ZIP code | ~1.46 GB | 200 public |
| `neighborhood_market_tracker.tsv000.gz` | Neighborhood | ~2.2 GB | 200 public |
| `national_market_tracker.tsv000.gz` | National | — | 403 blocked |

## Update Schedule

- **Cadence**: Monthly (covers the prior calendar month)
- **Stated publish window**: Friday of the third full week of each month
  — Redfin moved this ~1 week earlier in their 2025/2026 Data Center revamp
- **Observed S3 last-modified**: 2026-04-14 (Tuesday) for March 2026 data
- **Next confirmed update**: 2026-06-08 (per Redfin announcement, covers May 2026)
- **Data lag**: approximately 2 weeks after month-end; trending shorter

## Recommended Cron

```
0 9 15 * *   python -m ingest.duckdb_pipelines.redfin_swfl.pipeline
```

Run on the 15th at 9 AM — gives enough buffer after the third-week Friday publish.
Before running, optionally check S3 `Last-Modified` header to confirm fresh data:

```bash
curl -sI "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz" | grep last-modified
```

## Schema (58 columns, shared across all grain files)

**Dimensions**
`PERIOD_BEGIN`, `PERIOD_END`, `PERIOD_DURATION`, `REGION_TYPE`, `REGION_TYPE_ID`,
`TABLE_ID`, `IS_SEASONALLY_ADJUSTED`, `REGION`, `CITY`, `STATE`, `STATE_CODE`,
`PROPERTY_TYPE`, `PROPERTY_TYPE_ID`, `PARENT_METRO_REGION`,
`PARENT_METRO_REGION_METRO_CODE`, `LAST_UPDATED`

**Price metrics** (each × MOM + YOY = 12 columns)
`MEDIAN_SALE_PRICE`, `MEDIAN_LIST_PRICE`, `MEDIAN_PPSF`, `MEDIAN_LIST_PPSF`

**Volume metrics** (each × MOM + YOY = 15 columns)
`HOMES_SOLD`, `PENDING_SALES`, `NEW_LISTINGS`, `INVENTORY`, `MONTHS_OF_SUPPLY`

**Market-health metrics** (each × MOM + YOY = 15 columns)
`MEDIAN_DOM`, `AVG_SALE_TO_LIST`, `SOLD_ABOVE_LIST`, `PRICE_DROPS`,
`OFF_MARKET_IN_TWO_WEEKS`

## Not in public S3 (website-only or locked)

- Weekly housing market data
- Redfin Home Price Index (RHPI) — published second-to-last Tuesday of each month
- Investor home purchases
- Luxury / starter home segment cuts
- Home purchase cancellations, delistings, financing trends

## Tier 1 Ingest

Pipeline: `ingest/duckdb_pipelines/redfin_swfl/pipeline.py`
npm script: `npm run ingest:redfin-swfl`
Output: `s3://lake-tier1/market/redfin_swfl.parquet`
Filter: `STATE_CODE = 'FL'` + Cape Coral MSA (Lee) + Naples MSA (Collier)
  + Punta Gorda MSA (Charlotte) + North Port-Sarasota-Bradenton MSA (Sarasota)
  Glades + Hendry omitted — outside Redfin's MSA coverage (rural/untracked).
No consuming brain yet — `PACK_ID = None` in constants until `redfin-swfl` brain ships.
