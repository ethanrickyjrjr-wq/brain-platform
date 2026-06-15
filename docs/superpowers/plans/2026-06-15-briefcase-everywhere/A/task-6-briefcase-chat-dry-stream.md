# A-6 — Briefcase chat (DRY the stream) — **SONNET**

## Goal
Give the global Briefcase a chat, reusing the existing welcome/highlighter stream rather than forking
a second streaming implementation.

## Steps
1. Wire the Briefcase chat to the existing stream (DRY — one streaming path, not a copy).
2. Reuse the existing message/exchange rendering.
3. **Free weekly cap = flip an env var, NOT new code.** The cap is already wired
   (`lib/welcome/chat-usage.ts` + `welcomeChatWeeklyCount()`), gated by `WELCOME_CHAT_FREE_WEEKLY_CAP`.
   Step 3 is setting that env value, not writing metering.

## Acceptance test
- Briefcase chat streams via the shared path (no duplicated stream logic — grep shows one
  implementation).
- With `WELCOME_CHAT_FREE_WEEKLY_CAP` set, the weekly cap engages through the existing code.
