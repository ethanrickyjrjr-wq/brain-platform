-- SWFL Inc. Economic Development Announcements table
-- Run once in Supabase SQL editor before first pipeline run.
-- Source: https://www.swflinc.com/news/ (SWFL Inc., Lee County Economic Development Organization)

CREATE TABLE IF NOT EXISTS public.swfl_inc_announcements (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    announced_date  DATE,
    county          TEXT NOT NULL DEFAULT 'swfl',
    category        TEXT,
    investment_usd  NUMERIC,
    jobs            INTEGER,
    summary         TEXT,
    source_url      TEXT NOT NULL,
    scraped_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    inserted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS swfl_inc_announcements_date_idx
    ON public.swfl_inc_announcements (announced_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS swfl_inc_announcements_county_idx
    ON public.swfl_inc_announcements (county);

CREATE INDEX IF NOT EXISTS swfl_inc_announcements_category_idx
    ON public.swfl_inc_announcements (category);

COMMENT ON TABLE public.swfl_inc_announcements IS
'Economic development announcements from Southwest Florida Inc. (SWFL Inc.), '
'the official Lee County economic development organization. '
'Weekly scrape of https://www.swflinc.com/news/. '
'Structured fields: title, announced_date, county, category, investment_usd, jobs, summary.';

GRANT SELECT ON public.swfl_inc_announcements TO service_role;
