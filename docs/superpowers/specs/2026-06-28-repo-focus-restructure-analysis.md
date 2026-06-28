# Repo Focus / Restructure — Analysis & Recommendation

**Date:** 2026-06-28
**Status:** Analysis (pre-design). Decomposes into sub-projects; each gets its own spec.
**Purpose:** Evaluate Ricky's proposed monorepo + scoped-CLAUDE "clauses" + auto-routing-hook idea
against ground truth (code, graphify, Claude Code docs, web research). Decide what actually fixes
"I keep repeating myself and everything breaks."

Every factual claim here is cited to a file path or a fetched URL. Where something is my synthesis
(not a quote), it says so.

---

## PART 1 — What's actually true right now (ground truth)

### 1a. The repo root is a junk drawer, but the *code* is fine

Top-level has ~40 dirs. The real platform is a handful: `app/` (355 tracked files), `lib/` (505),
`ingest/` (404), `refinery/` (400), `components/` (99), `docs/` (739), `scripts/` (88),
`.github/` (93), `brains/` (38).

Everything else at root is **plan-doc clutter**, not code:
`FINAL BOSS/` (10 md), `GET DONE/` (4), `GO-LIVE/` (1), `HOMEPAGE/` (6), `Live Data/` (1),
`SITE FLOW BUILD/` (9), `SOCIAL BUILD/` (16), `TODO/` (5), `UNKNOWN/` (11), `_diagrams/` (4),
`__scratch__/`, `tmp/`, `downloads/`. These are markdown briefs that belong under `docs/` or
`_AUDIT_AND_ROADMAP/`, not the repo root.

There is also a **literally broken directory**: `C:Usersethandevbrain-platformmigrations/` — an
empty, untracked folder created when a Windows absolute path got jammed into a relative `mkdir`.
That is a direct scar of the shell-syntax-crossing problem already documented in CLAUDE.md RULE 7.
Safe to delete (0 tracked files).

**Takeaway:** the "everything is chaos" feeling is mostly root clutter, which is cosmetic but real.
It is NOT a code-architecture problem.

### 1b. The TypeScript code is one tightly-coupled organism — it cannot be cleanly split

Coupling measured by import edges (Explore agent, ripgrep on import statements):

- `app/` → `lib/`: **339** edges
- `components/` → `lib/`: 98
- `lib/` → `lib/` (internal): 244
- `lib/` → `refinery/`: 87 (plus `app/` → `refinery/`: 43)
- `refinery/` → `refinery/` (internal): **728**
- `refinery/` → `app/` or `components/`: **0** (clean one-way; nothing upstream depends on the UI)
- `lib/assistant/` (the answer engine) imports refinery directly:
  `lib/assistant/compose-chart.ts:2` → `@/refinery/agents/anthropic.mts`;
  `lib/assistant/conversation-path.ts:14` → `@/refinery/lib/location-resolver.mts`.

`lib/` is the hub (in-degree ~684). `app + lib + refinery + lib/assistant` form a single semantic
core with well over 1,000 cross-edges. **Splitting these into separate packages would create fake
boundaries** — you'd pay monorepo build-orchestration cost and constant cross-package import churn
for zero encapsulation benefit (see Part 5 research).

The only sections that ARE cleanly separable (and already are):
- `ingest/` — Python, imports only stdlib/duckdb/requests. Zero TS coupling. A true island.
- `brains/` — markdown content only. No code.
- `mcp-widget/` — self-contained, 0 imports from `lib/assistant` or `refinery`.
- `docs/` — docs.

### 1c. Ingest re-fetches everything every run (your complaint is literally true)

dlt write strategy across `ingest/`:
- `write_disposition="merge"`: 17 pipelines (idempotent upsert by `primary_key` — fine)
- `write_disposition="replace"`: 8 pipelines (full table wipe + reload):
  `census_acs`, `census_cbp`, `fdot`, `fema`, `fhfa`, `fl_dbpr_licenses` (+ scaffold)
- **dlt incremental loading (`dlt.sources.incremental`): 0 occurrences. Nowhere.**

So even the 17 "merge" pipelines extract the *entire source dataset* every run, then upsert. Nothing
uses an incremental cursor to pull only new/changed rows. The 8 "replace" pipelines wipe and reload.

