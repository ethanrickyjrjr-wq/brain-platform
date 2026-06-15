# B-1 — `claim_tokens` table + `claim-store.ts` — **OPUS**

## Goal
Create the short-TTL, single-use carry-back token store and the only module allowed to touch it.

## Files
- **NEW** `docs/sql/20260615_claim_tokens.sql` — the table + RLS.
- **NEW** `lib/claim/claim-store.ts` — `mintClaimToken`, `consumeClaimToken`, `attachProjectId`,
  `deterministicProjectId`.

## Migration (`docs/sql/20260615_claim_tokens.sql`)
Idempotent (`IF NOT EXISTS` everywhere — run it directly, never hand to the operator; creds in
`.dlt/secrets.toml`).

```sql
CREATE TABLE IF NOT EXISTS public.claim_tokens (
  token       text PRIMARY KEY,             -- high-entropy, opaque, URL-safe (base64url)
  items       jsonb NOT NULL,               -- the ProjectItem[] to carry
  title       text,
  project_id  text,                         -- written AFTER the winner's insert (observability/cleanup only)
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,         -- created_at + ~15 min
  consumed_at timestamptz                   -- set by the UPDATE-guarded consume
);
CREATE INDEX IF NOT EXISTS claim_tokens_expires_at_idx ON public.claim_tokens (expires_at);

ALTER TABLE public.claim_tokens ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated SELECT/INSERT/UPDATE policy => RLS default-denies all client (PostgREST) access.
-- service_role bypasses RLS; that is the ONLY accessor (via claim-store.ts).
GRANT ALL ON public.claim_tokens TO service_role;
REVOKE ALL ON public.claim_tokens FROM anon, authenticated;
```

## `lib/claim/claim-store.ts` (service-role only — `createServiceRoleClient()`)
- `mintClaimToken(items, title?) -> token`
  - token = `crypto.randomBytes(24).toString("base64url")` (URL-safe; survives two redirect hops).
  - `expires_at = now + 15 min`. INSERT row. Return token.
- `consumeClaimToken(token) -> ConsumeResult` (discriminated union, ONE round-trip + at most one peek):
  - Primary: **atomic** `UPDATE public.claim_tokens SET consumed_at = now() WHERE token = $1 AND
    consumed_at IS NULL AND expires_at > now() RETURNING items, title` → if a row returns →
    `{status:"won", items, title}`.
  - If no row: peek (service-role SELECT) to classify → `{status:"consumed"}` (consumed_at set) /
    `{status:"expired"}` (expires_at passed) / `{status:"missing"}`.
  - **This is the UPDATE-guarded consume — NOT `idempotency.ts:claimOnce` (INSERT-ON-CONFLICT). Name
    it accordingly in code + comments.**
- `peekClaimToken(token) -> { title, itemCount, kinds[], expired } | null` — **read-only,
  non-consuming** service-role SELECT used by the `/claim` preview (B-3b) to render what will be
  carried, before login. Returns only a summary (never the raw items to a client). Does NOT touch
  `consumed_at`.
- `attachProjectId(token, id)` — `UPDATE ... SET project_id = $2 WHERE token = $1`. Best-effort,
  winner-side observability/cleanup only. **Never the loser's navigation source.**
- `deterministicProjectId(token)` — `crypto.createHash("sha256").update(token).digest("hex").slice(0,12)`.
  Exported so the route computes the SAME id for winner and loser. (12 hex chars, matches
  `import/route.ts`'s `randomUUID().slice(0,12)` shape; unguessable because `token` is high-entropy.)

## Security invariants
- `claim_tokens` is service-role-only; client (anon/auth) PostgREST access is RLS-denied — verify.
- The consume is a single atomic statement (row-locked, no TOCTOU); exactly one concurrent caller
  can win.

## Acceptance test
- Apply migration; `\d claim_tokens` shows the columns + index; RLS enabled.
- As anon and as an authenticated user (PostgREST), `SELECT * FROM claim_tokens` returns **0 rows /
  denied**; service-role SELECT works.
- Unit: mint → consume returns `won` once; a second consume returns `consumed`; an expired token (set
  `expires_at` in the past) returns `expired`.
- Concurrency: fire two `consumeClaimToken` in parallel on one token → exactly one `won`, one
  `consumed`.
- `deterministicProjectId(token)` is stable across calls and 12 chars.
