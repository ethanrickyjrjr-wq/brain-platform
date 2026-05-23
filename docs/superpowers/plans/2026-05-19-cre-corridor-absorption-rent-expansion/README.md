# CRE Corridor Absorption + Asking Rent Expansion

**Status:** FULLY APPLIED — verified 2026-05-22.
**Drafted:** 2026-05-19 (LittleBird session)
**Targets:** `refinery/packs/cre-swfl.mts` (new) + `refinery/sources/cre-source.mts` + `refinery/vocab/brain-vocabulary.json` + `corridor_profiles` table (Supabase)

## Intent

Adds two new corridor metrics — Net Absorption (sqft) and Asking Rent (PSF NNN) — to `corridor_profiles`, exposes them through `CorridorNormalized`, registers them in `brain-vocabulary.json` as `cre_absorption_sqft` / `cre_asking_rent_psf` (+ corpus medians), and extracts the existing `cre-swfl` logic into a per-pack file under the Brain Factory v1.1 layout.

## Apply order

1. `migration.sql` — BEGIN/COMMIT wrapped ALTER TABLE against `corridor_profiles`. Adds 4 columns + 4 CHECK constraints. Negative absorption explicitly allowed; direction-pair discipline enforced.
2. `cre-source.diff` — extends `CorridorNormalized` interface and `normalizeCorridor()` with the 4 new fields.
3. `vocab.diff` — registers 4 new concepts + 4 raw_slug entries in `brain-vocabulary.json`.
4. `fixture.json` — replaces (or extends) the existing cre-swfl test fixture with 8 SWFL corridors covering the new metric ranges (notable: Estero Blvd has `absorption_sqft: -5000` with stable direction to validate negative-absorption constraint; US-41 Cleveland Ave is all-nulls to validate exclusion-from-direction-vote).
5. `index.diff` — registers `creSwfl` in `refinery/packs/index.mts`.

**PREREQUISITE (MET):** `refinery/packs/cre-swfl.mts` exists. Both PR A (pack extraction) and PR B (absorption + asking-rent expansion) shipped — code verified 2026-05-22. `migration.sql` applied to Supabase (confirmed: `absorption_sqft` columns exist in DB, values null on two large-format centers pending CoStar/broker data).

## PR strategy

Two distinct concerns bundled here — recommend splitting when picked up:

- **PR A — cre-swfl pack extraction.** Pure refactor of existing logic into per-pack file. No new metrics, no new vocab, no migration. Lands the `index.diff` against an empty-metric `cre-swfl.mts`.
- **PR B — absorption + asking-rent expansion.** Migration + source extension + vocab + fixture. Layers on top of PR A.

This avoids one PR mixing "registry shape change" + "schema migration" + "vocab add" — three different review surfaces with different blast radii.

## Open questions

- Source URLs on fixture rows are `example.notion.so/*` placeholders — need real corridor verification sources before fixture promotes from `_synthetic: true` to a real ingest.
- `source_brains` on `_median` concepts include both `cre-swfl` and `master` — confirm master pack's outputProducer actually emits corpus medians (or whether that's part of unstaged work).
