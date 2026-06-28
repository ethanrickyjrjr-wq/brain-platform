# Issue 01 — The Focus System (stop Claude repeating itself)

**Parent analysis:** `docs/superpowers/specs/2026-06-28-repo-focus-restructure-analysis.md`
**Status:** SPEC-READY breakdown. NOT built. Build via the protocol at the bottom.
**Priority:** #1 — highest leverage. This is the direct fix for "I have to repeat myself."
**One line:** Make the right rules *salient at the moment of decision* via a prompt-aware hook,
location-scoped CLAUDE.md, area subagents, and output lints — instead of one 600-line always-on file.

---

## 1. THE PROBLEM (in detail, with evidence)

Ricky keeps having to re-correct the same things: dates must be **MM/DD/YYYY**; we are **not just ZIP
grain**; we **can design any chart**; no internal IDs/jargon in answers; plain text (no tables) in
answers. These repeat for two structural reasons — and they are TWO DIFFERENT CLASSES with two
different fixes. Conflating them is the #1 way this build goes wrong.

### Class A — cross-cutting BELIEF repeats (the ones Ricky cited)
MM/DD/YYYY, "not ZIP-only", "any chart", no-jargon, plain-text. These are about what the assistant
*says/frames*. They repeat because:
- **Nothing is salient.** `CLAUDE.md` is ~600 lines; `MEMORY.md` indexes ~80 facts. When everything
  is always-on, no single rule fires when an answer is generated.
- **They are cross-cutting** — they belong to no folder, so a per-folder CLAUDE.md can NEVER catch them.
- **For the live product, CLAUDE.md is irrelevant.** The user-facing framing lives in
  `refinery/lib/rules-of-engagement.mts` (injected into the payload), imported by 8 files:
  `lib/grounded-answer.ts`, `lib/welcome/grounded.ts`, `lib/deliverable/build.ts`,
  `lib/assistant/conversation-path.ts`, `app/api/b/[slug]/route.ts`, `app/api/mcp/server.ts`,
  plus 2 snapshot tests. Editing CLAUDE.md does not change what the answer engine believes.

> **FIX for Class A:** for the LIVE PRODUCT → repair `rules-of-engagement.mts` + output lints (the
> answer engine reads THAT, not CLAUDE.md). For DEV-SESSION Claude → a UserPromptSubmit hook
> (salience). Directory-scoping does NOT fix Class A. Do not let anyone claim it does.

### Class B — code-convention repeats
"merge not replace", "push aggregation to SQL", "Deno imports in supabase/functions",
"verify with `bunx next build` not bare tsc". These DO belong to a folder.

> **FIX for Class B = short location-scoped CLAUDE.md in the 3-4 dirs that have real conventions.**

---

## 2. GROUND TRUTH — everything you need so you don't re-investigate

### Claude Code mechanics (verified against official docs 2026-06-28 — re-verify if behavior seems off)
- **Nested CLAUDE.md is LOCATION-based, not topic-based.** docs: subdirectory CLAUDE.md files are
  *"included when Claude reads files in those subdirectories"* (code.claude.com/docs/en/memory.md).
  A `lib/email/CLAUDE.md` fires when editing files in `lib/email/` — NOT because the question is
  about email.
- **UserPromptSubmit hook CAN inject context.** docs: for UserPromptSubmit/SessionStart hooks,
  *"anything you write to stdout is added to Claude's context"* (hooks-guide.md). There is also a
  structured `additionalContext` JSON field. THIS is the mechanism for "show me the notes on my
  question." We have ZERO UserPromptSubmit hooks today.
- **No native whole-session persona routing by topic.** Confirmed `NOT FOUND IN DOCS`. Do not design
  around a feature that doesn't exist.
- **Subagents are auto-selected by their `description`.** docs: *"Claude uses each subagent's
  description to decide when to delegate tasks"* (sub-agents.md). They run in a clean context and
  return the conclusion. We already have 3: `.claude/agents/{constitution-builder,
  project-state-sync, v3-spec-guard}.md`.
- **Hook exit codes (hooks-guide.md):** exit `0` = proceed (stdout → context for
  UserPromptSubmit/SessionStart); exit `2` = block, stderr → Claude as feedback; any other code =
  proceeds, shows a "hook error" notice (first line of stderr). "A hook that always works" = fast,
  idempotent, correct stream, exit 0/2 used deliberately, matcher scoped tightly.

### Live gotcha (this session)
A global PreToolUse Bash hook blocked a harmless `grep` because its pattern matched destructive-SQL
keywords inside the command string. **Too-broad matchers are how hooks "stop working" — they fire
when they shouldn't.** Scope every matcher.

