# ULTRA PLAN — Root 1: Unify the AI + project flow (R1 + BTN-1)

## Context

End-user verdict: *"I feel like I'm on 50 different sites."* The inventory
(`docs/superpowers/plans/2026-06-15-MASTER-PROBLEM-INVENTORY.md`) collapses ~47
problems to ~5 roots. This PR attacks **Root 1** only, tightly scoped. The other
two roots are handed off as standalone briefs:
- Root 3 (data) → `docs/superpowers/plans/2026-06-15-root-R3-data-truth.md`
- Roots 4+5 (visuals/discoverability) → `docs/superpowers/plans/2026-06-15-root-R4R5-visuals-discoverability.md`

**What the code actually shows (grounded 2026-06-15):**

- The one pill (`components/briefcase/AiBriefcasePill.tsx:36`) forks on `reportId`
  into two unrelated experiences hitting two backends:
  - `/r/*` → `AskAiDock` → `/api/converse` — **grounded** on a brain dossier,
    has charts + "file this chart". This is the GOOD experience (operator: keep it).
  - everywhere else → `BriefcasePanel` → `BriefcaseChat` → `/api/welcome/chat`.
- `/api/welcome/chat` runs `WELCOME_SYSTEM` (`route.ts:57-80`): a **cold-lead
  funnel premise** — asserts *"you just clicked through from a branded email,"*
  is ordered to *"lead with [the auto-email] hook,"* and bounces for a ZIP. It
  DOES have a grounded path (`buildWelcomeGroundedSystem`) once a location is
  named, but even that **closes with the funnel email hook** and **no surface can
  file a Q&A to a project**. Hence: pitches instead of answers (BRF-8), starter
  prompts guarantee a non-answer (BRF-9), and the AI denies the project system
  while running inside it (BRF-10).
- `ProjectDetail.tsx:323-330`: "Build deliverable" is hardcoded `disabled` +
  "Coming soon" with **zero callers**, while `POST /api/projects/[id]/build`
  (→ `assembleDeliverable`) is fully built and also used by MCP (BTN-1).

**The operator already decided** (build-queue, A-3): ONE pill, **dock preserved
on `/r/*`**. So Root 1 is NOT a widget rebuild. It is: (1) give the standalone
in-app chat an **analyst, project-aware, grounded** voice instead of the funnel
bot, without breaking the public welcome landing page; (2) give **both** chat
surfaces the missing **"File this answer"** capability so the AI can actually put
work into a project; (3) **wire the Build button**. That is the whole "50 sites /
prompts produce shit / can't create a project" complaint.

## Shape of the change

```mermaid
flowchart TB
  subgraph BEFORE
    P1[AiBriefcasePill]
    P1 -->|/r/*| D1[AskAiDock → /api/converse<br/>grounded · files CHART only]
    P1 -->|elsewhere| B1[BriefcaseChat → /api/welcome/chat<br/>FUNNEL premise · cannot file Q&A]
    PD1[ProjectDetail 'Build' = disabled, no onClick]
  end
  subgraph AFTER
    P2[AiBriefcasePill - unchanged fork]
    P2 -->|/r/*| D2[AskAiDock → /api/converse<br/>grounded + NEW 'File this answer']
    P2 -->|elsewhere| B2[BriefcaseChat → /api/welcome/chat?mode=analyst<br/>ANALYST premise · grounded · NEW 'File this answer']
    WC[/api/welcome/chat]
    WC -->|mode=welcome default| FUN[funnel voice — PUBLIC landing UNCHANGED]
    WC -->|mode=analyst| AN[analyst voice — location dossier OR master read]
    PD2[ProjectDetail 'Build' → template picker → POST build → /p/id]
  end
  BEFORE --> AFTER
```

The grounded *substrate* (location detect → dossier → no-invent floor) is reused
verbatim; only the **voice** (premise + closing line) and the **filing
capability** change. The public welcome funnel keeps its exact current behavior
because `mode` defaults to `welcome`.

