# Handoff — Gap 4 UI prefill: `schedule_suggestion` → one-click schedule setup

**Status:** backend done, shipped, live on main (commit `bf84bcfb`). This handoff is the remaining
UI wiring, scope-trimmed out of that build (see
`docs/superpowers/specs/2026-07-01-email-social-lake-wiring-design.md`, Gap 4 section).

## What's already done

The author tool (`lib/email/author-doc.ts`) may now emit an optional field when it authors content
that reads like a recurring digest:

```
schedule_suggestion?: { cadence: "weekly" | "monthly"; reason: string }
```

`authorDoc()` (`lib/email/build-doc.ts`, final `return` in the function) passes it through in the
build response payload as `scheduleSuggestion: { cadence, reason } | null`. It reaches
`app/api/email-lab/ai/route.ts`'s JSON response today — verify with a network-tab check on an
author-mode build (`mode` param that routes to `authorDoc`, not `buildContentDoc`) for a
weekly-market-update-style prompt.

**Nothing downstream reads it yet.** That's this handoff.

## The gap, precisely

`EmailLabShell.tsx`'s `runAi()` (around line 267-313) is the function that calls
`/api/email-lab/ai` and handles the response. Its response type declaration (line 283-290) doesn't
include `scheduleSuggestion`, so even though the field is present on the wire, it's silently dropped —
TypeScript just doesn't know about it and nothing reads `data.scheduleSuggestion`.

Separately, `ScheduleSendModal` (`components/email-lab/ScheduleSendModal.tsx`) is opened from
`EmailLabShell.tsx` around line 1130 (`{scheduleOpen && scheduleId && projectId && <ScheduleSendModal .../>}`)
and delegates entirely to `SendWeeklyHandle` (`app/p/[id]/SendWeeklyHandle.tsx`), which owns its own
`dayOfWeek`/`sendHour` state (lines 85-86, defaulting to Monday/7am) with zero way to be told "start
in the cadence step, pre-picked to weekly" from outside.

**Real blocker, not a styling gap:** `SendWeeklyHandle.propose()` (line 107-139) hardcodes
`cadence: "weekly"` in the request body it sends to `/api/email/schedule-command` (line 118). There
is currently NO monthly path in this component at all — only the day-of-week + hour pickers exist
(lines 328-379). If `schedule_suggestion.cadence` is `"monthly"`, there's nowhere in the UI today to
express that. `propose_email_schedule_action` (`lib/email/schedule-command.ts`) already supports
`cadence: "monthly"` + `day_of_month` server-side — the UI just never built a monthly picker because
nothing has asked for one until now.

## Suggested shape (not committed to — brainstorm before building per RULE 3.5)

1. `runAi()` reads `data.scheduleSuggestion` off the response and stores it in a new piece of
   `EmailLabShell` state (e.g. `suggestedSchedule: {cadence, reason} | null`).
2. When set, show a small dismissible banner near the build result (mirrors the existing
   `aiMessage`/`chartNote` banners at lines 295-307) — "This reads like a recurring [weekly/monthly]
   update — [reason]. Schedule it?" with a button that opens `ScheduleSendModal` already primed.
3. `ScheduleSendModal` → `SendWeeklyHandle` needs an optional `initialCadence`/`initialDayOfMonth`
   prop threaded through, defaulting the component's internal state and — for weekly — skipping
   straight to the `"cadence"` step instead of `"idle"`.
4. **Monthly picker is new UI**, not a prop-threading job: a day-of-month selector (1-28, mirroring
   `schedule-command.ts`'s `domSchema`) alongside the existing day-of-week picker, gated on which
   cadence is selected. `propose()`'s hardcoded `cadence: "weekly"` needs to become a real branch.

## Why this was cut from the backend build

Scope discipline, not laziness: the backend field (schema + tool + system prompt + payload
passthrough) is a clean, independently testable, low-risk unit that shipped with full test coverage
today. The UI work above touches a different component tree, needs a genuinely new monthly-cadence
UI that didn't exist before, and deserves its own brainstorm/plan pass rather than being rushed in as
an afterthought to a 3-piece backend build. The backend field isn't wasted in the meantime — it's
already visible in the API response for manual/network-tab use or a follow-up small PR.

## Where to start

- Brainstorm (RULE 3.5) the banner copy + monthly-picker UX before touching code — this is a
  genuinely new UI surface (day-of-month picker), not a pure refactor.
- `SendWeeklyHandle.tsx`'s `Step` union (lines 36-47) is the natural place to add a
  `"cadence-monthly"` step or extend the existing `"cadence"` step with a cadence toggle.
- No new check needed yet — fold into `email_social_lake_wiring_live_verify` (still open) or open a
  dedicated one when this ships, operator's call.
