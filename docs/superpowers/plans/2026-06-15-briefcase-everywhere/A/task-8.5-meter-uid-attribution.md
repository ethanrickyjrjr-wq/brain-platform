# A-8.5 — Meter uid-attribution — **OPUS**

## Goal
Attribute web build/deliver events to the **real `auth.uid`** so every future paywall, the 30-day
trial window, and MCP-connected detection have a substrate. This is the one prerequisite that unblocks
the whole ladder. (OPUS: touches the metering spine + a migration.)

## Why OPUS
It edits the shared metering path + adds a migration; the value (trial gate, send cap, discount
detection) all rides on getting the identity exactly right. It is also the **shared identity lock**
with Plan B.

## Change
- **Migration:** add `user_id uuid` to `usage_events` (`usage_events.client_id` is `text` and already
  carries `mcp:<uid>` / `sdg_cid` / `anon`; add a typed `user_id` for the auth uid). Idempotent
  (`ADD COLUMN IF NOT EXISTS`).
- On web **build / deliver_share / deliver_email**, write the real `auth.uid` to `user_id` when a
  session exists (the MCP path already writes `mcp:<uid>` to `client_id` — keep that). A logged-out
  action stays `sdg_cid`.
- Closes the `meter_uid_attribution` check (`docs/paywall-moat-gates.md:60-63`).

## Shared identity lock
ONE identity: `auth.uid` (== `mcp:<uid>` == `projects.user_id`). Do not invent a parallel scheme. B's
`isMcpConnected` (B-4) and any discount logic read off this.

## Acceptance test
- A logged-in web **build/send** writes `usage_events.user_id = auth.uid` (query the row).
- An MCP build still writes `client_id = mcp:<uid>`.
- A logged-out action stays `sdg_cid` (no `user_id`).
- `meter_uid_attribution` check closes on the live row evidence (prod, not dev attestation).
