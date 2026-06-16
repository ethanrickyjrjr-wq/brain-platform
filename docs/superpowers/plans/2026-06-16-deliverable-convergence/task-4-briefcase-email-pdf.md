# Task 4 — Briefcase `email` deliverable + PDF skin

**Builder:** Sonnet · **Wave:** B (parallel with Task 3) · **Depends on:** Task 2

## Goal

The briefcase can build an **email deliverable** (and a **PDF**) from the same grounded spine, frozen at build time, rendered on `/p/[id]`. This is the missing Lane C — today deliverable types are `market-overview | bov-lite | client-email | one-pager` with no email/PDF send output.

## Why this is Sonnet

Follows the existing deliverable pattern closely (add a TemplateId, a builder fn, a render branch) given Task 2 supplies the render primitive. Well-specified, low architectural risk.

## Build

1. **New TemplateId `"email"`** — add to `lib/deliverable/templates.ts:83` (`TemplateId` union) and the `DELIVERABLE_TEMPLATES` set in `lib/deliverable/assemble.ts:21`. Mirror the type-lift discipline (atomic; update `examples.ts` + the `ALL_TEMPLATES` test array in the same commit).
2. **`buildEmailDeliverable`** — adapt the frozen `Narrative` + `items_snapshot` into a `GroundedReportModel` (Task 2): metrics from `metric` items, reads from narrative sections, scope from the project. Store the **recipe** (template_id + scope + chosen metrics) on the deliverable row so Task 7 can extract it.
3. **PDF skin `templates/html/doc/doc-report.html`** — a letter-size doc skin consuming the **same** `repeats.hero/metrics/reads` + tokens as `email/email-report.html`. Reuse the existing `window.print()` path (`app/api/projects/[id]/print/route.ts`); add `report` to the printable slugs.
4. **`/p/[id]` render** (`app/p/[id]/page.tsx`): when `template === "email"`, render the grounded email HTML (email skin) inline; the print route serves the pdf skin.
5. **Seed an `is_example` email deliverable** (`lib/deliverable/examples.ts`) so the gallery + dogfood path covers it.

## Tests / acceptance

- `lib/deliverable/*.test.ts` green incl. the example-template coverage assertion (`examples.test.ts:97`).
- Build an `"email"` deliverable via the example path → `/p/[id]` shows the grounded email; print route returns the pdf skin (letter-size, same numbers).
- Frozen-at-build verified: re-opening `/p/[id]` shows identical numbers (snapshot intact).

## Guardrails

Frozen-snapshot moat intact (no live re-fetch on `/p/[id]`). No-fabrication: numbers from snapshot/model only. Build stays FREE (watermark at end; the paywall is the send step — Tasks 5/6). Open check `briefcase_email_pdf_deliverable`.
