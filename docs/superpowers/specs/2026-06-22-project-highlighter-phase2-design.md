# Project Highlighter (Phase 2) — Design Spec

> **Brainstormed 2026-06-22.** Supersedes the speculative §5 "open design questions" in the scoping brief
> `docs/superpowers/plans/2026-06-22-project-highlighter-phase2.md` — those are now decided here, grounded in code.
> Phase 1 (OUTSIDE highlighter) shipped at `3554411d`. Part of the One-Assistant unification
> (`docs/superpowers/specs/2026-06-21-one-assistant-unification-RECONCILED-SCOPE.md`).

## TL;DR

The PROJECT highlighter is the selection-triggered twin of the AI pill, *inside a project*. It splits into **two
layers, built by two sessions**:

- **LAYER 1 (this spec — build NOW):** the highlighter becomes true PROJECT AI inside `/project/[id]` — it
  **grounds on the open project** (digest / uploads / cross-project). Pure client wiring; the server already
  grounds when `context:"project"` + `project_id` arrive. Filing mirrors the pill (the briefcase tray) for now.
- **LAYER 2 (separate plan — build AFTER Layer 1 merges):** **in-deliverable select-to-edit** — select text inside
  the deliverable, Ask about it or propose a one-line *steer*, confirm → the gated edit route re-forks a new
  version. Hand-off in §6 so the next Claude can PLAN it now and BUILD it once Layer 1 lands.

---

## 1. Probe findings (verified in code — this spec is grounded, not assumed)

Per RULE 0.5, every architectural claim below was confirmed against the actual files on 2026-06-22.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Engine already speaks `context:"project"` + injects the project | ✅ | `lib/assistant/conversation-path.ts:457` `const analyst = req.context !== "public";`; `project_id` → digest + briefcase + uploads + TIER-B (`:468-477`) |
| 2 | `/api/assistant` contract already accepts the project fields | ✅ | `lib/assistant/contract.ts` `AssistantRequest`: `context`, `project_id`, `pageContext`, `briefcase`, `messages`, `report_id`, `fact`, `slug`, … |
| 3 | The project signal is a **store read**, not a new publisher | ✅ | `useAiContext()?.projectId` (`components/briefcase/use-ai-context.ts`), set by `ProjectAiContextBridge`; the pill reads the same store (`BriefcaseChat.tsx:51-52`) |
| 4 | The pill's body computation (the pattern to mirror) | ✅ | `BriefcaseChat.tsx:91-106` `getExtraBody` → `{context, project_id, pageContext: describePage(...), briefcase: briefcaseDigest(...)}` |
| 5 | The highlighter's converse client hard-codes `"outside"` | ✅ | `lib/highlighter/converse.ts:124` `context: "outside"` (inside the `:123` `body: JSON.stringify({` block), and sends **no** `project_id`/`pageContext`/`briefcase` |
| 6 | `use-converse` forwards the whole `ConverseInput` (no per-field plumbing) | ✅ | `lib/highlighter/use-converse.ts` `ask(input)` → `streamConverse(input, …)` |
| 7 | `pill-mount` does **not** suppress `/project/*` | ✅ | `lib/briefcase/pill-mount.ts` `shouldMountHighlighter` (highlighter already mounts on project pages today, as `context:"outside"`) |
| 8 | The coverage test only polices **report-context** publishers | ✅ | `lib/briefcase/page-mount-coverage.test.ts:100` "only /r/* pages publish a report context" — Layer 1 adds **no** publisher, so this stays green untouched |
| 9 | `app/project/layout.tsx` has no `key`, mounts no AI | ✅ | comment at top is a HARD GUARD; AI persists from root |
| 10 | Filing model: the briefcase is a **global anonymous tray** | ✅ | `BriefcaseProvider` (localStorage `DRAFT_KEY`); `fileItem` → tray. The pill, the highlighter, and `AddToProject` all file to the tray — **none** writes `projects.items` |
| 11 | **Edit route is moat-safe and takes NO prose** | ✅ | `/api/deliverables/[id]/edit` → `planDeliverableEdit` → `assembleDeliverable` (freeze → forced-tool narrative → lints). Only levers: `items`, `template`, `branding`, one-line `instruction` |
| 12 | **The deliverable is iframed** inside a project | ✅ | `DeliverableModal.tsx:109` `<iframe src="/p/[id]?r=…">`; `/p/*` is highlighter-suppressed. The deliverable narrative is **not** selectable parent-document text — Layer 2 must bridge it |

