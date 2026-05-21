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

## Developer Setup — Serena MCP

Serena gives Claude Code symbol-level semantic code intelligence (40+ languages, including TypeScript). Wired at project scope via `.mcp.json` + `.claude/settings.json` hooks. The `serena-agent` binary is a user-level install.

### Setup sequence (one-time, in order)

1. `uv tool install -p 3.13 serena-agent@latest --prerelease=allow`
2. `serena init`
3. Restart Claude Code so `.mcp.json` is picked up and the SessionStart hooks fire.

The hooks in `.claude/settings.json` will not work until both `serena-agent` and `serena-hooks` are on `PATH`. Running steps 1 and 2 puts them there.

### Optional max-adherence session launch

`claude --system-prompt="$(serena prompts print-cc-system-prompt-override)"`

Serena's docs flag Opus 4.7 as biased toward built-in Grep/Read; the hooks partially compensate, but the system-prompt override is the strongest fix. Use it when you need maximum semantic-tool adherence (large refactors, symbol-heavy work).

### Verification protocol

After a fresh restart, run these in order. Any failure means the wiring is broken — stop and fix before doing real work.

1. `/mcp` — `serena` must appear and be **connected**. If not, `.mcp.json` was not picked up.
2. `serena context list` (in a separate shell) — confirms the `claude-code` context is active for this project.
3. Symbolic search smoke test: ask "find the `normalizeStage` function" or "show me the `attributeError` symbol." A Serena MCP tool (e.g. `mcp__serena__find_symbol`) must fire — not built-in Grep/Read.

### Risks (intentional fail-fast design)

- **Missing `serena-agent` on PATH:** the SessionStart `serena-hooks activate` command will error loudly and block normal session bootstrap. This is intentional — silent fallback to Grep/Read would defeat the point of wiring Serena in the first place. Fix: run the install command above.
- **`.mcp.json` only loads on Claude Code start.** Edits to it during a session have no effect until restart.
- **`--project "."` is path-relative.** Launching Claude Code from outside the repo root will point Serena at the wrong directory. Always start CC from `brain-platform/`.

---

## Developer Setup — Build-Context Gate

Every session must start with a fresh `.claude/build-context.md` describing the intake for that session (goal, scope boundary, success test, files in play). The SessionStart hook `.claude/hooks/check-build-context.mjs` enforces this.

- **What it checks:** `.claude/build-context.md` exists AND was modified within the last **4 hours**.
- **What happens on failure:** the hook prints a loud banner to stdout (so Claude sees it as session context) and exits non-zero. Treat the failure as a hard stop — populate or refresh the file before doing work.
- **What happens on pass:** the hook prints a one-line OK with the file's age.
- **Why 4 hours:** short enough that stale intake from yesterday's session can't masquerade as today's plan; long enough to survive a coffee break.
- **Why "rewrite, don't touch":** the freshness check is mtime-based, but the _point_ is current intent. Touching the file to silence the hook is technically allowed and operationally a lie.

`.claude/build-context.md` is intentionally not committed — it's session-scoped, not project-scoped.

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

### Data Tier Policy (locked 2026-05-17)

Five rules that govern every new state/national dataset ingest. Lives in full at `docs/API_BLUEPRINTS.md`; summary here:

1. **Three-tier storage.** Tier 1 = Supabase Storage (cheap cold layer, ~$0.021/GB/mo) for geometry + speculative tabular Parquet. Tier 2 = Postgres `data_lake.*` (~$0.125/GB/mo) — ONLY when a consuming brain ships the same sprint. Tier 3 = promoted brain-validated baselines in non-`data_lake` Postgres schemas.
2. **Brain-first ingest gate.** No bulk ingest hits Tier 2 without its consuming brain's `PackDefinition` in the same PR. No direct Refinery SQL against `data_lake.*`.
3. **Macro denominator chain canonical.** `macro-us` (national) → `macro-florida` (state) → `macro-swfl` (regional deltas). Every gap-\* brain declares `macro-florida` as upstream. Gap math in code, never LLM.
4. **logistics-swfl owns FAF5; macro-\* stays economic/environmental.** Domain isolation per the `BrainDomain` union.
5. **FAF5 cold-storage provenance.** ORNL is the archive. `data_lake.faf_flows` is a working cache with `_ingest_metadata` rows for traceability — no Postgres bill for archival.

