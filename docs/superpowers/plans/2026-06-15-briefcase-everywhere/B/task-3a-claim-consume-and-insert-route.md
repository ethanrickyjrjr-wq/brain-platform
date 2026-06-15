# B-3a — `/api/claim` consume + project insert — **OPUS**

## Goal
Turn a valid claim token + a logged-in user into an owned project, race-safe and single-use.

## Files
- **NEW** `app/api/claim/route.ts` — POST `{ token }`. Mirror `app/api/projects/import/route.ts`
  (cookie client, `projectItemsSchema`, id minting, `recordUse` beacon).

## Flow (POST)
1. `const supabase = createClient(await cookies())`; `const { data:{ user } } = await
   supabase.auth.getUser()`. **401 if no user.** (This route only runs already-authenticated — the
   login happened in a prior request. **Never `exchangeCodeForSession` here.**)
2. `const id = deterministicProjectId(token)` — compute FIRST; winner **and** loser use this exact
   value. (= `sha256(token).hex.slice(0,12)`, from `claim-store.ts`.)
3. `const res = await consumeClaimToken(token)` (the atomic UPDATE-guarded consume):
   - **`won`** → validate `res.items` with `projectItemsSchema`; insert via the **cookie client**
     (RLS `WITH CHECK` binds the row to `auth.uid()` — like `import/route.ts:36`):
     `supabase.from("projects").insert({ id, user_id: user.id, title: res.title ?? null, items:
     res.items })`. If a unique-violation (id already exists from a racing winner) → treat as
     idempotent success. Then `attachProjectId(token, id)` (best-effort) and `recordUse(req, {
     action:"claim", report_id:id })`. Return `{ id }`.
   - **`consumed`** → the token was already claimed; **return `{ id }`** (the deterministic id) so the
     loser lands on the same project. **Do NOT read `row.project_id`** — `attachProjectId` may not have
     landed yet for a concurrent loser.
   - **`expired` / `missing`** → `410` with `{ error: "claim_link_expired" }`.

## Client-choice invariant
Use the **cookie client + RLS `WITH CHECK`** for the project insert. **Never** service-role with a
hand-set `user_id` — the database must be the thing that binds the row to `auth.uid`. (Service-role is
only for `claim_tokens` via `claim-store.ts`, which has no RLS path for clients.)

## Race-proofing (operator fix — load-bearing)
- Deterministic `projects.id` = `hash(token).slice(0,12)` makes the insert idempotent (PK conflict =
  no-op) → two simultaneous claims can never create two projects.
- The **loser computes `id` directly** (step 2) and navigates to it. It must **never** depend on
  `row.project_id` (written after the winner's insert; a concurrent loser may read it null).
- `attachProjectId` is winner-side observability/cleanup only.

## Acceptance test
- Logged-out POST → 401.
- Logged-in POST with a fresh token → a `projects` row exists with `id = hash(token).slice(0,12)`,
  `user_id = auth.uid`, the carried items; response `{ id }`.
- **Two simultaneous POSTs on the same token → exactly one `projects` row; both responses carry the
  same `id`; no null-project error; no duplicate row.**
- A second (sequential) POST on the same token → `{ id }` (idempotent land), no new row.
- Expired token (>15 min) → 410 `claim_link_expired`.
- The inserted row is editable/rebuildable by that user via the existing `/project/[id]` +
  `/api/projects/[id]/build` RLS path.
