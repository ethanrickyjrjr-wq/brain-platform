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

**Just commit and push (no diff request):**

- Rule, policy, or doc-only changes (`CLAUDE.md`, `SESSION_LOG.md`, `docs/**` prose, READMEs).
- Hook installs and `.claude/**` wiring.
- Memory file updates.
- Typos, dead-link fixes, comment-only edits.
- Small tooling additions and trivial reverts.
- Anything you authored this session that's easy to revert with one commit.

**SQL migrations — run them directly, never hand to the operator:**

Credentials live in `.dlt/secrets.toml` (gitignored). Connection URI: `postgresql://postgres:{password}@{host}:5432/postgres`. Run via `python -c "import psycopg; ..."` or a one-off script. Always write migrations to be idempotent (`IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS` instead of `ADD CONSTRAINT`). Verify row count after. This is your job, not the operator's.

**Ask for a diff review before pushing:**

- Brain pack edits (`refinery/packs/**`) that change `--- OUTPUT ---` shape or key_metrics math.
- Ingest pipeline changes that write to `data_lake.*` or touch production secrets.
- Multi-file refactors (>5 files) or renames that cross domains.
- Anything that could change a live `/api/b/*` response or the MCP surface.
- Anything you're not sure how to revert in under five minutes.
- **`ops/` no longer exists in this repo.** The ops dashboard moved to the standalone `swfldatagulf-ops` repo. Deploy from there with `vercel --prod`. Do not go looking for a backup copy.

**bun.lock — always regenerate after touching package.json:**

Any `package.json` change (add, remove, or version-bump a dep) requires `bun install` followed by `git add bun.lock` in the same commit. Skipping this causes `bun install --frozen-lockfile` to fail in CI with `error: lockfile had changes, but lockfile is frozen` — a fast, silent 1-second exit that blocks the entire daily rebuild. This has burned us multiple times. No exceptions.

**Always (no exceptions):**

- `SESSION_LOG.md` gets a new top-of-file entry on every push. The pre-push hook enforces this — if it blocks you, that's the rule doing its job; don't fight it, write the entry.
- Use `node scripts/safe-push.mjs` instead of raw `git push`. It fetches, rebases your commits on top of anyone who pushed first, shows you exactly what files are going, then pushes. Auto-retries up to 3× if another Claude lands while you're rebasing.
- Stage only files you created or intentionally modified. Untracked files in your working tree may be the operator's in-progress work.
- Never use `--no-verify`, never skip hooks, never force-push to `main`.

The point of this rule: every new Claude on any machine should be able to clone this repo, look at `SESSION_LOG.md` on `main`, and know exactly where things stand without asking. GitHub is the cross-session bus.

---

# brain-platform — SWFL Data Gulf

Live at `https://www.swfldatagulf.com`. MCP endpoint at `/api/mcp` (`claude mcp add --transport http swfl https://www.swfldatagulf.com/api/mcp`). Stack: Next.js + Supabase + Vercel + DuckDB + Python ingest. Separate from premise-engine — never mix them.

---

# THE GOAL — source of truth

**What we are building and how it must work lives in `docs/THE-GOAL.md`. Read it first.** Three tiers: **Tier 1 — Reporters** (leaf brains + corridor voices; cited current facts, no opinions) → **Tier 2 — Synthesizer (master)** (the only speculator; one grounded, conditional, falsifiable direction call over the whole lake) → **Tier 3 — Conversation** (the user's AI reasons over master's dossier + the lean block below, answering follow-ups without re-fetching). Master hands a **dossier, not an essay**; speculation is **conditional (IF/THEN + falsifier), not flat.** ChatGPT answers from Tier 3 alone (vibes); we force Tier 3 to stand on Tiers 1+2. **The proof is in the data.**

## Rules of engagement (this lean block travels in every payload)

```text
RULES OF ENGAGEMENT — SWFL Data Gulf
1. CITE. Every number traces to a source in this payload. No number, no claim.
2. TAG INFERENCE. Anything beyond the cited facts is marked [INFERENCE], with the
   value it builds on and one condition that would prove it wrong.
3. STOP AT THE GRAIN. Answer only at the grain the data holds. Do NOT offer
   drill-downs (a named business, a ZIP, a quarter) the payload doesn't contain.
   If asked past the grain, say what we don't have, plainly.
4. ONLY MASTER SPECULATES. Tier-1 facts carry no opinion. Direction calls and
   predictions come only from master's grounded, conditional thesis.
5. PLAIN ENGLISH. No internal IDs, no jargon, no hedging that re-encodes a hard
   number into vague words. Quote the freshness token once.
```

