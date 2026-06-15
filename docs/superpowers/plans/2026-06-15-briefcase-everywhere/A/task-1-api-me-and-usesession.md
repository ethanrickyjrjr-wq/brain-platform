# A-1 — `/api/me` + `useSession` — **SONNET**

## Goal
A client-readable auth signal so the global Briefcase/popup can branch on logged-in vs out **without
making the layout dynamic**.

## Files (net-new — verified absent)
- **NEW** `app/api/me/route.ts` — GET, `createClient(await cookies())` → `auth.getUser()` → return a
  minimal `{ authed: boolean, userId?: string }` (no PII). `createClient(await cookies())` is the
  confirmed correct server-client pattern.
- **NEW** `lib/auth/use-session.ts` (or `hooks/`) — `useSession()` client hook that fetches `/api/me`
  and caches it.

## Notes
- Confirmed net-new; the layout stays static (the auth read is client-side via `/api/me`, not a
  server component that would force dynamic rendering).

## Acceptance test
- Logged-out → `/api/me` returns `{ authed: false }`; logged-in → `{ authed: true, userId }`.
- `useSession()` exposes the state to client components; no layout became dynamic (`bun run build`
  still shows the affected routes static where they were).
