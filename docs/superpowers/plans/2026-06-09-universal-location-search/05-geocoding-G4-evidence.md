# §E / G4 evidence — real geocode JSON field paths

**Recorded 2026-06-10, in-session, against the LIVE HTTP endpoints (not docs, not memory).**
Per `05-geocoding.md` G4 this note exists BEFORE `lib/geocode.ts` was written. Runtime code
calls these HTTP APIs, so the live response shape is the source of truth.

## 0. Token restriction — the gotcha that 403'd the first call

`MAPBOX_TOKEN` in `.env.local` is a **public (`pk.`) token, URL-restricted to
`https://www.swfldatagulf.com/`**. Proof:

| Request                                  | HTTP |
| ---------------------------------------- | ---- |
| no Referer (plain server curl)           | 403 `{"message":"Forbidden"}` |
| `Referer: https://www.swfldatagulf.com/` | 200  |
| `Referer: http://localhost:3000/`        | 403  |

Token owner `stanicky`. **Consequence locked into the code:** `lib/geocode.ts` MUST send
`Referer: https://www.swfldatagulf.com/` on every Mapbox call. A server-side `fetch` sends no
Referer by default, so without this header the live `/api/where` on Vercel 403s. No token
change requested — the restriction stays (it keeps the token unusable from any other origin).

## 1. Mapbox v6 forward — primary

`GET https://api.mapbox.com/search/geocode/v6/forward?q=<addr>&country=us&limit=1&access_token=<tok>`
header `Referer: https://www.swfldatagulf.com/`

Verified `q = "16448 Rainbow Meadows Ct, Fort Myers FL"` → ZIP **33908** (acceptance target).

| Datum       | Field path (`features[0].`)                | Example value |
| ----------- | ------------------------------------------ | ------------- |
| lat         | `properties.coordinates.latitude`          | `26.505664`   |
| lon         | `properties.coordinates.longitude`         | `-81.906633`  |
| **ZIP**     | `properties.context.postcode.name`         | `"33908"`     |
| place       | `properties.context.place.name`            | `"Fort Myers"`|
| region code | `properties.context.region.region_code`    | `"FL"`        |
| county      | `properties.context.district.name`         | `"Lee County"`|
| confidence  | `properties.match_code.confidence`         | `"high"` (enum: exact/high/medium/low) |
| feature kind| `properties.feature_type`                  | `"address"`   |

**TRAP 1 — coordinates:** use `properties.coordinates.{latitude,longitude}` (explicit keys),
NOT `geometry.coordinates`, which is GeoJSON `[lon, lat]` order (swap-bug bait).
**TRAP 2 — ZIP:** read `context.postcode.name`, NOT `match_code.postcode`. For the acceptance
address `match_code.postcode` was `"unmatched"` (input carried no ZIP) yet `context.postcode`
still resolved `33908`. `match_code` is "did the INPUT token match", not "is there a ZIP".

## 2. Mapbox v6 reverse — locality fall-through (no postcode on forward)

A **locality-level** forward hit returns lat/lon but **no postcode and no match_code**:
`q = "Pelican Bay, Naples FL"` → `feature_type: "locality"`, `context.postcode = null`,
`match_code = null`, coords `26.230694, -81.80497`. So forward alone can't give the ZIP.

Reverse the coords with `types=postcode`:
`GET https://api.mapbox.com/search/geocode/v6/reverse?longitude=<lon>&latitude=<lat>&types=postcode&access_token=<tok>`
header `Referer: https://www.swfldatagulf.com/`

→ 1 feature, `features[0].properties.name = "34108"` (Pelican Bay's real Naples ZIP).
ZIP path for a reverse `types=postcode` result: `properties.name` (also `context.postcode.name`).

**Design rule baked into `geocodeAddress`:** forward first; if `context.postcode.name` is null
but coords are finite, reverse-geocode `types=postcode` to fill the ZIP. The dispatcher then
runs `resolveZip(zip)` as the in-scope gate (only SWFL ZIPs survive).

## 3. Census single-line — the one approved fallback

`GET https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=<addr>&benchmark=Public_AR_Current&format=json`
No key, no Referer. Verified same address → ZIP **33908**.

| Datum | Field path (`result.addressMatches[0].`)   | Example       |
| ----- | ------------------------------------------ | ------------- |
| lon   | `coordinates.x`                            | `-81.907022`  |
| lat   | `coordinates.y`                            | `26.504635`   |
| ZIP   | `addressComponents.zip`                    | `"33908"`     |
| city  | `addressComponents.city`                   | `"FORT MYERS"`|
| state | `addressComponents.state`                  | `"FL"`        |

**TRAP 3 — Census axis order:** `x` = longitude, `y` = latitude (opposite of how lat/lon read
left-to-right). No confidence field — assign a fixed lower confidence to mark it as fallback.