**Two findings reshaped the original plan:**

- **(12) killed "highlight the deliverable's prose inside the project."** The deliverable lives behind a
  same-origin iframe to a highlighter-suppressed `/p/` page. Layer 2 must capture selection from the iframe's
  `contentDocument`, not via the global `use-highlight` listener.
- **(11) killed "AI proposes replacement prose."** The edit route never accepts prose — the moat is structural.
  "AI proposes an edit" can only mean **AI proposes a one-line steer** (an `instruction`), confirmed → gated re-fork.

---

## 2. Layer 1 — PROJECT AI inside `/project/[id]`

### 2A. Grounding (the genuine net-new — pure client wiring, mirrors the pill)

The server already grounds on the project when the request carries `context:"project"` + `project_id`. The only gap
is that the highlighter's converse client never sends them. Thread four fields through the existing chain:

1. **`lib/highlighter/converse.ts`** — add to `ConverseInput` (all optional). Reference the **canonical** context type,
   don't re-declare a literal union (it would silently drift if `AssistantContext` gains a member):
   - at the top: `import type { AssistantContext } from "@/lib/assistant/contract";` (type-only → erased at compile,
     zero runtime/bundle coupling even though `contract.ts` carries a zod schema)
   - `context?: Exclude<AssistantContext, "public">` (the highlighter only ever sends `"project"`/`"outside"`, never
     the funnel's `"public"` — `AssistantContext` is `"project" | "outside" | "public"` at `contract.ts:10`)
   - `projectId?: string`
   - `pageContext?: unknown`
   - `briefcase?: unknown`

   In `streamConverse`'s POST body, replace the hard-coded `context: "outside"` (**line 124**, inside the `:123`
   `body: JSON.stringify({` block) with `context: input.context ?? "outside"`, and add `project_id: input.projectId`,
   `pageContext: input.pageContext`, `briefcase: input.briefcase` (JSON.stringify drops the `undefined` ones, so
   off-project requests are byte-identical to today).

2. **`lib/highlighter/use-converse.ts`** — no change (it forwards the whole `ConverseInput`).

3. **`components/highlighter/HighlightPopup.tsx`** — add the four fields to `PopupProps`; include them in the
   `ask({…})` payload (`:272-280`). The popup stays grounding-agnostic — it just relays what it's handed.

