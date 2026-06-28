# Focus-Restructure — status & handoff

**Updated:** 2026-06-28. Parent: `../2026-06-28-repo-focus-restructure-analysis.md`.
Four independent sub-projects. Status below; each unbuilt issue is self-contained in its own file.

---

## ✅ Issue 01 — Focus System — BUILT (2026-06-28)
Spec: `../2026-06-28-focus-system-design.md`. Check: `focus_system_live_verify` (OPEN — needs live proof).
Shipped:
- **Part C** — `.claude/hooks/inject-focus.mjs` (UserPromptSubmit), reads operator-editable
  `_ASSISTANT/RULES.md`, injects the 7 hard rules + pointers to area CLAUDE.md + TODAY.md via
  `hookSpecificOutput.additionalContext`, exit 0, no router. Wired in `.claude/settings.json`.
  Test: `.claude/hooks/inject-focus.test.mjs` (`node` it) — 10/10.
- **Part B** — `refinery/validate/zip-level-framing-lint.mts` (+ test, WALL green). Flags PRODUCT
  framing ("ZIP-level intelligence/insights/analytics/platform/product/offering") only; the 79 grain/
  citation uses stay allowed. Date-format lint NOT duplicated (already in `display-leak.test.mts`).
- **Part D** — scoped CLAUDE.md in `ingest/`, `refinery/packs/`, `lib/email/`, `lib/assistant/`.
- **Part E** — subagents `website-builder`, `deliverable-builder`, `ingest-engineer`,
  `answer-engine-guardian` in `.claude/agents/`.
- **Part A** — audited `refinery/lib/rules-of-engagement.mts`: rules 1-7 present, MM/DD/YYYY in rule 5;
  contested beliefs deliberately kept OUT of the payload (enforced by lint+hook). **No edit needed.**

**To close the check:** open a fresh session, submit a prompt, confirm the 7 rules appear injected
(additionalContext), and confirm a matching task auto-delegates to one of the 4 subagents. Live proof,
not "code looks right" (memory feedback_checks-prod-evidence-not-dev-attestation).

**Follow-up (cheap):** `zip-level-framing-lint`'s WALL currently scans `brains/*.md` only — where every
hit is the GOOD grain kind. The product framing "ZIP-level intelligence" would actually appear in
homepage/marketing copy (`app/`, `components/`) or answer-engine runtime output. All clean today (grep
verified), but extend the WALL to scan `app/`+`components/` customer copy so it guards the surface that
matters.

---

## ⬜ Issue 02 — Root Cleanup + Section Map — READY
File: `02-root-cleanup-and-section-map.md`. Relocate ~13 plan-doc dirs (`git mv` to kebab-case under
`docs/_archive/`), `rm` the broken `C:Users…migrations/` dir (untracked — NOT `git mv`), write
`docs/section-map.md`. Doc-only, no code moves. Confirm archive destination with operator first.

## ⬜ Issue 03 — Incremental Ingest — READY (research dlt live first)
File: `03-incremental-ingest.md`. Per-source audit: append sources (permits, listing_lifecycle) →
`dlt.sources.incremental` + merge; snapshot sources (Census ACS, realtor.com monthly) keep `replace`.
crawl4ai the live dlt incremental API for the installed version before coding. Reference impl =
listing_lifecycle or permits (NOT realtor.com — it's a monthly snapshot).

## ⬜ Issue 04 — Free Self-Healing Automation — READY (fix daily-rebuild cause first)
File: `04-self-healing-automation.md`. daily-rebuild flapper cause is KNOWN/deterministic (rebuild bot
lost main-branch bypass, `d996fba4`) — fix the bypass, don't wrap in retry. Then wire retry +
Healthchecks.io dead-man's-switch + auto-issue. Re-verify vendor free-tier numbers live.

---

## 🔭 Adjacent — Chart capability (separate, operator-owned)
Not part of focus-restructure but surfaced this session. Build (almost) any chart + proactive "Chart
Ideas": `../2026-06-28-chart-ideas-and-dynamic-charts-handoff.md`. Check `generic_chart_capability`.
