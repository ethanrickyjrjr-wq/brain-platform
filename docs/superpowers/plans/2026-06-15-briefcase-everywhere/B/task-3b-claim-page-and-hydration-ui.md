# B-3b — `/claim` page + hydration UI — **SONNET**

## Goal
The carry-back landing: show a logged-out user what they're about to bring over, route them through
the existing OTP login, and auto-claim on return.

## Files
- **NEW** `app/claim/page.tsx` (server component).
- **NEW** `app/claim/_components/ClaimOnLogin.tsx` (client). **Mirror**
  `app/project/_import/ImportDraftOnLogin.tsx` (incl. its `reportImportFailure`-style beacon).

## `page.tsx` (server)
- Read `t` (token) from `searchParams`. If absent → friendly "invalid link".
- `const peek = await peekClaimToken(t)` (read-only, from `claim-store.ts`, B-1). If `null` or
  `peek.expired` → render "This link has expired — ask your AI to hand off again." (no consume).
- `const { data:{ user } } = await createClient(await cookies()).auth.getUser()`:
  - **Logged OUT** → render a read-only **preview** (title, `peek.itemCount`, `peek.kinds`) + a
    primary CTA **"Sign in to claim"** → `/login?next=${encodeURIComponent('/claim?t=' + t)}`. The
    token is base64url (URL-safe) so it survives the two redirect hops intact.
  - **Logged IN** → render `<ClaimOnLogin token={t} />`.
- **No mutation on GET.** The page only reads (peek) and renders; the claim write is the client POST.

## `ClaimOnLogin.tsx` (client)
- On mount, POST `/api/claim` with `{ token }` (mirror `ImportDraftOnLogin`'s mount-POST to
  `/api/projects/import`).
  - On `{ id }` → `router.replace('/project/' + id)` (the editor; immediately rebuildable).
  - On 410 → "link expired" message + re-handoff hint.
  - On any failure → fire the failure beacon (mirror `reportImportFailure`) and show a retry.
- Show a lightweight "Claiming your work…" state while the POST is in flight.

## Invariants
- Preview never consumes the token and never exposes raw item bodies to the client (summary only).
- The only path that mutates is the authenticated client POST → `/api/claim` (B-3a).
- Uses the **existing** OTP login via `next=`; do not build a new login or a magic-link path.

## Acceptance test
- `/claim?t=<valid>` logged out → preview renders (title + item count/kinds), **no** `consumed_at`
  set; "Sign in" goes to `/login?next=/claim?t=<token>`.
- Complete OTP login → bounced back to `/claim?t=<token>` → auto-POST → lands on `/project/{id}`.
- `/claim?t=<expired>` → friendly expired message, no crash, no consume.
- Missing/garbage `t` → friendly invalid message.
