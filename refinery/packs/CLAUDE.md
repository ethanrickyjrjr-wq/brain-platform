# refinery/packs/ — brain pack conventions (loads when you edit here)

- **Thin pipe.** A downstream brain reads ONLY the `--- OUTPUT ---` of an upstream brain, never its
  internals/branches.
- **Deterministic math, narrative prose.** Numbers are computed in code; the LLM produces synthesis only.
- **Ship the vocab slug + the pack in the SAME commit.** Every slug a pack can emit — including
  conditionals — must be registered in `brain-vocabulary.json` in that commit, or the orphan linter
  aborts the GHA rebuild in the gap. Audit: `bun refinery/tools/check-vocab-coverage.mts --all`.
- **Atomic type-lift.** `PackDefinition` / `BrainOutput` type changes ship with a backfill of ALL packs
  in one commit.
- **Validators gate writes (Stage 4).** `spec-validator`, `facts-only-lint`, `inference-bait-lint`,
  `smoothing-lint`, `grain-guard-lint`. Customer-facing prose also answers to `display-leak` +
  `zip-level-framing-lint` (never frame the product as "ZIP-level"). A violation aborts the run; the
  prior brain file stays intact.
- **Gate 5 (pre-push).** Touching `refinery/packs/**` runs the `catalog.test.mts` mirror + each pack's
  `bun:test`. Keep the pack and `catalog.mts` in sync.
- **Rebuild one brain with `--target-only`** so you don't clobber a parallel session's `brains/*.md`
  (and to dodge the cre-swfl LLM-egress hang).
- **`master.sources[]` must mirror `input_brains[]`** — a brain in `sources[]` but not `input_brains[]`
  is fetched-never-built. Verify: `bun run refinery -- master --target-only`.
