-- Goals 0–8 ladder — the strategic goal ladder shown at /ops/goals.
-- Source of truth is THIS table, not a markdown file. The operator edits rows
-- directly in Supabase Studio; the /ops/goals page reads them at render time.
--
-- Idempotent. Safe to re-run. The seed is INSERT-ONLY (ON CONFLICT DO NOTHING):
-- a re-run can only fill a missing goal_number, NEVER overwrite a row the
-- operator has edited. Do not change the seed to an upsert.

CREATE TABLE IF NOT EXISTS public.goals (
    goal_number  INT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'red'
                 CHECK (status IN ('green', 'yellow', 'red')),
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.goals IS
'Strategic Goal 0-8 ladder rendered at /ops/goals. Hand-owned by the operator '
'(edited in Supabase Studio); status is manual, not signal-derived. The carry '
'contract is Goal 2. Seed is insert-only — operator edits are never overwritten.';

GRANT SELECT ON public.goals TO service_role;

-- One-time seed. ON CONFLICT DO NOTHING = operator edits survive any re-run.
INSERT INTO public.goals (goal_number, title, description, status) VALUES
(0, 'Stamp the goal & contract',
    'THE-GOAL.md + lean rules-of-engagement block — the contract is written down.',
    'green'),
(1, 'Live /ops ledger',
    'Derived-status operations dashboard, standalone swfldatagulf-ops repo.',
    'green'),
(2, 'The carry contract',
    'Dossier + lean rules ride in every payload (MCP _meta, /api/b json); speculation is conditional (IF/THEN + falsifier), not flat; explicit grain boundary. master.md v59. This is the focus.',
    'green'),
(3, 'Master is a synthesizer, not an index',
    'Weighted conclusion, contradictions surfaced, dynamic key-metric cap (t1Count+1).',
    'green'),
(4, 'Prove it & self-own the data',
    'Apply predictions SQL done; finish fl_dor_tdt + fl_dor_sales_tax backfill; pass acceptance Test A/B; get red GHA green (CI, Daily Brain Rebuild, Collier permits, freshness probe).',
    'yellow'),
(5, 'Audience voices + first derived metric',
    'Corridor character generator (done) -> Corridor Factor -> constitution as YAML -> 2-round critique-revision loop.',
    'red'),
(6, 'Honest confidence + rich side channel',
    'Yager-DST confidence -> report-page side channel /r/[slug] (charts, maps, shareable URL per reply) -> spatial oracle corridor_for_point.',
    'red'),
(7, 'Outcomes loop (correlation -> causation)',
    'Cron grades predictions vs observed, surfaces drift -> causal layer (Ian IV / synthetic control / diff-in-diff) -> backtests vs 2022-2024.',
    'red'),
(8, 'Autonomy & expansion',
    '3am scheduled refinery + watch-list + real-time subs -> regional (Tampa/Orlando -> statewide -> national -> outlier brain) -> multi-tenant /vault -> multi-agent inference -> fine-tuned synthesis.',
    'red')
ON CONFLICT (goal_number) DO NOTHING;
