# A-8 — Fix dead "Open project" + draft→project import — **SONNET**

## Goal
A logged-out user who filed items should, on login, find their draft materialized into an owned
project — and the "Open project" affordance should actually work.

## Behaviour
- `ImportDraftOnLogin` reads `DRAFT_KEY = "swfl_project_draft_v1"` (localStorage) → POSTs to
  `/api/projects/import` (verified: `{ items, title? }` → `projects.insert({ id, user_id: user.id,
  ... })`, cookie client + RLS `WITH CHECK`) → clears localStorage → `router.replace('/project/{id}')`.
- Fix the dead "Open project" link to route to `/project/{id}`.

## Note (shared with B)
This is the **web** carry-back path; B's `/claim` flow is the **MCP** analog of the same pattern
(`ImportDraftOnLogin` + `/api/projects/import`). Keep them consistent.

## Acceptance test
- File an item logged-out → persists across nav → "Sign in to build" → OTP login → draft imported to
  a `projects` row → "Open project" lands on `/project/{id}` → Build produces a `/p/{id}`.
