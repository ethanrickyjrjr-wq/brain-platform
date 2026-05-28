-- FL DOR Form 10 — Taxable Sales by Business Type
-- Run once in Supabase before first pipeline execution.
--
-- Source: Florida DOR Form 10 biennial Excel files (cy0203 through cy2425+).
-- Pipeline: ingest/pipelines/fl_dor_sales_tax/
-- Cadence: monthly (15th of month via fl-dor-sales-tax-monthly.yml).
-- Row estimate: ~54k rows for Lee + Collier full backfill (cy0203–cy2425).
--
-- Verified column schema from cy2223 Lee sheet:
--   county       — county name ("Lee", "Collier")
--   county_code  — FL DOR county code ("46" = Lee, "21" = Collier)
--   kind_code    — DOR business-type code (integer, e.g. 1=Grocery, 8=Restaurants)
--   business_type— business type description (col B of each county sheet)
--   period       — first day of the reported month (DATE)
--   taxable_sales_usd — monthly taxable sales in USD (NUMERIC, NULL if not yet published)

CREATE TABLE IF NOT EXISTS fl_dor_sales_tax (
    id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    county           TEXT        NOT NULL,
    county_code      TEXT,
    kind_code        INTEGER     NOT NULL,
    business_type    TEXT        NOT NULL,
    period           DATE        NOT NULL,
    taxable_sales_usd NUMERIC,
    source_url       TEXT,
    retrieved_at     TIMESTAMPTZ
);

-- Required before first upsert (ON CONFLICT (county, kind_code, period)).
ALTER TABLE fl_dor_sales_tax
    ADD CONSTRAINT fl_dor_sales_tax_county_kind_period_unique
    UNIQUE (county, kind_code, period);

-- Index for brain queries: county + period range scans.
CREATE INDEX IF NOT EXISTS idx_fl_dor_sales_tax_county_period
    ON fl_dor_sales_tax (county, period DESC);

-- Index for kind_code lookups (industry-type rollups).
CREATE INDEX IF NOT EXISTS idx_fl_dor_sales_tax_kind
    ON fl_dor_sales_tax (kind_code, period DESC);

GRANT SELECT ON fl_dor_sales_tax TO service_role;
