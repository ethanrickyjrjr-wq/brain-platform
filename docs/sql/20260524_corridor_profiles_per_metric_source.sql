-- 2026-05-24 — Add per-metric source URL columns to corridor_profiles.
-- Motivation: a single source_url per row cannot express mixed-source corridors
-- (e.g. cap rate from C&W Office MarketBeat, absorption from a broker contact).
-- Fallback chain in cre-source.mts: metric_source_url ?? source_url ?? null.
-- All columns nullable — corridors with a single source can leave these null
-- and rely on the row-level source_url.

ALTER TABLE corridor_profiles
  ADD COLUMN IF NOT EXISTS cap_rate_source_url         TEXT,
  ADD COLUMN IF NOT EXISTS vacancy_rate_source_url     TEXT,
  ADD COLUMN IF NOT EXISTS absorption_sqft_source_url  TEXT,
  ADD COLUMN IF NOT EXISTS asking_rent_psf_source_url  TEXT;

COMMENT ON COLUMN corridor_profiles.cap_rate_source_url        IS 'Per-metric source; overrides source_url for cap rate reads.';
COMMENT ON COLUMN corridor_profiles.vacancy_rate_source_url    IS 'Per-metric source; overrides source_url for vacancy reads.';
COMMENT ON COLUMN corridor_profiles.absorption_sqft_source_url IS 'Per-metric source; overrides source_url for absorption reads.';
COMMENT ON COLUMN corridor_profiles.asking_rent_psf_source_url IS 'Per-metric source; overrides source_url for asking rent reads.';
