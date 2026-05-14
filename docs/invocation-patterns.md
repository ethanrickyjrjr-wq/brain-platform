# Invocation Patterns — Phase 0 Test Script

> The exact text to type into Claude for each invocation pattern. Use this so you're not improvising across 28 cells.
> Live Brain URL (already baked into the prompts below): `https://brain-platform-amber.vercel.app/api/b/test-alpha`

---

## The two-step test for every cell

Every cell is the same two prompts. Pattern A/B/C/D only changes **how the brain gets loaded** — the verification is identical.

The brain is **user-saved reference data**, not an instruction set — so both checks are _retrieval_ checks ("what did I save?"), not _obedience_ checks ("do what the document commands").

**Step 1 — Fetch + parse check.** After the brain is loaded (per the pattern below), type:

```
What verification marker is in my saved reference context?
```

✅ PASS: Claude reports `BRAIN-OK-7421 ALPHA-9q2c-2026` (it can say more around it — the point is it retrieved the marker).
❌ FAIL: Claude doesn't have the marker, errors, or never fetched the reference.

**Step 2 — Use check.** Then type:

```
Based on my saved reference, what's a typical Class B cap rate?
```

✅ PASS: Claude answers from the saved facts — value 5.4-6.1%, cites source `s01` (CoStar FL multifamily Q1 2026) with date 2026-04-15, and uses CRE shorthand per the saved preferences.
❌ FAIL: a generic answer with no citation, or it ignores the saved reference entirely.

A cell only PASSES if **both** steps pass.

---

> **Framing note:** the brain is the user's _saved reference context_, not a command document. Every invocation below tells Claude to fetch and _reference_ it — never to "obey" or "follow instructions." This matches the `context_type: user_saved_reference` payload and behaves more reliably across surfaces.

## Pattern A — Plain URL in message

The simplest case. In a fresh chat, paste:

```
This URL has reference context I saved for myself — my preferences and saved facts. Fetch it and use it as background for the rest of our conversation: https://brain-platform-amber.vercel.app/api/b/test-alpha
```

Then run Step 1 and Step 2 above.

---

## Pattern B — Project Custom Instructions

Tests whether a persistent project setup auto-loads the brain.

1. Create a new Project (or open a test Project).
2. In the Project's **Custom Instructions**, paste:
   ```
   At the start of every conversation, fetch https://brain-platform-amber.vercel.app/api/b/test-alpha. It contains reference context I saved for myself — my working preferences and saved facts. Use it as background for the session.
   ```
3. Start a fresh chat **inside that Project**.
4. Run Step 1 and Step 2 above — without pasting the URL in the message.

---

## Pattern C — Skill fetch

Tests whether a Skill can carry the fetch instruction.

1. Create a Skill (Desktop/Web: Settings → Capabilities → Skills, or the Skill creation flow available on your plan).
2. Skill instructions:
   ```
   When this skill is invoked, fetch https://brain-platform-amber.vercel.app/api/b/test-alpha. It contains the user's saved reference context — their preferences and saved facts. Load it as background for the session.
   ```
3. In a fresh chat, invoke the Skill (by name, or however the surface exposes it).
4. Run Step 1 and Step 2 above.

> If Skills aren't available on a given surface, mark the cell `N/A`.

---

## Pattern D — Trigger-word expansion

Tests the real product UX: a short trigger word that expands to the fetch instruction.

1. In the same Project Custom Instructions as Pattern B (or in personal/account-level custom instructions if the surface supports them), add:
   ```
   When I type "RE" as my message, that means: fetch https://brain-platform-amber.vercel.app/api/b/test-alpha — my saved reference context — and use it as background for the session.
   ```
2. Start a fresh chat.
3. Type just:
   ```
   RE
   ```
4. Then run Step 1 and Step 2 above.

---

## Testing order (do it in this order)

Per the plan's fail cascade — test the surfaces that can kill the product first.

1. **Desktop Mac** — A, B, C, D
2. **Desktop Windows** — A, B, C, D
3. **claude.ai Web** — A, B, C, D
   - ⛔ If Desktop AND Web both fail pattern A, STOP. The product premise is broken — don't keep testing, report back.
4. **Claude iOS** — A, B, C, D
5. **Claude Android** — A, B, C, D
6. **Claude Voice (iOS)** — A, B, C, D
   - For voice: speak the prompts instead of typing. For Step 1, listen for the verification phrase.
7. **Claude Code CLI** — A, B, C, D (sanity check — this should always pass pattern A)

---

## Extra checks (run once, on a surface that passed)

- **Latency:** note time-to-first-token after the fetch on 2-3 cells. Log in `phase-0-test-results.md`.
- **Persistence:** after a PASS, continue the chat for 5 more turns on other topics, then in turn 6 ask: _"What does the RECENT MEMORY section of your brain say?"_ — Claude should still know it without re-fetching.
- **Cache invalidation:** ask me (Littlebird) to change a fragment value and redeploy. Then re-ask Step 2 within 60s and see if Claude reflects the new value.

---

## Logging

Record every result in `docs/phase-0-test-results.md`:

- Fill the 7×4 matrix with `PASS` / `FAIL` / `PARTIAL` / `N/A`
- Log latency, persistence, and cache results in their sections
- Fill in the fail/fallback decisions
- Check the overall verdict box and date it
