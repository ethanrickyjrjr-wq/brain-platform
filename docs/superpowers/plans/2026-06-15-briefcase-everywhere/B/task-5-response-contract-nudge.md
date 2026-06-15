# B-5 — RESPONSE_CONTRACT handoff nudge — **SONNET**

## Goal
Make the user's Claude *aware* that `swfl_project_handoff` exists and *when* to offer it — so carry-back
is discoverable in-conversation, honestly and without pressure.

## Files
- `app/api/mcp/server.ts` — the `RESPONSE_CONTRACT` constant (~lines 99–116). **Text only.**

## Change
Add one short line/section to the contract along the lines of:

> When the user wants to **save, share, or build a polished deliverable** from what they've seen, call
> `swfl_project_handoff` and give them the returned link to continue on the web (they'll sign in to
> claim it). Offer it once, when it's genuinely useful — never as a hard sell.

Match the existing contract's plain, no-jargon voice. No urgency/scarcity language.

## Hard invariants (the operator's explicit guardrail)
- **No gate, limit, or enforcement logic anywhere in the `swfl_fetch` path.** This task edits the
  contract *string* only. `swfl_fetch`'s code path stays byte-for-byte unchanged.
- This is a discoverability nudge, not metering. Limits (if ever) get added later via the contract
  hook + the meter — not here, and not in the fetch tool.

## Acceptance test
- The rendered RESPONSE_CONTRACT (prepended to `swfl_fetch` responses) contains the handoff hook.
- A `git diff` shows only the contract-string change — no logic added to `swfl_fetch` or its helpers.
- The added copy is honest (no "act now", no false scarcity) and uses no internal ids/jargon.
