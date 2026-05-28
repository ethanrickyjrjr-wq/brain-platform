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

**Ask for a diff review before pushing:**

- Brain pack edits (`refinery/packs/**`) that change `--- OUTPUT ---` shape or key_metrics math.
- Ingest pipeline changes that write to `data_lake.*` or touch production secrets.
- Schema migrations (`docs/sql/**`, anything affecting Postgres in prod).
- Multi-file refactors (>5 files) or renames that cross domains.
- Anything that could change a live `/api/b/*` response or the MCP surface.
- Anything you're not sure how to revert in under five minutes.

**Always (no exceptions):**

- `SESSION_LOG.md` gets a new top-of-file entry on every push. The pre-push hook enforces this — if it blocks you, that's the rule doing its job; don't fight it, write the entry.
- Stage only files you created or intentionally modified. Untracked files in your working tree may be the operator's in-progress work.
- Never use `--no-verify`, never skip hooks, never force-push to `main`.

The point of this rule: every new Claude on any machine should be able to clone this repo, look at `SESSION_LOG.md` on `main`, and know exactly where things stand without asking. GitHub is the cross-session bus.

---

# brain-platform — SWFL Data Gulf

Live at `https://www.swfldatagulf.com`. MCP endpoint at `/api/mcp` (`claude mcp add --transport http swfl https://www.swfldatagulf.com/api/mcp`). Stack: Next.js + Supabase + Vercel + DuckDB + Python ingest. Separate from premise-engine — never mix them.

---

# Where we are (snapshot, 2026-05-27)

15 upstream brains feeding `master`. MCP v1 live in prod. Pipeline-freshness standard locked with daily probe + auto-capture incident ledger. SESSION_LOG mechanism enforces cross-session continuity. Speaker layer renders tier-1/2/3 voice. Brain output is deterministic math + cited narrative; every numeric claim traces to a `source_url`.

**Recently shipped:** housing-swfl (Redfin buy-side, 125 ZIPs); permits-swfl second-county join (Collier); corridor character generator Steps 0–4.5; MCP v1 + waitlist + Anthropic Connectors submitted; freshness-first chain (PRs #19–#26); Firecrawl→Spider fallback rule locked.

**What we have not done yet:** master is still an index, not a synthesizer. No outcomes table. No constitution YAML. Confidence is still multiplicative, not Yager-DST. `tourism-tdt` brain is LIVE but still reads from premise-engine's Supabase — must self-ingest (see `_AUDIT_AND_ROADMAP/premise-data-replacement.md`). No watchlist. No regional expansion.

---

# What's next (NEXT — 1–3 weeks)

Sequenced; each unlocks the next.

1. **Master synthesizer (§6.1).** `outputProducer` on master that reads downstream OUTPUT blocks and emits `conclusion + key_metrics + caveats + contradicts`. Close the OUTPUT contract: top-level `trust_tier`, `direction`, `contradicts: string[]` on `BrainOutput`, atomic backfill across all 15 packs. Expand `inference-bait-lint`. Seed outcomes tables.
2. **Self-ingest tourism-tdt source data.** Brain LIVE; replace the premise-engine Supabase read with our own `ingest/pipelines/tdt_swfl/` → `data_lake.tdt_collections`. Full plan: `_AUDIT_AND_ROADMAP/premise-data-replacement.md`.
3. **Per-domain LAKE_ID refactor (§6.3).** Replace generic `SWFL-7421-v…` with `FINANCE-v…`, `ENVIRONMENTAL-v…`, etc. Mechanical.
4. **NOW acceptance tests (§6.4).** Test A (operator audit, T3) + Test B (homebuyer, T2 conversational via speaker). These are the proofs that §6.1 + §6.5 actually work.
5. **Industry-characters Phase 0** (`docs/superpowers/plans/2026-05-26-industry-characters/`). Shared infra for 7 voices: slug fn, DB migration, voice router, fact-pack interface, cloned grounded pipeline + synthesizer + lint, 7 cadence_registry entries.

NEAR-TERM (1–3 months) + LONG-TERM (3–12 months) detail lives in `docs/ontology-and-roadmap.md` §7–§8.

**North-star bet:** a homebuyer / analyst / planner / journalist / operator holds three variables in their head. We hold fifty, weighted honestly, with a quoted citation chain. Math is easy; weighting is everything. Brains is the apparatus that recognizes shockwaves and weights every brain against them.

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

| Topic                                               | File                                                                                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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
