# Plan A — triage verification + fixes (2026-06-15)

Every finding from the inherited triage was re-checked against the **live Windows
checkout** (the prior audit's line numbers were drifted/wrong throughout — symbols
were grepped to locate the real code). Verdict + real location + fix status below.

**Headline:** of the 6 "ship-blockers", **2 were not real** (#4 phantom, #3 mis-scoped
— the claimed consequence cannot occur). One real gap the audit **missed** was found
in the same file as #5 (`chart_save_gated`). 12 of 15 were real and are fixed; tests
`60/0` on touched modules, `tsc --noEmit` clean, `eslint` clean.

> Every line number the triage gave was off (it was generated against a different
> checkout). The "File" column below is the REAL path/symbol.

## Ship-blockers

| # | Audit said | Real location | Verdict | Fix |
|---|---|---|---|---|
| 1 | `use-chat-stream.ts:51` no `res.ok` guard → error bodies render as chat text | `lib/chat/use-chat-stream.ts` → `useChatStream.send()` | **REAL** (symptom mis-stated: a non-2xx didn't throw, so the catch never fired → **silent empty assistant bubble**, not "error text rendered") | ✅ added `if (!res.ok) throw` → friendly catch |
| 2 | `use-chat-stream.ts:62` typed frames (place/data/error) discarded | same `send()` loop | **PARTLY REAL** — `error` frames were dropped → **silent failure** on a server-side stream error (hits ConversationalChat + the pill). `place`/`data` are by-design handled by the dedicated `useWelcomeStream` (hero cards), not this text hook | ✅ `error` frame now surfaced; added optional `onFrame` passthrough so any consumer CAN read typed frames |
| 3 | `HighlighterLayer.tsx:33` `#briefcase-tray` dead in `SUPPRESS_CLOSEST` → popup fires inside open pill | actually `lib/highlighter/use-highlight.ts:32-33` | **MIS-SCOPED / NON-OCCURRING** — wrong file. `#briefcase-tray` IS dead config (tray retired in A-3) but the consequence can't happen: on `/r/*` the pill opens `AskAiDock` which still carries `id="ask-ai-dock"` (suppressed ✓); the standalone panel never renders on `/r/*` (bridged mode). | ⏭️ **no code change** — harmless dead selector; left the battle-tested highlighter untouched to avoid churn. Remove the dead `#briefcase-tray` token anytime as pure cosmetics. |
| 4 | `route.test.ts:45` missing `fetchRawClaimItems` mock crashes the suite | `app/api/claim/route.test.ts:48-50` | **PHANTOM** — the mock IS present (`fetchRawClaimItems: () => fetchRawImpl()`, with default + `beforeEach` reset). Suite runs **10 pass / 0 fail**. Line 45 is the unrelated service-role mock. | ⏭️ nothing to fix |
| 5 | `meter/route.ts:4` `claim_failed` not in `ALLOWED` → failure observability dark | `app/api/meter/route.ts` `ALLOWED` set | **REAL** — `app/claim/_components/ClaimOnLogin.tsx:12` POSTs `claim_failed`; the allowlist 400-rejects it → never recorded. **BONUS (audit missed):** `chart_save_gated` (`HighlightPopup.tsx`, `AskAiDock.tsx`) is the same dead path. | ✅ added BOTH `claim_failed` + `chart_save_gated` to `ALLOWED` |
| 6 | `project-tools.ts:459` eager chart insert + early return → orphaned `saved_charts` | `app/api/mcp/project-tools.ts` `swfl_project_handoff` handler | **REAL** — a `chart_block` inserts a `saved_charts` row eagerly; a later item's failure (or the schema/size guards after the loop) returns early, orphaning the inserted rows (no token minted → never referenced). | ✅ track inserted chart ids, delete them on every early-return error path before mint |

## Fix soon

| # | Real location | Verdict | Fix |
|---|---|---|---|
| 7 | `lib/auth/use-session.ts` `clearSessionCache` (zero callers) | **PHANTOM (current arch)** — login is a **hard navigation** by design (`app/login/login-form.tsx:71` `window.location.assign(next)`; magic-link goes through `/auth/callback` server redirect). A full reload wipes the module memo → `useSession` re-fetches. There is **no SPA login path** for the stale cache to survive. `clearSessionCache` is just unused defensive code. | ⏭️ no change (left the export; calling it right before a hard reload is a no-op) |
| 8 | `app/api/projects/route.ts` + `app/api/projects/import/route.ts` | **REAL** — `recordUse(...,"project_create")` was called WITHOUT the `user.id` 3rd arg (the user is proven; `claim/route.ts` does pass it). `project_create` is a funnel/trial event → A-8.5's own gap. | ✅ pass `user.id` in both routes |
| 9 | `lib/chat/use-chat-stream.ts` no `AbortController` | **REAL (minor)** — stream/reader outlived an unmounted component. | ✅ `AbortController` aborted in an unmount effect; `AbortError` swallowed |
| 10 | `app/c/[id]/AddToProject.tsx` writes `localStorage` directly | **REAL** — bypassed `BriefcaseProvider.fileItem`; a direct write doesn't notify React → **stale pill badge same-tab**. | ✅ files through `useBriefcase().fileItem` (write-through persists to the same `DRAFT_KEY`) |
| 11 | `components/briefcase/BriefcasePanel.tsx:67` `bumpVisits` on every remount | **REAL** — the panel unmounts on pill close + remounts on open (`AiBriefcasePill` conditional render), so every pill toggle inflated "visits" → premature `hard` CTA / leaner prompts. | ✅ new `bumpVisitsOnce` (module guard) → one bump per **page load**; toggles only read. Unit test added. |
| 12 | `lib/claim/claim-store.ts:77` peek error discarded | **REAL (minor)** — the classification peek ignored its `error`; a transient DB error read as terminal `missing` (tells the user a valid link is gone) instead of a retryable 500. | ✅ capture + throw the peek error (mirrors the rpc handling above it) |

## Low-priority / polish

| # | Real location | Verdict | Fix |
|---|---|---|---|
| 13 | `lib/deliverable/examples.ts` `harvestMetricItems` positional ids `${brainId}-m${i}` | **REAL but ~zero impact** — examples are rebuilt **wholesale** and items live self-contained inside `items_snapshot`; nothing external references `…-m3`. Changing to a label-slug id would risk collisions (duplicate labels) — a net regression. | ⏭️ left as-is by design (documented) |
| 14 | `app/api/claim/route.ts` sequential `attachProjectId` + `recordUse` | **REAL (trivial perf)** — both best-effort, post-insert, independent, each swallows its own errors. | ✅ `Promise.all` |
| 15 | `scripts/build-example-deliverables.mts` sequential for-await LLM loop | **REAL (low)** — 4 independent LLM builds run serially on the cron. | ✅ `Promise.allSettled` (keeps per-item isolation + non-zero exit on any failure) |

## Verification run

- `bun test` on all touched modules → **60 pass / 0 fail** (incl. `app/api/claim/route.test.ts` 10/0, proving #4 is a phantom).
- `bunx tsc --noEmit -p tsconfig.json` → no errors in touched files.
- `bunx eslint <touched files>` → exit 0.
- NOT pushed — touches the MCP surface (`project-tools.ts`), so it waits on operator diff review (RULE 1 / no-autonomous-push).
