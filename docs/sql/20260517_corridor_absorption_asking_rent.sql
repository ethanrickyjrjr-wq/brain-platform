BEGIN;

-- Adds Net Absorption and Asking Rent (PSF) to the corridor_profiles table.
-- Follows the nullable, explicitly typed pattern established by the cap/vacancy migration.

ALTER TABLE corridor_profiles
  ADD COLUMN absorption_sqft INTEGER,
  ADD COLUMN absorption_sqft_direction TEXT,
  ADD COLUMN asking_rent_psf NUMERIC(10,2),
  ADD COLUMN asking_rent_psf_direction TEXT;

-- Restrict the direction enums to the standard trio (or null)
ALTER TABLE corridor_profiles
  ADD CONSTRAINT chk_absorption_sqft_direction
    CHECK (absorption_sqft_direction IN ('rising', 'falling', 'stable') OR absorption_sqft_direction IS NULL),
  ADD CONSTRAINT chk_asking_rent_psf_direction
    CHECK (asking_rent_psf_direction IN ('rising', 'falling', 'stable') OR asking_rent_psf_direction IS NULL);

-- Ensure that if a metric is entered, its direction must also be entered (and vice versa).
-- Asking Rent
ALTER TABLE corridor_profiles
  ADD CONSTRAINT chk_asking_rent_pair
    CHECK (
      (asking_rent_psf IS NULL AND asking_rent_psf_direction IS NULL) OR
      (asking_rent_psf IS NOT NULL AND asking_rent_psf_direction IS NOT NULL)
    );

-- Absorption (Negative absorption is valid, so no >0 check on the value itself)
ALTER TABLE corridor_profiles
  ADD CONSTRAINT chk_absorption_pair
    CHECK (
      (absorption_sqft IS NULL AND absorption_sqft_direction IS NULL) OR
      (absorption_sqft IS NOT NULL AND absorption_sqft_direction IS NOT NULL)
    );

COMMIT;
