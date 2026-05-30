-- FDLE UCR property crime — Lee + Collier counties
-- Run once in Supabase SQL editor before first pipeline execution.
--
-- Source: FDLE Uniform Crime Report (UCR), Part I property offenses by county.
--   https://www.fdle.state.fl.us/FSAC/Crime-Data/UCR-Data-Archive.aspx
-- Pipeline: ingest/pipelines/fdle_crime_swfl/
-- Cadence: quarterly (1 Jan, 1 Apr, 1 Jul, 1 Oct via fdle-crime-quarterly.yml).
-- Grain: one row per (county, period). period = first day of calendar year
--   (FDLE UCR data is annual; pipeline runs quarterly to pick up new releases).
-- Pack: refinery/packs/safety-swfl.mts (Tier-1 Reporter).
-- Tier-1 cold layer: lake-tier1/crime/{year}/fdle_crime_swfl.ndjson (Supabase Storage).

CREATE TABLE IF NOT EXISTS public.fdle_crime_swfl (
    id                    UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
    county                TEXT         NOT NULL,
    -- First day of the calendar year the data covers (e.g. 2024-01-01 = 2024 UCR).
    period                DATE         NOT NULL,
    data_year             INTEGER      NOT NULL,
    burglary              INTEGER,
    larceny_theft         INTEGER,
    motor_vehicle_theft   INTEGER,
    arson                 INTEGER,
    -- Sum of the four Part I property offense categories above.
    total_property_crimes INTEGER,
    population            INTEGER,
    -- total_property_crimes / population * 1000; NULL when population is zero or missing.
    property_crime_per_1k NUMERIC(8, 2),
    source_url            TEXT,
    retrieved_at          TIMESTAMPTZ,
    inserted_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Required before first upsert (ON CONFLICT (county, period)).
CREATE UNIQUE INDEX IF NOT EXISTS fdle_crime_swfl_county_period_unique
    ON public.fdle_crime_swfl (county, period);

-- Index for pack queries: latest rows per county.
CREATE INDEX IF NOT EXISTS idx_fdle_crime_swfl_county_period
    ON public.fdle_crime_swfl (county, period DESC);

GRANT SELECT ON public.fdle_crime_swfl TO service_role;