4. **`components/highlighter/GlobalHighlighter.tsx`** — compute the four fields from the same store the pill reads,
   mirroring `BriefcaseChat.getExtraBody` exactly.

   **Add these imports** (verbatim from `BriefcaseChat.tsx` lines 7, 8, 10, 11, 14 — none exist in
   `GlobalHighlighter.tsx` today; `usePathname` is already imported at line 3):
   ```ts
   import { useBriefcase } from "@/components/briefcase/BriefcaseProvider";
   import { useAiContext } from "@/components/briefcase/use-ai-context";
   import { describePage, projectPageContextForPath } from "@/lib/chat/page-context";
   import { briefcaseDigest } from "@/lib/briefcase/briefcase-digest";
   import { getAiContext } from "@/lib/project/ai-context-store";
   ```

   **Hook placement (INVARIANT — `react-hooks/set-state-in-effect` + hooks-before-return):** the early return is
   `if (!shouldMountHighlighter(pathname)) return null;` at **line 54**. Only the two new *hook calls* must go ABOVE
   line 54 (alongside the existing `useReportContext`/`useHighlight`/`useHighlighterContext`):
   ```ts
   const aiContext = useAiContext();          // hook — above line 54
   const briefcaseCtx = useBriefcase();       // hook — above line 54
   ```
   Everything else is plain (non-hook) and is derived BELOW line 54, in the render path, next to the existing
   `threadKey`:
   ```ts
   const projectId = aiContext?.projectId ?? null;
   const context = projectId ? "project" : "outside";
   // getAiContext() is the IMPERATIVE store snapshot (not the hook) — exactly how the pill calls it:
   const pageContext = describePage(pathname, projectPageContextForPath(pathname, getAiContext()));
   const briefcase = briefcaseDigest(briefcaseCtx?.draftItems ?? []);
   ```
   Pass `context` / `projectId` / `pageContext` / `briefcase` into `<HighlightPopup …>` (which relays them into `ask`).

   **Grounding precedence:** `/r/*` report grounding still wins where it applies (`reportCtx?.reportId`). The route
   sets don't overlap (`/r/*` vs `/project/[id]`), so inside a project `reportCtx` is null and `projectId` drives
   `context:"project"`. Do not send both `report_id` and `project_id` for the same ask.

### 2B. Thread bucket

Today `GlobalHighlighter` sets `threadKey = reportCtx?.reportId ?? "outside"`. Add project precedence:

```
threadKey = reportCtx?.reportId ?? projectId ?? "outside"
```

so an in-project conversation gets its own per-project bucket in `HighlighterProvider` instead of dumping into the
global `"outside"` thread. **Live-merging** the highlighter thread (`HighlighterProvider`, in-memory) with the pill's
thread (`useProjectThread`, localStorage) is **out of scope** — they are two separate stores by design; the shared
guarantee is filing, not the live thread.

### 2C. Filing — **F1: mirror the pill (tray filing)** — DECIDED

The highlighter already files via `briefcase?.fileItem(...)` → the global tray, exactly like the pill in every
context. **Layer 1 changes nothing here.** "Into the project" is satisfied by the tray→project commit the app already
uses. This keeps the twins identical and is zero net-new work. (Direct-into-`projects.items` filing is **F2**, a
deliberate follow-up — see §5.)

### 2D. Moat (unchanged — structural, server-side)

No client moat work. The four-lane / no-invention law (RULE 0.7) is enforced on output by the engine and (for edits)
by `gateNarrative`. The highlighter only changes *which context the answer grounds on*, never what's allowed.

### 2E. Invariants — what must NOT change

