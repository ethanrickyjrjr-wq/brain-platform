# Data Coverage

_Last updated 2026-05-25. This file documents WHERE we have data and WHERE we
don't — by domain, by geography, by brain. Read this before assuming a metric
is unavailable in the platform; sometimes "no data" is a permanent gap, sometimes
it's a one-pack-away fix._

## permits-swfl — Lee County only

`refinery/packs/permits-swfl.mts` ingests building permits from Lee County's
Accela Citizen Access portal. It does NOT cover Collier County. Consequence:

- The per-corridor sidecar `fixtures/corridor-permits.json` only contains
  rows for Lee corridors.
- The render-time alias table at `refinery/lib/corridor-aliases.mts` maps
  all 10 Collier corridors to `null` — an explicit "no permits coverage"
  signal that propagates through `JoinedCorridorRow.permits`.
- Embed charts render the gap deliberately: the scatter chart excludes
  Collier rows from its dataset; the rent chart's side-panel shows an
  amber "No permits coverage" badge with a link back to this doc.

**Fix**: a Collier permits pack (parallel structure to permits-swfl, separate
Accela portal or county GIS feed). Not scheduled. The 10 Collier corridors
have permanent null permit fields until that pack ships.

**Affected corridors (Collier)**:

- 5th-ave-south-3rd-street-south
- collier-blvd-cr-951
- davis-blvd-east-naples
- immokalee-rd-north-naples
- naples-airport-pulling-north
- naples-airport-pulling-south
- pine-ridge-rd-naples
- us-41-tamiami-trail-naples
- vanderbilt-beach-rd-mercato
- waterside-shops

## permits-swfl — Accela ingest currently broken (2026-05-24 → ongoing)

Even within Lee County, the live Accela ingest has returned 0 rows on
2026-05-24 and 2026-05-25. `brains/permits-swfl.md` remains at v3 with a
TODO at the top noting the dependency. The Stage 4 sidecar code is in
place: a single clean Accela run will atomically produce both the v4 brain
and `fixtures/corridor-permits.json`. Until then, the embed scatter shows
0 plotted dots even for Lee — same null treatment as Collier.

**Fix**: investigate Firecrawl / dlt scrape against Accela; this is upstream
of the corridor pipeline PR and out of its scope.

## cre-swfl — full SWFL coverage

26 corridors across Lee + Collier. Rent, vacancy, and absorption are sourced
from `corridor_profiles` in Supabase. Regenerated to `fixtures/corridor-rents.json`
via `npm run fixtures:corridors`.

Two of 26 corridors (large-format centers) have null `absorption_sqft` —
real data gaps, awaiting a broker contact or CoStar feed.

## Centroid lookup — Lee only (hand-authored)

`fixtures/corridor-centroids.json` carries 16 Lee corridor centroids,
hand-authored from SWFL geographic knowledge. Two pairs survived as-is
from the original 4-row sample (us-41-cleveland-ave-fort-myers from the
old us-41-fort-myers centroid; daniels-pkwy-i-75-to-ben-hill-griffin from
the old daniels-pkwy); the other 14 are new and flagged for county-GIS
verification before relying on precise per-corridor permit assignment.

Collier centroids are not authored. The same Collier permits pack that
unblocks permits will require Collier centroids as a prerequisite.