### Where the current wiring lives
- Hooks config: `.claude/settings.json` (SessionStart, PreToolUse, PostToolUse, Stop, SessionEnd —
  all global; NO UserPromptSubmit).
- Hook scripts: `.claude/hooks/*.mjs`.
- Existing output-lint pattern to copy: the display-leak wall (CI test that blocks the raw
  `SWFL-…-YYYYMMDD` freshness token from reaching display) + `facts-only-lint` / `inference-bait-lint`
  in `refinery/validate/`. Find the exact file names with `grep -ril "display-leak\|facts-only" .`.

### The ~7 hard rules to inject on EVERY prompt (the Class-A canon)
1. **No invention.** Every number names a real source (four-lane: our data → upload → named web →
   user figure). An INVENTED number (no source) is the only hard block.
2. **As-of date = MM/DD/YYYY.** Never the raw `SWFL-…-YYYYMMDD` token. State it once.
3. **Grain is NOT ZIP-only.** The moat is four-lane at ANY grain. Never say "ZIP-level intelligence."
4. **Any chart is buildable.** Never tell the user we can't design a chart.
5. **No system nouns / IDs / jargon in answers.** No master/brain-id/§/pack IDs/routing talk.
   NNN = triple-net rent, never a place name.
6. **Answers are plain text.** No blockquotes, no tables (breaks Ricky's copy-paste). Code fences
   for commands only.
7. **Probe + research before answering.** RULE 0.5 (read OUR code first) + RULE 0.4 (crawl4ai the
   outside answer, never memory). If you don't know, use `/advisor` — never invent.

---

## 3. THE BUILD — five parts, PRODUCT-FACING FIRST

> Ordering rule (corrected): the LIVE PRODUCT reads `refinery/lib/rules-of-engagement.mts`, NOT
> CLAUDE.md and NOT the dev hook. The product-facing repeats are fixed THERE first. The hook only
> fixes dev-session Claude (writing copy/specs). Do Part A before anything else.

### Part A — `rules-of-engagement.mts` is the product source of truth (MANDATORY, FIRST)
Audit `refinery/lib/rules-of-engagement.mts` and add/repair the PRODUCT-FACING subset of the 7 rules
so all 8 importers inherit it:
- Belongs in the payload: no-invention/four-lane (1); as-of MM/DD/YYYY, never the raw token (2);
  grain-is-not-ZIP-only / never "ZIP-level" (3); any-chart-is-buildable (4); no system nouns/IDs/
  jargon (5); plain-text answers (6).
- Does NOT belong in the payload (dev-only — keep in the hook/CLAUDE.md): probe-code-first and
  crawl4ai-research-first (7). Don't pollute the product payload with dev instructions.
Some may already be present (the date rule was mirrored here — build queue 8bd1874b). AUDIT what's
there, ADD what's missing (especially "any chart is buildable" and an explicit not-ZIP-only framing
line), confirm all 8 importers pick it up.

