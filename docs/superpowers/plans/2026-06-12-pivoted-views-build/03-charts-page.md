# §03 — `/charts` page

**Model:** Sonnet (follows a proven sibling pattern; small, well-bounded; display-only)
**Gate:** §02 (display view `zhvi_pivoted` live). **Parallel with:** §04, §06-DDL, §07. **Blocks:** nothing.

## Why

A public page that renders the ZHVI trend directly from the authoritative view — so the chart and the brain can never silently disagree on the number. This is flywheel-neutral (a consistency/UX win), so keep it simple and do not let it block the spine.

## Build

- **Route:** `app/charts/page.tsx` — a **Server Component**, public, **no `"use client"`**.
- **Pattern to copy:** `app/embed/charts/page.tsx` — it already imports `createServiceRoleClient` from `@/utils/supabase/service-role`, sets `export const revalidate = 3600`, and renders `<ZHVIAreaChart>` from `@/components/viz`. Mirror it.
- **Data path:** server-side `createServiceRoleClient().from('zhvi_pivoted').select(...)` (schema `data_lake` — match how the sibling reaches lake views). **No client-side PostgREST fetch** (that would need an `anon` grant; we granted `service_role` only — R2-class 404).
- **Map** rows → `ZHVITrendEntry[]` (column names already match `month`/`cape_coral`/`fort_myers`/`naples`; confirm the type in `@/types/viz`). `asOf` = latest `month`.
- **Pass** to the existing `<ZHVIAreaChart>` — no component changes.

## Guardrails

- **Pagination:** the display view is ~24 rows, so a single `.select()` is safe. (If you ever point `/charts` at a long ZIP×month view instead, you MUST use `selectAllPaged` from `refinery/lib/paginate.mts` — a bare `.select()` silently caps at 1000 rows. Don't.)
- Do not re-derive any number client-side. The view is the source.

## Verification

- Page renders at `/charts`; the area chart shows Cape Coral / Fort Myers / Naples through the latest month.
- **No silent truncation:** rows rendered == rows returned by the view.
- Numbers visually match the brain's current `key_metrics` for those cities (display sanity only — the *graded* parity is §04's machine diff, not this).
- `tsc` + lint clean; no `"use client"` crept in.
