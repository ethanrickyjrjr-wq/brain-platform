# SESSION_LOG.md — Append-Only Cross-Session Memory

**Read this on session start. Append to it before every `git push`.**

Format per entry (newest at top):

```
## YYYY-MM-DD HH:MM (model · branch)
- What changed (1–3 lines, present tense, file paths welcome)
- What's next / what's blocked
- Links: PR #, issue #, plan path
```

If a hook blocks your push, that's the system working. Fix the entry, then push.

---

## 2026-05-26 (Opus 4.7 · main) — corridor character generator v2 plan propagation

- Locked v2 plan for replacing `corridor_profiles.character` (24–26 May-era Claude-drafted strings) with a two-block generator output: facts block (strict, sourced, lint-tight) + speculative block (AI unleashed with inline "Speculative — double-check" disclaimer). Optional chart block when comparison is useful. Sources chart page at the bottom of every answer carries citations + freshness token + legal/disclaimer (NOT in the answer body).
- Anthropic `web_search_20260209` locked as the grounded-search vendor. Decision rationale captured in `docs/vendor-notes/grounded-search-research-2026-05-26.md` from a 7-vendor background research run; per-claim citations with `cited_text` spans + raw publisher URLs + `ANTHROPIC_API_KEY` already wired. Three-vendor bake-off skipped — structural pick was clear.
- Propagation shipped in this commit: canonical plan at `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`; vendor research at `docs/vendor-notes/grounded-search-research-2026-05-26.md`; CLAUDE.md SWFL Protocol rule 8 carries an in-place carve-out exempting the speculative block from the smoothing-tokens ban; ontology-and-roadmap.md bumped to v1.6 with a new "Future-vision items (post-character-generator)" section (FL-other-cities comparison, statewide/national anchors, forecasts, outlier brain, BYO overlay, Tavily helper — all gated, none start before the generator ships one full cycle); memory `project_corridor-character-generator.md` indexed in MEMORY.md as a high-visibility ACTIVE PLAN pointer.
- Next: Step 1 — Anthropic web_search vendor-first check + smoke test against one corridor (Pine Ridge Rd Naples). Gated on operator availability. Plan path: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`.

---

## 2026-05-26 (Opus 4.7 · main) — corridor character snapshot baseline

- Froze the live `corridor_profiles.character` strings into a committed baseline at `docs/audits/2026-05-26-corridor-character-snapshot.md` (26 corridors · 10 Collier · 16 Lee · 0 unknown-county · 0 pending broker narratives). Source: `refinery/tools/pull-corridor-character-snapshot.mts` (re-runnable; same-day re-runs are byte-identical). Renames an earlier audit-mode puller; strips the per-row decision-checkbox template — file is a data snapshot, not a worksheet. Reverted the `docs/audits/*-corridor-character-audit.md` gitignore rule. Added `npm run snapshot:corridor-character`. Carries along the parallel-session commit `20692fc` (bare-env fix) onto origin/main.
- Why now: the May-2026 Claude-drafted character strings are about to be replaced by a corridor-character generator (deterministic local data pack + Gemini grounded answer → cited prose). Need a diff baseline + restore safety before the live column gets rewritten.
- Next: vendor-first check on the Gemini grounding API (model ID, grounded-answer response shape, citation format) before scoping the generator pipeline. Do not start the generator until that check is in-session.

---

## 2026-05-26 (Opus 4.7 · main) — env names: BRAINS\_ no longer required

- Finished the 2026-05-25 env normalization. Code now reads canonical bare `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` first, with `BRAINS_SUPABASE_*` as legacy fallback (matches the `service-role.ts` pattern from PR #19/#30). Updated: `refinery/config/env.mts:76-82`, `refinery/lib/predictions-log.mts:97-104`, `refinery/lib/predictions-log.test.mts` (clears both pairs), `scripts/lake-probe.mts:8-10`. Stale doc comments fixed: `refinery/tools/embed-all-concepts.mts`, `refinery/packs/cre-swfl.mts`, `.claude/commands/vault.md`, `utils/supabase/service-role.ts`.
- Why this slipped: PR #19 normalized `.env.example` + the GHA cron wrappers but left the runtime code reading `BRAINS_`-prefixed only. Anyone running with a fresh `.env.local` (bare names only) hit "missing env" — Ricky just hit it via `npm run audit:corridor-character`. The legacy fallback stays per `docs/littlebird-notes/2026-05-26.md`: "Don't cleanup the fallback first" — Vercel still has the legacy names.
- Verified: `bun test refinery/lib/predictions-log.test.mts` 5/5 pass; `npx tsc --noEmit -p .` clean.
- Next: when Vercel env is renamed, one-line PR to delete the `??` legacy fallback in each of the 4 code sites.

---

## 2026-05-26 (Opus 4.7 · main) — cleanup pass

- Merged PR #32 (`acee6aa`) and PR #29 (`ca0a099`). main is at `ca0a099`. Zero open PRs.
- Resolved PR #29's SESSION_LOG.md conflict in the `brain-platform-permits` worktree by taking origin/main's version (which had the corrective Opus entry from PR #32) — no content was lost. Merge commit on the branch: `1a14e85`, squashed into `ca0a099` on merge.
- Cleaned up 4 stale remote branches (`feat/permits-swfl-v2`, `feat/firecrawl-pipelines`, `feat/firecrawl-pipelines-github-actions`, `fix/waitlist-resend-lazy-init`) — all confirmed merged via PRs #29/#17/#15/#16. Removed the permits worktree. Force-deleted 2 stale local branches (squash-merge orphans).
- Final remote: only `origin/main`. Final local: only `main`. Working tree: only the untracked `docs/superpowers/plans/2026-05-26-corridor-broker-narrative-promotion/` directory (operator's, not from any session).
- Next: operator refresh — `git pull` in any other sessions, point Sonnet at the worktree pattern (`git worktree add ../brain-platform-<branch> <branch>`) for the next parallel run.

## 2026-05-26 (Opus 4.7 · fix/redfin-dry-run)

- Restored the Opus race-condition entry below that the prior `9c514eb` commit dropped (append-only violation: Sonnet edited from a stale read of SESSION_LOG.md and rewrote my entry with an older version).
- No code changes; SESSION_LOG.md only. This is a corrective commit so the eventual merge to main does not silently delete the warning entry already on origin/main.
- Lesson for the next session: **before editing SESSION_LOG.md, `git pull` first and confirm you see every prior session's entry.** If your edit would remove any line of any prior `## YYYY-MM-DD (model · ...)` block, stop — you're working from a stale base.

## 2026-05-26 (Sonnet 4.6 · fix/redfin-dry-run)

- Added `--dry-run` to `ingest/duckdb_pipelines/redfin_swfl/pipeline.py` + `test_dry_run.py`.
- Last of the not-yet-running pipelines missing the flag; all 8 now covered.
- Next: merge PR #29 and this PR after CI green.

## 2026-05-26 (Sonnet 4.6 · feat/permits-swfl-v2)

- Rebased `feat/permits-swfl-v2` (651c102) onto main (c19d3ca); 1 commit, clean.
- Added `--dry-run` to `ingest/pipelines/lee_permits/pipeline.py` + test; 33/33 green.
- Updates PR #29 (already open); no new PR needed.
- Next: merge PR #29 after CI green; add `--dry-run` to `redfin_swfl` on separate branch.

## 2026-05-26 (Opus 4.7 · main)

- Shipped enforced session-log mechanism + commit/push autonomy rubric. Five files: `SESSION_LOG.md` (this), `CLAUDE.md` (RULE 0 + RULE 1 at top, behind `<!-- SESSION-LOG-RULE-MARKER -->`), `.claude/hooks/print-session-log.mjs` (SessionStart: prints last 8 entries + verifies marker), `.claude/hooks/check-session-log-on-push.mjs` (PreToolUse Bash: blocks `git push` when no commit ahead touched SESSION_LOG.md), `.claude/settings.json` (wired).
- RULE 1 authorizes Claude to commit + push small/policy/tooling changes without asking, and lists what still requires a diff review (brain pack math, ingest→data_lake, schema migrations, multi-file refactors, anything affecting live `/api/b/*` or MCP).
- Race condition discovered mid-build: a parallel Sonnet 4.6 session sharing this working tree picked up my untracked `SESSION_LOG.md`, committed it onto `feat/permits-swfl-v2`, and switched HEAD under me. Sonnet's own entry will arrive on `main` when PR #29 merges — expect a 30-second conflict on this file, resolve by keeping both entry blocks. **Operator action needed: use `git worktree add` for parallel Claude sessions, not the same working tree.**
- Memory: `project_session-log-mechanism.md` + high-visibility pointer at top of MEMORY.md.
- Pushing this commit now under RULE 1 authority.

## 2026-05-25 (prior session · main)

- Seed entry — see git log for c19d3ca (GHA unblock + brand scrub), 86435b8 (Lane D fully live), c3b9d0a (waitlist env-name fallback #30).
