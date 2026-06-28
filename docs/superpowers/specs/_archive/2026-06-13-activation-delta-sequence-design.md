# Activation Delta Sequence — "It's Alive" (design spec)

**Date:** 2026-06-13 · **Status:** building · **Branch:** `claude/activation-delta-sequence-m0fasv`
**Growth-list item #6:** *Prove the "it's alive" moment before the gate — send the delta unprompted.*

## Problem / outcome

Manufacture the conversion jolt **before** the paywall. A prospect opts in → immediately gets a
branded, cited SWFL market report for their ZIP (**email #1**) → with no further action, gets the
same report 3 days later with **what changed** highlighted (**email #2**) → CTA to the gate. The
"it updated itself" moment is the trigger: recurring value felt viscerally before the first dollar
is asked. This is the acquisition front-end feeding the existing `/pricing` white-label funnel.

## Two hard constraints

1. **Compliance is consent, not legality.** Resend's AUP bans cold/unsolicited sending. Enrollment
   requires explicit opt-in (unchecked checkbox + clear wording + one-click unsub + real physical
   address). That single choice makes the play Resend-legal, CAN-SPAM-clean, and deliverable.
2. **The delta must be REAL** (platform moat #1: the system cannot invent a number). Email #1
   snapshots the exact cited facts it showed; email #2 diffs against that **stored** snapshot.
   "What we showed you Tuesday vs. now" is true by definition. The freshness token is the
   always-true liveness anchor; the delta is a bonus surfaced only where a real time-grain exists.

## Engine (grounded — verified against code, RULE 3 C1)

The scope→grounded-content engine is the ZIP-report path, **not** the `/welcome` chat (a streaming
LLM with no `SnapshotItem[]`) and **not** the project deliverable (`assembleDeliverable`, which
consumes a project's manually-filed items):

- `resolveZip(zip)` (`refinery/lib/zip-resolver.mts`) → `{ in_scope, ... }` — **the 6-county MOAT
  gate**. (NOT `buildPlaceContext`, which only emits a chat-grounding string.)
- `assembleLocationDossier(loc)` + `selectDossierLines(lines, tier)` (`lib/zip-dossier.ts`) →
  per-brain cited, freshness-stamped, speaker-scrubbed `LocationDossierLine[]`, including the
  deltable brains `city-pulse-swfl` (daily), `permits-swfl`/`permits-commercial-swfl`,
  `housing-swfl`, `env-swfl`.
- Per-ZIP housing cells (`housing-swfl` → `housing_by_zip`) + flood AAL (`env-swfl` key_metrics),
  mirroring `app/r/zip-report/[zip]/page.tsx`.

**Consequence:** the snapshot stores the assembled dossier ("what we showed you"); the delta diffs
a stored dossier against a freshly-assembled one. We diff the **distilled brain output via the
dossier**, never raw `data_lake` rows — so the email layer inherits the brains' already-distilled
live head and never re-implements `city_pulse` supersession.

## Modules

| Module | Responsibility |
|---|---|
| `lib/email/activation/types.ts` | `ActivationScope`, `ActivationSnapshot`, `SnapshotMetric/Line`, `ReportDelta` |
| `lib/email/activation/snapshot.ts` | `assembleActivationReport(scope)` → grounded facts + `ActivationSnapshot`; built on `resolveZip` + `assembleLocationDossier` + housing/flood reads |
| `lib/email/activation/delta.ts` | `computeReportDelta(prev, current)` — pure, deterministic; no-change is first-class |
| `lib/email/activation/render.ts` | `reportToEmailHtml(scope, brand, { delta? })` — deterministic shell fill |
| `templates/html/email/email-report.html` | the report shell (single column, ≤90kb) |
| `lib/email/activation/sequence.ts` | enroll + step runner (reuses `processSchedule` send path; DRY_RUN-capable) |
| migration | `prospect_activation` table + `email_subscribers` consent/scope columns |

## Integrity boundary (non-negotiable)

- Report facts come **only** from the grounded dossier engine (MOAT-invariant) and, when prose is
  added, the linted `buildDeliverableNarrative` (regenerates-then-hard-strips invented numbers).
  Never the chat LLM.
- Delta numbers are computed in code (`computeReportDelta`, deterministic — Brain-Factory #2). No
  second free-form LLM call to "summarize the delta."
- Delta diffs the stored v1 snapshot = exactly what we showed; it cannot claim an unprovable change.
- Scope ZIP must pass `resolveZip(...).in_scope` or the enrollment is parked/clarified.
- Freshness token (liveness, moves daily) ≠ delta (change). Email #2 shows both, distinctly.

## Phases

- **A — safe-additive:** consent checkbox + storage + `prospect_brand` producer; `prospect_activation`
  table; `computeReportDelta` + unit tests. No sends change.
- **B — renderer:** `reportToEmailHtml` + `email-report.html` + render-only tests.
- **C — sequence:** enroll → step-1 → step-2 (+3d) delta send. Exercise step-2 via manual
  `workflow_dispatch` + DRY_RUN only; do **not** flip the live `*/15` cron. Hard prereq:
  `city_pulse_supersession` closed (due 2026-06-15) + grain rule wired.
- **D — go-live:** swap the CAN-SPAM address, apply migrations + set `DIGEST_BROADCAST_SECRET`,
  THEN flip the live cron; monitor complaint <0.1% / unsub <0.3%; kill switch on breach.

## Checks ledger

`email_activation_consent` (A) · `prospect_snapshot_store` (A) · `report_delta_computer` (A) ·
`email_report_renderer` (B) · `activation_sequence_golive` (C/D, gated on `city_pulse_supersession`).
Advances `prospect_brand_write_side` (the missing producer, landed in A).