---

## Implementation (in order)

### 1. Split the chat voice: add `mode: "analyst" | "welcome"` to `/api/welcome/chat`

**`app/api/welcome/chat/route.ts`**
- Parse `mode` from the body (default `"welcome"` → today's behavior, untouched).
- Add `ANALYST_SYSTEM` next to `WELCOME_SYSTEM`: same no-invention floor, but the
  premise is *"You are a Southwest Florida market analyst helping this person
  build a cited, client-ready project. Answer the question directly from cited
  data. You CAN file answers, figures, and charts into their project — when they
  file something, it lands in their briefcase to build into a deliverable. When
  no place is named yet, ask which ZIP or area they want — do not pitch."* No
  "branded email you just saw," no "auto-email your clients" hook.
- No-location branch: when `mode==="analyst"` and `detectWelcomeLocation` returns
  null, **ground on the master read** instead of the un-grounded funnel explainer.
  Reuse `/api/converse`'s pattern: `fetchBrain("master", { tier: 2, origin })` +
  `buildDossier(output, freshness_token)` (both from `@/lib/fetch-brain`), inject
  that block with `ANALYST_SYSTEM` + the no-invent speak line. This is what makes
  the default starter prompt *"What's the bottom line on SWFL right now?"*
  actually answer (kills BRF-9). Keep the existing per-IP/weekly caps and the
  `assembleGuardedDossier` ceiling on the location path unchanged.
- Location branch (`mode==="analyst"` + a detected ZIP/place): reuse
  `buildWelcomeGroundedSystem`, but parameterize its closing line. In
  **`lib/welcome/grounded.ts`**, split `welcomeGroundedSpeakLine` so the funnel
  close ("auto-email their clients every week") is the `welcome` variant and an
  analyst close ("offer to file this read into their project") is the `analyst`
  variant; thread a `voice: "welcome" | "analyst"` param through
  `buildWelcomeGroundedSystem` (default `welcome`). Public landing unaffected.
- Emit the representative freshness token in the existing `data`/`place` prelude
  frame so the client can pin it on a filed Q&A (see step 3). The
  `place` frame already carries `{zip, name}`; add `freshness_token` to the
  grounded prelude (backward-compatible — clients ignore unknown fields).

### 2. Let `useChatStream` pass extra body fields

**`lib/chat/use-chat-stream.ts`**
- `send()` currently posts `{ messages: next }`. Add `opts.body?: Record<string,
  unknown>` merged into the POST body: `JSON.stringify({ messages: next,
  ...opts.body })`. Backward-compatible (welcome page passes nothing → `mode`
  undefined → funnel default).

### 3. Standalone chat: analyst mode + "File this answer"

**`components/briefcase/BriefcaseChat.tsx`**
- `useChatStream("/api/welcome/chat", { body: { mode: "analyst" }, onFrame })`.
- Capture the grounding identity from the prelude via `onFrame`: store the latest
  `place` (`{zip, name}`) and `freshness_token` in refs/state for use as the
  filed item's `report_id` (use `place.zip` if present, else `"swfl"`) and title.
- Add `useBriefcase()`. After each completed assistant turn (not streaming,
  non-empty), render a **"File this answer"** button that calls
  `briefcase.fileItem({ id: crypto.randomUUID(), added_at: new
  Date().toISOString(), origin: "web", kind: "qa", report_id, question: <last
  user msg>, answer: <last assistant msg>, freshness_token })` — matches the `qa`
  shape in `lib/project/items.ts:23-32`. Show "Filed ✓" transient state, mirroring
  `AskAiDock.fileChart`'s pattern. This is the capability that makes the AI
  project-aware (kills BRF-5 + BRF-10).

**`components/briefcase/BriefcasePanel.tsx`**
- One copy fix so the destination is explicit (BRF-2/BRF-3): under the chat, when
  the draft is non-empty, the existing list header already says "In your
  briefcase · N"; add a one-liner under the chat in the `pitch` state too —
  *"Answers and figures you file land here — open a project to build & send."* No
  new control; the file action lives in the chat (step 3) and the draft list
  already renders + the build path already exists.

### 4. Capability parity on the dock: "File this answer"

**`components/highlighter/AskAiDock.tsx`**
- The dock already has `useBriefcase()` (line 75) and files charts but never the
  Q&A. In the `stage === "answer"` block, next to "Ask another →", add a **"File
  this answer"** button (only when `!streaming && !error && !isSummaryAnswer`)
  that files `{ kind: "qa", report_id: reportId, question: activeQuestion,
  answer, freshness_token: freshnessToken }`. Reuse the `filed` transient-state
  pattern already in the file. Now BOTH surfaces file a Q&A → true parity.

### 5. Wire the Build button (BTN-1)

**`app/project/[id]/ProjectDetail.tsx:320-332`**
- Replace the disabled button + TODO with a real control inside `ProjectDetail`:
  a compact template `<select>` over the 4 ids in `DELIVERABLE_TEMPLATES`
  (`lib/deliverable/assemble.ts:21` — `market-overview`, `bov-lite`,
  `client-email`, `one-pager`) + a "Build deliverable" button.
- `onClick`: `POST /api/projects/${id}/build` with `{ template }` (reuse the
  `patch`-style fetch already in the file); on `{ id }` →
  `window.location.assign("/p/"+id)`; disable while building; on non-ok response
  **surface the error text** (e.g. "needs at least one filed item") instead of
  swallowing it. Gate: disabled when `items.length === 0` with a hint to file
  something first.
- **Out of scope (R2):** the deliverable's *content* quality
  (`lib/deliverable/build.ts:300` facts-only) is a different root — note it,
  don't touch it. The button just has to fire, navigate, and report failure.

### 6. Tests + housekeeping

- Add/extend a route test for `/api/welcome/chat` proving `mode:"welcome"` keeps
  the funnel system prompt and `mode:"analyst"` (no location) grounds on master
  and never emits the funnel hook. Pattern: existing `lib/welcome/grounded.test.ts`.
- Add a `BriefcaseChat`/dock unit assertion that "File this answer" calls
  `fileItem` with a valid `qa` item (validates against `projectItemsSchema`).
- Append a top-of-file `SESSION_LOG.md` entry; reconcile the `checks` ledger
  (`node scripts/check.mjs`); push via `node scripts/safe-push.mjs` (hooks fire).

## Verification

1. `bun test` (or repo test cmd) green; `next build` clean (routes static where
   they were).
2. Public welcome landing page chat: still funnel-voiced, still pitches the
   email hook (no `mode` sent → default). **No regression** is the bar.
3. On `/project`, `/charts`, `/` (off `/r/*`): open the pill → ask *"What's the
   bottom line on SWFL right now?"* → get a **grounded, cited** answer (not a
   pitch, not "give me a ZIP"). Ask a ZIP question → grounded read. **"File this
   answer"** appears → click → item shows in the draft list + badge count bumps.
4. On `/r/cre-swfl`: dock still works; new "File this answer" files a `qa` item.
5. On `/project/[id]` with ≥1 filed item: pick a template, click **Build
   deliverable** → lands on `/p/[slug]`. Empty project → button disabled with a
   hint; a backend error renders inline (not a dead click).
6. MCP `_meta` / `/api/converse` unchanged.

## Out of scope for this PR (noted, not dropped)

- R2 (output leads with chrome, deliverable forbidden from a real call) — the
  funnel-vs-analyst voice is fixed here, but caveat-dump density + the
  facts-only deliverable contract are a separate root.
- R3 → `2026-06-15-root-R3-data-truth.md`. R4/R5 →
  `2026-06-15-root-R4R5-visuals-discoverability.md`.
- Stripe/checkout (FUN-1): operator — keep Stripe on the roadmap, **no paywall
  until the product works**. Not this PR.
