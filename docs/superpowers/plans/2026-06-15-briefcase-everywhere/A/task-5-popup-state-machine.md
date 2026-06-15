# A-5 — Popup state machine — **SONNET**

## Goal
A state-branching Briefcase popup: pitch + examples when logged-out/empty; the draft + build path when
there's work; CTAs that point at the ladder.

## Behaviour
- **Logged-out / empty:** pitch + the 4 live example cards (A-4). Two exits aligned to the ladder:
  - **"Build & send here"** → `LoginModal` (rung 1 auth wall).
  - **"Use me in your own Claude — free"** → `MCPInstall` (shows `claude mcp add ...`, rung 0).
- **Has draft:** show filed items + the build affordance.
- Copy reflects the ladder: **"1 month free builds, then Pro (MCP-discounted)."**

## Create-gate (downgraded to SONNET)
The logged-out-build gate is trivial: **logged-out "Build" → open `LoginModal`, never call the build
API.** Ship it with a **bypass test** asserting the API is not hit while logged out.

## Acceptance test
- Logged-out popup shows pitch + 4 example cards; both exits work (`LoginModal` opens; `MCPInstall`
  shows the `claude mcp add` line).
- Logged-out "Build" opens `LoginModal` and does **not** POST the build route (bypass test).
- With a draft present, the popup shows items + build path.
