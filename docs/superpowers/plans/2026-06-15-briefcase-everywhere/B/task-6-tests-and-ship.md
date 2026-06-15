# B-6 — tests, green build, ledgers, ship — **SONNET**

## Goal
Prove B works end-to-end, update the durable trackers, and land it — with operator approval at the
push gate.

## Tests (write alongside the code in B-1..B-5)
- **`claim-store`** — consume returns `won` once, then `consumed`; `expired` for a past `expires_at`;
  **concurrency** (two parallel consumes → one `won`, one `consumed`); `deterministicProjectId`
  stable + 12 chars; `peekClaimToken` non-consuming.
- **`swfl_project_handoff`** — keyless call returns a `/claim?t=` URL; items come back stamped
  `origin:"mcp"`; >50 items or >256 KB rejected with no row; beacon row written.
- **`/api/claim`** — 401 logged-out; `won` inserts under `auth.uid` at the deterministic id;
  **two simultaneous claims → one row, both responses same `id`, no null, no dup**; sequential replay
  → idempotent `{id}`; expired → 410.
- **flow** — logged-out `/claim` preview (no consume) → OTP login `next=/claim?t=…` → auto-claim →
  `/project/{id}`.
- **No HMAC tamper test needed** (token is opaque-random, not signed). *If* any HMAC is ever added,
  corrupt **decoded bytes**, never the trailing base64url char (the ~6.5%/push flake class).

## Green gates (run before pushing)
- `bun test` (new/changed files) green; `tsc`; `eslint` clean; `bun run build` → `○ /claim` present.
- **Pre-push gate awareness:** this touches the **MCP surface** (a new tool) + adds a migration +
  app routes. Per CLAUDE.md RULE 1, an MCP-surface change is a **"ask for a diff review before
  pushing"** item — so B-6 ends by showing the diff and **waiting for operator approval**.
- No `refinery/packs/**` changes → Gate 5 N/A. The `claim_tokens` migration is a destructive-free
  `CREATE TABLE IF NOT EXISTS` → no Gate-4 concern.

## Migration
Run `docs/sql/20260615_claim_tokens.sql` directly (psycopg3, creds `.dlt/secrets.toml`, idempotent);
verify the table + RLS + index; confirm anon/auth SELECT is denied.

## Ledgers (same push)
- `SESSION_LOG.md` — new top-of-file entry (what shipped, file paths, what's next).
- `_AUDIT_AND_ROADMAP/build-queue.md` — mark the Carry-Back Bridge item `[~]`→`[x]`.
- `scripts/check.mjs` — open `carry_back_bridge_live_verify` (prod evidence: a real anonymous handoff
  → claim → `/project/{id}` lands, verified live after deploy — not dev attestation). Close on the
  live signal.

## Push
- Stage **only** B's files (explicit paths; never `git add -A` — RULE 1.5).
- `node scripts/safe-push.mjs` **after** the operator approves the diff (no autonomous push —
  memory `feedback_no-autonomous-push`).

## Acceptance test
- All gates green; live verification passes (handoff → claim → editor under a real account; return via
  OTP same email); ledgers reconciled; push approved + landed on `main`.
