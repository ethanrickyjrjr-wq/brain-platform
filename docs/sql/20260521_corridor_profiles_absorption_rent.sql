-- 2026-05-21 — RETROACTIVE DOCUMENTATION
-- These columns were applied directly to Supabase during the CRE corridor
-- absorption + asking-rent expansion (PR #4 / commit f43bb9a).
-- No data was lost. This file exists to close the docs/sql/ drift gap.
-- SAFE TO RE-RUN: ALTER TABLE ... ADD COLUMN IF NOT EXISTS.

ALTER TABLE corridor_profiles
  ADD COLUMN IF NOT EXISTS absorption_sqft          INTEGER,
  ADD COLUMN IF NOT EXISTS absorption_sqft_direction TEXT,
  ADD COLUMN IF NOT EXISTS asking_rent_psf          NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS asking_rent_psf_direction TEXT;

-- Direction enum constraints (skip if already present — Supabase will error on dup constraint names)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_absorption_sqft_direction'
  ) THEN
    ALTER TABLE corridor_profiles
      ADD CONSTRAINT chk_absorption_sqft_direction
        CHECK (absorption_sqft_direction IN ('rising','falling','stable') OR absorption_sqft_direction IS NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_asking_rent_psf_direction'
  ) THEN
    ALTER TABLE corridor_profiles
      ADD CONSTRAINT chk_asking_rent_psf_direction
        CHECK (asking_rent_psf_direction IN ('rising','falling','stable') OR asking_rent_psf_direction IS NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_absorption_pair'
  ) THEN
    ALTER TABLE corridor_profiles
      ADD CONSTRAINT chk_absorption_pair
        CHECK ((absorption_sqft IS NULL AND absorption_sqft_direction IS NULL) OR
               (absorption_sqft IS NOT NULL AND absorption_sqft_direction IS NOT NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_asking_rent_pair'
  ) THEN
    ALTER TABLE corridor_profiles
      ADD CONSTRAINT chk_asking_rent_pair
        CHECK ((asking_rent_psf IS NULL AND asking_rent_psf_direction IS NULL) OR
               (asking_rent_psf IS NOT NULL AND asking_rent_psf_direction IS NOT NULL));
  END IF;
END $$;
