# %%APP%% — Intelligence Bridge Platform

## Project Identity

- Working name: %%APP%% (replace globally when real name is decided)
- Purpose: Hosted "Brain URL" platform for persistent Claude context
- Stack: Next.js, Sanity CMS, Supabase Auth, Vercel
- This project is SEPARATE from premise-engine. Never mix them.
- All brand references use %%APP%% until name is decided
- Dashboard only — no maps, no 3D, no heavy viz libs

## Find + Replace When Name Is Ready

Search: `%%APP%%` → Replace: `[real name]`

---

## Brain Factory Architecture (v1.1)

**Spec of record:** [Notion — 🏭 Brain Factory Blueprint v1.1](https://www.notion.so/36135f3b7faf813db9b8dfc16ee7da0b) (page id `36135f3b-7faf-813d-b9b8-dfc16ee7da0b`). The Notion page is authoritative for spec changes; this section is a working summary so the agent can execute without round-tripping.

### Core concept

Every brain is a self-contained black box: 4–10 branches of data go in, **one distilled output** comes out (`conclusion`, `confidence`, `key_metrics`, `caveats`). Downstream brains read that **thin-pipe output**, never the upstream's raw branches. The `master` brain is no longer special — it was just the first brain that proved the pattern.

### Locked decisions (v1.1)

| #   | Decision                | Lock                                                                                                                                                    |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Output format           | JSON inside the `--- OUTPUT ---` section of the reference fence                                                                                         |
| 2   | Output position         | After `--- SAVED FACTS ---`, before `--- SUB-BRAIN POINTERS ---`                                                                                        |
| 3   | Identifier              | Single `id` field. No `slug`. No `brain_id` duplication going forward — `id` IS the URL-safe slug                                                       |
| 4   | Confidence              | Deterministic: `avg(trust_tier_score) × freshness_ratio`. Never produced by an LLM                                                                      |
| 5   | Per-pack files          | `refinery/packs/{id}.mts`. Scaffold atomically writes the file AND appends to `refinery/packs/index.mts`                                                |
| 6   | DAG source              | In-memory `input_brains` on each `PackDefinition`. Supabase registry is catalog-only                                                                    |
| 7   | Freshness token         | Per-domain LAKE_ID (e.g. `REAL-ESTATE-v3-20260515`, `FINANCE-v2-20260515`)                                                                              |
| 8   | `outputProducer`        | Optional per-pack helper on `PackDefinition`. If unset, default to top-composite-fact value extraction                                                  |
| 9   | `test-alpha.md`         | Kept as the frontmatter fixture referenced by `refinery/render/frontmatter.mts`. Not in `PACKS`, not in `brain_registry`                                |
| 10  | Domain taxonomy         | TypeScript union `BrainDomain = "real-estate" \| "finance" \| "environmental" \| "demographics" \| "logistics" \| "hospitality" \| "macro"` + SQL CHECK |
| 11  | Stage 4 Supabase upsert | Silent no-op when `SUPABASE_URL` is unset. Local `.md` is the artifact; registry is metadata                                                            |

### Non-negotiable rules

1. **Thin pipe only.** A downstream brain never reads an upstream's branches — only its `--- OUTPUT ---` block.
2. **Deterministic math, narrative prose.** Numbers (counts, sums, medians, rankings, confidence) are computed in code. LLMs produce qualitative synthesis only.
3. **Atomic type-lift.** Type changes to `PackDefinition` ship in the same commit as the backfill of all existing packs. No window where the codebase is broken.
4. **Brain-input fragments bypass `fitScore`.** A `brain-input:*` source is already distilled — Stage 2 forces its composite to max.
5. **Stale-upstream caveat.** When the DAG resolver builds against a stale upstream, it auto-appends `"Upstream brain '{id}' was stale at build time (expired {date})."` to `BrainOutput.caveats` and propagates `min(self, upstream)` confidence.
6. **Cycle detection.** Topological sort throws `Cycle detected: a → b → a` rather than infinite-looping.
7. **Spec-validator gates writes.** Every render runs through `spec-validator`, `facts-only-lint`, and `inference-bait-lint` before the `.md` is written. Failure aborts the run; the previous brain file is left intact.
8. **Freshness token quoted on first response.** The consumption contract requires Claude to quote the freshness token verbatim on first use of a brain.

### Build order (when adding a brain or shipping the factory)

| #   | Files                                                                                                                                             | Atomic group |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | `refinery/types/pack.mts` — add `domain` (`BrainDomain`), `input_brains` (default `[]`), `outputProducer?`. Add `trust_tier` to `SourceConnector` | **A**        |
| 2   | `refinery/config/packs.mts` — backfill `domain` + `trust_tier` on all 3 existing packs                                                            | **A**        |
| 3   | `refinery/sources/brain-input-source.mts` — `makeBrainInputSource()` factory                                                                      | —            |
| 4   | `refinery/lib/confidence.mts` — pure deterministic confidence function                                                                            | —            |
| 5   | `refinery/render/master-index.mts` — render `--- OUTPUT ---` after `SAVED FACTS`                                                                  | **B**        |
| 6   | `refinery/validate/spec-validator.mts` — add `--- OUTPUT ---` to `REQUIRED_SECTIONS`                                                              | **B**        |
| 7   | `refinery/stages/4-output.mts` — call `outputProducer`, compute confidence, optional registry upsert                                              | —            |
| 8   | `refinery/lib/dag.mts` — topo sort + cycle detect + stale walker + `walkConsumers`                                                                | —            |
| 9   | `refinery/cli.mts` — wire DAG resolver + `--force` flag                                                                                           | —            |
| 10  | `docs/sql/brain_registry.sql` — Supabase paste                                                                                                    | —            |
| 11  | `refinery/scaffold.mts` — atomic per-pack write + index append                                                                                    | —            |
| 12  | `refinery/packs/macro-swfl.mts` — first brain through the factory                                                                                 | —            |

### Success test

A new contributor runs `npx tsx refinery/scaffold.mts --id=foo --domain=finance --input-brains=master`, fills in three `fetch()` implementations, runs `npm run refinery foo`, and a deployable `brains/foo.md` lands with a valid `--- OUTPUT ---` block. **Zero edits to `packs.mts`. Zero edits to `cli.mts`.**

### Pointers

- Refinery pipeline: `refinery/stages/{1-4}-*.mts`
- Pack registry (today, monolithic): `refinery/config/packs.mts` — moves to `refinery/packs/{id}.mts` + `index.mts` in step 1+11
- Output rendering: `refinery/render/master-index.mts`
- Validators: `refinery/validate/{spec-validator,facts-only-lint,inference-bait-lint}.mts`
- Freshness: `refinery/lib/freshness.mts`
- Consumption contract for downstream Claude sessions: `docs/consumption-contract.md`
- Engine state snapshot: `docs/engine_state_may15.md`
- CT prior review (pre-lock): `docs/factory-review.md`
- **Ontology + roadmap (living doc, quarterly review, next: 2026-08-15):** `docs/ontology-and-roadmap.md`