- `lib/highlighter/use-highlight.ts` — byte-identical (snap-to-word/number + breakpoint rules).
- `lib/highlighter/position.ts` — popup positioning.
- `lib/briefcase/page-mount-coverage.test.ts` — stays green **untouched** (no new report-context publisher; finding #8).
- `app/project/layout.tsx` — no `key`, no AI mount (finding #9).
- `/r/*` and off-everything behavior — unchanged (off-project still `context:"outside"`; the JSON body is identical
  when the four fields are `undefined`).
- Exactly one pill + one highlighter on every page except the suppressed set.

### 2F. Files touched (Layer 1)

- `lib/highlighter/converse.ts` — `ConverseInput` fields (incl. `import type { AssistantContext }`) + body.
- `components/highlighter/HighlightPopup.tsx` — `PopupProps` + `ask()` payload (relay the four fields).
- `components/highlighter/GlobalHighlighter.tsx` — **5 new imports** (see §2A step 4) + 2 new hook calls above line 54
  + the derived `context`/`projectId`/`pageContext`/`briefcase` below it; `threadKey` precedence.
- `lib/highlighter/converse.test.ts` — assert the project body is sent when fields are present, and omitted when absent
  (fits the existing fetch-stub inject pattern).
- (No server, no new component, no new route, no schema change.)

### 2G. Verification bar (Layer 1)

- `bun test` (incl. `page-mount-coverage.test.ts` green untouched + the converse-body assertion) + `bunx next build`
  (the real gate; clean `tsc` is not enough — see `feedback_verify-with-next-build-not-npx-tsc`) + eslint clean
  (watch `react-hooks/set-state-in-effect`).
- **Manual (the real proof):** inside `/project/[id]`, select text → the answer **grounds on the OPEN project**
  (cites project data / an uploaded doc) → "File this answer" increments the tray badge → `/r/*` selections still
  report-grounded → off-everything still answers as OUTSIDE AI.
- **⚠ ANSWER-FIX-PROOF GATE (don't overlook — it hard-blocks the push):** this touches the answer path, so
  `.claude/hooks/...` requires a live, non-deflecting, leak-free proof line in `verification/answer-proofs.jsonl`
  captured from a real PROJECT-AI grounded answer. No proof line → no push (see `project_answer-fix-proof-hook`).
- Pre-push: touches the assistant client → diff review (RULE 1) + `SESSION_LOG.md` entry + `node scripts/safe-push.mjs`.

---

## 3. Architecture (both layers, for reference)

```
ROOT app/layout.tsx — mounts GlobalHighlighter + the pill; both read useAiContext()

LAYER 1  (build now)  — PROJECT AI everywhere inside /project/[id]
  GlobalHighlighter reads useAiContext().projectId
   → popup sends context:"project" + project_id + pageContext + briefcase  (mirror the pill)
   → server already grounds on the project; File → tray (F1)
  Net-new = client wiring only (converse.ts → use-converse → HighlightPopup → GlobalHighlighter)

LAYER 2  (build after L1) — in-deliverable select-to-edit
  DeliverableModal attaches a selection listener to the SAME-ORIGIN iframe contentDocument
  (no /p changes; owner-only by construction — the modal only exists in the authed workspace)
   → selection → popup over the iframe, two verbs:
       ASK  = converse about the span (PROJECT-grounded; reuses the Layer-1 converse path)
       EDIT = AI-proposed one-line steer(s) + free box → Confirm
   → Confirm → POST /api/deliverables/[id]/edit { instruction } → gated re-fork
   → existing DeliverableLanes.handleEdit swaps the modal to the new version
```

---

## 4. Out of scope (Layer 1)

- Editing the deliverable from the highlighter (that is all of Layer 2).
- Live-merging the highlighter thread with the pill thread.
- Any server / route / schema change.
- Option 3 from the brainstorm ("highlight project-side text to steer a rebuild") — **dropped** as redundant with
  Layer 2's direct select-to-edit.

---

## 5. Follow-up: **F2 — file directly into the open project** (deferred)

When a project is open, a "File" should also write the item into `projects.items` (via read-modify-write
`PATCH /api/projects/[id]`) so it appears in the workspace immediately, instead of only the anonymous tray. Deferred
because it must change **both** the pill and the highlighter together (otherwise the twins diverge), and adds a server
round-trip + optimistic update. Track as its own check/brief; do not bolt it onto Layer 1.

---

## 6. LAYER 2 HAND-OFF (for the next Claude — plan now, build after Layer 1 merges)

You have everything you need to PLAN Layer 2 from this section. **Do not BUILD until Layer 1 is on `main`** — Layer 2
edits the same `HighlightPopup` / converse surface (RULE 1.5 parallel-session tangle). Brainstorm the edit popup
(RULE 3.5) before building; probe-first (RULE 0.5) — re-open the files below, don't trust this summary blindly.

### 6.1 The interface Layer 1 leaves behind (what you build on)

- **`ConverseInput`** (`lib/highlighter/converse.ts`) now carries `context` / `projectId` / `pageContext` /
  `briefcase`. Your in-deliverable "Ask" verb passes these → the answer grounds on the project for free.
- **`HighlightPopup`** props now include those four. You can reuse the popup (or a sibling) for the in-deliverable
  surface and it will ground on the project by passing the fields.
- **`GlobalHighlighter`** holds the canonical "compute project fields from `useAiContext()`" code. Mirror it in
  `DeliverableModal` (or extract a shared helper *if* duplication bites — don't pre-abstract).
- Filing is still tray-based (F1). Your **EDIT** verb does **not** file — it POSTs to the edit route.

### 6.2 Layer 2 design direction (decided in brainstorm)

Chosen: **Option A + on-demand conversation.** The in-deliverable popup is one surface with two verbs on the span:
- **EDIT (fast path):** 2–3 AI-proposed one-line steers contextual to the selected span + a type-your-own box →
  Confirm → re-fork. The AI proposes a **steer/`instruction`, never replacement prose** (finding #11).
- **ASK (talk it out):** the popup's existing converse chat, PROJECT-grounded, with a "Rebuild with this steer" CTA
  when the user has talked themselves to the change.

### 6.3 Layer 2 probe findings (already gathered — verify, then extend)

- **Selection capture:** the deliverable is `<iframe src="/p/[id]">` in `DeliverableModal.tsx:109`; `/p/*` suppresses
  the highlighter. The iframe is **same-origin** (both `swfldatagulf.com`), so the parent CAN read
  `iframe.contentDocument` / `contentWindow.getSelection()`. Cleanest path: `DeliverableModal` attaches a
  `mouseup`/`selectionchange` listener to the iframe's `contentDocument` and renders a popup in the parent.
  **No `/p` changes needed, owner-only by construction** (the modal only renders in the authed workspace; public
  `/p` viewers never get this).
- **⚠ Coordinate transform (non-obvious — don't burn time on it):** `range.getBoundingClientRect()` taken inside the
  iframe's `contentDocument` is relative to the **iframe's own viewport** (it already accounts for the iframe's
  internal scroll), NOT the parent window. To place a parent-rendered popup, add the iframe element's offset:
  ```
  const ir = iframe.getBoundingClientRect();      // iframe position in the PARENT viewport
  const sr = range.getBoundingClientRect();        // selection rect in the IFRAME viewport
  parentX = ir.left + sr.left;
  parentY = ir.top  + sr.top;
  ```
  Edge case: if the iframe **content** scrolls after you position the popup, `sr` goes stale → the popup drifts.
  Recompute on the iframe's `scroll` event, or close the popup on scroll. (Reuse `lib/highlighter/position.ts`'s
  clamp-to-viewport logic for the final placement once you have `parentX/parentY`.)
- **Edit execution:** `POST /api/deliverables/[id]/edit` with `{ instruction }` → `planDeliverableEdit` classifies it
  `content` → `assembleDeliverable` (freeze → forced-tool narrative → lints) → returns `{ id: newId, inPlace: false }`.
- **Version swap:** `DeliverableLanes.handleEdit` (`:135`) already swaps the open modal to the new forked version
  (optimistic shell + `reloadNonce`). Wire your confirm through the existing `onEdit` prop, don't reinvent it.
- **Moat / boundary:** never send prose; the public `/p` link stays frozen (a content edit forks a NEW id, old
  `/p/[id]` untouched); the edit route is cookie-authed + ownership-checked server-side regardless.
- **Existing edit UI to stay consistent with:** `DeliverableEditPanel.tsx` (items + template + brand + one-line steer
  → same route). Your highlighter steer is a faster, span-anchored entry to the *same* route — don't fork the edit path.

### 6.4 Build-order constraint

Layer 1 → merge → THEN Layer 2. If you must work in parallel, isolate Layer 2 in a worktree (RULE 1.5) and rebase
after Layer 1 lands; expect to reconcile `HighlightPopup` / `converse.ts`.

---

## 7. Status / tracking

- Layer 1: ready for implementation plan (`superpowers:writing-plans`).
- Layer 2: this spec is its planning input; open a check when Layer 1 merges.
- F2 (direct project filing): deferred follow-up (§5).
