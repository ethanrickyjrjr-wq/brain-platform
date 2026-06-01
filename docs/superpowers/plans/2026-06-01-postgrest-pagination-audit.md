# PostgREST `db-max-rows` pagination audit — handoff for a fresh Claude

> Created 2026-06-01 by the session that fixed `fema-nfip-source`. **Write-then-stop handoff: a fresh Claude takes the audit from here.** Self-contained.

## The bug class

Supabase **PostgREST silently caps a single response at `db-max-rows` = 1,000 rows** on this project. A `.select()` with no row window — whether it has `.limit(BIG)` or no limit at all — returns **at most 1,000 rows, with no error**. Any aggregate computed on that response is a **silent sample**, not the full table. `.limit(500000)` does **not** override the cap.

Proven 2026-06-01 against `data_lake.fema_nfip_claims`: exact `count(head)` = **86,574**, but the unbounded `.select(...).limit(500000)` returned exactly **1,000**. env-swfl had been computing per-ZIP flood metrics on ~1.2% of claims for builds v18–v21 — FMB ZIP 33931 AAL read **$264/yr** (1k sample) vs **$30,074/yr** (full set). Nothing flagged it.

## The fix pattern (proven — `fema-nfip-source.mts` `f772f72`)

Page with `.range()`, ordered by a **unique** column (without a stable total order, pages overlap/skip), loop until a short page:

```ts
const PAGE = 1000;
const rows: Row[] = [];
for (let from = 0; ; from += PAGE) {
  const r = await sb.from(TABLE).select(COLS)
    .eq(...).in(...)          // same filters as before
    .order("id", { ascending: true })   // a UNIQUE column
    .range(from, from + PAGE - 1);
  if (r.error) throw new Error(`... (rows ${from}-${from + PAGE - 1}) — ${r.error.message}`);
  const page = (r.data ?? []) as Row[];
  rows.push(...page);
  if (page.length < PAGE) break;
}
```

**Verify each fix by data-equivalence**, not just "it runs": compare against the table's `count({ head: true })`, and rebuild the consuming brain to confirm distinct-id count == total and metrics shift in the expected direction (a fix that _drops_ rows is a bug; a fix that _adds_ rows means the old read was sampled).

## Audit scope

**Every `refinery/sources/*.mts`** that calls `getSupabase()...select()` against a `data_lake.*` (or `public.*`) table — flag any `.select()` with **no `.range()` pagination** that can hit a table with **>1,000 rows**. A `.select()` with no `.limit()` at all is just as exposed as `.limit(10000)` — both return ≤1,000.

Out of scope: sources that read pre-aggregated single rows, brain-input fragments, HTTP/CSV fetches, or DuckDB.

## Status

- **Fixed:** `fema-nfip-source.mts` (`f772f72`).
- **Already paginate (safe):** `fdot-source.mts` (`.range()` :244), `zori-source.mts` (`.range()` :63).
- **Everything else: UNAUDITED.** 28 source files call `.select()`; only the 3 above touch `.range()`.

### Top concrete suspect — start here

- **`fdot-freight-source.mts`** — `.limit(10000)` (:379) and `.limit(SHOCK_LOG_PULL_COUNT)` (:402), **no `.range()`**. If `data_lake.fdot_freight*` exceeds 1,000 rows, logistics-swfl / logistics-swfl-nowcast are running on a sample. Check this first.

### Confirmed-safe small `.limit()` (no action)

`bls-oews-source.mts` `.limit(200)`, `dbpr-sirs-source.mts` `.limit(20)`, `macro-florida-cbp-source.mts` `.limit(1)` — all ≤1,000 by construction.

### Unaudited `.select()` users (verify each — does it hit a >1k table without `.range()`?)

dbpr-public-notices, dbpr-sirs, fl-dbpr-licenses, dbpr-press-releases, corridor-pulse, city-pulse, swfl-inc, fdle-crime, rsw-airport, fgcu-reri, cre, fl-dor-sales-tax, tourism-tdt, collier-permits, permits, bls-laus, bls-qcew, fhfa-hpi, **leepa-value** (LeePA = 528k parcels — high-risk if it reads raw rows), fhfa-hpi, marketbeat-swfl, sector-credit-swfl, usgs-water, dbpr-public-notices.

## Priority order

**Audit by table row-count, biggest first** — biggest tables = biggest wrong-answer surface. Get each table's size before fixing:

```ts
const c = await sb.from(TABLE).select("*", { count: "exact", head: true }).<filters>;
// c.count is the true row count; if > 1000 and the real query lacks .range() → it's sampled.
```

Likely-large tables to rank first: `leepa_parcels` (~528k), `fdot_freight*`, `fl_dbpr_licenses` (~12k), `bls_*`, `redfin/zori` ZIP-months. Small lookup tables (county-year rollups, single-snapshot macro) are low risk.

## Done-ness

A table-row-count-ranked list of every source `.select()`, each marked safe / fixed / N-row-sample-was-wrong, with paginated fixes (own commits) + brain rebuilds for any that were sampling. Mirror the `fema-nfip-source` pattern and verify-by-equivalence.