Nuance (my synthesis, not a blanket judgment): `replace` is *correct* for a small full snapshot
like Census ACS (annual, whole-table). It is *wrong* for append-heavy sources (permits, listings,
licenses) where you should pull only new rows via an incremental cursor and `merge`. The fix is a
**per-source audit**, not a blanket "switch everything to incremental."

### 1d. Every hook is global. There is no prompt-aware hook.

`.claude/settings.json` wires SessionStart (kickoff/session-log/build-context), PreToolUse
(prepush gate, branch guard, orphan check, answer-fix-proof), PostToolUse, Stop. All are
global (matcher `""` or by tool type). **There is no `UserPromptSubmit` hook** — nothing reads
your question and surfaces the relevant rules. This is the missing mechanism (see Part 3/4).

You already have 3 custom subagents in `.claude/agents/`:
`constitution-builder.md`, `project-state-sync.md`, `v3-spec-guard.md`. So the
"specialized helper per area" mechanism is already in use — just narrowly.

### 1e. The user-facing answer framing does NOT live in CLAUDE.md

The "rules of engagement" that govern what the product says (cite, no-invention, grain, as-of date)
live in `refinery/lib/rules-of-engagement.mts` and are injected into the payload. 8 importers:
`lib/grounded-answer.ts`, `lib/welcome/grounded.ts`, `lib/deliverable/build.ts`,
`lib/assistant/conversation-path.ts`, `app/api/b/[slug]/route.ts`, `app/api/mcp/server.ts`,
plus two snapshot tests. **CLAUDE.md does not touch this.** This is the single most important
fact for the diagnosis below.

---

## PART 2 — Why you keep repeating yourself (the real diagnosis)

Your three examples are NOT one problem. They split into two classes with different fixes.

### Class A — cross-cutting BELIEF repeats (MM/DD/YYYY, "not just ZIP grain", "any chart")

These are about what the assistant *says/frames*, not which directory it edits. They repeat because:

1. **Nothing is salient.** CLAUDE.md is ~600 lines (RULE 0 → 3.5 + brain-factory + data-protocol +
   reference index) and MEMORY.md indexes ~80 facts. When everything is "always on," nothing fires
   at the moment an answer is generated. The MM/DD/YYYY rule is buried as "rule 5" inside the
   rules-of-engagement block; "not ZIP-level" is one memory line among 80.
2. **They're cross-cutting** — they belong to no single folder, so a per-folder CLAUDE.md (which
   loads by location, see Part 3) will never catch them.
3. **For the production answer engine, CLAUDE.md is irrelevant** — that behavior comes from
   `rules-of-engagement.mts` (1e). Editing or scoping CLAUDE.md cannot change what a user-facing
   answer believes.

**Fix for Class A:** decision-time salience + output enforcement.
- A `UserPromptSubmit` hook that injects the top ~7 non-negotiable rules into context on *every*
  prompt (Claude Code confirms this works — Part 3).
- Output lints that catch the belief failure at the seam, the way `display-leak.test.mts` already
  blocks the raw freshness token. Extend that same pattern: lint that flags "ZIP-level" framing in
  generated copy; an assertion that chart capability is presented as open-ended. This is your own
  locked principle: *structural guarantee, not AI virtue.*

### Class B — code-convention repeats (full-replace ingest, aggregate-at-source, etc.)

These DO belong to a folder. "Use merge not replace," "push COUNT/AVG to SQL," "Deno imports in
supabase/functions" — each is tied to a directory. They repeat because the convention lives far
away (in the giant CLAUDE.md or in memory) instead of next to the code.

**Fix for Class B:** short, location-scoped CLAUDE.md in the 3-4 dirs that have real conventions
(`ingest/`, `refinery/packs/`, `lib/email/`, `lib/assistant/`). These DO fire by location (Part 3),
so when I'm editing `ingest/`, the ingest conventions are right there.

---

## PART 3 — Verdict on your proposed structure (point by point, grounded in Claude Code docs)

Your instinct — focus Claude per area, stop repeating, stop breakage — is correct. Three of the
four mechanisms you proposed are mismatched to how Claude Code actually works.

### "Monorepo, separate main folders per section" — RED HERRING

You already have a monorepo. And per 1b the TS code can't be cleanly carved. Web research
(monorepo.tools, Nx, Turborepo) confirms: a monorepo needs "well-defined relationships" and
"division and encapsulation of discrete parts"; splitting tightly-coupled internals into packages
buys orchestration cost without the encapsulation benefit. **Don't do workspaces.** DO clean the
root clutter (1a). That delivers the "organized" feeling with none of the churn.