### Part B — output lints (Class A enforcement — the structural guarantee)
Extend the display-leak/facts-only pattern with CI tests that fail on: "ZIP-level" framing in
generated copy; any date as the raw token instead of MM/DD/YYYY (confirm `display-leak.test.mts`
coverage first — don't duplicate); (stretch) a chart-capability assertion. This ENFORCES Part A
instead of hoping for it — "structural guarantee, not AI virtue."

### Part C — `UserPromptSubmit` hook (dev-session salience) — SIMPLE, no router
`.claude/hooks/inject-focus.mjs`, wired under a new `UserPromptSubmit` block in `.claude/settings.json`.
- Reads prompt JSON from stdin. **No network/Supabase** — runs every submit, must be <50ms. Exit `0`.
- ALWAYS prints the 7 hard rules (§2) to stdout (→ context). **No keyword topic router** — a router
  misfires constantly (injects email notes on any prompt that merely says "email"). Instead print a
  static pointer: "for area conventions, read the CLAUDE.md in the directory you're editing
  (ingest/ · refinery/packs/ · lib/email/ · lib/assistant/)."
- Also surface `_ASSISTANT/TODAY.md` if present — complementary, not competing (TODAY.md = what's in
  flight; this hook = the hard rules). The "go deep on one area" case is handled by area subagents
  (Part E), not by routing here.

### Part D — location-scoped CLAUDE.md (Class B)
Short (10-20 line) `CLAUDE.md` in `ingest/`, `refinery/packs/`, `lib/email/`, `lib/assistant/` — only
the conventions that apply when editing THAT area (these load by location). Example for `ingest/`:
"Incremental cursor + merge; never blanket replace (issue 03). Push COUNT/AVG/median to SQL/DuckDB —
never haul raw rows. Probe <1 min before any multi-minute ingest. Guard load-bearing columns before
any destructive write (Gate 4)."

### Part E — area subagents
Tight-charter agents in `.claude/agents/`: `website-builder`, `deliverable-builder`,
`ingest-engineer`, `answer-engine-guardian`. Each `description` must clearly say WHEN to delegate
(drives auto-selection). Each carries ONLY its area's rules + "if you don't know, /advisor; never
invent; cite file paths or live docs."

---

## 4. EXECUTION PROTOCOL — do exactly this, in order

1. **Read first (RULE 0.5):** this file, the parent analysis, `.claude/settings.json`,
   `refinery/lib/rules-of-engagement.mts`, and one existing hook (e.g.
   `.claude/hooks/print-kickoff.mjs`) to copy the I/O shape.
2. **Brainstorm (RULE 3.5):** `superpowers:brainstorming`. Decide the exact PRODUCT-FACING rule
   wording for `rules-of-engagement.mts` with Ricky. Do NOT skip to coding.
3. **Verify mechanics live (RULE 0.4):** confirm the current UserPromptSubmit stdin shape and
   stdout→context behavior against code.claude.com/docs hooks reference via crawl4ai. The docs drift;
   verify verbatim before wiring.
4. **Register the build (RULE 3.5, locked 2026-06-28):**
   `node scripts/new-build.mjs focus-system "Focus system: prompt-aware injection + scoped CLAUDE + subagents + lints"`.
5. **TDD (`superpowers:test-driven-development`):** the hook is pure (prompt-in → text-out) — write
   the topic-routing + always-on-rules tests FIRST, like `assistant-lib.test.mjs` does. Lints get
   failing tests first.
6. **Build Part A → E in order — PRODUCT-FACING FIRST** (A: rules-of-engagement, B: lints), then dev
   tooling (C: hook, D: scoped CLAUDE.md, E: subagents). Each part verified before the next.
7. **Gates:** `bun test`, the pre-push gate hooks. Hook must exit 0 cleanly and add <30 lines.
8. **Prove BOTH:** (a) a live `/api/b` or converse response now honors the repaired rule (no
   "ZIP-level"; date as MM/DD/YYYY); (b) a fresh session shows the 7 rules injected. Evidence before "done."

---

## 5. HARD RULES / GUARDRAILS (so this doesn't drift)
- **Do not propose workspaces/monorepo packaging.** That's settled (parent analysis Part 3). The TS
  core is one organism.
- **The LIVE PRODUCT reads `rules-of-engagement.mts` — fix that FIRST.** The hook only fixes
  dev-session Claude; it can NEVER change a user-facing answer. Doing the hook first leaves the
  product still saying the wrong thing.
- **Do not claim scoped CLAUDE.md fixes the Class-A repeats.** It is location-triggered. Class A is
  fixed by rules-of-engagement.mts + lints (product) and the hook (dev). The load-bearing distinction.
- **The injection hook must be cheap, exit 0, and have NO keyword router.** No DB/network. A router
  misfires; a slow/crashing hook gets disabled and dies silently.
- **Never invent a Claude Code feature.** If a behavior isn't in the docs, it doesn't exist (we
  already proved "topic session routing" does not). `/advisor` over guessing.

## 6. VERIFICATION (definition of done)
- New session + a website-flavored prompt → website notes visibly injected; same for the other 3 areas.
- All 7 hard rules present on every prompt regardless of topic.
- New CI lint reds on a planted "ZIP-level" string and on a raw-token date; greens when fixed.
- 4 area subagents exist and auto-delegate on a matching task.
- `bun test` green; hook adds <50ms.

## 7. ANTI-PATTERNS (what NOT to do)
- Re-pasting all of CLAUDE.md into the hook (defeats salience — inject a short, sharp reminder).
- A topic router so clever it's nondeterministic — keep it simple keyword matching.
- Adding a 5th broad subagent that overlaps the others (auto-selection gets confused).
- Putting framing rules in a scoped CLAUDE.md and expecting the live answer engine to honor them
  (it reads `rules-of-engagement.mts`, not CLAUDE.md).

## 8. OPEN QUESTIONS for brainstorming
- Exact final wording of the product-facing rules in `rules-of-engagement.mts` (Ricky owns this).
- Which of the 7 are product-facing vs dev-only? (Draft split in Part A — confirm with Ricky.)
- Does the hook surface `_ASSISTANT/TODAY.md` inline, or just point to it?
