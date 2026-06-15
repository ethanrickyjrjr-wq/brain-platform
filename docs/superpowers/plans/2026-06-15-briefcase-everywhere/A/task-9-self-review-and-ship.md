# A-9 — Self-review, ledgers, ship — **SONNET**

## Goal
Verify A end-to-end, reconcile the durable trackers, and land it (operator-approved push).

## Green gates
- `bun test` green for all new/changed files; `tsc`; `eslint` clean; `bun run build` clean (affected
  routes stay static where expected).

## End-to-end verification (the integrated A flow)
1. Floating Briefcase button visible on `/`, `/charts`, `/r/<any>` while logged out.
2. Logged-out popup shows pitch + 4 example cards; each `/p/example-*` opens, renders cited content,
   and quotes a **current** freshness token matching live `/r/*`; both exits work (`LoginModal`;
   `MCPInstall` shows `claude mcp add ...`).
3. File an item logged-out → persists across nav → "Sign in to build" → OTP login → draft imported to
   a `projects` row → Build produces `/p/<id>`.
4. Revisit count changes the prompt set + CTA intensity.
5. Meter uid-attribution: a logged-in web build/send writes `usage_events.user_id = auth.uid`; an MCP
   build still writes `mcp:<uid>`; a logged-out action stays `sdg_cid`.
6. Refactor safety: `/r/*` file/remove/dock-file-chart behave exactly as before — exercise
   `AskAiDock` "file this chart" (the missed consumer) specifically.

## Ledgers (same push)
- `SESSION_LOG.md` top-of-file entry.
- `_AUDIT_AND_ROADMAP/build-queue.md` marked `[x]`/`[~]`.
- `scripts/check.mjs` — open `briefcase_examples_live_verify` (prod evidence: live `/p/example-*`
  tokens match live `/r/*`); close `meter_uid_attribution` on live row evidence.

## Push
Stage only A's files (explicit paths; never `git add -A`); `node scripts/safe-push.mjs` **after**
operator diff-review approval (no autonomous push).
