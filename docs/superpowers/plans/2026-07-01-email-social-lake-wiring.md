# Email/Social AI Lake Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** 🧠 Opus — 12 files, keywords: migration, refactor, schema

**Goal:** Kill the live per-request RentCast/SteadyAPI calls in the Email Lab and Social Lab, replacing
them with a read against the lake tables the ingest pipeline already populates daily; add a
lifecycle-event digest (price cuts / holdings / sales) to the shared data spine both AIs read; add an
optional schedule-suggestion field the author tool may emit.

**Architecture:** Three independent, sequentially-buildable pieces sharing one spine
(`fetchLakeParts`, `lib/email/build-doc.ts:87-95`). Gap 1 changes only `lib/listings/select.ts`'s
internals (same exported signatures). Gap 2 adds one SQL view + one loader function, wired into the
existing `fetchLakeParts`. Gap 4 adds one optional field to an existing tool schema.

**Tech Stack:** TypeScript/Bun, Supabase (Postgres, `data_lake` schema via the untyped service-role
client), `bun:test`, Zod, Anthropic Claude tool-use.

## Global Constraints

- No RentCast: never reintroduce a live call to `api.rentcast.io` (see `feedback_no-rentcast-dont-relitigate`
  memory — dead, no key configured).
- `lib/listings/steadyapi.ts` is NOT touched — `lib/assistant/comp-helper.ts` depends on it live.
- `lib/listings/rentcast.ts`'s `Listing` type + `normalizeListing` stay — `listings.test.ts` fixtures
  depend on them.
