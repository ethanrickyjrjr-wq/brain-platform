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

## 2026-05-26 (Opus 4.7 · feat/corridor-character-generator-step-2) — Step 3 audit follow-up: 3 commits closing 7 audit items

Outside-eyes audit on Step 2 surfaced 8 findings; this push lands fixes for #2 through #8. Item #1 (spider_client extraction_schema wrapper regression on commit `0028522`) is a merge-ordering concern, not a step-2 issue: B1's grounded pipeline uses Anthropic `web_search` and never reaches firecrawl→spider, so the fix correctly lives on `fix/firecrawl-agent-client` and propagates here on rebase after that PR lands.

- `ca58c29` `fix(refinery): snap month-end + Feb 29 date arithmetic in fact pack` — `buildPermitsTrailing6Mo` + `buildZoriRentIndex` were using JS native `setUTCMonth/setUTCFullYear`, which overflow Aug 31 −6mo → Mar 3 (not Feb 28) and Feb 29 −1y → Mar 1 (not Feb 28). Added `subtractMonthsUtc` + `subtractYearsUtc` to `refinery/lib/dates.mts` with last-day-of-month snap. End-to-end effect: the permits delta sign flips on the Aug-31 case and ZORI YoY unblocks on Feb 29 latest periods. (audit #2, #3)
- `ccadb51` `fix(validate): cross-check dangling [web-N] anchors in speculative block` — orchestrator was resolving anchors only on `facts_block`, letting `[web-99]` slip through `speculative_block` and break the renderer. Extracted `findDanglingAnchorErrors()`, called on both blocks. Marker presence still optional on speculative (pure `[inference]` allowed); any web/internal anchor that DOES appear must resolve. (audit #4)
- `d676f69` `fix(ingest): pipeline exit code, URL-safe storage key, slug parity, monkeypatch hygiene` — corridor_grounded/pipeline.py now returns 1 on partial failure (was 0 → silent GHA green) (#5); storage object key uses `strftime('%Y%m%dT%H%M%SZ')` instead of raw `isoformat()` (`:` and `+` URL-encode to `%2B`, breaking lookback) (#6); test_extract_client.py Case 7 rewritten with `monkeypatch.delenv` — prior `if "SPIDER_API_KEY" in os.environ:` guard made the test vacuously pass when the var wasn't ambient (#8); `fixtures/corridor-slug-parity.json` pins the slug() rule with 33 cases (26 verified corridors verbatim + 7 edge cases), parity tests in BOTH TS (`refinery/tools/corridor-slug-parity.test.mts`) and Python (`test_pipeline.py::test_slug_parity_python_side`) trip on any divergence between the two independent implementations (#7).

Test deltas: bun suite **687 → 738 pass** (+51 new tests across `dates.test.mts`, fact-pack regressions, orchestrator REJECTs, and 33 TS slug-parity cases) / 0 fail / 56 files. Pytest local-touched suites: 20/20 (slug parity Python-side + storage-key URL-safety + Case 7 rewrite). Typecheck: zero new real type errors (+2 `bun:test`-import baseline noise matching every other test file in the project).

- Next per plan: Step 4 in a fresh session — run `--preview` against all 26 corridors, operator eyes on 5 spot-checks against the snapshot baseline using the plan's 5-point rubric, then build the Stage A driver that wires fact-pack → grounded-NDJSON → synthesizer → DB writer.
- Branch is shippable on its own (Steps 2+3 done, no regressions). Operator decision pending: open PR now or bundle Step 4 in the same branch.
- Plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`

## 2026-05-26 18:52 (Opus 4.7 · feat/corridor-character-generator-step-2) — Step 2 C1+C2 + Stage A tests

- C1 synthesizer: new `refinery/tools/synthesize-corridor-character.mts` — single Anthropic call (`claude-sonnet-4-6`, forced tool_use for structured output), reads B1's grounded NDJSON via `readGroundedNdjson()`, threads `citations[]` into the model prompt as `[web-N]` anchors, and emits a three-block JSON `{facts_block, chart_block, speculative_block, citations}`. After the model returns, the orchestrator lint stack runs; a malformed run THROWS and the DB write path is never reached (Step 3 acceptance). CLI flags: `--corridor=<name>` + `--preview` (write `--write-db` is intentionally unimplemented in v1 — Step 4 owns the DB driver). Library-only entrypoint `synthesizeCorridorCharacter()` is what tests + the eventual Stage A driver call.
- C2 lint stack (split per the plan's three-file ask): `refinery/validate/speculative-block-lint.mts` enforces verbatim `Speculative — double-check` disclaimer + REQUIRES hedging tokens around any inferred number (inverted polarity vs facts — smoothing tokens are REQUIRED here, BANNED in the facts block); `refinery/validate/chart-block-lint.mts` does structural `{title, columns: string[], rows: (string|number|null)[][]}` validation with `rows[i].length === columns.length`; `refinery/validate/corridor-character-lint.mts` orchestrates (facts: smoothing + inference-bait + citation-match → speculative: disclaimer + hedging + citation-match → chart). Exports `CorridorCharacterOutput`, `SPECULATIVE_DISCLAIMER`, `lintCorridorCharacterOutput()`.
- Stage A test coverage (gap closed): `refinery/tools/build-corridor-fact-pack.test.mts` + shared `refinery/tools/corridor-character-fixtures.mts` (Naples full-data + Pine Ridge sparse fixtures used by both Stage A and Stage C suites). Stage C tests at `refinery/tools/synthesize-corridor-character.test.mts` exercise the synthesizer with a mocked Anthropic client — 7 explicit `REJECT:` cases covering missing disclaimer, unhedged inferred number, smoothing token in facts, no citation markers, dangling `[web-N]` (the "made-up tenant" shape), malformed chart_block, and no-tool_use response.
- Tests: 50 new across 3 new test files; full suite green at **687 pass / 0 fail / 54 files**. Typecheck delta: 0 new errors (15 pre-existing, all in unrelated files).
- Next: Step 4 — run all 26 corridors via `--preview` for operator sign-off, then build the Stage A driver that wires fact-pack → grounded-NDJSON → synthesizer → DB writer.
- Plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`

## 2026-05-26 (Opus 4.7 · feat/corridor-character-generator-step-2) — Step 2 A1+A2: fact pack builder + SQL migration

- New `refinery/tools/build-corridor-fact-pack.mts`: pure function `buildCorridorFactPack(input)` returning `CorridorFactPack`. Computes 9 decision-relevant metrics (cap_rate, vacancy_rate, absorption_sqft, asking_rent_psf w/ marketbeat YoY math, unemployment_rate via BLS LAUS, zori_rent_index w/ YoY %, permits_trailing_6mo Lee-only, nfip_claim_frequency non-storm 3v3 baseline, fdot_aadt length-weighted). Null values carry one-line `gap_reason` per plan rule 3. No IO — caller pre-filters Supabase rows. `fact_pack_vintage = OLDEST-YYYY-MM` from scanned source vintages.
- New `docs/sql/20260526_corridor_character_generator.sql`: idempotent ADD COLUMN IF NOT EXISTS for `character_facts TEXT`, `character_chart JSONB`, `character_speculative TEXT`, `character_citations JSONB`, `character_generated_at TIMESTAMPTZ`, `character_fact_pack_vintage TEXT`. Per-column COMMENT ON documents two-block contract, citation JSONB shape, disclaimer requirement, and CLAUDE.md rule 8 carve-out. Legacy `character` untouched (cold fallback per Step 5).
- Test gap flagged: no `build-corridor-fact-pack.test.mts` yet — C1+C2 subagent owns shared fixtures + Stage A coverage in same PR.
- Next: C1 (synthesize-corridor-character.mts) + C2 (lint stack split by block) — sequential, both Opus, can start now that A1+B1 contracts are stable.
- Plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`

## 2026-05-26 (Sonnet 4.6 · feat/corridor-character-generator-step-2) — Step 2 B1: corridor_grounded pipeline

- New `ingest/pipelines/corridor_grounded/pipeline.py`: one Anthropic `web_search_20250305` call per corridor (`--corridor NAME` / `--all`); captures full `model_dump()` response + flattened `citations[]` as NDJSON to `lake-tier1/corridor_grounded/{slug}/year=YYYY/month=MM/run-{iso}.ndjson`. `--dry-run` writes to `/tmp/{slug}-{date}.ndjson` for smoke acceptance. Tool-version guard: emits WARNING when `cited_text_count == 0` (the `20260209` regression signal).
- 12 unit tests green: `slug`, `_extract_citations` (dedup + null), `build_record` shape/zero-citations/full-response, `to_ndjson` NDJSON + unicode.
- `ingest/cadence_registry.yaml`: `corridor_grounded` entry under `not_yet_running` with `lake-tier1/corridor_grounded/` prefix key.
- Next: A1 (fact pack builder, TS) and A2 (SQL migration DDL) being built in parallel on this branch. B1 is the Python ingest half; C1+C2 (synthesizer + lint) depend on A1 + B1 contracts being stable.
- Plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`

## 2026-05-26 (Opus 4.7 · fix/firecrawl-agent-client) — firecrawl /v2/agent polling fix + spider fallback layer

- Root cause: `ingest/lib/firecrawl_client.py:agent()` was a single sync POST that returned the job-ID payload, never polled `GET /v2/agent/<id>`. Three pipelines (corridor_narratives, marketbeat_swfl, county_planning_swfl) were silently failing with "zero rows" because the extractor was reading `data.result.rows` on `{success, id}` — finds nothing → empty. Vendor-first verified `firecrawl-py>=4.28.0` already implements correct polling via `Firecrawl().agent()`.
- Wrapper fix: `agent()` now delegates to the SDK; raises `FirecrawlError` on terminal non-completed status (`failed` / `cancelled`) so silent-empty stops being a failure mode. `extract_agent_rows()` reads `data.rows` first; keeps legacy `data.result.rows` + `result.rows` as defensive fallbacks. 7 mocked tests cover happy + failed + legacy + empty + missing-key paths.
- Fallback layer (operator-requested, same PR): new `ingest/lib/spider_client.py` wraps `https://api.spider.cloud/ai/scrape` (defensive response parsing — OpenAPI spec underdocumented); new `ingest/lib/extract_client.py` `extract()` tries firecrawl across all URLs → on empty/error, per-URL spider fallback. Returns firecrawl-shape dict + `_provenance` log; raises `ExtractError` only when both vendors fail loudly per URL. 7 fallback tests green. 3 pipelines swapped to `extract()`; `SPIDER_API_KEY` wired to 3 GHA workflow env blocks + `ingest/.env.example`. Pipelines stay running on firecrawl-only when `SPIDER_API_KEY` unset.
- Why bundled: shared root cause (single client, three consumers); spider rescue is the durable answer to the silent-fail vendor lock-in.
- Discovery (use spider triage before next PR): all 4 corridor_narratives BROKER_SOURCES URLs are dead — `creconsultants.com/research/` 404, `lsicompanies.com/market-reports/` 404, `ipcswfl.com/research/` 525, `svnswfl.com/market-reports` 525. Wrapper fix surfaces this loudly now; URL audit is a separate follow-up PR per the corridor-broker-promotion plan Step 1.
- Followup commit on same branch: `spider_client.ai_scrape()` now sets `stealth=True` + `anti_bot=True` + `proxy_enabled=True` by default. Spider's `/unblocker` endpoint per OpenAPI only takes `RequestParams` (no `prompt`/`extraction_schema`), so chaining unblocker → re-extract would have been two round-trips; setting the same RequestParams flags on `/ai/scrape` does the unblock-then-extract in one call. This is the durable answer for the 525-blocked broker pages (`ipcswfl.com`, `svnswfl.com`).
- Next: live dry-runs (`gh workflow run corridor-narratives-quarterly.yml -f dry_run=true`, same for county-planning + marketbeat) to confirm spider rescue path lights up. Then URL audit follow-up.

---

## 2026-05-26 (Opus 4.7 · main) — corridor character generator Step 1 SHIPPED + tool-version correction

- Step 1 (Anthropic web_search verification + smoke against Pine Ridge Rd Naples) done. Vendor-first WebFetch confirmed contract; ran two questions through `web_search_20260209` then an A/B with `web_search_20250305` on Q1 after observing zero `cited_text` spans in the dynamic-filtering variant. Same prompt, same model, same `allowed_domains`: `20260209` returned 0 cited spans (Claude pipes content through code-execution and emits text from Python variables); `20250305` returned 9 verbatim cited spans with raw publisher URLs. **Corrected tool-version pick from `20260209` → `20250305`** in the v2 plan, the research doc (correction note at top), and memory. Anthropic-as-vendor unchanged.
- Other findings: `news-press.com` and `naplesnews.com` block Anthropic's crawler — API rejects allowlist with 400. Pine Ridge–specific NNN rents are not on the open web (paywalled in LoopNet/CoStar) — facts block will have to surface this as `{value: null, gap_reason: ...}` and let the speculative block do the inference work. Token budget for the full generator is ~$30/yr at `20250305`.
- Files: `docs/vendor-notes/anthropic-web-search-wire-up.md` (Step 1 deliverable — full Q&A, A/B table, blocked-publisher list, verified seed allowlist, parallel-eligible Step-2 task split for Opus + Sonnet), `docs/vendor-notes/anthropic-web-search-smoke-output.json` + `anthropic-web-search-compare-output.json` (raw API responses), `scripts/smoke/anthropic_web_search_smoke.py` + `anthropic_web_search_compare.py` (re-runnable). Plan + research doc + memory + this log carry the correction. `pip install anthropic` added a setup dep — flag for ingest pipeline `requirements.txt` work in Step 2 B1.
- Next: Step 2 (Pine Ridge end-to-end generator) — A1 Stage A fact pack builder + A2 SQL migration can run in parallel on Opus; B1 Stage B Python pipeline runs against the verified `20250305` contract on Sonnet; C1+C2 synthesis + lint stack are Opus-sequential after A+B contracts firm. Worktree pattern recommended. Plan path: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`. Wire-up doc: `docs/vendor-notes/anthropic-web-search-wire-up.md`.

---

## 2026-05-26 (Sonnet 4.6 · main) — CCPM installed + corridor character generator epic wired to GitHub

- Installed CCPM (agentskills.io PM skill) into `.claude/skills/ccpm/` — gives any session a live `standup.sh` + GitHub Issues source of truth instead of relying on SESSION_LOG alone. Motivated by 4-5 parallel sessions with no shared state.
- Created corridor character generator epic in CCPM: `.claude/prds/corridor-character-generator.md` + `.claude/epics/corridor-character-generator/` with 5 task files (34.md–38.md). Synced to GitHub: epic #33, tasks #34–#38 (`ethanrickyjrjr-wq/brain-platform`).
- Step 1 (vendor verification) was already DONE by a prior Opus session — discovered from untracked `docs/vendor-notes/anthropic-web-search-wire-up.md`. Critical finding: **use `web_search_20250305`, NOT `web_search_20260209`** (dynamic filtering kills citations — 0 `cited_text` spans). Posted finding on GitHub epic #33 and closed issue #34.
- Step 2 parallel decomposition from wire-up doc posted to GitHub: Batch A (fact pack builder + SQL migration, parallel) → Batch B (corridor_grounded pipeline, `web_search_20250305`) → Batch C (synthesizer + lint stack).
- Next: any session picking up Step 2 should read `docs/vendor-notes/anthropic-web-search-wire-up.md` first, then `gh issue view 35` for acceptance criteria. Branch: `feat/corridor-character-generator-step-2`.

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
