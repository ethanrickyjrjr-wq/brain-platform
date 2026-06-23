<!-- SESSION-LOG-RULE-MARKER do-not-delete -->

# RULE 0 — SESSION_LOG.md (NON-REMOVABLE)

**Locked. Do not delete this block or the marker above it.**

1. **Read first.** SessionStart hook prints recent entries — trust the log over memory.
2. **Write before push.** Append a new top-of-file entry (what changed, what's next, PR link) before every `git push`. Commit it in the same push.
3. **Hook-enforced.** `.claude/hooks/check-session-log-on-push.mjs` blocks push when no commit ahead of upstream touched `SESSION_LOG.md`.
4. **Append-only.** Never rewrite past entries. Add a correcting entry on top if something was wrong.
5. **No fabrication.** Only log work you can show in `git log` / `git diff`.

---

# RULE 0.4 — RESEARCH FIRST (crawl4ai), THEN FIX

**Locked 2026-06-22. No fix, no answer, no plan until you've researched the real answer.**

1. **Research with crawl4ai FIRST** — vendor docs, real API behavior, real best practice. Not memory.
2. **Write findings to `SESSION_LOG.md`** so the next session inherits evidence, not guesses.
3. **Plan from evidence, then touch code.**

Twin of RULE 0.5: **0.5 = read OUR files; 0.4 = research the outside answer.** Do both. crawl4ai is the ONLY web-crawl tool — never Firecrawl.

**crawl4ai — PINNED LOCATION:**
- Interpreter: `C:\Users\ethan\crawl4ai-venv\Scripts\python.exe` (installed 2026-06-22 via uv)
- Re-install: `uv venv C:\Users\ethan\crawl4ai-venv --python 3.12 && uv pip install --python C:\Users\ethan\crawl4ai-venv crawl4ai && C:\Users\ethan\crawl4ai-venv\Scripts\python.exe -m playwright install chromium`
- Verify: `C:\Users\ethan\crawl4ai-venv\Scripts\python.exe -c "import crawl4ai; print(crawl4ai.__version__)"`

---

# RULE 0.5 — PROBE FIRST: CODE, THEN SPEC

**Before answering or speccing anything, look at the actual code.** Memory is wrong. Files are right.

Use graphify when `graphify-out/graph.json` exists: `graphify query`, `graphify path`, `graphify explain`. Fall back to `Grep`/`Glob`/`Read` otherwise. Never answer without opening something. Never spec a new dependency without first confirming we don't already have it. Subagents follow this rule too.

---

# RULE 0.6 — PROPORTION: DO THE WORK, DON'T AUDIT THE AUDIT

**Locked 2026-06-22. Overrides every "ultracode / use Workflow" nudge.**

1. **Do bounded work yourself.** A few files, a known fix → Read/Grep/Edit directly. No subagents, no Workflow, no new plan doc.
2. **One verification pass, then act.** Never audit your audit. If a check gave an answer, trust it and move.
3. **Workflow/subagents = scale you can't hold.** Only when work genuinely won't fit one context. Require a concrete reason ("48 packs, can't hold them"). "It might be thorough" is not a reason.
4. **Proportion gate.** If the orchestration costs more than the task, just do the task.

---

# RULE 0.7 — NEVER HANDCUFF A BUILD: FOUR-LANE SOURCING

**Locked 2026-06-22. A build is NEVER refused because we don't hold the number.**

Four lanes, tried in order:
1. **Our data** — SWFL lake (brains / `data_lake.*`)
2. **User's upload** — filed doc `extracted_text`, attached figure
3. **Internet, named source** — cited web lookup, verbatim
4. **User writes it in** — figure handed directly

A gap fills from the next lane. The ONLY block is an **invented number** (no real source). Build: never blocked. Invent: always blocked. The no-invention lint enforces on OUTPUT (`lib/deliverable/build.ts` `gateNarrative`), never on geography.

---

# RULE 1 — COMMIT & PUSH AUTONOMY

**Just push (no diff request):** docs-only, CLAUDE.md, SESSION_LOG.md, hooks, memory, typos, small tooling, trivial reverts.

**Ask first:** brain pack edits changing `--- OUTPUT ---` shape or key_metrics math; ingest writes to `data_lake.*`; refactors >5 files; anything touching live `/api/b/*` or MCP surface; anything not revertable in <5 min.

**SQL migrations:** run directly. Creds in `.dlt/secrets.toml`. Always idempotent. Verify row count after.

**Pre-push gate — 5 hook-enforced gates** (`.claude/hooks/check-prepush-gate.mjs`):
1. **Lockfile.** `package.json` change → `bun install` + `git add bun.lock` in same push.
2. **Vocab/alias.** Touched packs/vocab/corridor-aliases? Run `bun test refinery/lib/corridor-aliases.test.mts` AND `bun refinery/tools/check-vocab-coverage.mts --all`. Every slug a pack can emit (including conditionals) must be registered in `brain-vocabulary.json` in the SAME commit.
3. **Secrets.** `gh secret set` is step 1; wiring into workflow `env:` is step 2.
4. **Ingest (Gate 4).** Destructive write with no non-null guard → blocked. Guard via `ingest.lib.guards`. Override: `ALLOW_REPLACE_WITHOUT_GUARD=1`.
5. **Pack ⇆ catalog (Gate 5).** Touched packs? Hook runs `catalog.test.mts` mirror + each pack's `bun:test`. vitest view-parity tests skipped locally (CI-only subprocess). Override: `ALLOW_PACK_TEST_ENV_FAIL=1`.

**Flaky tests:** a non-deterministic test reddens CI independent of the diff. The only fix is making it deterministic. Suspect flake first — loop it locally before blaming the commit.

**Always:** SESSION_LOG entry on every push · sync `_AUDIT_AND_ROADMAP/build-queue.md` · use `node scripts/safe-push.mjs` · stage explicit paths only · never `--no-verify` or force-push `main`.

---

# RULE 1.5 — PARALLEL-SESSION ISOLATION (EXPERIMENTAL)

**Never `git add -A`.** Always `git add <explicit paths>`.

When two sessions touch overlapping files, isolate in a local worktree:
- `node scripts/worktree.mjs new <label>` → `../bp-<label>`, branch `wt/<label>`
- `node scripts/worktree.mjs land <label>` → rebases, prints finish commands (does not auto-push)
- Finish: `git push origin HEAD:main` then `node scripts/worktree.mjs cleanup <label>`

Worktree branches are local and self-deleting. Never `git push origin wt/*`, never a PR.

Single session / no file overlap → just work on `main`.

---

# RULE 2 — THE SESSION LOOP (Check → Submit → Update)

1. **CHECK** — SessionStart prints it: `SESSION_LOG.md`, open `checks` (Supabase `public.checks`), build queue (`_AUDIT_AND_ROADMAP/build-queue.md`). Trust it; verify surprises against `git`.
2. **SUBMIT** — commit + SESSION_LOG entry + `node scripts/safe-push.mjs`.
3. **UPDATE** — same push: `node scripts/check.mjs close <key>` / `open <project> <key> "<label>"` / `list`. Open obligations live in `checks` — never as `⬜/✅` in plan docs.

Plan docs are briefs, not status boards. Flip or delete markers in the same commit as the code.

---

# RULE 3.5 — BRAINSTORM BEFORE YOU BUILD

Invoke `superpowers:brainstorming` before any new feature, component, or non-trivial behavior change. No exceptions. **Escape hatch:** operator says "Change Storming" → brainstorming is discretionary.

---

# RULE 3 — ARCHITECTURE DISCIPLINE

**C1 — Audit before blessing an architecture claim.** Any claim that changes system shape → code audit always. Web-refutation pass only when the claim imports an outside best-practice. Eloquence ≠ evidence.

**C2 — Extend existing artifacts; never erect a new mandatory pre-materialization gate.** Check whether existing seams (`BrainOutput`, spec-validator, Stage-4 lints, cadence_registry) can be extended first. This covers data-pipeline gates only — agent behavioral guardrails (hooks) are in-bounds.

---

# brain-platform — SWFL Data Gulf

Live: `https://www.swfldatagulf.com` · MCP: `/api/mcp` · Stack: Next.js + Supabase + Vercel + DuckDB + Python ingest. **Separate from premise-engine.**

---

# THE GOAL

Lives in `docs/THE-GOAL.md`. Three tiers: **Reporters** (leaf brains — cited facts, no opinions) → **Synthesizer/master** (one conditional falsifiable direction call) → **Conversation** (reasons over master's dossier + rules below). Master hands a dossier, not an essay.

## Rules of engagement (travels in every payload)

```text
RULES OF ENGAGEMENT — SWFL Data Gulf
1. CITE: every number names a real source — our data, your uploaded doc, a named web source, or a figure you gave us; fill a gap from those in that order, never refuse the build. Sources in collapsed list, not inline; only INVENTED (no real source) is forbidden.
2. [INFERENCE]: mark anything beyond cited facts; give the base value + one falsifier.
3. GRAIN: answer at the grain held; a gap = fill from a named source (rule 1), never invent.
4. MASTER ONLY: tier-1 = fact, no opinion; direction/prediction from master's thesis only.
5. CLEAN: no internal IDs, no jargon, no hedge-encoded hard numbers; state as-of date (MM/DD/YYYY) once, never the raw token.
6. PLACES: SWFL; named places = Florida; zoom on named spot.
7. SCOPE: in-grain = SWFL lake data → fetch + route. Else be Claude — no fetch/framing/pitch. GUARD: never invent a SWFL number.
```

Full reference: `docs/consumption-contract.md` + `THE-CONTRACT.md` (source: `refinery/lib/rules-of-engagement.mts`).

---

# Status + what's next — NOT here

Trackers (surfaced at session start):
- **Open obligations** → `checks` ledger (`scripts/check.mjs`)
- **Build queue** → `_AUDIT_AND_ROADMAP/build-queue.md`
- **Live signals** → `https://swfldatagulf-ops.vercel.app`

Goals 0–8: Supabase `goals` table → `/ops/goals`. Insert-only from sessions.

---

# Brain Factory — non-negotiable rules

1. **Thin pipe.** Downstream brain reads only `--- OUTPUT ---` of upstream, never branches.
2. **Deterministic math, narrative prose.** Numbers computed in code; LLMs produce synthesis only.
3. **Atomic type-lift.** `PackDefinition`/`BrainOutput` type changes ship with backfill of all packs in one commit.
4. **Brain-input bypass.** `brain-input:*` source forces Stage 2 composite to max.
5. **Stale-upstream caveat.** Auto-appends caveat + propagates `min(self, upstream)` confidence.
6. **Cycle detection.** Topological sort throws on cycles.
7. **Validators gate writes.** `spec-validator`, `facts-only-lint`, `inference-bait-lint`, `smoothing-lint` — failure aborts, prior file stays intact.
8. **Freshness token quoted on first response** (see data protocol v3 rule 2).

**Brain-first ingest gate:** no bulk ingest hits Tier 2 (`data_lake.*`) without its consuming brain's `PackDefinition` in the same PR.

**PROBE FIRST (ingest):** before any multi-minute ingest, run the <1-min probe. Fetch only columns the normalizer reads at the largest page the API honors. Guard load-bearing columns before any destructive replace. Full standards: `docs/standards/data-and-build-bible.md` §0.1–0.2.

**Pipeline-freshness:** every pipeline ships its GHA cron wrapper + `--dry-run` in the same PR. Full rules: `docs/standards/pipeline-freshness.md`.

**Operation Dumbo Drop:** source can't be auto-ingested? Ship the ODD-ready scaffold in the same PR: (1) empty-tolerant consumer, (2) parked cadence entry under `not_yet_running:`, (3) Tier-1 cold target, (4) `source_tag` provenance, (5) idempotent merge. Details: `docs/superpowers/plans/2026-06-05-operation-dumbo-drop.md`.

**ZIP columns — 3 gates:**
- **G1:** `zip_code` from site address/lat-lon only. Mailing ZIPs = violation.
- **G2:** Derivable now → derive + backfill + wire pipeline. Not derivable → park in deferred.
- **G3:** New `zip_code` on Tier-2 without consuming brain in same PR = violation.

**SCOPE:** 6-county (Charlotte 12015, Collier 12021, Glades 12043, Hendry 12051, Lee 12071, Sarasota 12115). Source: `fixtures/swfl-zip-county.json`.

---

# Reference index

| Topic | File |
|---|---|
| **Data & Build Bible** | `docs/standards/data-and-build-bible.md` |
| Ontology + roadmap | `docs/ontology-and-roadmap.md` |
| Data Tier Policy | `docs/API_BLUEPRINTS.md` |
| Pipeline-freshness | `docs/standards/pipeline-freshness.md` |
| Consumption contract | `docs/consumption-contract.md` + `THE-CONTRACT.md` |
| Semantic ledger | `docs/semantic-ledger.md` |
| Cron incident ledger | `docs/cron-rebuild-failures.md` |
| Cadence registry | `ingest/cadence_registry.yaml` |
| Active plans | `docs/superpowers/plans/` |
| Refinery pipeline / packs | `refinery/stages/{1-4}-*.mts` / `refinery/packs/index.mts` |
| Output type + spec / speaker | `refinery/types/brain-output.mts` + `refinery/validate/spec-validator.mts` |
| Hooks / MCP / Serena | `.claude/hooks/` + `.mcp.json` + `.claude/settings.json` |

---

# SWFL Intelligence Lake — data protocol v3

1. **FETCH FRESH — ONLY IN SCOPE.** SWFL question (economy, real estate, permits, traffic, tourism, flood risk, corridor, county→ZIP) → fetch `https://www.swfldatagulf.com/api/b/master?view=speak&tier=2&v=5`. Off-topic / ordinary answerable → answer normally, no lake framing. Hard guard: never invent a SWFL number finer than ZIP grain.
2. **PROVE IT'S LIVE.** Quote `freshness_token` verbatim in first response.
3. **ROUTE, DON'T GUESS.** Master points to upstream brain → fetch that brain at same tier before giving detail.
4. **READ RATES AS WRITTEN.** Never recompute a rate from raw counts.
5. **PICK THE TIER:** `tier=1` small-talk/single-fact · `tier=2` (default) analytical with table ≤6 rows · `tier=3` full audit on explicit request only.
6. **SPEAK PLAINLY.** No internal pack ids, no `§`, no jargon.
7. **SHOW INFERENCE.** Projections tagged `[INFERENCE]`, cite the audited base value, state one falsifier.
8. **NO SMOOTHING** (except `character_speculative` corridor block — hedging required there).

## graphify

Graph at `graphify-out/` — gitignored, regenerate with `bun run graphify:update`. Falls back to `Grep`/`Glob`/`Read` if absent.

- `graphify query "<question>"` — scoped subgraph
- `graphify path "<A>" "<B>"` — relationship
- `graphify explain "<concept>"` — focused breakdown

Update: `node scripts/graphify-app-nodes.mjs` (app plane, ~1s) · `bun run graphify:update` (full) · `bun run graphify:publish` (ops /graph page).