- `data_lake` schema reads use `createServiceRoleClientUntyped` (`@/utils/supabase/service-role`) —
  never the typed client, never `bun run gen:types` for this schema (it's intentionally untyped).
- Every new file touching `data_lake` needs an entry + `KNOWN-DEBT` comment in
  `verification/supabase-untyped-allowlist.json` (ESLint bans the import otherwise).
- Migrations apply via `bun scripts/run-migration.ts <file>.sql` (psql not installed), always
  `CREATE OR REPLACE VIEW` (idempotent), always followed by `GRANT SELECT ... TO service_role;
  NOTIFY pgrst, 'reload schema';`.
- No invented numbers: every figure this build produces states a real source + as-of date.

---

### Task 1: The lifecycle digest SQL view

**Files:**
- Create: `docs/sql/20260701_listing_transitions_recent_zip_stats.sql`

**Interfaces:**
- Produces: view `data_lake.listing_transitions_recent_zip_stats` with columns
  `county, zip_code, price_cuts_30d, price_raises_30d, new_holdings_30d, sales_30d, new_listings_30d,
  price_cuts_90d, price_raises_90d, new_holdings_90d, sales_90d, new_listings_90d, latest_at` — one row
  per `(county, zip_code)`, one per `(county)` with `zip_code IS NULL`, one region-total row with both
  NULL (from `GROUPING SETS`). Consumed by Task 3's `loadLifecycleDigest`.

- [ ] **Step 1: Write the migration file**

```sql
-- docs/sql/20260701_listing_transitions_recent_zip_stats.sql
-- Lifecycle-event digest for the Email/Social AI shared data spine: price cuts, new holdings
-- (departures from the active market, cause unknown), resolved sales, and new listings, at
-- region/county/zip grain, over a 30-day AND a 90-day trailing window in one pass. The loader
-- (lib/email/market-context.ts loadLifecycleDigest) picks 30d if it has any signal, else 90d,
-- so a slow-moving ZIP never reads as "nothing happening" just because 30 days is too tight a
-- window for real estate. `seed = false` drops the one-time historical backfill (10,459 rows)
-- so counts reflect real day-to-day activity only. `listing_transitions` carries no geography
-- column, so this joins `listing_state` for zip_code/county via the (address_key, sale_or_rent) key.
--
-- Apply: bun scripts/run-migration.ts docs/sql/20260701_listing_transitions_recent_zip_stats.sql

CREATE OR REPLACE VIEW data_lake.listing_transitions_recent_zip_stats AS
WITH recent AS (
  SELECT t.*, s.zip_code, s.county
  FROM data_lake.listing_transitions t
  JOIN data_lake.listing_state s USING (address_key, sale_or_rent)
  WHERE t.source_name = 'api_feed'
    AND t.seed = false
    AND t.at >= current_date - interval '90 days'
)
SELECT
  county,
  zip_code,
  count(*) FILTER (WHERE at >= current_date - interval '30 days' AND from_state = to_state AND price_delta < 0) AS price_cuts_30d,
  count(*) FILTER (WHERE at >= current_date - interval '30 days' AND from_state = to_state AND price_delta > 0) AS price_raises_30d,
  count(*) FILTER (WHERE at >= current_date - interval '30 days' AND to_state = 'holding')                     AS new_holdings_30d,
  count(*) FILTER (WHERE at >= current_date - interval '30 days' AND to_state = 'sold')                        AS sales_30d,
  count(*) FILTER (WHERE at >= current_date - interval '30 days' AND from_state IS NULL)                       AS new_listings_30d,
  count(*) FILTER (WHERE from_state = to_state AND price_delta < 0) AS price_cuts_90d,
  count(*) FILTER (WHERE from_state = to_state AND price_delta > 0) AS price_raises_90d,
  count(*) FILTER (WHERE to_state = 'holding')                     AS new_holdings_90d,
  count(*) FILTER (WHERE to_state = 'sold')                        AS sales_90d,
  count(*) FILTER (WHERE from_state IS NULL)                       AS new_listings_90d,
  max(at) AS latest_at
FROM recent
GROUP BY GROUPING SETS ((county, zip_code), (county), ());

GRANT SELECT ON data_lake.listing_transitions_recent_zip_stats TO service_role;
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply the migration**

Run: `bun scripts/run-migration.ts docs/sql/20260701_listing_transitions_recent_zip_stats.sql`
Expected: `Running docs/sql/20260701_listing_transitions_recent_zip_stats.sql... ✓ done` then
`Migrations complete.`

- [ ] **Step 3: Verify live via the lake MCP (read-only, free — a SELECT, not a paid vendor call)**

Query: `SELECT * FROM pg.data_lake.listing_transitions_recent_zip_stats WHERE zip_code = '33928'`
Expected: one row (or zero if that specific ZIP has no activity — try `33914` or `34112` too; at
least one Lee/Collier ZIP should show non-zero 90d counts given the live 25,616-row `api_feed` set).

- [ ] **Step 4: Commit**

```bash
git add docs/sql/20260701_listing_transitions_recent_zip_stats.sql
git commit -m "feat(lake): listing_transitions_recent_zip_stats view — 30d/90d lifecycle digest"
```

---

### Task 2: Gap 1 — `loadListingContext` reads the lake, not live vendor APIs

**Files:**
- Modify: `lib/listings/select.ts:1-19` (imports), `:202-245` (`loadListingContext`)
- Modify: `lib/listings/rentcast.ts:100-128` (delete `fetchSaleListings` + `RENTCAST_BASE` + the
  `RENTCAST_API_KEY` read; keep `Listing` interface + `normalizeListing` + `str`/`strOrNull`/`numOrNull`)
- Modify: `verification/supabase-untyped-allowlist.json` (add `lib/listings/select.ts`)
- Create: `lib/listings/select.test.ts` (new test file — `listings.test.ts` already covers the pure
  helpers with fixture data; this file covers the impure `loadListingContext` orchestrator)

**Interfaces:**
- Consumes: `Listing` type + `normalizeListing` (unchanged, `./rentcast`); `createServiceRoleClientUntyped`
  (`@/utils/supabase/service-role`).
- Produces: `loadListingContext(scope, today): Promise<ListingContext>` — SAME signature and return
  shape (`{figures: MarketFigure[], ranked: Listing[], city: string}`) as today. `build-week.ts:280`,
  `social/design/author.ts:217`, `build-doc.ts:406` (all existing callers) need NO changes.

- [ ] **Step 1: Write the failing test for the lake-backed loader**

```typescript
// lib/listings/select.test.ts
import { test, expect, mock, afterAll } from "bun:test";

interface FakeRow {
  listing_id: string;
  street_address: string;
  city: string;
  county: string;
  zip_code: string;
  lat: number | null;
  lon: number | null;
  property_type: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lot_acres: number | null;
  status: string;
  list_price: number | null;
  listed_date: string | null;
  last_seen: string | null;
  days_on_market: number | null;
  mls_name: string | null;
  mls_number: string | null;
  photo_url: string | null;
}

function makeChain(rows: FakeRow[]) {
  const chain: Record<string, unknown> = {};
  chain.eq = () => chain;
  chain.limit = () => chain;
  chain.then = (resolve: (r: { data: FakeRow[]; error: null }) => void) =>
    resolve({ data: rows, error: null });
  return chain;
}

let rowsForNextCall: FakeRow[] = [];
const realServiceRole = await import("@/utils/supabase/service-role");
afterAll(() => {
  mock.module("@/utils/supabase/service-role", () => realServiceRole);
});
mock.module("@/utils/supabase/service-role", () => ({
  ...realServiceRole,
  createServiceRoleClientUntyped: () => ({
    schema: () => ({
      from: () => ({
        select: () => makeChain(rowsForNextCall),
      }),
    }),
  }),
}));

const { loadListingContext } = await import("./select");

const SAMPLE_ROW: FakeRow = {
  listing_id: "116:2026016564",
  street_address: "4100 Lakewood Blvd F30",
  city: "Cape Coral",
  county: "Lee",
  zip_code: "33914",
  lat: 26.55,
  lon: -81.98,
  property_type: "Single Family",
  beds: 3,
  baths: 2,
  sqft: 1800,
  lot_acres: 0.23,
  status: "Active",
  list_price: 340000,
  listed_date: "2026-06-01",
  last_seen: "2026-07-01",
  days_on_market: 30,
  mls_name: "Florida Gulf Coast MLS",
  mls_number: "226012345",
  photo_url: "https://rdcpix.example/photo.jpg",
};

test("loadListingContext reads data_lake.listing_state, never calls a live vendor API", async () => {
  rowsForNextCall = [SAMPLE_ROW];
  const ctx = await loadListingContext({ kind: "county", value: "Lee" }, new Date("2026-07-01"));
  expect(ctx.ranked).toHaveLength(1);
  expect(ctx.ranked[0].photoUrl).toBe("https://rdcpix.example/photo.jpg");
  expect(ctx.ranked[0].price).toBe(340000);
  expect(ctx.figures.length).toBeGreaterThan(0);
});

test("loadListingContext degrades to empty context on zero rows — never throws", async () => {
  rowsForNextCall = [];
  const ctx = await loadListingContext({ kind: "county", value: "Hendry" }, new Date("2026-07-01"));
  expect(ctx.ranked).toEqual([]);
  expect(ctx.figures).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/listings/select.test.ts`
Expected: FAIL — `loadListingContext` still calls `fetchSaleListings`/`fetchPhotoListings` (live
`fetch`, not the mocked Supabase client), so the mocked rows never reach it.

- [ ] **Step 3: Rewrite `loadListingContext` to read the lake**

In `lib/listings/select.ts`, replace the import on line 17-18:

```typescript
import { type Listing } from "./rentcast";
import { createServiceRoleClientUntyped } from "@/utils/supabase/service-role";
```

(delete the `fetchSaleListings` and `fetchPhotoListings` imports; `aerial.ts`'s `aerialUrl` import stays.)

Replace `loadListingContext` (currently `select.ts:202-245`) with:

```typescript
interface LakeListingRow {
  listing_id: string | null;
  street_address: string | null;
  city: string | null;
  county: string | null;
  zip_code: string | null;
  lat: number | null;
  lon: number | null;
  property_type: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lot_acres: number | null;
  status: string | null;
  list_price: number | null;
  listed_date: string | null;
  last_seen: string | null;
  days_on_market: number | null;
  mls_name: string | null;
  mls_number: string | null;
  photo_url: string | null;
}

/** Pure: coerce one data_lake.listing_state row into the shared `Listing` shape.
 *  `yearBuilt`/`removedDate` have no lake column — left null rather than invented. */
export function lakeRowToListing(row: LakeListingRow): Listing | null {
  if (!row.listing_id || !row.street_address) return null;
  return {
    id: row.listing_id,
    formattedAddress: row.street_address,
    addressLine1: row.street_address,
    city: row.city ?? "",
    state: "FL",
    zipCode: row.zip_code ?? "",
    county: row.county ?? "",
    latitude: row.lat,
    longitude: row.lon,
    propertyType: row.property_type ?? "",
    bedrooms: row.beds,
    bathrooms: row.baths,
    squareFootage: row.sqft,
    lotSize: row.lot_acres,
    yearBuilt: null,
    status: row.status ?? "Active",
    price: row.list_price,
    listedDate: row.listed_date,
    removedDate: null,
    lastSeenDate: row.last_seen,
    daysOnMarket: row.days_on_market,
    mlsName: row.mls_name,
    mlsNumber: row.mls_number,
    ...(row.photo_url ? { photoUrl: row.photo_url } : {}),
  };
}

const LAKE_LISTING_COLUMNS =
  "listing_id, street_address, city, county, zip_code, lat, lon, property_type, beds, baths, " +
  "sqft, lot_acres, status, list_price, listed_date, last_seen, days_on_market, mls_name, " +
  "mls_number, photo_url";

/** Fetch active for-sale listings for one city straight from the lake (populated daily by
 *  ingest/pipelines/listing_lifecycle — no live vendor call, no per-request cost). Empty-tolerant:
 *  no creds, no rows, any query error → `[]`, never throws (four-lane/ODD contract). */
async function fetchLakeListings(city: string): Promise<Listing[]> {
  if (!city) return [];
  try {
    const db = createServiceRoleClientUntyped();
    const { data } = await db
      .schema("data_lake")
      .from("listing_state")
      .select(LAKE_LISTING_COLUMNS)
      .eq("city", city)
      .eq("state", "active")
      .eq("sale_or_rent", "sale")
      .eq("source_name", "api_feed")
      .limit(500);
    if (!Array.isArray(data)) return [];
    return (data as LakeListingRow[])
      .map(lakeRowToListing)
      .filter((l): l is Listing => l !== null);
  } catch {
    return [];
  }
}

export async function loadListingContext(
  scope: BuildScope | undefined,
  today: Date,
): Promise<ListingContext> {
  const city = scopeCity(scope);
  const listings = await fetchLakeListings(city);
  return {
    figures: listingsToFigures(listings, today, city),
    ranked: rankListings(listings),
    city,
  };
}
```

Delete the old `photoListings`/`rentcastListings` merge block entirely (it's replaced by the single
`fetchLakeListings` call — the lake row already carries `photo_url` merged in by the ingest pipeline,
so there's no longer a separate photo-source merge to do at request time).

- [ ] **Step 4: Add the `KNOWN-DEBT` comment + allowlist entry**

In `lib/listings/select.ts`, above the `createServiceRoleClientUntyped` import, add:

```typescript
// KNOWN-DEBT(data_lake: listing_state lives in the data_lake schema, which the typed
// Supabase client intentionally does not cover — see utils/supabase/service-role.ts):
```

In `verification/supabase-untyped-allowlist.json`, add `"lib/listings/select.ts"` to the array
(alphabetical order, between `"lib/email/usage.ts"` and `"lib/zip-summary/load.ts"`).

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test lib/listings/select.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Run the existing pure-helper tests to confirm no regression**

Run: `bun test lib/listings/listings.test.ts`
Expected: PASS — unchanged, since `rankListings`/`pickFeatured`/`listingsToFigures`/
`attachFeaturedAerial` are untouched.

- [ ] **Step 7: Delete the dead RentCast live-fetch code**

In `lib/listings/rentcast.ts`, delete `fetchSaleListings` (the whole function, lines ~100-128) and the
`RENTCAST_BASE` constant (line 17). Keep `Listing`, `normalizeListing`, `str`/`strOrNull`/`numOrNull`.

- [ ] **Step 8: Run the full lib/listings suite + lint**

Run: `bun test lib/listings/`
Expected: PASS, all files.
Run: `bunx eslint lib/listings/select.ts lib/listings/rentcast.ts --max-warnings=0`
Expected: clean (no new `no-restricted-imports` violation, since the allowlist entry was added).

- [ ] **Step 9: Commit**

```bash
git add lib/listings/select.ts lib/listings/select.test.ts lib/listings/rentcast.ts \
  verification/supabase-untyped-allowlist.json
git commit -m "refactor(listings): loadListingContext reads data_lake.listing_state, kills live RentCast/SteadyAPI calls in the request path"
```

---

### Task 3: Gap 2 — `loadLifecycleDigest` loader, wired into `fetchLakeParts`

**Files:**
- Modify: `lib/email/market-context.ts` (add `loadLifecycleDigest`)
- 🔴 Modify: `lib/email/build-doc.ts:87-95` (`fetchLakeParts` folds in the digest)
- Create: `lib/email/market-context.test.ts` (first test file for this module)

**Interfaces:**
- Consumes: `data_lake.listing_transitions_recent_zip_stats` (Task 1).
- Produces: `loadLifecycleDigest(scope): Promise<MarketFigure | null>`; `fetchLakeParts` return type
  gains the digest folded into its existing `figures: MarketFigure[]` array (no shape change to
  `FreshLakeContext`/`BuildResult` — it's just one more figure, same as any other).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/email/market-context.test.ts
import { test, expect, mock, afterAll } from "bun:test";

interface FakeStatsRow {
  price_cuts_30d: number;
  price_raises_30d: number;
  new_holdings_30d: number;
  sales_30d: number;
  new_listings_30d: number;
  price_cuts_90d: number;
  price_raises_90d: number;
  new_holdings_90d: number;
  sales_90d: number;
  new_listings_90d: number;
  latest_at: string;
}

function makeChain(row: FakeStatsRow | null) {
  const chain: Record<string, unknown> = {};
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.maybeSingle = async () => ({ data: row, error: null });
  return chain;
}

let rowForNextCall: FakeStatsRow | null = null;
const realServiceRole = await import("@/utils/supabase/service-role");
afterAll(() => {
  mock.module("@/utils/supabase/service-role", () => realServiceRole);
});
mock.module("@/utils/supabase/service-role", () => ({
  ...realServiceRole,
  createServiceRoleClientUntyped: () => ({
    schema: () => ({ from: () => ({ select: () => makeChain(rowForNextCall) }) }),
  }),
}));

const { loadLifecycleDigest } = await import("./market-context");

test("loadLifecycleDigest prefers the 30-day window when it has signal", async () => {
  rowForNextCall = {
    price_cuts_30d: 4, price_raises_30d: 0, new_holdings_30d: 12, sales_30d: 1, new_listings_30d: 6,
    price_cuts_90d: 10, price_raises_90d: 1, new_holdings_90d: 30, sales_90d: 3, new_listings_90d: 15,
    latest_at: "2026-07-01",
  };
  const fig = await loadLifecycleDigest({ kind: "zip", value: "33928" });
  expect(fig?.value).toContain("4 price cuts");
  expect(fig?.label).toContain("last 30 days");
});

test("loadLifecycleDigest falls back to the 90-day window when 30d is all zero", async () => {
  rowForNextCall = {
    price_cuts_30d: 0, price_raises_30d: 0, new_holdings_30d: 0, sales_30d: 0, new_listings_30d: 0,
    price_cuts_90d: 2, price_raises_90d: 0, new_holdings_90d: 5, sales_90d: 1, new_listings_90d: 3,
    latest_at: "2026-07-01",
  };
  const fig = await loadLifecycleDigest({ kind: "zip", value: "33928" });
  expect(fig?.value).toContain("2 price cuts");
  expect(fig?.label).toContain("last 90 days");
});

test("loadLifecycleDigest returns null when both windows are all-zero", async () => {
  rowForNextCall = {
    price_cuts_30d: 0, price_raises_30d: 0, new_holdings_30d: 0, sales_30d: 0, new_listings_30d: 0,
    price_cuts_90d: 0, price_raises_90d: 0, new_holdings_90d: 0, sales_90d: 0, new_listings_90d: 0,
    latest_at: "2026-07-01",
  };
  expect(await loadLifecycleDigest({ kind: "zip", value: "33928" })).toBeNull();
});

test("loadLifecycleDigest returns null on no row (out-of-scope county, e.g. Hendry)", async () => {
  rowForNextCall = null;
  expect(await loadLifecycleDigest({ kind: "county", value: "Hendry" })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/email/market-context.test.ts`
Expected: FAIL — `loadLifecycleDigest` is not exported yet.

- [ ] **Step 3: Implement `loadLifecycleDigest` in `lib/email/market-context.ts`**

Add near the bottom of the file, after `countyFigures`:

```typescript
interface LifecycleStatsRow {
  price_cuts_30d: number | null;
  price_raises_30d: number | null;
  new_holdings_30d: number | null;
  sales_30d: number | null;
  new_listings_30d: number | null;
  price_cuts_90d: number | null;
  price_raises_90d: number | null;
  new_holdings_90d: number | null;
  sales_90d: number | null;
  new_listings_90d: number | null;
  latest_at: string | null;
}

function digestValue(
  cuts: number, raises: number, holdings: number, sales: number, listings: number,
): string | null {
  const parts: string[] = [];
  if (cuts) parts.push(`${cuts} price cut${cuts === 1 ? "" : "s"}`);
  if (raises) parts.push(`${raises} price raise${raises === 1 ? "" : "s"}`);
  if (holdings) parts.push(`${holdings} pulled to holding`);
  if (sales) parts.push(`${sales} sale${sales === 1 ? "" : "s"}`);
  if (listings) parts.push(`${listings} new listing${listings === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : null;
}

/** Real-estate lifecycle activity (price cuts / holdings / sales / new listings), adaptive-window:
 *  prefers the last 30 days, falls back to 90 if a slower-moving scope shows no 30-day signal, and
 *  returns null (no figure) if BOTH windows are empty — never forces an empty-looking line. */
export async function loadLifecycleDigest(scope?: {
  kind?: string;
  value?: string;
}): Promise<MarketFigure | null> {
  if (!scope?.value) return null;
  let db: Db;
  try {
    db = createServiceRoleClientUntyped();
  } catch {
    return null;
  }
  try {
    let q = db
      .schema("data_lake")
      .from("listing_transitions_recent_zip_stats")
      .select(
        "price_cuts_30d, price_raises_30d, new_holdings_30d, sales_30d, new_listings_30d, " +
          "price_cuts_90d, price_raises_90d, new_holdings_90d, sales_90d, new_listings_90d, latest_at",
      );
    q =
      scope.kind === "zip"
        ? q.eq("zip_code", scope.value)
        : q.eq("county", scope.value.replace(/\s*County$/i, "").trim()).is("zip_code", null);
    const { data } = await q.maybeSingle();
    const row = data as LifecycleStatsRow | null;
    if (!row) return null;

    const v30 = digestValue(
      row.price_cuts_30d ?? 0, row.price_raises_30d ?? 0, row.new_holdings_30d ?? 0,
      row.sales_30d ?? 0, row.new_listings_30d ?? 0,
    );
    const v90 = digestValue(
      row.price_cuts_90d ?? 0, row.price_raises_90d ?? 0, row.new_holdings_90d ?? 0,
      row.sales_90d ?? 0, row.new_listings_90d ?? 0,
    );
    const value = v30 ?? v90;
    if (!value) return null;
    const windowDays = v30 ? 30 : 90;
    const asOf = mdY(row.latest_at) ?? mdY(new Date().toISOString());

    return {
      key: "lifecycle_digest",
      label: `Lifecycle activity — ${scope.value} (last ${windowDays} days)`,
      value,
      source: "SWFL Data Gulf",
      as_of: asOf,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/email/market-context.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Wire into `fetchLakeParts`**

In `lib/email/build-doc.ts`, add the import (near the existing `loadMarketFigures` import on line 22):

```typescript
import {
  loadMarketFigures,
  loadLifecycleDigest,
  figuresToPromptBlock,
  type MarketFigure,
} from "@/lib/email/market-context";
```

Replace `fetchLakeParts` (currently lines 87-95):

```typescript
export async function fetchLakeParts(
  scope?: BuildScope,
): Promise<{ figures: MarketFigure[]; dossier: string }> {
  const [marketFigures, lifecycleFigure, dossier] = await Promise.all([
    loadMarketFigures(scope).catch(() => []),
    loadLifecycleDigest(scope).catch(() => null),
    fetchMasterDossier(scope).catch(() => ""),
  ]);
  const figures = lifecycleFigure ? [...marketFigures, lifecycleFigure] : marketFigures;
  return { figures, dossier };
}
```

- [ ] **Step 6: Run the build-doc test suite to confirm no regression**

Run: `bun test lib/email/build-doc.test.ts lib/email/build-doc-listing.test.ts`
Expected: PASS — `fetchLakeParts`'s return shape is unchanged (still `{figures, dossier}`), so nothing
downstream needed a change.

- [ ] **Step 7: Commit**

```bash
git add lib/email/market-context.ts lib/email/market-context.test.ts lib/email/build-doc.ts
git commit -m "feat(email): lifecycle-event digest folded into the shared lake spine (fetchLakeParts)"
```

---

### Task 4: Gap 4 — `schedule_suggestion` on the author tool

**Files:**
- Modify: `lib/email/doc/schema.ts:393-395` (`AuthorDocSchema`)
- Modify: `lib/email/author-doc.ts:66-202` (`AUTHOR_TOOL.input_schema`, `authorSystem`)
- 🔴 Modify: `lib/email/build-doc.ts:700-711` (`authorDoc` payload)
- Modify: `lib/email/author-doc.test.ts` (add coverage)

**Interfaces:**
- Produces: `AuthoredDoc.schedule_suggestion?: { cadence: "weekly" | "monthly"; reason: string }`;
  `authorDoc()`'s returned payload gains `scheduleSuggestion: { cadence, reason } | null`.

- [ ] **Step 1: Write the failing test**

Add to `lib/email/author-doc.test.ts`:

```typescript
test("AuthorDocSchema accepts an optional schedule_suggestion", () => {
  const parsed = AuthorDocSchema.safeParse({
    blocks: [{ type: "footer" }],
    schedule_suggestion: { cadence: "weekly", reason: "Reads like a recurring market update." },
  });
  expect(parsed.success).toBe(true);
});

test("AUTHOR_TOOL.input_schema declares schedule_suggestion as optional (not in required)", () => {
  expect(AUTHOR_TOOL.input_schema.required).toEqual(["blocks"]);
  expect(AUTHOR_TOOL.input_schema.properties).toHaveProperty("schedule_suggestion");
});
```

(Add `AuthorDocSchema` to the test file's existing import from `./doc/schema` if not already imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/email/author-doc.test.ts`
Expected: FAIL — `schedule_suggestion` not yet a recognized key (strip mode drops it, so `parsed.success`
is `true` but the field is silently absent — check by asserting
`parsed.success && parsed.data.schedule_suggestion !== undefined` to catch the strip; either way the
second test FAILs since `AUTHOR_TOOL.input_schema.properties` has no such key yet).

- [ ] **Step 3: Add the field to `AuthorDocSchema`**

In `lib/email/doc/schema.ts`, replace lines 393-395:

```typescript
export const ScheduleSuggestionSchema = z.object({
  cadence: z.enum(["weekly", "monthly"]),
  reason: z.string().max(200),
});

export const AuthorDocSchema = z.object({
  blocks: z.array(AuthoredBlockSchema).min(1).max(20),
  schedule_suggestion: ScheduleSuggestionSchema.optional(),
});
```

- [ ] **Step 4: Add the field to `AUTHOR_TOOL.input_schema`**

In `lib/email/author-doc.ts`, inside `AUTHOR_TOOL.input_schema.properties` (after the `blocks` property,
before the closing brace at line 163), add:

```typescript
      schedule_suggestion: {
        type: "object",
        additionalProperties: false,
        description:
          "OPTIONAL. Only if this content reads like a recurring digest (a weekly/monthly market " +
          "update, not a one-off announcement) — suggest a send cadence. Omit for a one-off email.",
        properties: {
          cadence: { type: "string", enum: ["weekly", "monthly"] },
          reason: { type: "string", description: "One sentence: why this cadence fits." },
        },
        required: ["cadence", "reason"],
      },
```

(`required` at the top level, line 165, stays `["blocks"]` — `schedule_suggestion` is not required.)

- [ ] **Step 5: Add the line to `authorSystem()`**

In `lib/email/author-doc.ts`, in `authorSystem()` (currently lines 171-202), add one entry to the
`parts` array, after the `DATA MENU` line and before the `dossier` block:

```typescript
    "SCHEDULING — if this content reads like a recurring digest (a weekly/monthly market update, not " +
      "a one-off), you MAY optionally set schedule_suggestion (cadence + a one-sentence reason). Omit " +
      "it for a one-off email.",
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test lib/email/author-doc.test.ts`
Expected: PASS (both new tests, plus all existing tests in the file unchanged).

- [ ] **Step 7: Pass `schedule_suggestion` through `authorDoc()`'s payload**

In `lib/email/build-doc.ts`, in the final `return` of `authorDoc()` (currently lines 700-711), add one
field:

```typescript
  return {
    payload: {
      doc: finalDoc,
      applied: true,
      authored: true,
      chart: Boolean(chartRes),
      chartNote: chartRes?.note,
      photo: Boolean(photoRes),
      regenerations,
      stripped,
      scheduleSuggestion: authored.schedule_suggestion ?? null,
    },
  };
```

Note: this reads `authored` (the FIRST successful parse), not `authored2` from the lint-retry branch —
`schedule_suggestion` is untouched by the prose lint (it's not a prose field), so the first draft's
value is the correct one to surface even if prose regenerated. If the lint-retry path fully replaces
`doc` from `reparse2.data`, `authored`'s `schedule_suggestion` is still the value that was actually
authored for this response and stays valid.

- [ ] **Step 8: Run the build-doc suite to confirm no regression**

Run: `bun test lib/email/build-doc.test.ts lib/email/author-doc.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/email/doc/schema.ts lib/email/author-doc.ts lib/email/author-doc.test.ts lib/email/build-doc.ts
git commit -m "feat(email): schedule_suggestion — the author tool may suggest a send cadence for recurring digests"
```

---

### Task 5: Full verification + session close-out

**Files:**
- Modify: `_AUDIT_AND_ROADMAP/build-queue.md`, `SESSION_LOG.md`

- [ ] **Step 1: Full offline verification**

Run: `bunx next build`
Expected: clean build, no type errors.

Run: `bun test`
Expected: full suite green (or same pre-existing red count as before this build — check
`git stash` + rerun if anything looks new-red).

Run: `bunx eslint . --max-warnings=0` (or the project's scoped lint command if `.` is too broad —
check `package.json` `"lint"` script first)
Expected: clean.

- [ ] **Step 2: Live-verify checklist for the operator (do NOT run these yourself — paid/prod, operator-run per feedback_no-live-paid-api-calls-without-approval)**

Write this checklist into the SESSION_LOG entry (Step 4), don't execute it:
- Build an email in `/email-lab` for a Lee/Collier ZIP scope → confirm the featured listing shows a
  real MLS photo (not the Mapbox aerial fallback), sourced with zero live vendor calls in the request
  (check server logs / network tab for `api.rentcast.io` or `steadyapi` calls during the build — there
  should be none).
- Confirm the lifecycle digest line appears for an active ZIP and cites "SWFL Data Gulf" + a real
  as-of date.
- Confirm a weekly-market-update-style author build surfaces `scheduleSuggestion` in the API response
  (network tab — no UI surface yet, per the Gap 4 scope trim).
- Close check `email_social_lake_wiring_live_verify` on this live evidence, not on "code looks right"
  (per `feedback_checks-prod-evidence-not-dev-attestation`).

- [ ] **Step 3: Update the build queue**

Read `_AUDIT_AND_ROADMAP/build-queue.md`, add/update the entry for this build to reflect: SQL view +
loader + Gap 1/2/4 code shipped, `email_social_lake_wiring_live_verify` open pending operator live-verify,
Gap 4's UI prefill wiring flagged as a fast-follow (not in this build).

- [ ] **Step 4: SESSION_LOG entry**

Append a new top-of-file entry to `SESSION_LOG.md` summarizing: killed the live RentCast/SteadyAPI
calls in the listing lab (RentCast was already dead — no key configured), wired listing photos from
`data_lake.listing_state` instead; added the `listing_transitions_recent_zip_stats` view + adaptive
30d/90d lifecycle digest; added optional `schedule_suggestion` to the author tool. Link the spec
(`docs/superpowers/specs/2026-07-01-email-social-lake-wiring-design.md`) and this plan. Note the open
check and the Gap 4 UI fast-follow.

- [ ] **Step 5: Commit the SESSION_LOG + build-queue update**

```bash
git add SESSION_LOG.md _AUDIT_AND_ROADMAP/build-queue.md
git commit -m "log(email-social-lake-wiring): session log + build queue — before push"
```

- [ ] **Step 6: STOP — do not push**

Per `feedback_no-autonomous-push`: show the commit log, ask before `node scripts/safe-push.mjs`.

---

## Parallel Safety

> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.

| Group | Tasks | Shared Files |
|-------|-------|--------------|
| 🔴 | Task 3, Task 4 | `lib/email/build-doc.ts` |

Tasks with no color badge have no file conflicts — safe to parallelize freely.
