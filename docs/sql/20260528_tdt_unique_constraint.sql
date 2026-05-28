-- Add UNIQUE constraint on (county, period) to fl_dor_tdt_collections.
-- Required before the fl_dor_tdt pipeline can upsert rows ON CONFLICT.
-- Run once against the live Supabase DB before the first pipeline execution.

ALTER TABLE fl_dor_tdt_collections
  ADD CONSTRAINT fl_dor_tdt_county_period_unique UNIQUE (county, period);
