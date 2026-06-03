-- swfl_search_demand — SWFL search-demand proxy (DataForSEO Google Ads volume).
-- Operator-only roadmap signal; NOT customer-facing, NOT our engagement data.
-- public.* (not data_lake.*) with no consuming brain — precedent: dbpr_public_notices.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.swfl_search_demand (
  id                   text PRIMARY KEY,          -- md5(keyword|source|location|captured_month)[:16]
  keyword              text NOT NULL,
  source               text NOT NULL,             -- provider.name — STRUCTURAL provenance ('dataforseo')
  location             text NOT NULL,             -- 'metro:cape-coral-fort-myers' | 'state:fl' | ...
  captured_month       date NOT NULL,             -- month the volume describes (latest in monthly_searches)
  avg_monthly_searches integer,                   -- DataForSEO search_volume (nullable)
  competition          text,                      -- HIGH | MEDIUM | LOW | NULL
  cpc                  numeric,                    -- nullable
  monthly_searches     jsonb,                     -- [{year, month, search_volume}] — coarse 12-mo trend
  is_bucketed          boolean NOT NULL DEFAULT false,  -- vendor returned a range, not exact (data-quality flag)
  fetched_at           timestamptz NOT NULL,
  inserted_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS swfl_search_demand_keyword_idx
  ON public.swfl_search_demand (keyword);

CREATE INDEX IF NOT EXISTS swfl_search_demand_captured_month_idx
  ON public.swfl_search_demand (captured_month);

-- PostgREST read for the digest (public schema is normally granted to service_role
-- already; included for completeness — no-op if the grant exists).
GRANT SELECT ON public.swfl_search_demand TO service_role;
NOTIFY pgrst, 'reload schema';
