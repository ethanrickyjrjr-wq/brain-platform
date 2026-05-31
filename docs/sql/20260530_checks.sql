-- 20260530_checks.sql — Deferred-Commitment Ledger (/checks)
-- Spec: docs/superpowers/specs/2026-05-30-deferred-commitment-ledger-design.md
-- Shared Supabase (public schema), read by swfldatagulf-ops via service_role.
-- Idempotent: CREATE ... IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING.
-- Run by Claude via psycopg3 (.dlt/secrets.toml). Page/API are built in swfldatagulf-ops.

CREATE TABLE IF NOT EXISTS public.checks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project     text        NOT NULL,
  check_key   text        NOT NULL UNIQUE,
  label       text        NOT NULL,
  detail      text,
  resolution  text        NOT NULL DEFAULT 'manual' CHECK (resolution IN ('auto','manual','both')),
  signal      jsonb,
  priority    smallint    NOT NULL DEFAULT 0,
  due_at      timestamptz,
  state       text        NOT NULL DEFAULT 'open' CHECK (state IN ('open','done','dropped')),
  drop_reason text,
  resolved_at timestamptz,
  resolved_by text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checks_open_idx ON public.checks (state) WHERE state = 'open';

CREATE INDEX IF NOT EXISTS checks_project_idx ON public.checks (project);

GRANT SELECT, INSERT, UPDATE ON public.checks TO service_role;

INSERT INTO public.checks (project, check_key, label, resolution, signal, due_at) VALUES
  ('city_pulse', 'city_pulse_first_rows', 'Eyeball first 09:00 UTC cron rows landed', 'auto', '{"type":"table_fresh","table":"data_lake.city_pulse","column":"run_at","since":"due_at"}'::jsonb, '2026-05-30 09:00:00+00'),
  ('city_pulse', 'city_pulse_first_gha', 'GHA green on first post-ship cron run', 'auto', '{"type":"workflow_success","workflow":"city-pulse-daily.yml"}'::jsonb, '2026-05-30 09:00:00+00'),
  ('flywheel', 'flywheel_writeback', 'conversation->flywheel write-back (the moat)', 'manual', NULL, '2026-06-06 00:00:00+00'),
  ('flywheel', 'flywheel_volume_guard', 'volume guard / cleaning agent', 'manual', NULL, '2026-06-04 00:00:00+00'),
  ('city_pulse', 'city_pulse_story_key', 'story_key content-aware supersession', 'manual', NULL, '2026-06-15 00:00:00+00'),
  ('city_pulse', 'city_pulse_weekly_corridor', 'weekly corridor trigger', 'manual', NULL, '2026-06-15 00:00:00+00')
ON CONFLICT (check_key) DO NOTHING;
