# U4 — Workspace "Social posting" lane + connect block

| | |
|---|---|
| **Model** | **Opus** (shared-file edits + connect-block state machine + concurrency judgment) |
| **Stage** | USER-SIDE — build **LAST**: after backend **01** + **FINAL BOSS Piece 1 merges** |
| **Runs in parallel with** | nothing safely — it edits the live workspace files |
| **CANNOT run with** | **any concurrent workspace work** (FINAL BOSS Piece 1) — it edits `page.tsx` + `ProjectWorkspace.tsx` |
| **Blocked by** | 01 (`social_schedules`, `social_accounts`), U1 (connect/disconnect routes the block links to) |
| **Files** | EDIT: `app/project/[id]/workspace/types.ts`, `app/project/[id]/workspace/DeliverableLanes.tsx`, `app/project/[id]/ProjectWorkspace.tsx`, `app/project/[id]/page.tsx`; NEW: `app/project/[id]/workspace/ConnectSocialBlock.tsx`, `app/project/[id]/workspace/__tests__/social-lane.test.tsx` |
| **Gate** | **RE-PROBE the four shared files at build time** — they move; `react-hooks/set-state-in-effect` is a hard ESLint error |

## Goal
Surface social schedules + account-connection state in the project workspace, mirroring the existing Built/Emailing lanes. Schedule-driven (not post-driven), exactly like `email_schedules`. Add a per-platform connect block with the reconnect-on-expiry float-to-top pattern.

## ⚠ Concurrency hazard (verified 2026-06-20)
`page.tsx`, `ProjectWorkspace.tsx`, `BuildActions.tsx` are **currently modified** in `git status` (FINAL BOSS Piece 1, held for push). U4 edits the same files. **Build U4 only after Piece 1 merges, and re-open all four shared files first** — the line anchors below will have shifted. Stage U4 last for this reason.

## Verified anchors (2026-06-20 — cite the symbol, never a line number)
- `DeliverableLanes({ projectId, deliverables, trashedDeliverables, emailSchedules, items, projectBranding, mcpConnected, onConnectMcp, ... })` — `app/project/[id]/workspace/DeliverableLanes.tsx`. The **Built lane** and **Emailing lane** are sibling `<section className="mt-6 rounded-xl border border-white/10 bg-[#0d1e2b]/50 p-4">` blocks; the Emailing lane renders conditionally on `emailSchedules.length > 0` and maps to `EmailScheduleCard({ s })`.
- `EmailScheduleRow` — `app/project/[id]/workspace/types.ts`: `{ id, cadence, day_of_week, day_of_month, send_hour_et, audience_slug, scope_kind, scope_value, topic, status, last_run_at, next_run_at }`.
- `page.tsx` — `email_schedules` SELECT: `.from("email_schedules").select("id, cadence, day_of_week, day_of_month, send_hour_et, audience_slug, scope_kind, scope_value, topic, status, last_run_at, next_run_at").eq("project_id", id).neq("status","stopped").order("created_at",{ascending:false})` → `<ProjectWorkspace emailSchedules={emailSchedules} />`.
- `ProjectWorkspace` Props carry `emailSchedules: EmailScheduleRow[]` and thread it into `<DeliverableLanes emailSchedules={emailSchedules} />`.
- `ConnectMcpBlock` (the FINAL BOSS §E block) is the precedent for the connect block's open / dismissed / connected modes via `ui_state`.
- **Schedule-driven gotcha:** `email_schedules` carries NO `deliverable_id` — it's schedule-driven. `social_schedules` must follow the same shape.

## Build
1. **`types.ts`** — add `SocialScheduleRow { id: number; platform: string; cadence: string; day_of_week: number | null; day_of_month: number | null; send_hour_et: number; scope_kind: string | null; scope_value: string | null; status: string; last_run_at: string | null; next_run_at: string | null; account_name: string | null; media_kind: string | null }`.
2. **`page.tsx`** — after the `email_schedules` SELECT, add the parallel `social_schedules` SELECT (`.eq("project_id", id).neq("status","stopped").order("created_at",{ascending:false})`) → `socialSchedules: SocialScheduleRow[]`. Also SELECT `social_accounts` (`platform, account_name, status`) for the connect block. Pass both to `<ProjectWorkspace socialSchedules={...} socialAccounts={...} />`.
3. **`ProjectWorkspace.tsx`** — add `socialSchedules: SocialScheduleRow[]` + `socialAccounts: SocialAccountRow[]` to Props, the function signature, and the `<DeliverableLanes .../>` call. (Thread through all three layers — page → ProjectWorkspace → DeliverableLanes — same as `emailSchedules`.)
4. **`DeliverableLanes.tsx`** — add `socialSchedules` + `socialAccounts` to props; add a `SocialScheduleCard({ s }: { s: SocialScheduleRow })` mirroring `EmailScheduleCard` (platform badge, cadence label, status badge, last/next-run line via the same time formatter); add a third `<section>` "Social posting" (conditional on `socialSchedules.length > 0`) between the Emailing lane and the modal JSX; render `<ConnectSocialBlock accounts={socialAccounts} projectId={projectId} />` above the schedule list.
5. **`ConnectSocialBlock.tsx`** (new) — per-platform connect cards (X / Meta / LinkedIn / GBP). Each card: if connected → show `account_name` + a disconnect action (POST `/api/social/connect/[platform]/disconnect`, U1); if `expired|revoked` → **float to the top + highlight + "Reconnect"** (links `/api/social/connect/[platform]/start`, U-D4); if not connected → "Connect" (links `/start`). **GBP card → "Connect · access pending Google approval"** (U-D5). No `setState` synchronously in a `useEffect` body (hard ESLint error) — use the set-state-during-render pattern.

## Tests & gates
`SocialScheduleCard` renders platform/cadence/status/next-run for a row · the lane is hidden when `socialSchedules.length === 0` · `ConnectSocialBlock` floats an `expired` account to the top with a Reconnect CTA, shows `account_name` for connected, and renders GBP as pending-approval · **email + Built lanes unchanged** (regression — you edited shared files) · `next build` ✓, real-tsc 0, eslint clean (incl. `react-hooks/set-state-in-effect`), `bun test` for the workspace green.

## Done =
The project workspace shows a "Social posting" lane (schedule cards) + a connect block (per-platform connect/reconnect/disconnect, GBP pending-approval), threaded page → ProjectWorkspace → DeliverableLanes exactly like email, with the Built + Emailing lanes untouched.