Cost rationale: a 50 GB speculative dump costs ~$1.05/mo in Tier 1 vs ~$6.25/mo in Tier 2 — multiplied across CBP, ACS, FEMA, FDOT historical the gap compounds fast.

Tool placement matrix (dlt vs DuckDB lanes, anti-patterns, cross-tier deferral) is in `docs/API_BLUEPRINTS.md` (Data Tier Policy → Tool Placement).

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
- Speaker layer (Stage 6, user-facing rendering): `refinery/render/speaker.mts` + report page at `app/r/[slug]/page.tsx`. Reached via `/api/b/{slug}?view=speak&tier=N`.
- Validators: `refinery/validate/{spec-validator,facts-only-lint,inference-bait-lint}.mts`
- Freshness: `refinery/lib/freshness.mts`
- Consumption contract for downstream Claude sessions: `docs/consumption-contract.md`
- Engine state snapshot: `docs/engine_state_may15.md`
- CT prior review (pre-lock): `docs/factory-review.md`
- **Ontology + roadmap (living doc, quarterly review, next: 2026-08-15):** `docs/ontology-and-roadmap.md`

SWFL Intelligence Lake — data protocol v3 (always follow):

1. FETCH FRESH. Before answering any SWFL-scope question (Lee or Collier
   County, FL), fetch
   https://brain-platform-amber.vercel.app/api/b/master?view=speak&tier=2&v=5
   in THIS conversation. Pick the tier from the question shape (see rule 5).
   Never answer from memory, project knowledge, earlier messages, or a cached
   copy — only from a fetch made in this conversation.
2. PROVE IT'S LIVE. The payload carries a `freshness_token` (format
   SWFL-7421-v{n}-{YYYYMMDD}). Quote it verbatim in your first response. If
   you cannot fetch, say so — never answer from stale context.
3. ROUTE, DON'T GUESS. The master read is a synthesis. When it points to an
   upstream brain for record-level detail (franchise-outcomes, cre-swfl,
   properties-lee-value, etc.), fetch that brain at the same tier before
   answering with the detail.
4. READ RATES AS WRITTEN. Survival rates, charge-off rates, and any other
   ratios are stated explicitly in the payload and are always over their
   stated denominators (resolved loans for survival, etc.). Never recompute
   a rate from raw counts.
5. PICK THE TIER from the question shape:
   - tier=1: small-talk, one-liners, clarifications, single-fact lookups.
     Reply in 2-5 sentences. Include the report-page link the payload
     contains and the freshness token. No table.
   - tier=2 (default for analytical questions): scope opener, conclusion,
     compact key-metrics table (<=6 rows), caveats, report-page link,
     freshness token.
   - tier=3: full audit. Only fetch when the user explicitly asks for
     "the audit," "the full breakdown," or "everything you have."
6. SPEAK PLAINLY. The speaker layer has already translated the payload for
   tier 1/2 replies. Do not reuse internal pack identifiers (env-swfl,
   properties-lee-value, master, etc.) in your prose. Never write the
   section-marker character. Never write "bifurcate." Never say
   "siblings haven't shipped." If the payload can't answer something,
   say what we don't know in plain English.
7. SHOW INFERENCE. Numbers come verbatim from the payload's key_metrics
   or conclusion. If you make a projection that goes beyond the audited
   numbers, mark the projection inline [INFERENCE], cite the audited
   value it builds on, and state at least one condition that would
   falsify it.
8. NO SMOOTHING. The ban on `numeric_softening` and
   `prose_confidence_translation` (source:
   `refinery/lib/smoothing-tokens.mts`) applies to every line of your
   reply. Quantify projections numerically — don't re-encode deterministic
   numbers into ambiguous English.
