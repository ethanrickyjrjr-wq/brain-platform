-- =====================================================================
-- Brain Registry — Supabase catalog of every refinery-produced brain.
--
-- Scope: ONE row per pack defined in `refinery/config/packs.mts` (or, after
-- the scaffold lands, per `refinery/packs/{id}.mts`). Hand-curated fixture
-- files under `brains/` (e.g. `brains/test-alpha.md`, referenced by
-- `refinery/render/frontmatter.mts`) are intentionally NOT registered —
-- they are reference fixtures, not chain participants.
--
-- Source of truth contract:
--   • The PackDefinition in TypeScript is the build-time source of truth.
--   • This table is the discovery / catalog source — used by the scaffold
--     to suggest input_brains, by --list-consumers, and by external tools
--     that want to enumerate the lake.
--   • The DAG resolver itself reads in-memory PACKS, NOT this table. That
--     means the refinery builds correctly in offline / fixture mode even
--     when this table is empty or unreachable.
--
-- Paste-and-run: this file is meant for the Supabase SQL editor. There is
-- no `supabase/migrations/` infrastructure in this repo.
-- =====================================================================

CREATE TABLE IF NOT EXISTS brain_registry (
  id              TEXT PRIMARY KEY,
  -- Mirrors BrainDomain in refinery/types/pack.mts — keep both in sync.
  domain          TEXT NOT NULL CHECK (
    domain IN (
      'real-estate',
      'finance',
      'environmental',
      'demographics',
      'logistics',
      'hospitality',
      'macro'
    )
  ),
  display_name    TEXT NOT NULL,
  scope           TEXT NOT NULL,
  -- Authority tiers of the source connectors (1=primary, 4=inferred).
  -- Stored for discovery; the refinery computes confidence from in-memory
  -- SourceConnector.trust_tier, not from this column.
  source_tiers    SMALLINT[] NOT NULL DEFAULT '{}',
  -- Vercel URL of the rendered brain (live read-through for Claude sessions).
  url             TEXT NOT NULL,
  -- Branches (raw sources) feeding this brain. Free-form ids — used for
  -- discovery, not for build correctness.
  branch_ids      TEXT[] NOT NULL DEFAULT '{}',
  output_type     TEXT NOT NULL DEFAULT 'assessment',
  output_summary  TEXT NOT NULL,
  output_metrics  TEXT[] NOT NULL DEFAULT '{}',
  -- Ids of upstream brains this pack reads via input_brains. Mirrors the
  -- TypeScript field of the same name.
  input_brains    TEXT[] NOT NULL DEFAULT '{}',
  -- Auto-maintained by the trigger below from peer rows' input_brains.
  consumer_brains TEXT[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated', 'experimental')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brain_registry_domain_idx ON brain_registry (domain);
CREATE INDEX IF NOT EXISTS brain_registry_status_idx ON brain_registry (status);

-- ---------------------------------------------------------------------
-- Trigger: keep consumer_brains[] in sync from the inverse direction.
-- When a row is inserted/updated with input_brains = [a, b], we append
-- the row's id into a.consumer_brains and b.consumer_brains.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_consumer_brains()
RETURNS TRIGGER AS $$
DECLARE
  upstream TEXT;
BEGIN
  -- Remove this id from any previous upstream's consumer_brains (handles
  -- updates where input_brains shrinks).
  IF TG_OP = 'UPDATE' AND OLD.input_brains IS DISTINCT FROM NEW.input_brains THEN
    FOREACH upstream IN ARRAY OLD.input_brains LOOP
      IF NOT (upstream = ANY(NEW.input_brains)) THEN
        UPDATE brain_registry
        SET consumer_brains = array_remove(consumer_brains, NEW.id),
            updated_at = now()
        WHERE id = upstream;
      END IF;
    END LOOP;
  END IF;

  -- Add this id to every current upstream's consumer_brains (idempotent).
  FOREACH upstream IN ARRAY NEW.input_brains LOOP
    UPDATE brain_registry
    SET consumer_brains = (
      SELECT ARRAY(SELECT DISTINCT unnest(consumer_brains || ARRAY[NEW.id]))
    ),
        updated_at = now()
    WHERE id = upstream;
  END LOOP;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS brain_registry_sync_consumers ON brain_registry;
CREATE TRIGGER brain_registry_sync_consumers
  BEFORE INSERT OR UPDATE OF input_brains ON brain_registry
  FOR EACH ROW EXECUTE FUNCTION sync_consumer_brains();

-- =====================================================================
-- Seed: the three v1 brains. Use ON CONFLICT DO UPDATE so re-running this
-- file re-syncs the catalog with the current PackDefinitions.
-- =====================================================================
INSERT INTO brain_registry
  (id, domain, display_name, scope, source_tiers, url,
   branch_ids, output_type, output_summary, input_brains)
VALUES
  (
    'franchise-outcomes',
    'real-estate',
    'Franchise Outcomes — SWFL',
    'SBA 7(a)/504 franchise loan outcomes — Lee & Collier counties, FL',
    ARRAY[1]::SMALLINT[],
    'https://brain-platform-amber.vercel.app/api/b/franchise-outcomes',
    ARRAY['sba_loans_franchise_outcomes'],
    'assessment',
    'Per-brand SBA franchise loan survival and charge-off outcomes across Lee & Collier counties, with corpus-level capital, charge-off, and survival aggregates.',
    ARRAY[]::TEXT[]
  ),
  (
    'cre-swfl',
    'real-estate',
    'SWFL CRE Corridors',
    'SWFL commercial real estate corridors — verified corridor intelligence (profiles, character, active flags)',
    ARRAY[2]::SMALLINT[],
    'https://brain-platform-amber.vercel.app/api/b/cre-swfl',
    ARRAY['corridor_profiles'],
    'reference',
    'Verified SWFL CRE corridor profiles with character narrative, seasonal index, and ground-truth active flags layer.',
    ARRAY[]::TEXT[]
  ),
  (
    'master',
    'real-estate',
    'SWFL Intelligence Lake — Master Index',
    'SWFL Intelligence Lake — master index across the verified Franchise Outcomes and CRE Corridors packs (Lee & Collier counties, FL)',
    ARRAY[2, 2]::SMALLINT[],
    'https://brain-platform-amber.vercel.app/api/b/master',
    ARRAY[]::TEXT[],
    'index',
    'Master directory for the SWFL Intelligence Lake — aggregates the two verticals (franchise outcomes + CRE corridors) and points to the sub-brains for record-level detail.',
    ARRAY['franchise-outcomes', 'cre-swfl']
  )
ON CONFLICT (id) DO UPDATE
SET
  domain         = EXCLUDED.domain,
  display_name   = EXCLUDED.display_name,
  scope          = EXCLUDED.scope,
  source_tiers   = EXCLUDED.source_tiers,
  url            = EXCLUDED.url,
  branch_ids     = EXCLUDED.branch_ids,
  output_type    = EXCLUDED.output_type,
  output_summary = EXCLUDED.output_summary,
  input_brains   = EXCLUDED.input_brains,
  updated_at     = now();

-- Force-sync consumer_brains after seed (in case the trigger missed any
-- prior-state ON CONFLICT updates). After this, franchise-outcomes and
-- cre-swfl both list 'master' in their consumer_brains.
UPDATE brain_registry r
SET consumer_brains = (
  SELECT COALESCE(array_agg(DISTINCT c.id ORDER BY c.id), ARRAY[]::TEXT[])
  FROM brain_registry c
  WHERE r.id = ANY(c.input_brains)
),
    updated_at = now();
