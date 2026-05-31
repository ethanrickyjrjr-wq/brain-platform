-- RSW Airport Monthly Statistics table
-- Run once in Supabase SQL editor before first pipeline run.
-- Source: https://www.flylcpa.com/about/statistics (Lee County Port Authority)
-- Airports: RSW (Southwest Florida International) + PGD (Punta Gorda)

CREATE TABLE IF NOT EXISTS public.rsw_airport_monthly (
    id                  TEXT PRIMARY KEY,
    report_month        DATE NOT NULL,
    airport_code        TEXT NOT NULL,
    metric              TEXT NOT NULL,
    value               BIGINT,
    yoy_pct_change      NUMERIC(8,2),
    period_label        TEXT,
    source_url          TEXT NOT NULL,
    inserted_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rsw_airport_monthly_month_idx
    ON public.rsw_airport_monthly (report_month DESC);

CREATE INDEX IF NOT EXISTS rsw_airport_monthly_airport_metric_idx
    ON public.rsw_airport_monthly (airport_code, metric, report_month DESC);

COMMENT ON TABLE public.rsw_airport_monthly IS
'Monthly passenger statistics for RSW (Southwest Florida International) and PGD (Punta Gorda) '
'airports. Source: Lee County Port Authority (https://www.flylcpa.com/about/statistics). '
'Scraped monthly via Firecrawl. Metrics: enplanements (primary), total_passengers, '
'aircraft_operations (if available). YoY % change computed from prior-year rows.';

GRANT SELECT ON public.rsw_airport_monthly TO service_role;
