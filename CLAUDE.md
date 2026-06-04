<!-- SESSION-LOG-RULE-MARKER do-not-delete -->

# RULE 0 — SESSION_LOG.md (NON-REMOVABLE)

**This rule is locked by operator decree. Do not delete this block. Do not delete the marker comment above it. A SessionStart hook verifies the marker on every session and will fail loudly if it is missing.**

1. **Read first.** At session start, read `SESSION_LOG.md` at repo root. The SessionStart hook prints the most recent entries — they are the source of truth for what the previous Claude actually did. Trust the log over your memory and over your assumptions.
2. **Write before push.** Before any `git push`, append a new entry at the top of `SESSION_LOG.md` (newest-first) covering: what changed (1–3 lines, file paths welcome), what's next or blocked, and any PR / plan link. Commit the log entry as part of the work (or as its own `log: ...` commit) — then push.
3. **Hook-enforced.** `.claude/hooks/check-session-log-on-push.mjs` blocks `git push` when no commit ahead of upstream touched `SESSION_LOG.md`. If you see the block, the system is working — write the entry, commit, retry.
4. **Append-only.** Never rewrite or delete past entries. If something earlier is wrong, add a correcting entry on top.
5. **No fabrication.** Only log work you actually did and can show in `git log` / `git diff`. "I told Sonnet to..." is not a thing — there is no live Sonnet to tell. Sessions don't talk; files do. The log is the only channel.

If this rule or the marker comment above it is missing the next time a session starts, the SessionStart hook will block — restore the block verbatim before doing anything else.

---

# RULE 1 — COMMIT & PUSH AUTONOMY

Operator policy (locked 2026-05-26): you decide when to commit and push. Don't ask permission for every diff — exercise judgment. The session-log hook is the failsafe; the rubric below is the judgment.

**Just commit and push (no diff request):** rule/policy/doc-only changes (`CLAUDE.md`, `SESSION_LOG.md`, `docs/**`, READMEs); hook installs and `.claude/**` wiring; memory updates; typos/dead-links/comment edits; small tooling additions and trivial reverts; anything you authored this session that's easy to revert with one commit.

**Ask for a diff review before pushing:** brain pack edits (`refinery/packs/**`) that change `--- OUTPUT ---` shape or key_metrics math; ingest changes that write `data_lake.*` or touch production secrets; multi-file refactors (>5 files) or cross-domain renames; anything that could change a live `/api/b/*` response or the MCP surface; anything you can't revert in under five minutes. (`ops/` no longer exists here — the dashboard is the standalone `swfldatagulf-ops` repo, deployed with `vercel --prod`. Don't look for a backup copy.)

**SQL migrations — run them directly, never hand to the operator.** Credentials live in `.dlt/secrets.toml` (gitignored). URI: `postgresql://postgres:{password}@{host}:5432/postgres`. Run via `python -c "import psycopg; ..."` or a one-off script. Always write them idempotent (`IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS` not `ADD CONSTRAINT`). Verify row count after.

**Pre-push gate — the three recurring breakers** (each has aborted the nightly rebuild more than once; now hook-enforced by `.claude/hooks/check-prepush-gate.mjs`, which also matches `safe-push`):

1. **Lockfile.** Any `package.json` dependency change requires `bun install` + `git add bun.lock` in the same push. Skipping it makes CI's `bun install --frozen-lockfile` fail in <1s (`lockfile had changes, but lockfile is frozen`) and block the whole rebuild. No exceptions.
2. **Vocab/alias.** Touched `refinery/packs/**`, `refinery/vocab/**`, `refinery/lib/corridor-aliases.mts`, or `fixtures/corridor-*`? Run `bun test refinery/lib/corridor-aliases.test.mts` + `bun refinery/tools/check-vocab-coverage.mts` first. (The full guarantee — a brand-new pack-emitted slug — only comes from a local rebuild: `npm run refinery -- master --force`.)
3. **Secrets.** A secret isn't live until it's in every workflow `env:` block that invokes the pipeline — `gh secret set` is step 1, the `env:` wiring is step 2.

Incident detail + "Recurring Patterns" live in `docs/cron-rebuild-failures.md`.

**Always (no exceptions):**

