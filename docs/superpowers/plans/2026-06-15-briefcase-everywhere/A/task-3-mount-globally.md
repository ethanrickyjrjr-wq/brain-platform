# A-3 — Mount the Briefcase globally — **SONNET**

## Goal
Make the Briefcase button + state visible on every page (`/`, `/charts`, `/r/*`), logged-in or out.

## Files
- Root layout (`app/layout.tsx` or the appropriate shell) — mount `BriefcaseProvider` (A-2) + the
  global floating Briefcase button.
- `AskAi.tsx:23` — **remove the per-page `<Briefcase/>`** so there is no double button once it's
  global.

## Acceptance test
- Floating Briefcase button visible on `/`, `/charts`, `/r/<any>` while logged out.
- No duplicate button anywhere (the old `AskAi.tsx` mount is gone).
- Draft state persists across navigation (provider is at the root).
