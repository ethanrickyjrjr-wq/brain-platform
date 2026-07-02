# Email Lab AI + Social AI — lake wiring (photos, lifecycle digest, schedule awareness)

Design doc. Follows `_ASSISTANT/research/2026-07-01-email-social-ai-pipeline-report.md` (read-only audit)
and a same-day plan-review pass that corrected two of its gaps against live code + a live lake query.

## Scope

Three independent pieces, one shared spine (`fetchLakeParts`, `lib/email/build-doc.ts:87-95`):

1. **Gap 1 — listing photos from the lake, not a live vendor call.**
2. **Gap 2 — a lifecycle-event digest (price cuts / holdings / sales) surfaced to both AIs.**
3. **Gap 4 — light-touch schedule-suggestion awareness in the author tool.**

Out of scope (unchanged from the original report): Gap 3 (user-uploaded photos), Gap 5 (social publish
go-live flag), the RentCast client (dead — no key configured, superseded by SteadyAPI; see
`feedback_no-rentcast-dont-relitigate` memory — do not re-look-up or re-wire it).

## Gap 1 — listing photos

**Problem confirmed live:** `loadListingContext` (`lib/listings/select.ts:202-245`) calls two vendor
APIs live, per Email/Social Lab build request — `fetchSaleListings` (RentCast, dead: no
`RENTCAST_API_KEY` in repo secrets, silently returns `[]`) and `fetchPhotoListings` (SteadyAPI,
`PHOTOS_API`, live and working). Meanwhile the ingest pipeline (`ingest/pipelines/listing_lifecycle`,
Python, its own SteadyAPI client `extract_api.py`) already runs on a daily cron and writes the same kind
of row — including `photo_url`, `zip_code`, `county`, `list_price`, `days_on_market` (confirmed via
`information_schema.columns` on `data_lake.listing_state`) — into the lake. The lab has never been
pointed at it.

**Design:** `loadListingContext` stops calling live vendor APIs. It queries `data_lake.listing_state`
(`source_name = 'api_feed'`, `state = 'active'`, `sale_or_rent = 'sale'`) scoped by
county/zip → city the same way `scopeCity` already resolves it, via the SAME untyped service-role
hatch `lib/email/market-context.ts` uses (`createServiceRoleClientUntyped`, already allowlisted in
`verification/supabase-untyped-allowlist.json` — add `lib/listings/select.ts` there with its own
`KNOWN-DEBT` comment). Every pure downstream helper (`rankListings`, `pickFeatured`, `listingsToFigures`,
`renderListingsBlock`, `attachFeaturedAerial`) is unchanged — only the fetch layer changes, from two
HTTP calls to one Postgres read.

`lib/listings/rentcast.ts`'s live fetch (`fetchSaleListings`, the `RENTCAST_BASE` HTTP call) is deleted —
but its `Listing` type + `normalizeListing` coercion helper stay: `lib/listings/listings.test.ts` imports
both to build fixtures for the pure helpers (`rankListings`, `pickFeatured`, etc.), and `Listing` is the
shared shape used across `select.ts`/`build-week.ts`/`social/design/author.ts`. `lib/listings/steadyapi.ts`
is NOT touched at all — `lib/assistant/comp-helper.ts` (the separate, already-specced SteadyAPI Phase 2B
comp-helper feature) calls `fetchPhotoListings` live for a different reason (per-conversation freshness on
an explicit user ask, not a daily digest); killing that import would break a different in-flight feature.
`select.ts` simply stops calling `fetchSaleListings`/`fetchPhotoListings` itself and reads the lake instead.

**Degrade path:** county/ZIP outside the seeded scope (Hendry still sits on stale `lifecycle_seed`,
not `api_feed`) → empty rows → `ListingContext.figures`/`.ranked` come back empty → same no-photo,
no-listings-block behavior the labs already have today. Never throws, never invents.

## Gap 2 — lifecycle digest

**Schema, confirmed live (not assumed):** `data_lake.listing_transitions` has
`address_key, sale_or_rent, from_state, to_state, at, price, price_delta, seed, sold_price, sold_date`
(no geography column) and needs a join to `data_lake.listing_state` (`zip_code`, `county`) on
`address_key + sale_or_rent`. State vocabulary (from `ingest/pipelines/listing_lifecycle/transitions.py`):
live states `active/new/coming_soon/back_on_market`; a departure from any live state → `holding`
(cause unknown); a later probe resolves `holding` → `sold` (with `sold_price`/`sold_date`) or
`withdrawn`. A same-state transition with a non-null `price_delta` is a cut (`< 0`) or raise (`> 0`).
`from_state IS NULL` is a brand-new listing.

**New view** `data_lake.listing_transitions_recent_zip_stats`, mirroring the `GROUPING SETS`
region/county/zip pattern of `active_listings_residential_zip_stats`. Computes BOTH a 30-day and a
90-day window in one pass (adaptive-window requirement — most SWFL ZIPs move on a monthly cadence, and
a 7-day window would read as a false "nothing happening" on a quiet ZIP):

