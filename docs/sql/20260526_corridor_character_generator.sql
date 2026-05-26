-- 20260526_corridor_character_generator.sql
--
-- Adds the six character_* columns the corridor-character generator
-- (Step 2 of docs/superpowers/plans/2026-05-26-corridor-character-generator/)
-- writes to. The legacy `character` TEXT column is intentionally NOT touched
-- — it stays as cold fallback for one full quarterly cycle so a regressed
-- generator run can be reverted by reading the snapshot at
-- docs/audits/2026-05-26-corridor-character-snapshot.md.
--
-- Two-block design (see plan, "Design model"):
--   - character_facts        : verified, sourced, lint-strict prose.
--   - character_chart        : optional structured comparison table.
--   - character_speculative  : AI-inferred prose with required inline disclaimer.
--   - character_citations    : per-claim provenance — internal data rows + web cites.
--   - character_generated_at : timestamp of the run that wrote this row.
--   - character_fact_pack_vintage : "OLDEST-YYYY-MM" of inputs the run consumed.
--
-- All columns nullable. composeCharacterRender (cre-source.mts) will read
-- character_facts when non-null and fall back to legacy `character` otherwise
-- (wired in Step 5; not in this migration).
--
-- Apply via Supabase SQL editor; idempotent on re-run.

ALTER TABLE corridor_profiles
  ADD COLUMN IF NOT EXISTS character_facts             TEXT,
  ADD COLUMN IF NOT EXISTS character_chart             JSONB,
  ADD COLUMN IF NOT EXISTS character_speculative       TEXT,
  ADD COLUMN IF NOT EXISTS character_citations         JSONB,
  ADD COLUMN IF NOT EXISTS character_generated_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS character_fact_pack_vintage TEXT;

COMMENT ON COLUMN corridor_profiles.character_facts IS
  'Generator-authored facts block: verified, per-claim cited, lint-strict (spec-validator + facts-only-lint + inference-bait-lint + numeric_softening ban). Every numeric value verbatim from the fact pack. NULL until first generator run.';

COMMENT ON COLUMN corridor_profiles.character_chart IS
  'Optional structured comparison block — {title: string, columns: string[], rows: cell[][]} using only fact-pack values, or NULL when no comparison is genuinely useful. No semantic gating; structural shape only.';

COMMENT ON COLUMN corridor_profiles.character_speculative IS
  'Generator-authored speculative block: AI inference around fact-pack gaps + grounded web context. Hedging language REQUIRED for inferred numerics; must end verbatim with: "_Speculative — based partly on inferred data. Double-check._". Exempt from numeric_softening ban (see CLAUDE.md SWFL Protocol rule 8 carve-out).';

COMMENT ON COLUMN corridor_profiles.character_citations IS
  'Per-claim provenance for both blocks. Shape: {internal: [{ref: "internal-N", source_url: text}], web: [{ref: "web-N", url: text, title: text, cited_text: text}]}. References ([internal-N] / [web-N]) appear inline in character_facts and character_speculative.';

COMMENT ON COLUMN corridor_profiles.character_generated_at IS
  'UTC timestamp of the generator run that wrote this row. Distinct from updated_at (which tracks any column change) — character_generated_at moves only when the generator pipeline writes.';

COMMENT ON COLUMN corridor_profiles.character_fact_pack_vintage IS
  'OLDEST-YYYY-MM marker — the date of the OLDEST data source used by the generator run. Surfaced to consumer-Claude per the SWFL consumption-contract freshness rule.';
