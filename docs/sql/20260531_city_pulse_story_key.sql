-- 20260531_city_pulse_story_key.sql — content-aware story supersession (Build #1).
-- Adds story_key (the slug that names the underlying story/entity/deal) so a NEW article about
-- the SAME story can retire the older one, which dedup_key (city|normalize_url(source_url)) cannot.
-- superseded_by already exists (FK to id, NO ACTION) from 2026-05-30_city_pulse.sql.
-- Plan: docs/superpowers/plans/2026-05-31-city-pulse-story-key/README.md
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS. Run via psycopg per RULE 1.

ALTER TABLE data_lake.city_pulse ADD COLUMN IF NOT EXISTS story_key TEXT;

-- Serves the grounding read (WHERE city=? AND superseded_by IS NULL AND story_key IS NOT NULL)
-- and the reader filter. Partial: only live, keyed rows. NOTE: the reconcile head CTE also reads
-- superseded rows, so it will NOT use this partial index — fine at this table's size.
CREATE INDEX IF NOT EXISTS city_pulse_story_live_idx
  ON data_lake.city_pulse (city, story_key)
  WHERE superseded_by IS NULL AND story_key IS NOT NULL;
