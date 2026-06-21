# ONE ASSISTANT — RECONCILED SCOPE (audited, code-verified)

**Date:** 2026-06-21 · **Status:** 🟢 GO-WITH-CHANGES · **Verdict owner:** chief-architect audit (12-agent, adversarial)
**Verified against:** `main` HEAD `920496ac` + harvest commit `49e64e3` (`origin/claude/404-errors-investigation-oeu3yf`).
**Design source:** `origin/claude/page-behavior-inconsistency-78ub79:docs/superpowers/specs/2026-06-21-one-assistant-unification-design.md`.

> **This doc is the single source of truth for the unification.** It supersedes the loose framing in the design
> spec (esp. its §6.5 "throw → degrade, one line", which the audit proved false) and consolidates the scattered
> AI-surface specs (`2026-06-20-ai-surface-audit-and-handoff`, `2026-06-20-p1-ai-surface-fixes-design`,
> `2026-06-21-data-readiness-web-search-design`). Where a spec disagreed with code, **code won** and it is flagged.
> Operator naming is locked: **PROJECT AI** + **OUTSIDE AI**; the public funnel is a degenerate state of OUTSIDE AI.

---

## 1. VERDICT — GO-WITH-CHANGES

The architecture is right and the cause is real. There is **no single root for the answer path** — two live engines
(`app/api/converse/route.ts` + `app/api/welcome/chat/route.ts`) with **opposite failure semantics** (one throws a
user-facing 404 at `converse/route.ts:138`, one degrades at `welcome/chat/route.ts:206`), forked by one button at
`AiBriefcasePill.tsx:36`. That is exactly why "the AI got fixed 5 times and is still broken": each fix landed in
whichever engine that session happened to open. Collapsing to one `/api/ai` engine + one client + a frozen contract
is the correct, **RULE-3-C2-compliant** fix — it *extends* the existing `lib/grounded-answer.ts` seam and erects no
new materialization gate. The "simpler root exists" steelman was **refuted**; in-flight collisions were **refuted**.

**Three corrections the design spec hides — write them into the build or it ships broken:**

1. **The no-404 fix is NOT "one line."** There are **three throw paths** in the harvested resolver —
   invalid-ZIP (`49e64e3:report-grounding.ts:60`), exhaustiveness (`:118`), and the real one: every `fetchBrain`
   inside `brainBlock` (`:38`, reached by all five kinds) throws `BrainNotFoundError` when an underlying brain `.md`
   is missing. As-built, the harvest **narrows** the 404 (synthetic ids resolve) but does **not eliminate** it. Ship
   it literally and invariant #11 (no user-facing 404) is silently unmet.