```sql
CREATE OR REPLACE VIEW data_lake.listing_transitions_recent_zip_stats AS
WITH recent AS (
  SELECT t.*, s.zip_code, s.county
  FROM data_lake.listing_transitions t
  JOIN data_lake.listing_state s USING (address_key, sale_or_rent)
  WHERE t.source_name = 'api_feed' AND t.seed = false
    AND t.at >= current_date - interval '90 days'
)
SELECT
  county, zip_code,
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

`seed = false` drops the 10,459-row historical backfill so counts reflect real activity, not the
one-time seed dump.

**New loader** `loadLifecycleDigest(scope)` beside `loadMarketFigures` in `lib/email/market-context.ts`
(same file, same untyped hatch it already uses — no new allowlist entry needed). Reads the one row for
the scope's zip/county. Picks the 30-day counts if their sum is non-zero; else the 90-day counts (and
says "in the last 90 days" instead of 30 — an honest wider window, not smoothing); if BOTH are all-zero,
returns no figure for this scope at all (never forces an empty-looking line). Returns a `MarketFigure`
(same shape everything else in this file returns) so it folds into `fetchLakeParts` (`build-doc.ts:87-95`)
alongside `loadMarketFigures` + `fetchMasterDossier` with zero per-surface duplication — both the Email
Lab and the social calendar pick it up through the one shared spine automatically.

Example figure: `label: "Lifecycle activity — 33928 (last 30 days)"`,
`value: "4 price cuts, 12 pulled to holding, 1 sale, 6 new listings"`, `source: "SWFL Data Gulf"`,
`as_of: <today, MM/DD/YYYY>`.

## Gap 4 — schedule-suggestion awareness

`propose_email_schedule_action` (`lib/email/schedule-command.ts:33-105`) already ships `strict: true` +
`input_examples` (commit `82a05fa4`, today) — that part of the original report's ask is DONE, not new
work. What's still open: the author path (`lib/email/author-doc.ts`) has zero schedule awareness
(grep-confirmed).

Add one optional field to `AUTHOR_TOOL`'s existing `input_schema` — no new tool, `tool_choice:
{type:"tool", name: AUTHOR_TOOL.name}` untouched:

```
schedule_suggestion?: { cadence: "weekly" | "monthly"; reason: string }
```

One line added to `authorSystem()`: "If this content reads like a recurring digest (a weekly/monthly
market update, not a one-off), you MAY optionally include `schedule_suggestion` with a cadence and a
one-sentence reason; omit it otherwise." The API route (`app/api/email-lab/ai/route.ts`) passes it
through in the response payload untouched.

**Scope trim (this build):** the backend contract ends there — `schedule_suggestion` reaches the
client in the build response. Wiring it into `ScheduleSendModal`'s one-click prefill means threading a
cadence override through `SendWeeklyHandle` (`app/p/[id]/SendWeeklyHandle.tsx`, not yet read/scoped
this session) and `EmailLabShell`'s modal-open state — a real UI task, not a one-liner, and independent
of the backend contract. Flagged as a fast-follow rather than guessed at here; the backend field is
useless to no one in the meantime (a client can read `applied.scheduleSuggestion` off the build
response today via the network tab / a follow-up small PR, same as `chart`/`photo` booleans already
are).

## Testing

- Gap 1: unit tests on `loadListingContext` — inject/mock the service-role client the same way any
  future `market-context.ts` test would need to (the file has no existing client-mocking test today;
  this build adds the first one, factored so `loadLifecycleDigest` in Gap 2 reuses the same seam).
  Confirms it never imports `fetch`-based vendor clients and returns figures/ranked from a rows fixture;
  confirms empty rows → empty context, no throw.
- Gap 2: unit tests for `loadLifecycleDigest`'s window-selection logic (30d wins / falls back to 90d /
  both-zero → undefined) against fixture rows; a live post-migration check that the view returns
  non-zero rows for at least one known-active SWFL zip.
- Gap 4: schema test that `input_examples` still validates against `AUTHOR_TOOL.input_schema` with the
  new optional field present; a snapshot that `schedule_suggestion` survives `AuthorDocSchema` parsing
  and reaches the response payload untouched by the no-invention prose lint (it's structured metadata,
  not prose the anchor-number lint should touch).

## Process notes

- Migration applied via `Bun.SQL` (psql not installed), idempotent `CREATE OR REPLACE VIEW`.
- `bun run gen:types` does NOT need to run for the new view — `data_lake` schema is intentionally
  untyped (`utils/supabase/service-role.ts:41-47`); the loader uses the same untyped hatch pattern
  already established in this file.
- Pre-push gates in play: lockfile (none expected, no new deps), ingest Gate 4 (view is additive
  `CREATE OR REPLACE`, no destructive replace on ingest tables), pack/catalog Gate 5 (not touched — no
  pack files change).
