-- 20260611_saved_charts.sql — anonymous, shareable saved chart. Idempotent.
CREATE TABLE IF NOT EXISTS public.saved_charts (
  id              text PRIMARY KEY,
  chart_block     jsonb NOT NULL,
  source_meta     jsonb,
  freshness_token text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_charts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY saved_charts_public_select ON public.saved_charts FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- writes go through service_role only (no anon/authenticated INSERT policy)
GRANT SELECT ON public.saved_charts TO anon, authenticated;
GRANT ALL    ON public.saved_charts TO service_role;