- `SESSION_LOG.md` gets a new top-of-file entry on every push (RULE 0; the pre-push hook enforces it — don't fight it, write the entry).
- Use `node scripts/safe-push.mjs` instead of raw `git push`. It fetches, rebases your commits on top of anyone who landed first, shows you exactly what's going, then pushes (auto-retries up to 3×).
- Stage only files you created or intentionally modified. Untracked files in your tree may be the operator's in-progress work.
- Never use `--no-verify`, never skip hooks, never force-push to `main`.

The point: every new Claude on any machine should clone this repo, read `SESSION_LOG.md` on `main`, and know exactly where things stand without asking. GitHub is the cross-session bus.

---

# RULE 2 — THE SESSION LOOP (Check → Submit → Update)

**Every session runs the same three beats. No branches, no special cases. The reason "nobody knew where we are" was a missing third beat — work shipped but the durable tracker never moved, so the next CHECK was a lie.**

1. **CHECK** — the SessionStart kickoff prints it for you: last ship (`SESSION_LOG.md`), open `checks` (the Deferred-Commitment Ledger — Supabase `public.checks`, spec `docs/superpowers/specs/2026-05-30-deferred-commitment-ledger-design.md`), and the build queue (`_AUDIT_AND_ROADMAP/build-queue.md`). That is the state. Trust it over memory; verify any surprise against `git`/code before acting.
2. **SUBMIT** — ship the work: commit + a top-of-file `SESSION_LOG.md` entry + `node scripts/safe-push.mjs`. (Hook-enforced; don't fight it.)
3. **UPDATE** — in the _same_ push, reconcile the ledger so the next CHECK is true:
   - finished something → `node scripts/check.mjs close <check_key> [note]` (`--drop` to abandon)
   - found / left something open → `node scripts/check.mjs open <project> <check_key> "<label>" [--detail "…"] [--due YYYY-MM-DD]`
   - `node scripts/check.mjs list` to see what's open. Open obligations live in the `checks` table — **never** as `⬜/✅` markers in a plan doc.

**Plan/handoff docs under `docs/superpowers/plans/**`are briefs, not status boards.** Their`⬜/✅ DECISION`markers rot the instant code ships without flipping them — that drift is what makes a finished job look unfinished and burns the next session re-litigating settled work. So: never trust a plan-doc marker as done/not-done — verify against`git` + the file first; and if a plan doc carries a marker, flip or delete it in the _same commit_ as the code. Shipping the fix and leaving the tracker stale IS the bug this rule kills.

---

# RULE 3 — ARCHITECTURE DISCIPLINE (working agreement + standing refusal)

Locked 2026-06-04 from the row-tier / "Source Contract as spine?" audit. Two rules for how architecture-level decisions get made here.

**C1 — Audit before you bless an architecture claim.** Any claim that changes the _shape_ of the system — a new storage tier, a new mandatory gate, a new primitive, or any "X is the spine / the one thing" — gets a **code audit always** (open the files; verify the surface exists as described; a plan or README that names a surface is a hypothesis, not authority, and can be hallucinated). It gets an **adversarial web-refutation pass _only_ when the claim imports an outside best-practice** ("the data-contract community mandates contract-first," "everyone uses bitemporal here"). Eloquence is not evidence — a well-argued case for the wrong primitive is still the wrong primitive. Reserving the web pass for _imported_ claims keeps it cheap.

**C2 — Extend the enforced artifact; never erect a new mandatory pre-materialization gate.** Before adding a gate everything must pass through, ask whether the seam you already have (consumption contract, `BrainOutput` + spec-validator, the Stage-4 lints, the brain-first ingest gate, `cadence_registry`) can be **extended** instead. The five-facet "Source Contract as spine" was rejected on evidence (dbt warns against early bundled governance; ODCS is descriptive, not a gate; GoCardless ran the contract _alongside_ a precomputed layer). **Scope:** this refusal covers **data-pipeline gates and mandatory pre-materialization schema constraints** — the machinery that turns sources into the lake. It does **NOT** cover the agent's own behavioral guardrails (path-guard hooks, hook enforcement); those gate Claude's behavior, not the materialization path, and are explicitly in-bounds (`.claude/hooks/check-project-path.mjs`, the Rule-8 cross-project guard, is exactly such a hook).

---

# brain-platform — SWFL Data Gulf

Live at `https://www.swfldatagulf.com`. MCP at `/api/mcp` (`claude mcp add --transport http swfl https://www.swfldatagulf.com/api/mcp`). Stack: Next.js + Supabase + Vercel + DuckDB + Python ingest. **Separate from premise-engine — never mix them.**

---

# THE GOAL — source of truth

**What we are building and how it must work lives in `docs/THE-GOAL.md`. Read it first.** Three tiers: **Tier 1 — Reporters** (leaf brains + corridor voices; cited current facts, no opinions) → **Tier 2 — Synthesizer (master)** (the only speculator; one grounded, conditional, falsifiable direction call over the whole lake) → **Tier 3 — Conversation** (the user's AI reasons over master's dossier + the lean block below, answering follow-ups without re-fetching). Master hands a **dossier, not an essay**; speculation is **conditional (IF/THEN + falsifier), not flat.** The proof is in the data.

## Rules of engagement (this lean block travels in every payload)

```text
RULES OF ENGAGEMENT — SWFL Data Gulf
1. CITE: no source in this payload → no claim.
2. [INFERENCE]: mark anything beyond cited facts; give the base value + one falsifier.
3. GRAIN: answer at the grain held; a gap = offer to pull, never invent.
4. MASTER ONLY: tier-1 = fact, no opinion; direction/prediction from master's thesis only.
5. CLEAN: no internal IDs, no jargon (NNN = triple-net rent, never a place name), no hedge-encoding hard numbers; quote freshness_token once.
6. PLACES: SWFL; named places = Florida, not elsewhere; zoom on named spot.
7. SCOPE: in-grain = SWFL lake data (Lee/Collier, county→ZIP; named town/beach = ZIP) → fetch + route. Else be Claude — no fetch/framing/pitch: off-topic, other regions, OR ordinary answerables (Arby's on Cleveland Ave = answer normally). GUARD: never invent a SWFL number below ZIP.
```

Full reference: `docs/consumption-contract.md`. The contract that travels with every payload: `THE-CONTRACT.md` (canonical source: `refinery/lib/rules-of-engagement.mts`).

---

# Status + what's next — NOT here

Current state, what's shipped, and what's-next live in the **durable trackers**, never in this file (prose drifts; a ledger can't). **Do not record build status in CLAUDE.md** or in a plan/handoff doc. The trackers, all surfaced at session start (RULE 2 CHECK):

- **Open obligations** → the `checks` ledger (Supabase `public.checks`), reconciled with `scripts/check.mjs` (RULE 2 UPDATE).
- **Build queue** → `_AUDIT_AND_ROADMAP/build-queue.md`.
- **Live signals** (pipelines, GHA, brains) → the **/ops dashboard** (`https://swfldatagulf-ops.vercel.app`), derived from GitHub + Supabase.

Plan the next move from those, confirming done-ness against `git`. Roadmap detail: `docs/ontology-and-roadmap.md`.

The strategic **Goal 0–8 ladder** lives in a Supabase `goals` table, rendered at `/ops/goals` — the operator edits it in Studio; never seed/overwrite from a session (the seed is insert-only). **The carry contract is Goal 2 and it is live:** a downstream Claude reasons over master's dossier + the lean rules block above (rides in every MCP `_meta` / `/api/b?format=json` payload) and answers follow-ups without re-fetching. That carry contract is the spine — everything 3→8 stands on it.

---

# Brain Factory — non-negotiable rules

These fire on every pack / output operation. The locked v1.1 spec, build order, and reference detail live in the Notion blueprint (`36135f3b-7faf-813d-b9b8-dfc16ee7da0b`) and `docs/ontology-and-roadmap.md`.

1. **Thin pipe only.** A downstream brain never reads an upstream's branches — only its `--- OUTPUT ---` block.
2. **Deterministic math, narrative prose.** Numbers (counts, sums, medians, rankings, confidence) are computed in code. LLMs produce qualitative synthesis only.
3. **Atomic type-lift.** Type changes to `PackDefinition` / `BrainOutput` ship in the same commit as the backfill of all existing packs. No window where the codebase is broken.
4. **Brain-input fragments bypass `fitScore`.** A `brain-input:*` source is already distilled — Stage 2 forces its composite to max.
5. **Stale-upstream caveat.** When the DAG resolver builds against a stale upstream, it auto-appends `"Upstream brain '{id}' was stale at build time (expired {date})."` to `BrainOutput.caveats` and propagates `min(self, upstream)` confidence.
6. **Cycle detection.** Topological sort throws `Cycle detected: a → b → a` rather than infinite-looping.
7. **Validators gate writes.** Every render runs through `spec-validator`, `facts-only-lint`, `inference-bait-lint`, and `smoothing-lint` before the `.md` is written. Failure aborts the run; the previous brain file is left intact.
8. **Freshness token quoted on first response** (the canonical statement lives in data protocol v3 rule 2 below).

**Brain-first ingest gate (Data Tier Policy rule 2):** no bulk ingest hits Tier 2 (`data_lake.*` in Postgres) without its consuming brain's `PackDefinition` in the same PR. Tier 1 (Supabase Storage Parquet) is the speculative cold layer. Full policy: `docs/API_BLUEPRINTS.md`.

**Pipeline-freshness:** every ingest pipeline ships its GHA cron wrapper + `--dry-run` in the same PR. Vendor cadence is verified against the publisher's release calendar, not remembered. HTML scraping routes through `extract_client.scrape_with_fallback()` (Firecrawl primary, Spider fallback); `scrape_with_actions()` (Accela click-through) stays direct. Full rules: `docs/standards/pipeline-freshness.md`.

---

# Reference index (read when relevant — progressive disclosure)

**THE BIBLE — read before any data/ingest/lake/pack work:** `docs/standards/data-and-build-bible.md`. How data enters the lake, how each format (parquet/csv/ndjson/geojson) is read, the tier rules, the lake-MCP view rules, and the "wire a new dataset" checklist. We have the data — the job is wiring it, not rebuilding. Wins over older docs on any format/tier conflict.

| Topic                                       | File                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Data & Build Bible (formats/tiers/wire)** | **`docs/standards/data-and-build-bible.md`**                                                               |
| Ontology + roadmap + NEAR/LONG-TERM         | `docs/ontology-and-roadmap.md`                                                                             |
| Data Tier Policy + tool-placement matrix    | `docs/API_BLUEPRINTS.md`                                                                                   |
| Pipeline-freshness + Firecrawl/Spider rule  | `docs/standards/pipeline-freshness.md`                                                                     |
| Consumption contract (downstream Claude)    | `docs/consumption-contract.md` + `THE-CONTRACT.md`                                                         |
| Semantic ledger (SKOS + DAG + overrides)    | `docs/semantic-ledger.md`                                                                                  |
| Cron + rebuild incident ledger              | `docs/cron-rebuild-failures.md`                                                                            |
| Cadence registry (every pipeline)           | `ingest/cadence_registry.yaml`                                                                             |
| Active plans                                | `docs/superpowers/plans/`                                                                                  |
| Refinery pipeline / pack registry           | `refinery/stages/{1-4}-*.mts` / `refinery/packs/index.mts`                                                 |
| Output type + spec / speaker layer          | `refinery/types/brain-output.mts` + `refinery/validate/spec-validator.mts` / `refinery/render/speaker.mts` |
| Hooks / MCP / Serena setup                  | `.claude/hooks/` + `.mcp.json` + `.claude/settings.json`                                                   |

---

# SWFL Intelligence Lake — data protocol v3 (fires only on an in-scope SWFL question)

1. **FETCH FRESH — ONLY IN SCOPE.** If the question is answerable from this lake's SWFL (Lee/Collier FL) data — economy, real estate, permits, traffic, tourism, hurricane/flood risk, sector credit, corridor pulse, at any grain county→**ZIP/named-place** — fetch `https://www.swfldatagulf.com/api/b/master?view=speak&tier=2&v=5` in THIS conversation (tier per rule 5); never answer from memory or cache. **A named town, beach, corridor, or ZIP IS in grain** — "Is Fort Myers Beach a good buy" → ZIP 33931 ($30,074/yr AAL, +60bps): fetch and route, never "too specific." **Anything else — off-topic (weather, other regions, general knowledge, coding) OR an ordinary question you can just answer (store open? hours? directions? a definition?) — DON'T fetch and DON'T frame it as a data gap; answer normally**, no lake framing, no pitch. **One hard guard:** never invent a SWFL number (flood loss, sale price, stat) finer than we hold (single parcel/address) — offer the ZIP read instead.
2. **PROVE IT'S LIVE.** The payload carries a `freshness_token` (`SWFL-7421-v{n}-{YYYYMMDD}`). Quote it verbatim in your first response. Can't fetch? Say so — never answer from stale context.
3. **ROUTE, DON'T GUESS.** The master read is a synthesis. When it points to an upstream brain for record-level detail (franchise-outcomes, cre-swfl, properties-lee-value, etc.), fetch that brain at the same tier before giving the detail.
4. **READ RATES AS WRITTEN.** Ratios (survival, charge-off, etc.) are stated in the payload over their stated denominators (resolved loans for survival). Never recompute a rate from raw counts.
5. **PICK THE TIER from the question shape:** `tier=1` — small-talk/one-liners/single-fact; 2–5 sentences with the report-page link + freshness token, no table. `tier=2` (default, analytical) — scope opener, conclusion, key-metrics table (≤ 6 rows), caveats, report link, token. `tier=3` — full audit; only when the user asks for "the audit," "the full breakdown," or "everything you have."
6. **SPEAK PLAINLY.** The speaker layer already translated tier 1/2. No internal pack ids (env-swfl, master, etc.), no section-marker character, no "bifurcate," no "siblings haven't shipped." If the payload can't answer, say what we don't know in plain English.
7. **SHOW INFERENCE.** Numbers come verbatim from `key_metrics` or `conclusion`. A projection beyond the audited numbers is tagged inline `[INFERENCE]`, cites the audited value it builds on, and states one falsifying condition.
8. **NO SMOOTHING (one carve-out).** The ban on `numeric_softening` and `prose_confidence_translation` (`refinery/lib/smoothing-tokens.mts`) applies to every line BY DEFAULT — quantify projections numerically, don't re-encode deterministic numbers into vague English. **Exempt:** the corridor `character_speculative` block (v2 generator, `docs/superpowers/plans/2026-05-26-corridor-character-generator/`) — hedging is required there, not banned (it carries its own "Speculative — double-check" disclaimer). Every other surface follows the no-smoothing rule.
