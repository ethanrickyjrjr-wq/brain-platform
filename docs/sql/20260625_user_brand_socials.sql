-- Social URLs + unsubscribe on user_brand_profiles, plus a custom-platform log
--
-- WHY: the Email Lab footer/social-icons rendering layer (FooterBlock, applyBrand,
-- the email-lab token bridge) was fully wired but never received data. Three
-- upstream gaps killed the flow: (1) no DB columns to persist socials at the
-- account level, (2) no form inputs, (3) /api/user/brand never selected/saved
-- them. This migration closes gap (1).
--
-- Account-level vs project-level: like primary_color/accent_color, these social
-- URLs persist at the account level so they CARRY to new projects (pre-fill in
-- ProjectWorkspace). Per-project overrides still live in projects.branding (JSONB,
-- no migration needed — arbitrary keys ride along once the API emits them).
--
-- Consumers: app/api/user/brand/route.ts (GET returns, PATCH upserts via
--   SOCIAL_FIELDS), app/project/[id]/workspace/BrandingBlock.tsx ("Connect
--   Socials" form), app/project/[id]/email-lab/page.tsx (token builder),
--   components/email-lab/EmailLabShell.tsx (applyBrand).
--
-- Idempotent. This repo has no supabase/ CLI — migrations live in docs/sql/ and
-- apply to prod directly. The API GET degrades if columns are missing (profile
-- still loads); deploy the migration before the route change to keep PATCH green.

ALTER TABLE public.user_brand_profiles
  ADD COLUMN IF NOT EXISTS instagram_url   text,
  ADD COLUMN IF NOT EXISTS facebook_url    text,
  ADD COLUMN IF NOT EXISTS linkedin_url    text,
  ADD COLUMN IF NOT EXISTS x_url           text,
  ADD COLUMN IF NOT EXISTS tiktok_url      text,
  ADD COLUMN IF NOT EXISTS youtube_url     text,
  ADD COLUMN IF NOT EXISTS pinterest_url   text,
  ADD COLUMN IF NOT EXISTS threads_url     text,
  ADD COLUMN IF NOT EXISTS unsubscribe_url text;

-- Log of "add your own" custom-platform URLs the user pasted that did NOT match a
-- pre-baked platform. Drives future "promote a custom platform to pre-baked" data;
-- logo_url is the Logo.dev / favicon resolved icon (nullable). user_id is nullable
-- so an unauthenticated funnel paste can still log (FK cascades on user delete).
CREATE TABLE IF NOT EXISTS public.brand_custom_socials (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain     text NOT NULL,
  url        text NOT NULL,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  logo_url   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brand_custom_socials_domain ON public.brand_custom_socials(domain);

-- Service-role reads/writes the log from the API route; RLS off is fine (no client
-- access). Grant so PostgREST + the service key can use it.
GRANT SELECT, INSERT ON public.brand_custom_socials TO service_role;

NOTIFY pgrst, 'reload schema';

-- Verify:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'user_brand_profiles'
--       AND column_name LIKE '%_url' ORDER BY column_name;
--   SELECT to_regclass('public.brand_custom_socials');
