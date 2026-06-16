# Deliverable Convergence — build → send → send-weekly, all in chat

**Date:** 2026-06-16 · **Owner:** session (Opus) · **Status:** design brief (not a status board — open obligations live in the `checks` ledger, never here)

> Scope: **Phases 2–7 only.** Phase 1 (data-driven `email-report.html`) is **excluded by operator decree** — it is owned by the parallel session's companion plan `docs/superpowers/plans/2026-06-16-email-report-data-driven.md` and is referenced here as a precondition, not re-specced.

---

## What we're building (operator intent)

A user asks the briefcase AI to build an email/PDF, approves it, sends it, and the AI offers **"send this weekly?"** — all inside the chat, with a confirm button and a way to pick recipients. Every **built deliverable keeps a permanent "Send / Send weekly" handle** so the user can return later and send something already made. Eventually the AI sets up the recurring send and the user uploads contacts.

Most of the recurring engine, AI schedule-setup, and contacts upload **already exist on `main`**. This convergence wires them into one in-chat flow + adds send-handles on built work, on top of a shared grounded render path.

---

## Gate before Wave A — the artifact must be real and green (Phase 0)

**Do not start Wave A until this is true.** As of 2026-06-16 the foundation is **local-only and red:**

- Local `main` is **ahead of origin/main by 7 commits, unpushed.** origin/main has the **old** spec, **no** companion plan, **no** Phase-1 code.
- Phase 1 is **half-built:** renderer (`render-html-template.ts`), wrapper (`render-template.ts`), and template (`email-report.html` → `repeat:hero/metrics/reads`) are done; **`lib/email/activation/render.ts` still feeds the removed `[ BODY TEXT ]` slot** → `bun test lib/email` = **312 pass / 5 fail** (freshness token, delta block, re-verified, CTA, callout border).
- One of the 7 unpushed commits is **unrelated** (`f6a8b0f` crawl4ai→Accela).

**Phase 0 = finish Phase 1 to 5-green (per the companion plan) → push spec + companion plan + green Phase 1 to origin/main** (the crawl4ai doc rides along, harmless). Only then is there a real approved artifact to build Phases 2–7 against. Owner of Phase 0 = TBD by operator (parallel session vs. isolated worktree). Pushing before green = red `main` — forbidden.

---

## The two-object model (the hinge — never collapse these)

- **Deliverable = a frozen photograph.** `freezeSnapshot` (`lib/deliverable/build.ts`) bakes data in at build time; `/p/[id]` shows the same numbers forever. The preview/approval gate + the "what we sent on date X" record.
- **Schedule = a standing order.** Stores a *recipe* (template + scope + audience + cadence) and **re-fetches fresh data every run** (`scripts/email/run-schedules.mts`). `email_schedules` already stores the recipe, never a snapshot.
- "Send weekly" copies the **recipe** out of a built deliverable into a schedule — it never re-sends the frozen photo. Same design, fresh numbers each run. "Send later" re-renders fresh and re-asks "still look right?" — the frozen `/p/[id]` stays the historical record.

---

## The in-chat flow (Tasks 5–7) and send-later (Task 6)

```
1. "Make a Cape Coral flood email and send it weekly to my buyers."
2. AI builds → preview card + /p/[id] link        [Looks good] [Change]
3. Approve → "Who gets it?"  audience chips +      [Upload contacts]
4. AI sends once (or [Send me a test first])
5. "Send this every week?"                          [Yes, weekly] [Just once]
6. Yes → cadence chips → propose card               [Confirm] [Cancel]
7. Confirm → ONE email_schedules row → cron sends weekly with FRESH data
```

Buttons for every finite choice. The "weekly?" confirm reuses `schedule-command.ts`'s existing propose→confirm (writes nothing until confirm). Built deliverables carry the same Send / Send-weekly handle on `/p/[id]` and `/project`.