### "Scoped CLAUDE.md clause, auto-selected by my question topic" — PARTLY RIGHT, WRONG TRIGGER

Official docs (code.claude.com/docs/en/memory.md): subdirectory CLAUDE.md files are *"included when
Claude reads files in those subdirectories."* That is **location-based, not topic-based.** A
`lib/email/CLAUDE.md` fires when I edit files in `lib/email/` — NOT because your *question* is about
email. So scoped CLAUDE.md is great for Class B (code conventions) and **useless for your three
cited Class A repeats.** This is the trap to avoid: "scoped CLAUDE.md will stop the ZIP-level repeats"
is tidy and false.

### "A hook presents me with a Claude that has notes on the question / best-knowledge Claude auto-activates"

Two halves:
- **Whole-session persona routing by topic: does not exist natively.** I checked the docs — there is
  no mechanism to swap the session's instruction set based on what you ask. (`NOT FOUND IN DOCS`.)
- **Injecting the right notes per question: this DOES exist and is the real win.** A `UserPromptSubmit`
  hook receives your prompt and *"anything you write to stdout is added to Claude's context"*
  (code.claude.com/docs/en/hooks-guide.md). So the hook can scan your question for topic signals and
  inject the relevant rules/notes/`graphify` pointer every turn. **You have zero UserPromptSubmit
  hooks today — this is the single highest-leverage missing piece.**

### "Constant subagent specialized per area he can run with / ask questions" — YES, REAL, AND THE BETTER FIT FOR DEEP WORK

