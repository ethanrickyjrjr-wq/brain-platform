# 02 — PIECE 2: Project-Aware AI  🟡 DRAFT (needs brainstorm)

> **Recommended model:** ⚡ Sonnet — 8 tasks, 7 files, keywords: redesign





> ⚠️ This is a SCOPED DRAFT derived from the operator's vision + the codebase map — **not an approved design.**
> Before building, run `superpowers:brainstorming` (RULE 3.5) and write `docs/superpowers/specs/<date>-piece2-project-aware-ai-design.md`.

## Intent

The assistant stops being a stateless pill and becomes the **always-prepared Project AI**: it knows a little about
each project (more when there are fewer), knows what you already have and what **overlaps** with your other projects,
and suggests **without nagging**. It surfaces **changing situational prompts** — 3 that depend on what's going on +
1 that just offers to do something — broad when no project is open, focused when one is. Prompts change only on
**project-switch or a question**, not every click. "Give him time to load during click-over." It is **one persistent
assistant in two contexts** (Outside mode ↔ Project mode), joined by the context bus + `project_id` — not two bots
(`00-MASTER-PLAN.md` → The spine).

## Contract

**Depends on (from P1):** the persistent layout/AI · `aiContext/setAiContext` + `{kind:"project",projectId}` PillPage
seam (= the in-session half of the **context bus**, `00-MASTER-PLAN.md`) · `summarizeItem` · `groupItemsByKind` ·
`projects.ui_state` · the digest-prefetch-on-click hook.
**Depends on (from P3, optional/enriching):** `project_feed` (kinds: data-change · engagement · external-event ·
**platform-feature**) + email click events + change-detection — for "7 clicks / Walmart nearby / the new data shows X /
we just got new charts that fit this" prompts. **P2 ships an MVP without P3** using signals that exist today.
**Provides:** the dynamic prompt engine + a project-digest builder (read by the prompt surfaces P1 left in `workspace/*`).

## Scope (proposed)

1. **Project digest builder** — a small, mostly-deterministic summary of one project (its items via `summarizeItem`,
   last activity, deliverables, schedules, scope ZIP/topic). Cheap; this is the AI's "what's in here" context.
2. **Cross-project index** — for the signed-in user, a lightweight map of each project's scope + item identities so the
   AI can say "you already have this 33931 flood metric in *Luxury Clients* — reuse it?" Overlap = identity match on
   existing item fields (no new embeddings for v1).
3. **Dynamic prompt engine** — replaces the static `lib/briefcase/visits.ts` sets with a generator producing **3
   situational + 1 offer**, parameterized by no-project (broad/urgent) vs. project-open (focused), the digest, and (if
   present) P3 signals. Recompute **only** on project-switch or after a question (cache between). Concrete prompts:
   *"Ready to send?"* (a seeded email is staged), *"Pick up where we left off?"*, *"the new data shows X — want it in
   your report?"*, *"this would look good in an email for your luxury clients."*
4. **Wire project buttons → AI** — consume P1's `setAiContext` so each workspace action "prepares" the assistant.
5. **Selective pre-build (background, ONE option, on a strong signal)** — when intent is clear, pre-build a single
   suggested deliverable so a sample thumbnail / one-click PDF is ready on arrival. Stage recipes cheaply (P1); spend an
   LLM pass on **one** option, never all (`00-MASTER-PLAN.md` → Convergence engine). Never block the user on it.
