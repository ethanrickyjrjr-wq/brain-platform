# Task 5 — In-chat flow: build → approve → send → "go weekly?"

**Builder:** Opus · **Wave:** D (parallel with Task 6) · **Depends on:** Task 7 (bridge), Task 4 (email deliverable)

## Goal

The whole flow lives in the briefcase chat with inline buttons: build → "Looks good?" → pick audience → send → **"Send this every week?"** → confirm. No leaving the chat.

## Why this is Opus

UX orchestration across the chat stream + the send/paywall gate + the propose/confirm hand-off; touches the auth-gated send path. Correctness of the gate (build free, send gated) is load-bearing for monetization.

## Build

1. **Action cards in the chat** (`components/briefcase/BriefcaseChat.tsx` + `/api/welcome/chat`): reuse the existing typed-card channel to emit action frames — `build-result` (preview + `/p/[id]` link + [Looks good]/[Change]), `audience-pick` (chips from the user's `email_audiences` + [Upload contacts]), `send` ([Send] / [Send me a test first]), `go-weekly` ([Yes, weekly]/[Just once]), `confirm-schedule` (the propose card + [Confirm]/[Cancel]).
2. **Wire confirm to the existing two-step contract** — the "weekly?" confirm calls `schedule-command.ts` propose → user confirm → write (Task 7 supplies the recipe→`email_schedules` insert). Nothing writes before confirm.
3. **Gate the send step on auth/paywall** — building + preview is free; tapping Send (one-off or weekly) is the login-capture + send paywall moment (locked monetization model). Build path stays ungated.
4. **First-send default:** offer both [Send a test to me first] and [Send to <audience>] (recommended safe default).

## Tests / acceptance

- E2E (manual + component test): build→approve→audience→send→"weekly?"→confirm runs with inline buttons; no free-text required for finite choices.
- Send step gates on auth/paywall; build does not (assert an anonymous user can build+preview but is gated at Send).
- Confirm inserts exactly one schedule via Task 7; cancel writes nothing.

## Guardrails

Reuses the propose/confirm (no silent mutation). Per RULE 1.5, if built concurrently with Task 6, isolate in a worktree (shared client schedule-action util). Open check `inchat_build_send_schedule_flow`.