Docs (code.claude.com/docs/en/sub-agents.md): *"Claude uses each subagent's description to decide
when to delegate tasks."* Subagents are auto-picked by description, run in their own clean context
(so they aren't drowning in the 600-line ruleset), and return just the conclusion. You already have
3. This is the correct mechanism for your "hyper-focused helper per area" idea — better than scoped
CLAUDE.md for anything that's a *task* rather than a *file edit*.

### So: scoped-CLAUDE vs persistent subagents — it's NOT either/or

They solve different problems. The honest answer is a small stack:
- **UserPromptSubmit injection hook** → fixes the REPEATS (Class A, every turn).
- **Location-scoped CLAUDE.md** (3-4 dirs) → fixes code-convention drift (Class B, on edit).
- **Area subagents** (a handful) → focus for DEEP work in one area (delegation).
- **Output lints** → catch belief failures structurally at the seam.

All four EXTEND what you already have (the 3 subagents, the `_ASSISTANT` session-brief system, the
existing lints, graphify). None erects a new mandatory architecture — consistent with your RULE C2.

### Hooks "so they always work"

Docs (hooks-guide.md): exit `0` = proceed (and for UserPromptSubmit/SessionStart, stdout → context);
exit `2` = block, stderr → Claude as feedback; any other code = proceed but show a hook-error notice.
"Always work" means: be fast, be idempotent, use exit 0 to add context / exit 2 to block, write to
the correct stream, and don't over-match. Live example from this very session: a global PreToolUse
Bash hook blocked a harmless `grep` because its pattern matched destructive SQL keywords in my
command string — a too-broad matcher is exactly how hooks "stop working" (they fire when they
shouldn't). Scope matchers tightly.

---

## PART 4 — The recommended system (what actually fixes it)

Built entirely on existing seams. No workspaces, no new architecture.

1. **Root cleanup.** Move the ~13 plan-doc dirs into `docs/_archive/` or `_AUDIT_AND_ROADMAP/`.
   Delete the broken `C:Users…migrations/` dir. Result: a root that shows the real platform
   (`app lib ingest refinery components brains docs scripts .github`).

2. **`graphify` as the "what-connects-to-what" map.** graphify already builds the cross-section
   dependency graph (`graphify-out/graph.json`, 31 MB, regenerated). The coupling map in Part 1b is
   exactly what it surfaces. The gap is that Claude doesn't reliably consult it — so the
   UserPromptSubmit hook (below) injects a `graphify query "<topic>"` pointer when the question
   touches code. graphify is the tool; the hook is the nudge.

3. **Fix the live product FIRST in `rules-of-engagement.mts`, then add dev-session salience.** The
   product-facing repeats (ZIP-level, date format, any-chart) must be repaired in
   `refinery/lib/rules-of-engagement.mts` — the live answer engine reads THAT, not CLAUDE.md or any
   hook. Then a SIMPLE `UserPromptSubmit` hook (`.claude/hooks/inject-focus.mjs`) always injects the
   ~7 hard rules + a pointer to the area CLAUDE.md files + the `_ASSISTANT/TODAY.md` brief — NO
   keyword topic router (it misfires); the "go deep" case is handled by area subagents. This hook
   fixes dev-session Claude only.

4. **Location-scoped CLAUDE.md** in `ingest/`, `refinery/packs/`, `lib/email/`, `lib/assistant/`.
   Each is short (10-20 lines): the conventions that apply when editing THAT area
   (e.g. ingest: "incremental cursor + merge, never blanket replace; push aggregation to SQL").

5. **Area subagents** (`.claude/agents/`). Add a few tight-charter agents:
   `website-builder`, `deliverable-builder`, `ingest-engineer`, `answer-engine-guardian`. Each
   carries only its area's rules + the "advise via /advisor when you don't know, never invent" rule.

6. **Extend output lints** to cover the Class A beliefs (ZIP-level framing flag, chart-capability
   assertion) the same way `display-leak.test.mts` guards the freshness token.

7. **`decisions.md` (ADR log) per area** — see Part 5. This is where the LOCKED decisions currently
   scattered across memory + CLAUDE.md get a permanent, citable home.

---

## PART 5 — decisions.md vs design.md vs CLAUDE.md (you're conflating three things)

Cited from research (adr.github.io, cognitect.com/Nygard, industrialempathy.com design-docs-at-Google):

- **`decisions.md` = an ADR log = WHY.** An Architecture Decision Record captures one decision: its
  context, the choice ("We will…"), status, and consequences. Append-only; supersede, don't rewrite.
  *"We want to create an ADR when we want future developers to understand the 'why'."* This is the
  right home for "neutral stays in the master vote denominator," "merge not replace because…,"
  "no ZIP-level framing because it kills lanes 2-4."

- **`design.md` = a design doc = WHAT + HOW.** Written before coding: context/scope, goals/non-goals,
  the design, **alternatives considered**, trade-offs, cross-cutting concerns. *"If a doc basically
  says 'this is how we are going to implement it' without trade-offs and alternatives… write the
  program right away"* — i.e. a design doc that's just an implementation manual isn't worth writing.

- **`CLAUDE.md` = agent instructions = HOW TO BEHAVE HERE, NOW.** Present-tense operative rules an
  agent must follow while working. Not a record of past reasoning, not a system plan.

So your "decisions.md per repo" is a good, cheap idea — but it's an ADR log (why), distinct from the
scoped CLAUDE.md (how-to-behave) you also want. Both are useful; they're not the same file.

---

## PART 6 — Incremental ingest (separate sub-project)

Current: 0 incremental, 17 merge, 8 replace (Part 1c). Fix is per-source:
- Append-heavy sources (permits, listings, licenses, anything with a date/id cursor): adopt
  `dlt.sources.incremental` on the cursor column so extraction pulls only new/changed rows; keep
  `write_disposition="merge"` with `primary_key` for idempotency.
- Full-snapshot sources (Census ACS, small annual tables): `replace` is correct — leave them, but
  document WHY in the area `decisions.md`.
- Gate 4 (destructive-write guard) already exists; this work is about *extraction*, not the write
  guard.

Verify against live dlt docs before coding (RULE 0.4). This is its own spec + plan.

---

## PART 7 — Free, self-healing automation (separate sub-project)

Research (R2, all figures quoted from vendor pages). Recommended **$0 stack**, two layers because
in-workflow logic can never detect its own non-execution:

1. **GitHub Actions `on: schedule` as the engine.** Free: unlimited for public repos, 2,000 min/mo
   for private (GitHub Free). 5-minute floor. Schedule **off-the-hour** (`cron: '17 6 * * *'`, never
   `0 * * * *`) — the docs warn high load at the top of the hour can *drop* queued runs. Public
   scheduled workflows auto-disable after 60 days of no activity. Add `timeout-minutes` and a
   `concurrency` group so runs can't hang or overlap.
2. **`nick-fields/retry@v3`** inside the job for transient API/network blips (`max_attempts: 3`,
   `retry_wait_seconds: 30`). Handles ~90% of flakiness with no external moving part.
3. **Healthchecks.io free Hobbyist (20 checks, $0) as the dead-man's-switch** — the ONLY thing that
   catches "the schedule silently never fired" (dropped queue / 60-day disable). Successful run's
   last step `curl`s the ping URL; no ping in period+grace → it alerts you.
4. **`JasonEtco/create-an-issue@v2`** with `if: failure()` + `update_existing: true` → auto-files
   (and de-dupes) a tracked issue on hard failure.
5. Optional: a `workflow_run` watchdog running `gh run rerun --failed`, **capped** at
   `run_attempt < 3` or it loops forever and drains your free minutes.

Plus free dependency self-healing: **Dependabot security updates** (zero-config, all repos, free).
This extends your existing `log-cron-incident.yml` / cron-incident-auto-capture, it doesn't replace it.

Vercel Hobby cron = once/day, ±59 min — only fits a single daily HTTP trigger; GitHub Actions is the
workhorse for everything else.

---

## PART 8 — Decomposition (per brainstorming's decompose rule)

This is four independent sub-projects. Each gets its own spec → plan → build. Recommended order:

1. **Focus System** (Part 4: UserPromptSubmit hook + scoped CLAUDE.md + area subagents + lints).
   Highest leverage — directly kills the repeats and the breakage. Do first.
2. **Root cleanup + section map** (Part 1a/4.1-4.2). Fast, low-risk, makes the repo legible. Can run
   alongside #1.
3. **Incremental ingest** (Part 6). Real engineering; per-source; verify dlt docs first.
4. **Free self-healing automation** (Part 7). Wire the $0 stack to existing crons.

decisions.md (ADR) per area (Part 5) is a thin thread that runs through all four.

---

## Sources

Code (this repo): `.claude/settings.json`, `.claude/agents/*`, `refinery/lib/rules-of-engagement.mts`,
`ingest/pipelines/*/resources.py`, coupling via ripgrep import scan, `graphify-out/graph.json`.

Claude Code docs: memory.md (nested CLAUDE.md = location-based), sub-agents.md (auto-delegation by
description; no topic session-routing), hooks-guide.md (UserPromptSubmit stdout→context; exit-code
semantics).

Web (crawl4ai, fetched 2026-06-28): adr.github.io, cognitect.com (Nygard ADR), industrialempathy.com
(design docs at Google), monorepo.tools, nx.dev, turbo.build, vercel.com/docs/monorepos,
docs.github.com (Actions schedule/billing/concurrency), github.com/nick-fields/retry,
github.com/marketplace/actions/create-an-issue, healthchecks.io, cron-job.org, uptimerobot.com,
vercel.com/docs/cron-jobs, docs.renovatebot.com, Dependabot docs.

---

## PART 9 — Sonnet review: pushbacks and improvements (added 2026-06-28)

Overall: the analysis is sharp. The Class A / Class B split is the right frame. The "don't split the TS codebase" verdict is correct. These are the places I'd push back or add.

---

### Pushback 1 — Issue 01: the hook only fixes Claude-the-developer, not the live product (load-bearing)

The spec correctly says CLAUDE.md doesn't govern live answers — `rules-of-engagement.mts` does. Then it
lists 7 hard rules to inject via the hook and marks "mirror them into rules-of-engagement.mts" as an
open question. That's wrong priority. The hook governs what this dev session believes. The live product
is governed by `rules-of-engagement.mts`, period.

Rules 1–6 (no-invention, MM/DD/YYYY, grain-not-ZIP, any-chart, no-jargon, plain-text) need to be in
`rules-of-engagement.mts` first — that's where the product actually reads them. The hook is a
useful secondary reminder for dev-session Claude. Treating the mirror as optional stretch leaves the
live product unchanged no matter how well the hook works.

**Fix:** make mirroring the 7 rules into `rules-of-engagement.mts` PART A of Issue 01, not an open
question. The hook (current Part A) becomes Part B.

---

### Pushback 2 — Issue 01: keyword topic routing will misfire; simplify it

"website/landing/page/component → inject website notes" sounds reasonable until a question like
"why is the email template breaking the ingest probe" routes to deliverables when it's actually an
ingest question. Keyword matching on free-form questions produces false positives constantly.

The area subagents already handle the "go deep on one area" case via their description auto-selection.
The hook doesn't need to duplicate that. A simpler and more reliable hook:

- Always inject the 7 hard rules (short, sharp — not a CLAUDE.md paste).
- Always inject a one-line pointer: "For area-specific conventions see ingest/CLAUDE.md,
  refinery/packs/CLAUDE.md, lib/email/CLAUDE.md, lib/assistant/CLAUDE.md."
- That's it. No topic detection. The developer knows what they're working on; the area CLAUDE.md
  fires by location when they open the right file.

Simpler → more reliable → less maintenance. The clever router is exactly the kind of thing that
breaks silently and is hard to debug.

---

### Pushback 3 — Issue 03: realtor.com is NOT the right incremental reference implementation

The spec calls realtor.com "the perfect first candidate to build incremental from day one." But
Session Log 2026-06-27 says realtor.com is monthly public S3 CSVs — full snapshot per release.
The spec's own ground truth says "History should load as REPLACE." That's correct. Replacing CSVs
monthly with a full snapshot IS the right pattern for this source.

Using it as the incremental reference implementation is a contradiction. The real incremental
candidates are append-heavy sources: permits, DBPR licenses, listing_lifecycle. Those have
monotonic date cursors and event-style append semantics.

**Fix:** classify realtor.com as snapshot → REPLACE, document WHY in decisions.md, and pick
listing_lifecycle or permits as the incremental reference implementation.

---

### Pushback 4 — Issue 04: the daily-rebuild flapper's root cause is already known

The spec says "triage flappers first" — correct. But it treats the cause as unknown. It isn't.
SESSION_LOG and memory both document it: the rebuild bot lost its main-branch bypass when the branch
ruleset was tightened, so the GHA rebuild can't push to main. The fix is `local bun refinery/cli.mts
master --resilient → safe-push as operator`, not retry. Wrapping that in `nick-fields/retry` won't
help — the failure is deterministic (permission denied), not transient.

Before wiring any retry onto daily-rebuild: restore bot push permissions or permanently move the
daily rebuild trigger to operator-manual. Then retry makes sense for the actual network-flaky steps.

---

### Improvement 1 — Issue 01: wire into the _ASSISTANT/TODAY.md system we just built

The previous session built `_ASSISTANT/TODAY.md` (SESSION_LOG 2026-06-28: assistant-weekly.mjs
writes it). This already surfaces in-flight checks and spec health at session start. The focus
system should extend it, not run parallel to it. Specifically:

- `_ASSISTANT/TODAY.md` = what's in flight (project state, overdue checks)
- The hook = what rules apply RIGHT NOW on each prompt

These are complementary. The weekly script could also write a `_ASSISTANT/RULES.md` snapshot of
the 7 hard rules so the hook can read a local file instead of hardcoding them — that way Ricky can
edit the rules in one place without touching the hook script.

---

### Improvement 2 — Issue 02: the broken folder needs rm not git mv

`C:Usersethandevbrain-platformmigrations/` is untracked (0 tracked files). `git mv` won't work on
untracked dirs — just `rmdir` it. The spec conflates it with the tracked plan-doc dirs. Only the
tracked dirs need `git mv` to preserve history. The broken dir is just `rm -rf`.

---

### Improvement 3 — Issues 01/02: the ws session was a SEPARATE project, not a monorepo restructure

The parent analysis flags the ws plan as potentially a "bun/npm workspaces split of the codebase"
and warns it contradicts the no-split verdict. Worth clarifying: ws is a brand-new standalone CLI
project at C:\Users\ethan\dev\ws\ — it has nothing to do with restructuring brain-platform's
package layout. The flag in the analysis is misfired. No reconciliation needed.

---

### Net verdict on the four issues

| Issue | Verdict | Top action before building |
|---|---|---|
| 01 Focus System | Build it, but fix rule 1 (mirror to rules-of-engagement.mts first) and simplify the hook (no topic router) | Confirm 7 rules wording with Ricky |
| 02 Root Cleanup | Build it, low risk. Use rm on the broken dir, git mv on tracked dirs. | Confirm archive destination (_archive vs _AUDIT_AND_ROADMAP) |
| 03 Incremental Ingest | Build it, but reclassify realtor.com as snapshot-REPLACE. Pick listing_lifecycle as incremental reference. | Per-source audit table first |
| 04 Self-Healing | Diagnose daily-rebuild bot-push failure before adding retry. Then wire the stack. | Fix the root cause, then template |