**Monetization fit (locked):** build + preview + PDF = free forever (watermark at end, not a block). **Send / Send weekly is the gated action** — the login-capture + send paywall moment, both in-chat and on the built-work button.

---

## Convergence spine (Task 2 — the shared primitive everything rides on)

1. **`GroundedReportModel` = `AssembledReport` EXTENDED** (operator-approved C1 fix) with `delta?: ReportDelta | null`, a general `scope { kind:"zip"|"place"|"county"|"region"; value; grain; topic? }`, and `cta_url`/`site_origin`. `AssembledReport` (`lib/email/activation/snapshot.ts:48`) carries **none** of these today (delta is computed separately; scope is ZIP-hardcoded).
2. **`renderGroundedReport(model, {skin:"email"|"pdf", brand})`** — computes structured tokens + `repeats.hero/metrics/reads` + the `[ DELTA ]` block, calls `renderHtmlTemplate` on the chosen skin. Generalizes Phase 1's repeat-block; **extends** the existing `renderEmailTemplate`/`renderHtmlTemplate` seam (RULE 3 C2 — no new mandatory gate).
3. **Two skins, same data** — `email/email-report.html` (Phase 1) for email; new `doc/doc-report.html` (same `repeats`/tokens) for PDF via the existing `window.print()` path.

---

## Wave / builder / concurrency matrix

| Wave | Tasks (parallel within the wave) | Builder | Depends on |
|------|----------------------------------|---------|-----------|
| **0 (gate)** | Finish + push Phase 1 to green — *companion plan, NOT in this folder* | — | — |
| **A** | [Task 2 — Convergence spine](./task-2-convergence-spine.md) | **Opus** | Phase 1 green on origin/main |
| **B** | [Task 3 — Recurring adopts spine](./task-3-recurring-adopts-spine.md) ‖ [Task 4 — Briefcase email + PDF](./task-4-briefcase-email-pdf.md) | **Opus** ‖ **Sonnet** | Task 2 |
| **C** | [Task 7 — Build→schedule bridge](./task-7-build-to-schedule-bridge.md) | **Opus** | Task 4 |
| **D** | [Task 5 — In-chat flow](./task-5-inchat-flow.md) ‖ [Task 6 — Send-later on built work](./task-6-send-later-built-work.md) | **Opus** ‖ **Sonnet** | Task 7 |

**Parallelism rules:** within a wave, tasks touch disjoint files (B: scheduler/scoped-content vs. deliverable/doc-skin; D: chat components vs. deliverable/project buttons). If two are built concurrently by separate sessions, **isolate in a git worktree (RULE 1.5)** — Wave D's two tasks may share a small client schedule-action util; whoever lands second rebases.

**Builder rationale:** Opus where correctness/architecture is load-bearing (the spine, the recurring break-guard, the bridge recipe extraction, the UX+paywall orchestration). Sonnet where the work follows an existing pattern closely (the new deliverable type; the built-work buttons).

---

## Checks to open (after this folder is reviewed — they live in the ledger, not here)

`email_grounded_render_spine` (T2) · `email_recurring_report_template` (T3) · `briefcase_email_pdf_deliverable` (T4) · `inchat_build_send_schedule_flow` (T5) · `built_work_send_handle` (T6) · `build_to_schedule_bridge` (T7). Already tracked, do **not** duplicate: `email_report_multizip_revival`, `email_brand_navy_canonical`, the companion plan's Phase-1 checks.

## Standing guardrails (apply to every task)

- No-fabrication / provenance: numbers come from `GroundedReportModel` fields, never invented; cite source; mark `[INFERENCE]`.
- Vendor-first: before any go-live cron flip, verify Resend `segments`/`broadcasts` surface in-session (separate from this folder).
- RULE 1.5: `git add <explicit paths>`, never `-A`; worktree-isolate concurrent same-file work.
- No-autonomous-push / no-branch / no-PR: land on `main` via `node scripts/safe-push.mjs` only after operator confirmation; SESSION_LOG entry every push.
