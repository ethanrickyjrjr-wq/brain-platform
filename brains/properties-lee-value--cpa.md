# CPA / Audit Briefing: properties-lee-value

_Audit-grade read with full per-metric provenance tabulated by trust tier — every value traceable to its source URL._

## TL;DR

**BULLISH** (magnitude 0.50)

## ⚠️ Caveats (read first)

- Sales-velocity baseline is derived from each parcel's LATEST qualified sale, so re-sales attributed to recent years are subtracted from earlier-year buckets. Current-year z-score is therefore biased UPWARD; treat marginal bullish reads as suggestive rather than confirmatory.
- Qualified-sale-only sample: inheritance, divorce, and non-arms-length transfers do not appear in the velocity counts. The signal measures market-mediated parcel turnover, not total ownership change.
- Lee County only — Collier and Charlotte are NOT included. SWFL-wide reads must be assembled from sibling brains (not yet built).
- FHFA HPI metrics (Cape Coral MSA + FL state) use a repeat-sale methodology and are published quarterly with a ~2-month lag. They measure price-level change, not transaction volume — the LeePA z-score and the FHFA YoY are complementary, not interchangeable.
- Save-Our-Homes gap median is restricted to parcels with cap_difference > 0 (actively benefiting from the SOH cap). Non-homestead and newly-homesteaded parcels are excluded from the median; total_parcels is the full snapshot row count for context.
- Direction thresholds: bullish if z ≥ +1.0σ; bearish if z ≤ -1.0σ; neutral otherwise. Standard deviation is population std over 3 baseline years; if variance is zero (all baseline years identical) z is undefined and direction is neutral.

## Conclusion

Lee County had 8301 qualified parcel sales recorded for 2025 across 548798 parcels (15.1 per 1,000). Trailing 3yr baseline (2022-2024) averaged 7408 sales/yr; current year sits at z = 1.5 — bullish read on Lee parcel transaction velocity. FHFA Cape Coral-Fort Myers MSA HPI: -8.86% YoY (2025-Q4), FL state -2.62% — federal price-index benchmark for the Lee market.

## Audit Trail (all metrics, by trust tier)

| Tier | Metric | Value | Direction | Citation | URL |
| --- | --- | --- | --- | --- | --- |
| T1 | FHFA Cape Coral-Fort Myers MSA HPI YoY (2025-Q4) — Lee County price-level proxy | -8.86 | falling | FHFA House Price Index via data_lake.fhfa_hpi (purchase-only, traditional, quar… | https://www.fhfa.gov/hpi/download/monthly/hpi_master.json |
| T1 | FHFA Florida state HPI YoY (2025-Q4) — statewide baseline | -2.62 | falling | FHFA House Price Index via data_lake.fhfa_hpi (purchase-only, traditional, quar… | https://www.fhfa.gov/hpi/download/monthly/hpi_master.json |
| T2 | Lee County parcels in snapshot (data_lake.leepa_parcels) | 548798 | stable | LeePA parcel snapshot via data_lake.leepa_parcels (dlt-ingested from gissvr.lee… | https://jtkdowmrjaxfvwmemxso.supabase.co/rest/v1/leepa_parcels?select=folioid,just_value,taxable_value,cap_difference,last_sale_date,use_code |
| T2 | Lee sales velocity, year 2025 (qualified sales per 1,000 parcels) | 15.1 | stable | LeePA parcel snapshot via data_lake.leepa_parcels (dlt-ingested from gissvr.lee… | https://jtkdowmrjaxfvwmemxso.supabase.co/rest/v1/leepa_parcels?select=folioid,just_value,taxable_value,cap_difference,last_sale_date,use_code |
| T2 | Lee sales-velocity z-score, year 2025 vs trailing 3yr (2022-2024) | 1.49 | rising | LeePA parcel snapshot via data_lake.leepa_parcels (dlt-ingested from gissvr.lee… | https://jtkdowmrjaxfvwmemxso.supabase.co/rest/v1/leepa_parcels?select=folioid,just_value,taxable_value,cap_difference,last_sale_date,use_code |

## Drivers

_No upstream drivers (primary brain)._

## Confidence

- **0.91** (deterministic: trust tier × freshness × upstream propagation)
- Worst trust tier in chain: T2
- Upstream brains that passed the relevance floor: 0

---

_Brain: `properties-lee-value` v11 · refined 2026-05-20T18:58:55Z · relevance half-life 720h · decay `weeks`_
