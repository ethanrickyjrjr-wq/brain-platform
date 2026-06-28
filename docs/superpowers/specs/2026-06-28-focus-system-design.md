# Focus system: prompt-aware injection hook + scoped CLAUDE.md + area subagents + ZIP-level lint

**Date:** 2026-06-28
**Breakdown source:** `docs/superpowers/specs/2026-06-28-focus-restructure/01-focus-system.md` (full reasoning).
**Parent:** `docs/superpowers/specs/2026-06-28-repo-focus-restructure-analysis.md`.
**Check:** `focus_system_live_verify`.
This file = the concrete, code-grounded build delta. Read the breakdown for the why.

## Problem

Operator re-corrects the same things every session: dates must be MM/DD/YYYY, the moat is NOT
ZIP-only, no internal IDs/jargon, plain-text answers. Two structural causes, two classes:
- **Class A — cross-cutting beliefs** (ZIP-only, plain-text, no-jargon): nothing is salient — CLAUDE.md
  is ~600 lines, MEMORY indexes ~80 facts, so no rule fires at decision time. For the LIVE PRODUCT
  these come from `refinery/lib/rules-of-engagement.mts` (the payload), not CLAUDE.md.
- **Class B — code conventions** (merge-not-replace, aggregate-at-source, Deno imports): belong to a
  folder, fixed by location-scoped CLAUDE.md (loads by location).

## Goal

Make the right rules salient at the moment of decision — via a prompt-aware dev hook, location-scoped
CLAUDE.md, area subagents, and an output lint — instead of one always-on 600-line file. "Structural
guarantee, not AI virtue."

## Resolved decisions (operator, 2026-06-28)

1. **Part A placement:** the contested beliefs do NOT go in the 300-token live payload. "Not ZIP-only"
   → enforced by the new lint (Part B) + dev hook. "Any chart is buildable" → NOT a payload rule
   (it's conditional — non-bar shapes for arbitrary topics aren't built yet; a payload rule would make
   the product over-promise). The real chart work is its own handoff
   (`2026-06-28-chart-ideas-and-dynamic-charts-handoff.md`). Part A collapses to: audit rules 1-6 in
   `rules-of-engagement.mts` are present + worded right (likely zero change).
2. **Scope:** Issue 01 only this session + a clear handoff for Issues 02/03/04.
3. **Rules source:** the hook reads the hard rules from an operator-editable `_ASSISTANT/RULES.md`.
4. **TODAY.md:** point to it, never inline (33KB / ~8K tokens; has dates → would go stale on resume).

## Verified hook contract (code.claude.com/docs/en/hooks, fetched 2026-06-28, RULE 1)

- `UserPromptSubmit` stdin JSON: `prompt`, `session_id`, `cwd`, `transcript_path`,
  `permission_mode`, `hook_event_name`.
- Exit 0 + `hookSpecificOutput.additionalContext` → string added to context every turn, discreetly.
- Exit 2 = blocks + erases prompt (never do this). Always exit 0.
- 30s timeout, runs before every prompt → fast, no network/DB. Output ≤10k chars.
- Phrase as factual reminders, not imperative system commands (avoids prompt-injection surfacing).
- No matcher support; resume replays saved text → keep injected content static (no timestamps).

## What we're building

### Part C — `.claude/hooks/inject-focus.mjs` (UserPromptSubmit)
Pure prompt-in → JSON-out. Reads `_ASSISTANT/RULES.md` (fallback to a built-in default if absent),
emits `{ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: <rules + one-line
pointers to area CLAUDE.md files + TODAY.md> } }`, exit 0. No keyword router. Wired under a new
`UserPromptSubmit` block in `.claude/settings.json`. TDD: pure logic in a testable module.

### Part B — ZIP-level framing lint (`refinery/validate/zip-level-framing-lint.mts` + test)
Flags "ZIP-level" framing in customer-facing prose. Date-format already covered by
`display-leak.test.mts` (ISO_DATE_RE + raw-token guards) — do NOT duplicate. Follow the
`facts-only-lint.mts` shape (pure function returning `{ok, violations}`). TDD.

### Part D — location-scoped CLAUDE.md ×4
Short (10-20 lines) in `ingest/`, `refinery/packs/`, `lib/email/`, `lib/assistant/` — only the
conventions that apply when editing THAT area (Class B).

### Part E — area subagents ×4 (`.claude/agents/`)
`website-builder`, `deliverable-builder`, `ingest-engineer`, `answer-engine-guardian`. Tight
`description` for auto-selection; each carries only its area rules + "if unsure, /advisor; never
invent; cite file paths or live docs." Follow the existing `v3-spec-guard.md` frontmatter shape.

### Part A — rules-of-engagement audit
Confirm rules 1-6 present + worded right in `rules-of-engagement.mts`. No belief additions to the
payload (per decision 1). If any wording change is needed it must stay ≤300 tokens AND byte-mirror
across the 4 files guarded by `rules-of-engagement.test.mts` (constant + consumption-contract.md +
THE-CONTRACT.md + CLAUDE.md). Touches live `/api/b` + MCP → ask before push (RULE 1).

## Verification (definition of done)
- `bun test` green; hook exits 0, adds <50ms, output is valid JSON.
- New CI lint reds on a planted "ZIP-level" string; greens when removed.
- Fresh session: the 7 rules appear injected (additionalContext) on a prompt.
- 4 scoped CLAUDE.md exist; 4 subagents exist and auto-delegate on a matching task.
- Handoff written for Issues 02/03/04 + the chart-capability build.