6. **Cross-project assist** — using the index (#2), surface "you already have this in *Project Y* — reuse it?" and line
   up a one-click add. Identity-match is deterministic; the build is the selective tier (#5).

## Existing signals P2 can use on day one (before P3)

Freshness-token diff (master/brain `freshness_token` changed since last open = "new data as of X") · `email_sends`
(something went out) · reconcile verdicts (`swfl_reconcile` — a filed metric is now stale) · "where you left off"
(latest `items.added_at` / last deliverable). These power real prompts without the P3 feed.

## Open decisions for brainstorm

- Prompt generation: deterministic templates vs. a cheap LLM pass vs. hybrid. (Cost/latency vs. naturalness.)
- Does P2 need a `project_ai_memory` table, or is on-the-fly digest enough? (Lean: on-the-fly.)
- How "broad/urgent" no-project prompts are chosen (region master read? most-stale project? newest signal?).
- Overlap UX: inline chip vs. a dedicated "you also have…" line. How aggressive before it's nagging.
- Exactly where the 3+1 prompts render in `workspace/*` and the global pill, and the switch/question refresh trigger.

## Likely key files
`components/briefcase/BriefcaseChat.tsx` · `components/briefcase/BriefcasePanel.tsx` ·
`components/briefcase/BriefcaseProvider.tsx` · `lib/briefcase/visits.ts` (static prompts → replace) ·
`lib/chat/page-context.ts` · `app/api/welcome/chat/route.ts` (analyst mode system prompt) · new `lib/project/digest.ts`
+ `lib/project/prompt-engine.ts`. Reuse `summarizeItem`/`groupItemsByKind` from P1.

---
---

# 🔒 PIECE 2 — BUILD PLAN (locked 2026-06-17 · supersedes the scoped draft above)

> The draft above is preserved for provenance. **This section is the precise, ready-to-build plan** — the RULE 3.5
> brainstorm output, decisions locked from the operator Q&A (2026-06-17). Next step on approval: write the repo spec
> `docs/superpowers/specs/2026-06-17-piece2-project-aware-ai-design.md`, confirm Piece 1's seams exist, then build.
> Code-verified seam claims below (line numbers checked against the repo on 2026-06-17). Append-only — do not revert.

## Grounding vs. actions — the organizing split (read this first)

Two fundamentally different operations happen through the assistant. **Get this distinction wrong and you'll try to route project actions through a surface that can't support them.**

- **Grounding (project-aware *answers*)** — reading the project's context to phrase better answers. This is cheap and works on the **anonymous** `/api/welcome/chat` surface: §D pushes a client-computed `projectContext` block into the POST body via `getExtraBody` → the existing `buildClientContextBlock` injection (DATA, not instructions). No server-side auth needed.
- **Actions (project *mutations*)** — "Ready to send?", seeding a build, scheduling a send. These **cannot** ride the anonymous, text-only `welcome/chat` route — they need an **authenticated** surface with `user_id` and `project_id`.

**The locked open decision (G1):** today there is no specified authenticated surface for project actions. Two candidates: (a) port `/api/converse` (which already supports charts + actions) to the project context, or (b) a dedicated authed project-action route. This must be decided before J4 ("see it before you send") works end-to-end — it is the blocker called out in `00-MASTER-PLAN.md` J2/J4 and `06-convergence-and-journeys.md`.

`welcome/chat` deliberately stays **anonymous + text-only**. The answer-grounding path (§D below) is the cheap win that ships without solving G1. The action path is a hard J4 dependency that requires it.

---

## Context — why this is being built

Today the in-app assistant (the briefcase pill) is **stateless and static**: on `/project/[id]` it shows the same
generic SWFL prompts as the home page, answers region-wide, and knows nothing about the open project or the user's other
projects. Verified: `pageFromPath` returns `{kind:"generic"}` for `/project/*`; `BriefcasePanel.tsx:54` calls the pure
static `promptsForPage(page, visits)`; `/api/welcome/chat` receives only a generic `pageContext` string + the anon
briefcase digest. `aiContext`/`setAiContext` do not exist yet.

Piece 2 is **the communication layer** the operator calls "the heart": every page action feeds the assistant so it's
**always prepared**, it reasons **across all the user's projects**, and it can **assemble work on command** ("build a
project for 1142 3rd St 33908 and pull the important data from my existing projects"). The data→answer→graph→prediction
engine already exists and is **out of scope** — Piece 2 wires project awareness *into* it, it does not rebuild it.

**Quality bar (HANDOFF):** the user is a 20-yr broker — output must be accurate, fast, polished, decision-grade, and
surface what they *missed*. Cross-project intelligence ("you already have this; it's missing there; these pair well")
is exactly that.

## Locked decisions (from the 2026-06-17 brainstorm)

1. **Dual-tier everywhere — the organizing principle.** Every premium capability ships as a **deterministic, free,
   instant baseline** + an **LLM accelerator behind an entitlement flag** (polished prompts, background pre-build,
   one-shot assembly). Default: baseline ON for everyone; LLM layer **paved but flag-gated** (free for an intro window,
   then a paid nicety — exact ramp decided later once real build cost is measured). Honors the locked monetization rule:
   **never gate a *build*; only gate speed/polish accelerators** (the free deterministic path always produces the full
   result). Memory: `build-monetization-model`.
2. **Ground answers project-aware (Q1 = yes, and more).** When a question is asked inside a project, inject the
   project's scope + a compact "what's in here / what's across your other projects" context into the **existing** chat so
   the answer comes back at the project's grain and can close with **one** short cross-project offer.
3. **Cross-project intelligence is the centerpiece (Q1 expanded).** Bidirectional + deterministic for v1:
   - **Reuse:** "you already have this 33908 flood metric in *Luxury Clients* — reuse it here?"
   - **Gap:** "*Luxury Clients* is missing this metric and it fits the 33908 group — add it there?"
   - **Pairing:** "your {metric} from {other project} would pair well with this — pull it in?"
   - **Assemble-on-command (the execution goal):** from Outside or Project mode, "build a project for {ZIP/place},
     pull the important data from my existing projects" → assemble a new project from identity-matched items at that
     grain, landing already open. v1 grain = ZIP/topic; **future-proof toward address grain** (leave the slot).
4. **Prompts: deterministic baseline now, LLM-polish paved + gated (Q2).** Short situational templates filled from the
   digest render instantly and free. A cheap LLM rephrase runs only in the hover-prefetch, cached per project-open,
   behind the flag — falls back to deterministic on flag-off/failure. Prompts recompute **only on project-switch or
   after a question**, never per click.
5. **Selective pre-build paved + gated (Q3).** The free baseline is the **cheap deterministic staging** (summaries,
   chartable-combo flags, pre-resolved chart recipes). The **one-LLM-pass background pre-build** of a single suggested
   deliverable is flag-gated, signal-triggered only, never eager, never blocks.
6. **On-the-fly digest; no new tables.** Derive the project digest from already-loaded data each open; persist only tiny
   markers (last-seen freshness token, dismissed-overlap keys) in **`projects.ui_state`** (P1's bag). The cross-project
   index is computed on the fly from the user's projects; a cached index table is a future optimization, not v1.

## The context-bus mechanism (THE critical detail — get this exactly right)

The persistent AI lives in the **root** layout (`app/layout.tsx:44-54`) so it survives nav. The per-project digest is
computed where the data loads — `app/project/[id]/page.tsx` (P1) — which **swaps** on nav. The prompt seam is
**synchronous and pure** (`BriefcasePanel.tsx:54`), so the digest must be readable **synchronously at render**. And
`react-hooks/set-state-in-effect` is **build-blocking**, so we cannot push the digest up via `useEffect`.

**Mechanism (honor P1's `setAiContext`/`aiContext` seam names; make the backing React-safe):**

- Back `aiContext` with an **external store** (`useSyncExternalStore` over a module-level store keyed by `projectId`),
  not plain React state. `setAiContext(digest)` writes to the store. Writes become callable from **anywhere** — event
  handlers *or* render-time init — with **no effect and no cross-component-render warning** (it is not a React
  `setState`). If P1 ships `aiContext` as plain `useState`, P2 swaps the backing to this store behind the same public API.
- **Writer — primary (event, on-brand "time to load during click-over"):** `ProjectsRail` (P1) prefetches the digest on
  **hover** and, on **click**, calls `setAiContext(digest)` then navigates. Pure event handler.
- **Writer — direct load / deep link:** `app/project/[id]/page.tsx` computes the digest server-side (cheap) and renders a
  tiny client `ProjectAiContextBridge` that seeds the store via `useState(() => setAiContext(seed))` (lazy init, runs
  once during first render — **not** an effect). Re-seed on `projectId` change via the store's keyed-write guard.
- **Reader:** `BriefcasePanel` and `BriefcaseChat.getExtraBody` read the current digest via `useAiContext()`
  (`useSyncExternalStore`). Panel → prompt engine; getExtraBody → answer-grounding context (event-time read, no effect).

This is the #1 implementation risk — verify `next build` + lint are green after wiring it (watch `set-state-in-effect`).

## Dependencies on Piece 1 (hard-required — P1 is not built yet)

P2 is buildable once these P1 seams exist. If interleaving, build this minimal P1 subset first:

| P1 seam | Why P2 needs it |
|---|---|
| `app/project/layout.tsx` persistent rail + AI (no unmount) + `ProjectsRail` hover-prefetch | the write path for the context bus |
| `aiContext` / `setAiContext` on `BriefcaseProvider` + `{kind:"project",projectId}` PillPage / `pageFromPath` | the bus channel + the page kind P2 keys on |
| `projects.ui_state jsonb` + the PATCH `ui_state` branch | persist last-seen freshness token + dismissed overlaps |
| `summarizeItem` / `groupItemsByKind` (`lib/project/*`) | digest item lines (P2 may later swap to AI summaries behind the same signature) |
| `app/project/[id]/page.tsx` server load (items, deliverables, schedules) | the raw data the digest is derived from |
| create-from-anywhere + `deriveProjectName` + `/api/projects/import` | the assemble-on-command target (reuse, don't rebuild) |

## Components to build

| # | File (new unless noted) | Tier | Responsibility |
|---|---|---|---|
| A | `lib/project/digest.ts` | free | `buildProjectDigest(input): ProjectDigest` — deterministic "what's in here" |
| B | `lib/project/cross-project-index.ts` | free | identity index + `findOverlap()` (reuse / gap / pairing) across the user's projects |
| C1 | `lib/project/prompt-engine.ts` | free | deterministic 3-situational + 1-offer generator |
| C2 | `lib/project/prompt-polish.ts` | gated | optional LLM rephrase in the prefetch, cached, flag-gated, deterministic fallback |
| D | `lib/chat/page-context.ts` (extend) + `BriefcaseChat.getExtraBody` (extend) + `ANALYST_SYSTEM` (extend) | free | project-grounded answers + one closing cross-project offer |
| E | `lib/project/assemble-command.ts` + `app/api/projects/assemble/route.ts` | free base / gated LLM | "build a project for {scope}, pull from existing" |
| F1 | (P1 §I staging) + `lib/project/stage.ts` | free | cheap deterministic staging (combos, recipes, summaries) |
| F2 | `lib/project/prebuild.ts` + `app/api/projects/[id]/prebuild/route.ts` | gated | one-LLM-pass background pre-build of ONE deliverable |
| G | `lib/briefcase/pill-mount.ts` + `lib/briefcase/visits.ts` + `BriefcasePanel.tsx` (extend) | free | wire project page kind → engine; `ProjectAiContextBridge` |
| H | `app/api/projects/[id]/build/route.ts` + MCP `swfl_project_build` (extend) | free | thread `scope_kind/scope_value` + add `"email"` to template enum (carryover from P1 §I if not already done) |

### A. Project digest builder — `lib/project/digest.ts` (deterministic, pure)
`buildProjectDigest(input) → ProjectDigest` where:
```ts
interface ProjectDigest {
  projectId: string; title: string; rev: string;             // rev = hash(items+freshness) for cache/refresh
  scope: { zip?: string; topic?: string; address?: string };  // address reserved (future grain)
  itemCount: number; kindCounts: Record<string,number>;
  identityKeys: string[];                                      // for cross-project matching (see B)
  freshnessToken?: string; freshnessChangedSinceSeen: boolean;
  latestActivityAt?: string;                                   // max(items.added_at, deliverables.created_at)
  deliverables: { id:string; template:string; createdAt:string }[];
  schedules:    { cadence:string; scope?:string; lastRunAt?:string }[];
  recentSends:  { sentAt:string }[];
  staleMetrics: { label:string; expiredAt?:string }[];        // from reconcile verdicts (gate OFF → [])
}
```
- Scope inference reuses the `deriveProjectName` ZIP/topic logic (`\b3\d{4}\b` + SWFL place scan + keyword topic table)
  over items, falling back to `email_schedules.scope_value` / `deliverables.scope_value`.
- `freshnessChangedSinceSeen` = newest item `freshness_token` > `ui_state.last_freshness_token_seen`.
- Pure + cheap; called server-side in `page.tsx` and reusable by MCP `swfl_project_list`.
- Tests: `digest.test.ts` (scope inference, freshness diff, kind counts, stale list with gate on/off).

### B. Cross-project index — `lib/project/cross-project-index.ts` (deterministic, pure)
- `buildCrossProjectIndex(projects) → CrossProjectIndex`: map each project → `{scope, identityKeys}`.
- Identity key per kind (from the verified `ProjectItem` fields): metric→`${metric_slug ?? label}@${report_id}`,
  report→`slug`, table_slice→`${report_id}::${title}`, frame→`${brain_id}::${frame_id??"auto"}::${metric_keys}`,
  source→`${table}::${url}`, qa→`${report_id}::${question}`, chart→`chart_id`, file→`storage_path`, note→`text`.
- `findOverlap(currentDigest, index) → { reuse[], gap[], pairing[] }`:
  - **reuse** = identity key in current ∩ another project (same data already filed elsewhere).
  - **gap** = identity key in current ∉ a *scope-matching* other project (same ZIP/topic) that lacks it.
  - **pairing** = another project at the same scope holds a complementary metric the current one doesn't.
- Conservative thresholds (exact identity match + scope match) to avoid nagging; respect `ui_state` dismissed keys.
- Tests: `cross-project-index.test.ts` (reuse/gap/pairing fixtures; dismissed-key suppression; scope anchoring).

### C. Dynamic prompt engine
- **C1 deterministic** — `projectPrompts({digest, overlap, signals, visits, hasOpenProject}) → { prompts:string[3]; offer:string }`.
  - Candidate generators, ranked by signal strength: `freshData` ("the new data shows {metric} as of {date} — add it to
    your report?") > `readyToSend` ("Ready to send?" when a seeded email/active schedule exists — **this is J4's
    closing beat; it only fires once the G1 auth surface exists**) > `crossProject`
    (reuse/gap/pairing one-liners from B) > `whereLeftOff` ("Pick up where we left off — {latest}?"). Pick top 3 + 1 offer.
  - **No-project (Outside / list):** broad set — "Pick up in {most-recent project}?", "{most-stale project} is out of
    date — refresh?", region master read; keep existing `HOME_PROMPTS` as the floor.
  - Memoize on `(projectId, rev, questionCount)`; recompute only on switch or question.
  - Tests: `prompt-engine.test.ts` (each signal → expected prompt; ranking; no-project set; memo trigger).
- **C2 LLM-polish (gated)** — `polishPrompts(deterministic, digest): Promise<string[]>`: one cheap call in the
  hover-prefetch, cached by `(projectId, rev)`, behind `PROMPT_POLISH_ENABLED` + entitlement; deterministic fallback on
  flag-off/error. **Never** on the synchronous render path (result is cached into the digest before the panel reads).

### D. Answer grounding (the cheap, high-leverage win) — extend existing channel, no route redesign
- `lib/chat/page-context.ts`: extend `describePage` for `/project/[id]` to name the project's scope + a one-line "what's
  in here" (deterministic, from digest), bounded ≤600 chars (existing clamp).
- `BriefcaseChat.getExtraBody`: when `page.kind==="project"`, add a compact `projectContext` block (digest summary +
  overlap hints) to the POST body; it rides the **existing** `buildClientContextBlock` injection (framed as DATA, not
  instructions — the safe channel already in place). Bounded by the existing 1200-char clamp.
- `ANALYST_SYSTEM` (`/api/welcome/chat`): add a short clause — *when project context is present, answer at that project's
  place/grain; if the context flags the same data already in another project, or missing from one where it fits, you MAY
  close with exactly ONE short offer to reuse/move/add it — never more, never pushy.* Keep the no-invention floor + the
  consumption contract (cite / `[INFERENCE]` / grain / quote freshness token) intact.
- Charts-in-the-pill stay **out of scope** (the `/api/welcome/chat` surface is text-only by design; the chart-frame
  path lives in `/api/converse` — a future port, noted not built).

### E. Assemble-on-command (the execution centerpiece) — `lib/project/assemble-command.ts` + `app/api/projects/assemble/route.ts`
- Intent: "build a project for {ZIP/place}, pull the important data from my existing projects."
- **Free deterministic base:** parse the scope (reuse the ZIP/place scan); select identity-matched items from the user's
  projects at that scope via the cross-project index; create the project via the existing `/api/projects/import`
  (`deriveProjectName`, brand-follows-all); land already open. "Done right" rides the existing no-invention build guards.
- **Gated LLM accelerator:** the LLM ranks/curates *which* matched items matter most and orders them, and (with F2)
  pre-builds one deliverable. Flag-gated; deterministic selection is the fallback.
- Future-proof: scope carries an optional `address` slot (unused in v1; lake grain is ZIP today).
- Tests: `assemble-command.test.ts` (scope parse → matched items → import payload; empty-match graceful).

### F. Staging (free) + selective pre-build (gated)
- **F1 free staging** — `lib/project/stage.ts`: on item save, derive summaries (`summarizeItem`), flag chartable combos,
  pre-resolve chart recipes (no LLM). Mostly P1 §I; P2 consumes the result in the digest so arrival feels "lined up."
- **F2 gated pre-build** — `lib/project/prebuild.ts` + `app/api/projects/[id]/prebuild/route.ts`: on a **strong signal**
  (seeded email intent, or digest shows "everything for a one-pager is present"), background-call `assembleDeliverable`
  for ONE option; mark it suggested so a sample thumbnail / one-click PDF is ready. Behind `PREBUILD_ENABLED` +
  entitlement. Never eager, never blocks. Still passes `spec-validator` + the 3 lints (structural no-invention).

### G. Wiring
- `lib/briefcase/pill-mount.ts`: `pageFromPath` detects `/project/[id]` → `{kind:"project",projectId}` (P1 may already).
- `lib/briefcase/visits.ts`: add the `project` PillPage variant; leave `promptsForPage`/`createSuggestion` unchanged for
  non-project kinds (no regression).
- `BriefcasePanel.tsx`: branch — `page.kind==="project"` → `projectPrompts(useAiContext()…, visits)`; else the existing
  static path. Add `ProjectAiContextBridge` mount (per the context-bus mechanism).

### H. Build-path carryover (if not already shipped in P1 §I)
- `app/api/projects/[id]/build/route.ts` + MCP `swfl_project_build`: thread `scope_kind/scope_value`; add `"email"` to
  the tool's `TEMPLATE_ENUM`. `assembleDeliverable` already supports email+scope — only the route/tool lag. Required by
  E/F2; verify P1 didn't already close it before duplicating.

## Data model

- **No new tables for the core.** Reuse `projects.ui_state` (P1) for: `last_freshness_token_seen`,
  `last_digest_viewed_at`, `dismissed_overlap_keys: string[]`. Additive keys only (never repurpose).
- Cross-project index = on-the-fly from the user's projects (one `select id,title,items` query). If it gets hot at scale,
  a cached `project_identity_index` is a **future** optimization — not v1.
- **Entitlement flags:** `PROMPT_POLISH_ENABLED`, `PREBUILD_ENABLED`, `ASSEMBLE_LLM_ENABLED` (env + per-user tier check).
  Default the LLM layers OFF/intro-free; deterministic baselines always on.
- Future-proofing: `scope.address?` reserved across digest/index/assemble; unused in v1.

## Build sequence (ship + verify each)

1. **Digest builder (A)** + tests → green. Wire into `page.tsx` server load (read-only; nothing renders yet).
2. **Context bus (G mechanism)** — external-store backing for `aiContext`/`setAiContext` + `ProjectAiContextBridge` +
   `ProjectsRail` click/hover writer. Verify the digest reaches a debug read in the pill; `next build`+lint green
   (set-state-in-effect clean). **Gate.**
3. **Cross-project index (B)** + tests → reuse/gap/pairing detected on fixtures.
4. **Deterministic prompt engine (C1)** + tests; branch `BriefcasePanel` for project kind → project prompts render,
   change on switch/question, not per click.
5. **Answer grounding (D)** → ask a question inside a project: answer is at the project's grain and can close with one
   cross-project offer; consumption contract still honored (freshness token quoted, cites, `[INFERENCE]`).
6. **Assemble-on-command (E, deterministic)** → "build a project for 33908, pull from my projects" lands a new project
   with the matched items, already open.
7. **Free staging (F1)** consumed by the digest → arrival looks lined up.
8. **Gated layers paved (C2, F2, E-LLM)** behind flags, default off; deterministic fallback verified when flags off.
9. **Build-path carryover (H)** if still open.

## Verification

- `bun test lib/project/` (digest, cross-project-index, prompt-engine, assemble-command) + full suite + `next build` +
  lint all green; **watch `react-hooks/set-state-in-effect`** at the bus wiring.
- Run the app: open a project → pill shows project-specific 3+1 prompts (not the generic home set); switch projects →
  prompts swap, **pill never reloads** (no `key={pathname}` regression); ask a question → project-grounded answer +
  ≤1 cross-project offer; trigger "build a project for {ZIP}, pull from existing" → new project lands open with matched
  items; flags off → deterministic everything (no LLM calls); flags on → polished prompts + one pre-built sample
  thumbnail, never blocking.
- Contract checks: `/api/welcome/chat` answers still quote the `freshness_token`, cite, tag `[INFERENCE]`, stay in
  grain (rules-of-engagement + consumption contract); any pre-built deliverable passes `spec-validator` + the 3 lints.
- RULE 2: open obligations go to the `checks` ledger (e.g. `piece2_context_bus_live_verify`,
  `piece2_crossproject_assemble_live_verify`), not plan-doc markers; build-queue + SESSION_LOG updated on push.

## Deferred / future (named, not silently dropped)

Address-grain scope (lake is ZIP today); charts-in-the-pill (port `/api/converse` frame path); cached
`project_identity_index` table; `project_ai_memory` (on-the-fly digest is enough for v1); P3-fueled prompts (7 clicks /
Walmart-nearby — land once `project_feed` + click tracking exist; P2 ships the MVP on day-one signals first); embeddings
for fuzzy overlap (v1 is exact identity match only).

## Critical files

**Verified seams P2 rewires:** `components/briefcase/BriefcasePanel.tsx:54,127` (prompt seam) ·
`components/briefcase/BriefcaseChat.tsx` (`getExtraBody`, `projectIdFromPath`) ·
`components/briefcase/BriefcaseProvider.tsx` (`aiContext`/`setAiContext` backing) · `lib/briefcase/visits.ts`
(`PillPage`, `promptsForPage`, `createSuggestion`) · `lib/briefcase/pill-mount.ts` (`pageFromPath`) ·
`lib/chat/page-context.ts` (`describePage`) · `app/api/welcome/chat/route.ts` (`ANALYST_SYSTEM`,
`buildClientContextBlock`).
**Reused as-is:** `lib/project/items.ts` (ProjectItem identity fields) · `lib/deliverable/assemble.ts`
(`assembleDeliverable`, email+scope) · `app/api/projects/import/route.ts` · `lib/project/derive-name.ts` (P1) ·
`summarizeItem`/`groupItemsByKind` (P1) · `lib/reconcile/*` (stale verdicts) · `email_sends`/`email_schedules` tables.
**New:** `lib/project/{digest,cross-project-index,prompt-engine,prompt-polish,assemble-command,stage,prebuild}.ts` ·
`app/api/projects/{assemble,[id]/prebuild}/route.ts` · `ProjectAiContextBridge` (in `app/project/[id]/workspace/`).
