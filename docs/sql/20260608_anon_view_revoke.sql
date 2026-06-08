-- Anon-view REST leak sweep + forward posture (PACKET P2)
-- Apply via psycopg3 using creds from brain-platform/.dlt/secrets.toml.
-- Idempotent: every statement is safe to re-run.
--
-- ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
-- Supabase ships a blanket default privilege that GRANTs `anon` + `authenticated`
-- full rights on EVERY new object in schema public. Verified live in pg_default_acl
-- on 2026-06-08: for relations (r), sequences (S) and functions (f), the default
-- ACL = {anon=arwdDxtm, authenticated=arwdDxtm, ...} owned by BOTH `postgres` and
-- `supabase_admin`. That blanket grant is how the Glass read-views leaked
-- retrodicted skill numbers to the public PostgREST endpoint:
--   * public.glass_skill_over_time   — REVOKEd in 20260608_glass_views.sql
--   * public.glass_calibration       — REVOKEd in 20260608_glass_views.sql
--   * public.backtest_skill_by_slug  — REVOKEd in 20260608_data_targets.sql
-- A VIEW is the dangerous case: a plain view runs with the DEFINER's rights and
-- BYPASSES the underlying tables' RLS (no security_invoker), so the anon SELECT
-- grant is a live read. Tables are safer here only because all 27 anon-readable
-- public tables have RLS ENABLED with 0 policies (verified 2026-06-08) → RLS
-- denies anon at the row level even with the grant present. The grant is still a
-- footgun (one missing/permissive RLS policy = open table), so we revoke for
-- defense-in-depth.
--
-- ── SWEEP RESULT (the remediation half) ───────────────────────────────────────
-- BEFORE sweep of every public VIEW (has_table_privilege 'anon'/'authenticated'):
--   backtest_skill_by_slug   anon=False  auth=False
--   glass_calibration        anon=False  auth=False
--   glass_skill_over_time    anon=False  auth=False
--   grade_accuracy_by_slug   anon=True   auth=True   (INTENTIONAL — public accuracy page)
-- => 0 leaked views remain at sweep time; the three known leaks were already
--    revoked by their own migrations. No per-view REVOKE is required today.
--    `grade_accuracy_by_slug` stays anon by design (20260601_grade_predictions.sql:94).
--
-- ── DEFERRED DECISION: SCHEMA-WIDE FORWARD POSTURE (made: SHIP IT) ─────────────
-- Decision: flip the default so NEW public objects do NOT auto-grant anon/auth
-- SELECT. This closes the root cause permanently instead of playing per-view
-- whack-a-mole every time someone adds a view.
--   * Reversible: any future public object can opt back in with an explicit GRANT
--     (see the grade_accuracy_by_slug re-grant below — that is the pattern).
--   * Cost: legitimately-public objects now need ONE explicit GRANT line. Cheap,
--     and it makes "this is public" an intentional, greppable act instead of a
--     silent default. That is the correct direction for a data product whose
--     internal tables (predictions, outcomes, backtest_grades, usage_events,
--     waitlist, checks, ops_notes…) must never reach anon.
--   * Sibling packet P10 adds public.data_requests (must be anon-denied): this
--     default-privilege flip covers it AUTOMATICALLY — no extra REVOKE needed when
--     P10 lands, as long as P10 does not add its own explicit anon GRANT.
--   * Caveat (documented, not a blocker): ALTER DEFAULT PRIVILEGES only affects
--     objects created by the role it is scoped to. The Supabase default is owned
--     by BOTH `postgres` and `supabase_admin`. Our migrations + dlt ingest create
--     objects as `postgres`, so `FOR ROLE postgres` covers every path WE create.
--     Objects created by `supabase_admin` (Supabase-internal machinery, not our
--     app surface) still inherit the blanket default — out of scope for app data,
--     and not something our role can ALTER. The per-object REVOKE in each view
--     migration remains the belt to this suspenders.

BEGIN;

-- 1. FORWARD POSTURE — new public TABLES/VIEWS created by `postgres` no longer
--    auto-grant SELECT (or anything else) to anon/authenticated.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

-- Sequences + functions inherit the same blanket grant; revoke them too so a new
-- view's backing objects can't be poked at by anon either. (Belt-and-suspenders;
-- harmless if already absent.)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- 2. Re-assert the one legitimately-public object explicitly. With the default
--    flipped, "public" must now be declared, not inherited. Idempotent.
GRANT SELECT ON public.grade_accuracy_by_slug TO anon, authenticated;

-- 3. Belt for the existing leak set (idempotent no-op today — already revoked by
--    their own migrations — kept here so this file is the single source of truth
--    for the anon-view posture and re-running it can't regress them).
REVOKE ALL ON public.glass_skill_over_time   FROM anon, authenticated;
REVOKE ALL ON public.glass_calibration       FROM anon, authenticated;
REVOKE ALL ON public.backtest_skill_by_slug  FROM anon, authenticated;

COMMIT;

-- ── VERIFY AFTER RUNNING ──────────────────────────────────────────────────────
--   Every public VIEW except grade_accuracy_by_slug → anon=False:
--     SELECT viewname,
--            has_table_privilege('anon','public.'||viewname,'SELECT') AS anon
--     FROM pg_views WHERE schemaname='public' ORDER BY viewname;
--   New-object default is now revoked for postgres-owned objects:
--     SELECT defaclobjtype, pg_get_userbyid(defaclrole) AS owner, defaclacl
--     FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
--     WHERE n.nspname='public' AND pg_get_userbyid(d.defaclrole)='postgres';
