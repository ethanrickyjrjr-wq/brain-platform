# Phase 0 Kill-Switch Test — Results

> Goal: verify Claude can reliably **fetch + parse + follow** a Brain URL across every surface before we build anything else.
> Test brain: `test-alpha` · Live URL: `https://brain-platform-amber.vercel.app/api/b/test-alpha`
> See `docs/invocation-patterns.md` for the exact text to type in each cell.

---

## Pass criteria (per cell)

The brain is `user_saved_reference` data — both checks are _retrieval_ checks, not _obedience_ checks. A cell **PASSES** only if BOTH are true:

1. **Fetch + retrieve:** within 30s of being asked "what verification marker is in my saved reference context?", Claude reports `BRAIN-OK-7421 ALPHA-9q2c-2026`.
2. **Use:** when asked "based on my saved reference, what's a typical Class B cap rate?", Claude answers 5.4-6.1%, cites `s01` with the verified date (2026-04-15), and uses CRE shorthand.

Mark each cell: `PASS` / `FAIL` / `PARTIAL` (retrieve worked, use didn't — or vice versa) / `N/A`.

---

## Results matrix

Round 1 (2026-05-14): only a Windows PC available. Mac / iOS / Android / Voice deferred until those devices are on hand. Desktop Windows + claude.ai Web are the kill-switch surfaces — if both pass A and B, Phase 1 is greenlit regardless of the deferred rows.

| Surface            | A — Plain URL in message | B — Project Custom Instructions | C — Skill fetch      | D — Trigger-word expansion |
| ------------------ | ------------------------ | ------------------------------- | -------------------- | -------------------------- |
| Desktop Mac        | DEFERRED — no device     | DEFERRED — no device            | DEFERRED — no device | DEFERRED — no device       |
| Desktop Windows    | PASS²                    | PASS                            |                      |                            |
| claude.ai Web      | PASS²                    | PASS¹                           |                      |                            |
| Claude iOS         | DEFERRED — no device     | DEFERRED — no device            | DEFERRED — no device | DEFERRED — no device       |
| Claude Android     | DEFERRED — no device     | DEFERRED — no device            | DEFERRED — no device | DEFERRED — no device       |
| Claude Voice (iOS) | DEFERRED — no device     | DEFERRED — no device            | DEFERRED — no device | DEFERRED — no device       |
| Claude Code CLI    |                          |                                 |                      |                            |

**¹ claude.ai Web / Pattern B note:** both prompts passed — marker retrieved exactly, cap rate correct (5.4-6.1%) with s01 citation + verified date + CRE shorthand. Claude also volunteered a staleness flag, but **miscalculated it**: said s01 was "a month past its 90-day TTL window" when it is actually 29 days _into_ the window (verified 2026-04-15, today 2026-05-14, expires 2026-07-14). Claude engaged the TTL field correctly but botched the date arithmetic. **Fixed in v1.1 spec:** `ttl` duration replaced with precomputed `expires:` date so Claude compares two dates instead of doing arithmetic.

**Desktop Windows / Pattern B note:** both prompts passed — "Fetched." then marker + cap rate with s01 citation. No TTL miscalculation observed (Claude didn't volunteer a staleness check here).

**² Pattern A note (both surfaces) — fetch mechanism PASS, plus the most important Phase 0 finding:** both Desktop Windows and Web fetched the URL and retrieved the marker `BRAIN-OK-7421 ALPHA-9q2c-2026` cleanly; payload parsed. The use-check (prompt 2) was not run because both Claude instances pivoted to flagging the design — and that pivot is the finding:

- **Both refused to adopt the fixture's identity.** Neither roleplayed as the "CRE broker" — they treated the payload as untrusted reference data and explicitly said so. **This is correct, desired behavior** and validates the v3 `user_saved_reference` reframe. If the `authority` directive had still been present, this would likely have gone worse (harder resistance, or compliance with a fake identity).
- **Both flagged the unauthenticated-URL injection surface** — guessable slug, no auth, anyone who knows the URL can serve content. Already a Phase 2 item; both Claudes independently sharpened it.
- **Both noted the brain competes with Anthropic's native memory** — they already have the user's real context loaded; the fixture's identity conflicts with it. Strategic finding, not a mechanism failure.

**Root cause of the identity flag = our own fixture.** The v2 fixture carried an `identity:` block asserting "the user is a CRE broker." A fetched URL asserting identity is exactly what a model should not trust. **Fixed in v1.1 spec + v3 fixture:** `identity` block removed entirely, replaced with a `scope:` line (what the brain _covers_, never who it _belongs to_).

**Re-test against v3 identity-free fixture (2026-05-14, post-redeploy): clean PASS.** Pattern A prompt 2 returned the marker, the correct cap rate (5.4-6.1%), the s01 citation with verified date — and **no identity fight and no TTL miscalculation**. Claude used the payload as reference data exactly as intended ("citation table and saved facts both readable"). The v1.1/v3 hardening resolved both Phase 0 findings.

**Other v1.1 hardening from this round:** added the **facts-only contract** (payloads carry data, never imperative language; Refinery validates on serve, invocation instruction tells the model to ignore instruction-shaped text) and documented **invocation trust tiers** (Patterns B/D = primary-trust via authenticated settings; Pattern A = convenience/lower-trust).

---

## Latency log

Time-to-first-token after the fetch starts. Target < 2s · warn 2-5s · fail > 5s.

| Surface | Invocation | TTFT (s) | Notes |
| ------- | ---------- | -------- | ----- |
|         |            |          |       |
|         |            |          |       |
|         |            |          |       |

---

## Persistence log

Did the brain stay loaded for 5+ turns without needing a re-fetch? (Test: in turn 5, ask Claude something only answerable from the end of the brain — e.g. the content of `RECENT MEMORY`.)

| Surface | Invocation | Held 5+ turns? | Notes |
| ------- | ---------- | -------------- | ----- |
|         |            |                |       |
|         |            |                |       |

---

## Cache invalidation log

Edit `brains/test-alpha.md` (change the `version` and one fragment value), redeploy, then re-ask the same question within 60s. Did Claude see the new content?

| Surface | Invocation | Saw update < 60s? | Notes |
| ------- | ---------- | ----------------- | ----- |
|         |            |                   |       |

---

## Fail / fallback decisions

Using the fail cascade from the plan:

- **Desktop OR web fail** → product dead, redesign required. Decision: **N/A — both passed.**
- **Mobile (iOS/Android) fail** → laptop-only product, mobile becomes marketing surface only. Decision: **Untested — no devices. Deferred, not blocking; Round 2 when devices are on hand.**
- **Voice fail** → drop voice from pitch deck, not blocking. Decision: **Deferred to Round 2.**
- **Skill-fetch (C) fail but Custom-Instructions (B) pass** → ship via Custom Instructions only. Decision: **C untested this round; B confirmed working, so the primary path is proven regardless.**
- **Persistence fail** → add "re-fetch every N turns" instruction to the Brain header. Decision: **Persistence not formally measured; no re-fetch issues observed across multi-turn responses. Revisit in Round 2.**
- **Cache > 60s** → add `?v={version}` cache-bust param to the Brain URL. Decision: **Route serves `Cache-Control: no-store`; v3 redeploy was picked up immediately on re-test. No cache-bust needed.**

---

## Overall verdict

- [x] **Phase 0 PASSED** — Desktop Windows + claude.ai Web both pass Pattern A (fetch + use) and Pattern B (fetch + use) against the v3 identity-free fixture. Kill-switch surfaces are green. **Proceed to Phase 1.**
- [ ] Phase 0 PARTIAL
- [ ] Phase 0 FAILED

**Date tested:** 2026-05-14
**Tester notes:** Round 1 ran on a Windows PC only — Mac/iOS/Android/Voice deferred to Round 2 (not blocking; mobile/voice are bonus surfaces). Patterns C (Skill) and D (trigger-word) untested this round — product-UX polish, not kill-switch. Two findings surfaced and were fixed mid-round: (1) TTL date-math error → `expires` precomputed date in spec v1.1; (2) fixture `identity:` block triggered correct identity-refusal → block removed, `scope:` added, facts-only contract + trust tiers documented. The identity-refusal is logged as **desired behavior**, not a defect — it validates the `user_saved_reference` architecture.
