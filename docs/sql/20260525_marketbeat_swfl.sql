-- 20260525_marketbeat_swfl.sql
--
-- Adds the MarketBeat SWFL quarterly table and the corridor_profiles
-- character_broker_narrative column. Both are written to by n8n flows
-- (Firecrawl + Postgres node) per the 2026-05-25 firecrawl-pipeline-skeleton
-- plan, and both are read by cre-swfl in the same PR (brain-first gate).
--
-- Apply via Supabase SQL editor; idempotent on re-run.

CREATE TABLE IF NOT EXISTS data_lake.marketbeat_swfl (
  id              TEXT PRIMARY KEY,                       -- submarket || '_' || quarter
  submarket       TEXT NOT NULL,
  quarter         TEXT NOT NULL,                          -- "2026-Q3"
  vacancy_rate    NUMERIC,
  asking_rent_nnn NUMERIC,
  absorption_sqft INTEGER,
  source_url      TEXT,
  verified        BOOLEAN NOT NULL DEFAULT false,
  _source_model   TEXT NOT NULL DEFAULT 'spark-1-mini',
  _ingested_at    TIMESTAMPTZ NOT NULL,
  UNIQUE (submarket, quarter)
);

CREATE INDEX IF NOT EXISTS idx_marketbeat_swfl_quarter
  ON data_lake.marketbeat_swfl (quarter DESC);

GRANT SELECT ON data_lake.marketbeat_swfl TO service_role;

ALTER TABLE corridor_profiles
  ADD COLUMN IF NOT EXISTS character_broker_narrative JSONB;
