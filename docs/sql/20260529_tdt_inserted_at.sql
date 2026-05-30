-- Rename retrieved_at → inserted_at so the ops freshness signal can find it.
-- directTableFreshness() in swfldatagulf-ops queries inserted_at; the pack never
-- touches this column (selects only id, county, period, collections_usd).
-- Idempotent: no-ops if retrieved_at has already been renamed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'fl_dor_tdt_collections'
      AND column_name  = 'retrieved_at'
  ) THEN
    ALTER TABLE public.fl_dor_tdt_collections
      RENAME COLUMN retrieved_at TO inserted_at;
  END IF;
END;
$$;
