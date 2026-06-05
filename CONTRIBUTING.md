# Contributing & engineering standards

This repo is a DAG of deterministic "brains" plus a master synthesizer. Most work
is adding or hardening a brain. These are the house rules.

## Non-negotiables

- **No LLM in the math path.** Scoring, normalization, and direction logic is deterministic TypeScript.
- **Every constant** that affects scoring, thresholds, or normalization carries an inline source comment or a `SOURCED.md` entry.
- **Citations branch on the real data source** (live table vs fixture). Never hardcode a source path.
- **Leaf brains state cited facts only.** Synthesized or inferred claims live in master and carry an `[INFERENCE]` tag plus a falsifier.
- **The graph stays acyclic:** leaf brains never point back to master.

## Ship contract

- A brain's vocabulary and `slug_index` land in the same commit as the brain.
- A Tier-2 ingest never ships without the brain that consumes it in the same PR.
- Tests and lints (`facts-only-lint`, `spec-validator`) pass before a change is shippable.

## Local dev

- **Install:** `bun install`
- **Run tests:** `bun test`
- **Single-brain rebuild:** use the `--target-only` CLI flag to rebuild one brain without the whole lake — e.g. `bun refinery/cli.mts macro-swfl --target-only`.

## Push protocol

- Pushes go through the rebase-safe push guard: stash → fetch → rebase → show outgoing → push → pop stash. Run it with `node scripts/safe-push.mjs` instead of `git push`.
