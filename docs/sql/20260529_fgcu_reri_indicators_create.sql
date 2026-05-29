-- FGCU RERI Regional Economic Indicators table
-- Run once in Supabase SQL editor before first pipeline run.
-- Source: https://www.fgcu.edu/cob/reri/ (Lutgert College of Business, FGCU)

CREATE TABLE IF NOT EXISTS public.fgcu_reri_indicators (
    id                       TEXT PRIMARY KEY,
    report_month             DATE NOT NULL,
    indicator                TEXT NOT NULL,
    county                   TEXT NOT NULL DEFAULT 'swfl',
    reference_period_label   TEXT,
    reference_period_end     DATE,
    pct_change               FLOAT,
    pct_change_unit          TEXT,
    source_url               TEXT NOT NULL,
    inserted_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fgcu_reri_indicators_month_idx
    ON public.fgcu_reri_indicators (report_month DESC);

CREATE INDEX IF NOT EXISTS fgcu_reri_indicators_indicator_idx
    ON public.fgcu_reri_indicators (indicator, county);

COMMENT ON TABLE public.fgcu_reri_indicators IS
'Monthly SWFL economic indicators from FGCU Regional Economic Research Institute (RERI). '
'8 metrics per month: airport_activity, tourist_tax_revenues, taxable_sales, '
'unemployment_rate, permits_single_family, home_sales_single_family, '
'home_prices_single_family, active_listings_residential. '
'Lee + Collier + Charlotte county coverage. Source: https://www.fgcu.edu/cob/reri/';

GRANT SELECT ON public.fgcu_reri_indicators TO service_role;