2. **CI reddens on merge unless a test is inverted atomically.** `converse/route.test.ts:116-126` *asserts*
   `toBe(404)`. The degrade and that inversion must land in the **same commit** (invariant #10 atomic type-lift).
3. **Two capabilities are homeless, not "preserved."** Charts-in-panel and the web-fallback rung (#12) **do not
   exist** today (`BriefcaseChat.tsx:62` has no chart import; zero grep hits for `[WEB`/`not our verified data`).
   They are **net-new builds**, and folding `AskAiDock` before lifting `DockChart` would *regress* `/r/*` charts.

---

## 2. THE ROOT — one engine, one resolver, fix-in-one-place

Two load-bearing files:

- **`lib/ai/grounding-resolver.ts`** (NEW — absorbs harvested `report-grounding.ts` + `report-surface.ts`, extends
  `lib/grounded-answer.ts`). The heart: maps inputs → grounding and is **forbidden to throw**.
- **`app/api/ai/route.ts`** (NEW — the single engine; `converse` + `welcome/chat` become thin forwarding aliases
  for one release, then delete).

```
                     ┌─────────────────────────────────────────────┐
                     │  app/api/ai/route.ts        (ONE engine)     │
                     │  + lib/ai/grounding-resolver.ts (THE HEART)  │
                     │  + lib/ai/contract.ts       (frozen shape)   │
                     │  + lib/ai/use-assistant.ts  (ONE client)     │
                     │                                              │
                     │  AT THE ROOT (shared by all forks):          │
                     │   • grounding ladder, DEGRADE-NEVER-THROW    │
                     │       brain→zip→corridor→method→source       │
                     │       → master region read → "be Claude"     │
                     │   • RULES_OF_ENGAGEMENT / no-invention floor │
                     │   • freshness_token quote                    │
                     │   • weekly cap + per-IP burst                │
                     │   • WEB rung (#12)  [shared web-grounding]   │
                     │   • charts (buildChartForIntent)             │
                     └───────────────┬──────────────────────────────┘
            context discriminator: "project" | "outside" | (public)
       ┌──────────────────┼──────────────────────┬───────────────────┐
       ▼                  ▼                       ▼
  PROJECT AI          OUTSIDE AI            public funnel
  context=project     context=outside       (degenerate STATE of OUTSIDE AI)
   • TIER-A digest     • whole-site          • WELCOME_SYSTEM cold-lead pitch
   • isolation guard     analyst voice       • email hook
   • TIER-B (cap 8)    • file/summarize      • NO project ctx / NO auth
   • per-proj threads  • highlighter /r/*    • route tests BYTE-FOR-BYTE
   • OFFERS → authed
       │ offers only; never mutates
       ▼
  AUTHED MUTATION SURFACE (separate, NOT root)
  app/api/projects/[id]/action  ·  /api/deliverables/[id]/{build,refresh,edit}
  cookie/RLS auth · PROPOSE→CONFIRM · nonce
```

**At the root** (write once): grounding ladder + degrade-never-throw, no-invention contract, freshness token, caps,
WEB rung, charts. **At the forks**: system prompt, project wiring, auth posture, UI mount. **Off the root entirely**:
mutations — assistant only *offers*; authed routes execute (G1's correct resolution).

---

## 3. CAPABILITY MATRIX

`execution` = **engine** (the `/api/ai` answer path) vs **authed route** (`/api/projects/*` or `/api/deliverables/*`).

| Capability | PROJECT AI | OUTSIDE AI | public | Where it executes |
|---|:--:|:--:|:--:|---|
| Grounded answer (no funnel pitch) | ✅ | ✅ | — | engine |
| No-location → master region read | ✅ | ✅ | — | engine |
| ZIP/place → grounded ZIP read | ✅ | ✅ | ✅ | engine |
| Quote `freshness_token` verbatim | ✅ | ✅ | ✅ | engine |
| **Degrade-never-throw (no user 404)** ⚠ | ✅ | ✅ | ✅ | engine — **NET-NEW (3 throw sites)** |
| Report-dossier grounding (`/r/*`) | ✅ | ✅ | — | engine (harvested resolver) |
| Highlighter | on /r/* | on /r/* | — | engine, behind `highlighterUiEnabled()` |
| **Charts in panel** ⚠ | ✅ | ✅ | — | engine — **NET-NEW (lift DockChart first)** |
| **WEB fallback rung (#12)** ⚠ | ✅ | ✅ | ✅ | engine — **NET-NEW, shared `lib/ai/web-grounding.ts`** |
| File this answer / chart | ✅ | ✅ | — | engine + briefcase (live on main) |
| Summarize → file | ✅ | ✅ | — | engine |
| Weekly cap + per-IP burst | ✅ | ✅ | ✅ | engine |
| TIER-A current-project digest | ✅ | — | — | engine (context=project) |
| Project-isolation guard | ✅ | — | — | engine (`page-context.ts:193`) |
| TIER-B cross-project (cap 8, frozen) | ✅ | — | — | engine (cookie-authed read) |
| Per-project threads | ✅ | — | — | engine (`useProjectThread`) |
| Dynamic 3+1 prompts | ✅ | — | — | engine (Piece-2 prompt-engine) |
| Cold-lead funnel premise + email hook | — | — | ✅ | engine (context=public / WELCOME_SYSTEM) |
| Branded arrival (URL params) | — | — | ✅ | static `app/welcome/page.tsx` (not engine) |
| **Offer** build/refresh/edit/schedule | ✅ | — | — | engine emits offer |
| **Execute** build/refresh/edit/trash | ✅ | — | — | **authed route** (`/api/deliverables/*`) |
| **Execute** schedule_send / build | ✅ | — | — | **authed route** (`/api/projects/[id]/action`) |
| Prospect→project claim bridge | — | — | ✅ | `/api/claim` (built); arrival takeover convo = DEFERRED |

⚠ = the three things the design spec mislabels as "preserve"; they are net-new. **Nothing is orphaned** by the
two-assistant model — every capability has exactly one home.

---

## 4. BUILT vs HARVEST vs TO-BUILD

| Already on `main` (preserve, do not rewrite) | Harvest from `49e64e3` | Net-new code |
|---|---|---|
| TIER-A digest + context bus (`lib/project/digest.ts`, `ai-context-store.ts`, `ProjectAiContextBridge.tsx`) | `lib/highlighter/report-surface.ts` — **take as-is** (pure, applies clean) | `app/api/ai/route.ts` (the one engine) |
| Isolation guard (`page-context.ts:193`) + test | `lib/highlighter/report-grounding.ts` — **take WITH CHANGE** (degrade 3 throw sites) | `lib/ai/contract.ts` (frozen request/response shape) |
| TIER-B 5-rule contract (`other-projects.ts:118`), cap 8, fail-open | `lib/grounded-answer.ts` surfaceNote diff — **take as-is** (additive) | `lib/ai/use-assistant.ts` (one client; merges `use-chat-stream`/`use-converse`/`converse.ts`/`sse.ts`) |
| Per-project threads (`useProjectThread`) | `report-surface.test.ts` — **take + EXTEND** (never-throws assertion) | `lib/ai/web-grounding.ts` (shared WEB rung; reused by email data-readiness — built once) |
| Prompt engine (`prompt-engine.ts`, 16 tests) | 4× `app/r/**/page.tsx` edits — **take as-is** | **Charts-in-panel**: lift `DockChart`/`buildChartForIntent` into the unified panel |
| File-this-answer (`BriefcaseChat.tsx:303` — live; BRF-5 stale) | converse route diff — **take PATTERN only**, drop the 404 return | **Invert** `converse/route.test.ts:116` (atomic, same commit) |
| `mode:analyst`/`summarize` + `ANALYST_SYSTEM` (`route.ts:96,455`) | — | `action/route.test.ts` (the live mutation surface has ZERO tests) |
| Public funnel (`WELCOME_SYSTEM`, branded arrival, claim+seed bridge — shipped) | — | Encode #12 web/tier rung in `refinery/lib/rules-of-engagement.mts` (durable, not a plan doc) |
| G1 authed action route (`action/route.ts`, PROPOSE→CONFIRM, nonce) | — | Thin forwarding aliases `converse`+`welcome/chat` → `/api/ai` (1 release) |
| `buildGroundedSystemPrompt` shared (MCP + reply-sensor import it) | — | Page×capability matrix test (Phase-4 prove-it harness) |

---

## 5. INVARIANTS & TESTS (the design spec's #1–#12)

| # | Invariant | Test status |
|---|---|---|
| 1 | Public funnel byte-for-byte | **EXISTS** — `welcome/chat/route.test.ts:90,98,181,209,228` (pass verbatim post-rename) |
| 2 | Project isolation (projectId===path) | **EXISTS (lib)** — `page-context.test.ts:116`. **NEEDS-TEST** at the unified route level |
| 3 | TIER-B advisory/frozen/cap-8/fail-open | **PARTIAL** — pure fn covered; **NEEDS-TEST** route glue `otherProjectsBlockFor` |
| 4 | No-invention / consumption contract | **EXISTS** — `grounded-answer.test.ts:37` + `welcome/chat/route.test.ts:181` |
| 5 | Charts wherever the assistant runs | **NEEDS-TEST** — none today; net-new (charts dock-only) |
| 6 | Highlighter mount, behind flag | **PARTIAL** — `highlighter/flag.test.ts` (flag only); **NEEDS-TEST** one-pill-per-page |
| 7 | Per-project threads | **NEEDS-TEST** — no `use-project-thread.test` found |
| 8 | Weekly cap + per-IP burst | **EXISTS** — `converse/route.test.ts:191`, `welcome/chat/route.test.ts:147`, `meter.test.ts:21` |
| 9 | MCP untouched; `buildGroundedSystemPrompt` stays shared | **PARTIAL** — core pinned; **NEEDS-TEST** MCP-route smoke for import drift |
| 10 | Atomic type-lift | **NEEDS-TEST** (process; `tsc` backstop) — enforce by inverting #11's test in the same commit |
| 11 | **No user-facing 404 — degrade never throw** | **INVERTED ON MAIN** — `converse/route.test.ts:116` asserts 404. Invert + ADD never-throws assertion |
| 12 | Tiered web fallback (`[WEB — not our verified data]`) | **NEEDS-TEST** — pure greenfield, zero code today |

---

## 6. COLLISIONS & SEQUENCING

- **Piece 1 (workspace shell):** NO collision. `app/project/layout.tsx:21` mounts NO assistant; Piece 1 merged
  (`e84ec8c1`); `origin/main == main`. **Mitigation:** never mount an assistant in the layout; never add
  `key={pathname}` above the pill.
- **Piece 2 (project-aware AI):** mostly BUILT on main (plan docs saying "not built" are stale). Risk = the unify
  *moves* TIER-A/B code into `/api/ai`; a sloppy move regresses the #1 ask. **Mitigation: move, don't rewrite**;
  keep the isolation guard + 5-rule contract verbatim.
- **Piece 3 (signal layer, held):** the assistant is the sole reader of `project_feed` via `digest.ts feedSignals`.
  **Mitigation:** the unify must *call* the digest, not flatten grounding.
- **Piece 4 (edit/refresh/trash, held):** offers must point at gated `/api/deliverables/*` (spec-validator + 3
  lints). **Mitigation:** no chat-side prose mutation, ever; free-build / send-paywall unchanged.
- **Social branches (2 worktrees):** NO collision — true diffs touch only `lib/social/**` + `scripts/social/**`.
  Land independently; rebase over `origin/main` as normal hygiene.
- **MCP / `/api/b/*`:** NO collision — `app/api/mcp/server.ts` imports none of the renamed surfaces. **Mitigation:**
  keep `buildGroundedSystemPrompt` exported from its shared location (MCP + reply-sensor depend on it).
- **Funnel (Piece 5, shipped):** the `welcome/chat` rename can't drop `mode:welcome`. **Mitigation:** thin
  forwarding alias one release; public route tests pass verbatim; `WELCOME_SYSTEM` survives byte-for-byte.
- **Data-readiness web-search (uncommitted, in working tree):** specs the SAME web primitive #12 needs, scoped to
  email. **Mitigation:** factor ONE `lib/ai/web-grounding.ts` reused by both — else it gets built twice (the exact
  "fixed N times" failure mode).

---

## 7. BUILD ORDER (reconciled; design-spec phases corrected per this audit)

- **Phase 0 — Harvest (sequential, first). [Sonnet]** Apply the 9 `49e64e3` files onto main (verified clean:
  merge-base = harvest parent, zero drift, `git apply --check` exits 0). Surface contract + 4 page edits +
  surfaceNote take as-is. Narrows the `/r/*` 404 class; does NOT yet eliminate it.
- **Phase 1 — Contract freeze + engine skeleton (sequential). [Opus]** `lib/ai/contract.ts`, `app/api/ai/route.ts`,
  `lib/ai/use-assistant.ts` (merge the **4** client files). No behavior change; aliases forward.
- **Phase 2 — Resolver into the root + DEGRADE (sequential — THE critical commit). [Opus]** Move grounding into
  `lib/ai/grounding-resolver.ts`. Convert all **three** throw sites to master→"be Claude" fallback. Drop
  `converse/route.ts:138`'s 404. **Same commit:** invert `converse/route.test.ts:116` + add the never-throws
  assertion. Atomic #10/#11 — do not split.
- **Phase 3 — Forks + net-new (parallel-safe after Phase 2):**
  - **3A Charts-in-panel [Sonnet]** — lift `DockChart`/`buildChartForIntent` BEFORE folding the dock.
  - **3B WEB rung [Opus]** — `lib/ai/web-grounding.ts` (shared w/ email); encode tier in `rules-of-engagement.mts`.
  - **3C Highlighter-to-root [Sonnet]** — behind `highlighterUiEnabled()`; flag OFF = today exactly.
  - **3D Rename fossils [Sonnet]** — `welcome`/`analyst`/`converse`/`AskAiDock`/`BriefcaseChat` → PROJECT/OUTSIDE
    AI names; aliases kept 1 release.
- **Phase 4 — Prove-it harness (sequential, last). [Opus]** Page×capability matrix test (red on per-page
  divergence) + the NEEDS-TEST gaps: `action/route.test.ts`, route-level isolation, TIER-B glue, per-project
  threads, MCP smoke.

**Sequential:** 0 → 1 → 2 → 4. **Parallel-safe:** 3A/3B/3C/3D after Phase 2; social branches anytime.
Phase 2 is the one commit that must not be split.

---

## 8. OPEN DECISIONS (operator call)

1. **Public funnel = state vs separate surface.** *Recommend: degenerate STATE of OUTSIDE AI* (`context:"public"`
   / `WELCOME_SYSTEM`) — distinct system prompt, zero project context; maps to the two-agent decree (OUTSIDE AI =
   data agent, public = its no-auth `/welcome` mode). **Default adopted unless redirected.**
2. **Sticky-project (design-spec Phase 5).** The one place code does the opposite of operator intent. Per-page
   divergence is reduced but not fully gone until it lands. **Pull into this build or defer?**
3. **G1 markers in FINAL BOSS docs.** `FINAL BOSS/02` + `06` still call G1 "the locked open decision"; it's
   resolved + built. Flip the markers in the same PR (RULE 2) — *will do as part of the work*.
4. **`readyToSend` wiring.** Engine supports it (`prompt-engine.ts:122`); no caller passes `sendReady:true`. G1
   now exists to honor it. **Light now or defer with J4?**

---

## 9. THE "FIX IN ONE PLACE" GUARANTEE

After this lands, when the AI misbehaves on any page — wrong voice, a 404, a missing chart, a leaked project, an
ungrounded claim — the operator opens **one file: `lib/ai/grounding-resolver.ts`** (or `app/api/ai/route.ts` for a
context/routing issue). One engine, one client, one frozen contract; a resolver fix lands on PROJECT AI, OUTSIDE AI,
and the public funnel simultaneously. The Phase-4 page×capability matrix test goes red the instant any page diverges,
so "fixed everywhere" can no longer be a lie. The only behavior that lives off that root is mutation — and that has
its own single home, `app/api/projects/[id]/action/route.ts`.
