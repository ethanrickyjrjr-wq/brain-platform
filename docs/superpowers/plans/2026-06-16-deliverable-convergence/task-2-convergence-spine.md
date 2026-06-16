# Task 2 — Convergence spine: `GroundedReportModel` + `renderGroundedReport`

**Builder:** Opus · **Wave:** A (solo) · **Depends on:** Phase 1 green + pushed to origin/main

## Goal

One grounded data shape and one skinnable render function that every lane (activation, recurring, briefcase, PDF) produces/consumes — so "template fixed, data updates" and "build email or PDF" ride a single primitive instead of three ad-hoc paths.

## Why this is Opus

It defines the shape the other five tasks bind to; a wrong field set here propagates everywhere. Architecture-load-bearing (RULE 3 C1 — audit the real shapes before writing).

## Build

1. **`GroundedReportModel`** (new `lib/email/grounded-report.ts`) = **extend** `AssembledReport` (`lib/email/activation/snapshot.ts:48`), do **not** rename it. Add:
   - `delta?: ReportDelta | null` — today computed separately (`activation/delta.ts`) and passed as `opts.delta`; fold it into the model so every lane can carry it.
   - `scope: { kind: "zip"|"place"|"county"|"region"; value: string; grain: string; topic?: string }` — general scope; `AssembledReport` is ZIP-hardcoded (`zip/primaryPlace/countyName`), the recurring lane carries `scope_kind/value/topic`. Map existing ZIP fields into this.
   - `cta_url`, `site_origin` — today `RenderReportOptions`.
2. **`renderGroundedReport(model, { skin: "email"|"pdf", brand })`** (same file) — port the body-building logic from `reportToEmailHtml` (`lib/email/activation/render.ts`) into structured outputs:
   - `repeats.hero` = `[{HERO_VALUE, HERO_LABEL}]` from `model.metrics[0]` or `[]`.
   - `repeats.metrics` = value+label per metric (cap `MAX_METRIC_ROWS`); `repeats.reads` = `lineToHtml` per line (cap `MAX_LINES`).
   - `[ DELTA ]` block from `model.delta` (the one conditional/nested piece, dark-restyled).
   - tokens: `PLACE/COUNTY/ZIP/FRESHNESS_TOKEN/CTA_URL` + brand.
   - call `renderHtmlTemplate(skin === "email" ? "email/email-report" : "doc/doc-report", tokens, { repeats, delta })` via `renderEmailTemplate`-style wrapper. (doc skin is built in Task 4; for Task 2, email skin is the live target, pdf skin may stub to email until Task 4.)
3. **Thin `reportToEmailHtml`** to a wrapper: build the model from `AssembledReport` + opts, call `renderGroundedReport(model, {skin:"email", brand})`, then `ensureUnsubscribeToken`. Behavior identical to Phase-1 green output (no test regression).

## Tests / acceptance

- `bun test lib/email` stays green (Phase-1's 5 + existing).
- New unit: `renderGroundedReport` email skin == `reportToEmailHtml` output for the same data (golden equivalence) — proves the thin-wrapper refactor is behavior-preserving.
- New unit: a model with `delta=null` renders no `[ DELTA ]` content; a model with `delta.has_change=false` renders "Re-verified".

## Guardrails

No new render path that bypasses the no-fabrication lints; numbers only from model fields. Extends the existing renderer seam (RULE 3 C2). Open check `email_grounded_render_spine` on completion.