The full reference is `docs/consumption-contract.md`.

# Status + what's next — NOT here

Current state, what's shipped, and what's-next live in the **/ops live ledger** at `https://swfldatagulf-ops.vercel.app`, derived from real signals — never in this file (prose drifts; the ledger can't). **Do not record build status in CLAUDE.md.** Plan the next move from /ops, confirming done-ness against GitHub + the relevant /ops section. Roadmap detail still lives in `docs/ontology-and-roadmap.md`.

The **strategic Goal 0–8 ladder** lives in a Supabase `goals` table and renders at **`https://swfldatagulf-ops.vercel.app/goals`** — the operator edits it in Studio; never seed/overwrite it from a session (the seed is insert-only). **The carry contract is Goal 2 and it is live**: a downstream Claude reasons over master's dossier + the lean rules block above (rides in every MCP `_meta` / `/api/b?format=json` payload) and answers follow-ups without re-fetching. That carry contract is the spine — everything 3→8 stands on it.

---

# Brain Factory — non-negotiable rules

These fire on every pack / output operation. The locked v1.1 spec, build order, locked decisions, and reference detail live in the Notion blueprint (`36135f3b-7faf-813d-b9b8-dfc16ee7da0b`) and `docs/ontology-and-roadmap.md`.

1. **Thin pipe only.** A downstream brain never reads an upstream's branches — only its `--- OUTPUT ---` block.
2. **Deterministic math, narrative prose.** Numbers (counts, sums, medians, rankings, confidence) are computed in code. LLMs produce qualitative synthesis only.
3. **Atomic type-lift.** Type changes to `PackDefinition` / `BrainOutput` ship in the same commit as the backfill of all existing packs. No window where the codebase is broken.
4. **Brain-input fragments bypass `fitScore`.** A `brain-input:*` source is already distilled — Stage 2 forces its composite to max.
5. **Stale-upstream caveat.** When the DAG resolver builds against a stale upstream, it auto-appends `"Upstream brain '{id}' was stale at build time (expired {date})."` to `BrainOutput.caveats` and propagates `min(self, upstream)` confidence.
6. **Cycle detection.** Topological sort throws `Cycle detected: a → b → a` rather than infinite-looping.
7. **Validators gate writes.** Every render runs through `spec-validator`, `facts-only-lint`, `inference-bait-lint`, and `smoothing-lint` before the `.md` is written. Failure aborts the run; the previous brain file is left intact.
8. **Freshness token quoted on first response.** The consumption contract requires Claude to quote the freshness token verbatim on first use of a brain.

**Brain-first ingest gate (Data Tier Policy rule 2):** no bulk ingest hits Tier 2 (`data_lake.*` in Postgres) without its consuming brain's `PackDefinition` in the same PR. Tier 1 (Supabase Storage Parquet) is the speculative cold layer. Full policy: `docs/API_BLUEPRINTS.md`.

**Pipeline-freshness:** every ingest pipeline ships its GHA cron wrapper + `--dry-run` in the same PR. Vendor cadence is verified against the publisher's release calendar, not remembered. HTML scraping routes through `extract_client.scrape_with_fallback()` (Firecrawl primary, Spider fallback); `scrape_with_actions()` (Accela click-through) stays direct. Full rules: `docs/standards/pipeline-freshness.md`.

---

# Reference index (read when relevant — progressive disclosure)

**THE BIBLE — read before any data/ingest/lake/pack work:** `docs/standards/data-and-build-bible.md`. How data enters the lake, how each format (parquet/csv/ndjson/geojson) is read, the tier rules, the lake-MCP view rules, and the end-to-end "wire a new dataset" checklist. We have the data — the job is wiring it, not rebuilding. This file wins over older docs on any format/tier conflict.

| Topic                                               | File                                                                                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Data & Build Bible (formats, tiers, wiring)**     | **`docs/standards/data-and-build-bible.md`**                                                                                                                    |
| Ontology + roadmap + NEAR/LONG-TERM detail          | `docs/ontology-and-roadmap.md`                                                                                                                                  |
| Brain Factory v1.1 spec of record                   | Notion page `36135f3b-7faf-813d-b9b8-dfc16ee7da0b`                                                                                                              |
| Data Tier Policy + tool placement matrix            | `docs/API_BLUEPRINTS.md`                                                                                                                                        |
| Pipeline-freshness standard + Firecrawl/Spider rule | `docs/standards/pipeline-freshness.md`                                                                                                                          |
| Consumption contract (downstream Claude)            | `docs/consumption-contract.md`                                                                                                                                  |
| Semantic ledger (SKOS + DAG + overrides)            | `docs/semantic-ledger.md`                                                                                                                                       |
| Cron + rebuild incident ledger                      | `docs/cron-rebuild-failures.md`                                                                                                                                 |
| Cadence registry (every pipeline)                   | `ingest/cadence_registry.yaml`                                                                                                                                  |
| Active plans                                        | `docs/superpowers/plans/`                                                                                                                                       |
| Cross-session activity log                          | `SESSION_LOG.md`                                                                                                                                                |
| Refinery pipeline                                   | `refinery/stages/{1-4}-*.mts`                                                                                                                                   |
| Pack registry                                       | `refinery/packs/index.mts`                                                                                                                                      |
| Output type + spec                                  | `refinery/types/brain-output.mts` + `refinery/validate/spec-validator.mts`                                                                                      |
| Speaker layer (user-facing render)                  | `refinery/render/speaker.mts`                                                                                                                                   |
| Build-context gate                                  | `.claude/hooks/check-build-context.mjs` (enforces `.claude/build-context.md` is < 4h old)                                                                       |
| Serena MCP setup                                    | `.mcp.json` + `.claude/settings.json`; one-time install: `uv tool install -p 3.13 serena-agent@latest --prerelease=allow && serena init && restart Claude Code` |

---

# SWFL Intelligence Lake — data protocol v3 (fires on every SWFL-scope question)

1. **FETCH FRESH.** Before answering any SWFL-scope question (Lee or Collier County, FL), fetch `https://www.swfldatagulf.com/api/b/master?view=speak&tier=2&v=5` in THIS conversation. Pick the tier from the question shape (see rule 5). Never answer from memory, project knowledge, earlier messages, or a cached copy — only from a fetch made in this conversation.
2. **PROVE IT'S LIVE.** The payload carries a `freshness_token` (format `SWFL-7421-v{n}-{YYYYMMDD}`). Quote it verbatim in your first response. If you cannot fetch, say so — never answer from stale context.
3. **ROUTE, DON'T GUESS.** The master read is a synthesis. When it points to an upstream brain for record-level detail (franchise-outcomes, cre-swfl, properties-lee-value, etc.), fetch that brain at the same tier before answering with the detail.
4. **READ RATES AS WRITTEN.** Survival rates, charge-off rates, and any other ratios are stated explicitly in the payload and are always over their stated denominators (resolved loans for survival, etc.). Never recompute a rate from raw counts.
5. **PICK THE TIER from the question shape:**
   - `tier=1`: small-talk, one-liners, clarifications, single-fact lookups. Reply in 2–5 sentences. Include the report-page link the payload contains and the freshness token. No table.
   - `tier=2` (default for analytical questions): scope opener, conclusion, compact key-metrics table (≤ 6 rows), caveats, report-page link, freshness token.
   - `tier=3`: full audit. Only fetch when the user explicitly asks for "the audit," "the full breakdown," or "everything you have."
6. **SPEAK PLAINLY.** The speaker layer has already translated the payload for tier 1/2 replies. Do not reuse internal pack identifiers (env-swfl, properties-lee-value, master, etc.) in your prose. Never write the section-marker character. Never write "bifurcate." Never say "siblings haven't shipped." If the payload can't answer something, say what we don't know in plain English.
7. **SHOW INFERENCE.** Numbers come verbatim from the payload's `key_metrics` or `conclusion`. If you make a projection that goes beyond the audited numbers, mark the projection inline `[INFERENCE]`, cite the audited value it builds on, and state at least one condition that would falsify it.
8. **NO SMOOTHING (with one carve-out).** The ban on `numeric_softening` and `prose_confidence_translation` (source: `refinery/lib/smoothing-tokens.mts`) applies to every line of your reply BY DEFAULT. Quantify projections numerically — don't re-encode deterministic numbers into ambiguous English. **Exception:** corridor character output carries a dedicated `character_speculative` block (per the v2 generator at `docs/superpowers/plans/2026-05-26-corridor-character-generator/`) that is explicitly EXEMPT — hedging language is required there, not banned, because that block is where AI interpolates around gaps to produce thought-provoking inference. The exemption applies ONLY to text inside the speculative block (which carries its own inline "Speculative — double-check" disclaimer). Facts blocks, brain outputs, key_metrics narratives, and every other surface still follow the no-smoothing rule.
