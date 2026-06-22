# Project Highlighter Phase 2 — Layer 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** ⚡ Sonnet — keywords: schema, architecture

**Goal:** Make the app-root Highlighter ground on the OPEN project when the user is inside `/project/[id]` — it sends `context:"project"` + `project_id` + `pageContext` + `briefcase` to `/api/assistant` (which already grounds on the project server-side), instead of always saying `context:"outside"`.

**Architecture:** Pure client wiring, mirroring the pill (`BriefcaseChat.getExtraBody`). Thread four optional fields through the existing converse chain: `GlobalHighlighter` computes them from the `useAiContext()` store → `HighlightPopup` relays them → `streamConverse` puts them in the POST body. No server, route, schema, or new-component change. Filing stays tray-based (decision F1). Layer 2 (in-deliverable editing) is a separate plan.

**Tech Stack:** Next.js App Router (React 19, client components), TypeScript, Bun test runner.

**Spec:** `docs/superpowers/specs/2026-06-22-project-highlighter-phase2-design.md` (§2 is Layer 1).

## Global Constraints

- **Mirror the pill exactly.** The canonical pattern is `components/briefcase/BriefcaseChat.tsx:91-106` (`getExtraBody`). Field names are the `AssistantRequest` contract (`lib/assistant/contract.ts`): `context`, `report_id`, `project_id`, `pageContext`, `briefcase`, `messages`. `project_id` is snake_case; `pageContext` is camelCase — copy them verbatim.
- **Tests run on Bun:** `bun test <path>`. The converse engine is the only unit-tested unit; the React components are gated by build + lint + the manual proof.
- **`bunx next build` is the real type gate** — a clean `tsc` is NOT sufficient (see memory `feedback_verify-with-next-build-not-npx-tsc`; a `next build` TS error has reddened prod past a green `tsc`). Run it before declaring done.
- **`react-hooks/set-state-in-effect` is a HARD eslint error.** Do not add any `useEffect` that calls `setState`. This plan adds no effects — keep it that way.
- **Hooks before the early return.** `GlobalHighlighter`'s only early return is `if (!shouldMountHighlighter(pathname)) return null;` at **line 54**. Every hook call (incl. the two new ones) goes ABOVE it; plain derivations go below.
- **INVARIANTS — do not touch:** `lib/highlighter/use-highlight.ts` (selection/snap/breakpoint, byte-identical), `lib/highlighter/position.ts`. `lib/briefcase/page-mount-coverage.test.ts` must stay green **untouched** (Layer 1 adds no report-context publisher).
- **Off-project must stay byte-identical.** When the four fields are absent, `JSON.stringify` drops the `undefined` keys and `context` falls back to `"outside"` — every existing converse test must still pass.
- **Staging:** stage explicit paths only — never `git add -A` (RULE 1.5 parallel-session isolation; there is other in-progress work in the tree).
- **Push is operator-gated.** Do NOT `git push`. End at "ready to push." The pre-push hook runs the gates; the operator triggers the push.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/highlighter/converse.ts` | modify | The framework-free engine. Add 4 optional fields to `ConverseInput`; put them in the POST body. |
| `lib/highlighter/converse.test.ts` | modify | Add one test asserting the project body is sent when present / omitted when absent. |
| `components/highlighter/HighlightPopup.tsx` | modify | Accept the 4 fields as props; relay them into the `ask({…})` call. |
| `components/highlighter/GlobalHighlighter.tsx` | modify | Compute the 4 fields from `useAiContext()` + `useBriefcase()` (mirror the pill); pass to the popup; project-precedence `threadKey`. |

Build order: **Task 1 (engine) → Task 2 (popup relay) → Task 3 (root compute) → Task 4 (verify + proof)**. Each consumes the prior task's new names.

---

## Task 1: Thread project context through the converse engine

**Files:**
- Modify: `lib/highlighter/converse.ts` (`ConverseInput` ~`:11-36`; POST body `:123-132`)
- Test: `lib/highlighter/converse.test.ts`

**Interfaces:**
- Consumes: `AssistantContext` from `lib/assistant/contract.ts` (`"project" | "outside" | "public"`, exported at `:10`).
- Produces: `ConverseInput` gains optional `context?: Exclude<AssistantContext, "public">`, `projectId?: string`, `pageContext?: string`, `briefcase?: string`. `streamConverse` sends them as `context` / `project_id` / `pageContext` / `briefcase`.

- [ ] **Step 1: Write the failing test** — append to `lib/highlighter/converse.test.ts`:

```ts
test("sends project context (context/project_id/pageContext/briefcase) when provided, omits them off-project", async () => {
  type Body = { context?: string; project_id?: string; pageContext?: string; briefcase?: string };

  // PROJECT context — all four fields ride the body.
  const inProject: { body?: Body } = {};
  const projFetch = (async (_url: string, init: RequestInit) => {
    inProject.body = JSON.parse(init.body as string) as Body;
    return { ok: true, status: 200, body: streamOf([`data: {"done":true,"reach":[]}\n\n`]) };
  }) as unknown as typeof fetch;
  await streamConverse(
    {
      question: "how does this project look?",
      context: "project",
      projectId: "proj-123",
      pageContext: 'their project "Cape Coral CRE"',
      briefcase: "The user has already saved these…",
    },
    collector().handlers,
    projFetch,
  );
  expect(inProject.body?.context).toBe("project");
  expect(inProject.body?.project_id).toBe("proj-123");
  expect(inProject.body?.pageContext).toBe('their project "Cape Coral CRE"');
  expect(inProject.body?.briefcase).toBe("The user has already saved these…");

  // No project fields → context defaults to "outside" and the keys are ABSENT (not null).
  const off: { body?: Body } = {};
  const offFetch = (async (_url: string, init: RequestInit) => {
    off.body = JSON.parse(init.body as string) as Body;
    return { ok: true, status: 200, body: streamOf([`data: {"done":true,"reach":[]}\n\n`]) };
  }) as unknown as typeof fetch;
  await streamConverse({ question: "general q" }, collector().handlers, offFetch);
  expect(off.body?.context).toBe("outside");
  expect("project_id" in (off.body ?? {})).toBe(false);
  expect("pageContext" in (off.body ?? {})).toBe(false);
  expect("briefcase" in (off.body ?? {})).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test lib/highlighter/converse.test.ts`
Expected: the new test FAILS — `context` is the hard-coded `"outside"` (not `"project"`), and `project_id`/`pageContext`/`briefcase` are not in the body. (Also: `context: "project"` is a TS error against the unextended `ConverseInput` — the type change in Step 3 is what makes the test compile.)

- [ ] **Step 3: Implement** — in `lib/highlighter/converse.ts`:

(a) Add the type import directly under the existing `import { parseSSEFrames } from "./sse";` (line 9):

```ts
import type { AssistantContext } from "@/lib/assistant/contract";
```

(b) Add the four optional fields to `ConverseInput`, immediately before `question: string;` (the last member, ~line 35):

```ts
  /** Assistant context. "project" inside an open project (the engine grounds on the project
   *  digest server-side), else "outside". Never "public" — that is the funnel/welcome voice. */
  context?: Exclude<AssistantContext, "public">;
  /** The open project's id → the engine's cookie-authed cross-project read. Undefined off a project. */
  projectId?: string;
  /** Plain-English "where the user is" + open-project summary (the `describePage` output). */
  pageContext?: string;
  /** Short customer-clean digest of what's filed (the `briefcaseDigest` output). */
  briefcase?: string;
```

(c) In `streamConverse`'s POST body (the `JSON.stringify({ … })` at line 123), change the hard-coded
`context: "outside"` line and insert the three new keys right after `report_id`:

```ts
      body: JSON.stringify({
        context: input.context ?? "outside",
        report_id: input.reportId,
        project_id: input.projectId,
        pageContext: input.pageContext,
        briefcase: input.briefcase,
        fact: input.fact,
        slug: input.slug,
        selection_type: input.selectionType,
        is_realtime: input.isRealtime,
        from_chip: input.fromChip,
        messages: [{ role: "user", content: question }],
      }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/highlighter/converse.test.ts`
Expected: PASS — the new test plus all existing converse tests (the off-project tests still see `context:"outside"` and no extra keys).

- [ ] **Step 5: Commit**

```bash
git add lib/highlighter/converse.ts lib/highlighter/converse.test.ts
git commit -m "feat(highlighter): converse engine threads project context to /api/assistant"
```

---

## Task 2: Relay the project fields through `HighlightPopup`

**Files:**
- Modify: `components/highlighter/HighlightPopup.tsx` (`PopupProps` `:32-53`; function params `:61-70`; `ask({…})` `:272-280`)

**Interfaces:**
- Consumes: the four `ConverseInput` fields from Task 1.
- Produces: `PopupProps` gains optional `context` / `projectId` / `pageContext` / `briefcase`; the popup forwards them into `ask(...)`. (`GlobalHighlighter` in Task 3 supplies them.)

- [ ] **Step 1: Add the type import** — under the existing imports at the top of `HighlightPopup.tsx` (e.g. after the `ChartSpec` import at line 14):

```ts
import type { AssistantContext } from "@/lib/assistant/contract";
```

- [ ] **Step 2: Add the four props to `PopupProps`** — insert immediately before `onClose: () => void;` (line 52):

```ts
  /** Assistant grounding for the converse call — computed by GlobalHighlighter from the
   *  project-context store (mirrors the pill's getExtraBody). Undefined off a project. */
  context?: Exclude<AssistantContext, "public">;
  projectId?: string;
  pageContext?: string;
  briefcase?: string;
```

- [ ] **Step 3: Destructure the new props** — in the `HighlightPopup({ … })` parameter list (lines 61-70), add them alongside the existing destructured props (before `onClose`):

```ts
export function HighlightPopup({
  reportId,
  threadKey,
  fact,
  suggestions,
  fileableMetric,
  conclusion,
  freshnessToken,
  context,
  projectId,
  pageContext,
  briefcase,
  onClose,
}: PopupProps) {
```

- [ ] **Step 4: Relay them into the `ask({…})` call** — in `submit()` (lines 272-280), add the four fields to the object passed to `ask`:

```ts
    void ask({
      reportId,
      context,
      projectId,
      pageContext,
      briefcase,
      fact: factWithContext,
      slug: fact.slug,
      selectionType: deriveSelectionType(fact),
      fromChip: opts?.fromChip ?? false,
      isRealtime: opts?.isRealtime ?? false,
      question: trimmed + priorContext,
    });
```

- [ ] **Step 5: Typecheck the change**

Run: `bunx tsc --noEmit`
Expected: no new errors involving `HighlightPopup` / `ConverseInput` (the props now flow cleanly into `ask`). (Pre-existing baseline errors elsewhere, if any, are unrelated — the gate that matters is `next build` in Task 4.)

- [ ] **Step 6: Commit**

```bash
git add components/highlighter/HighlightPopup.tsx
git commit -m "feat(highlighter): HighlightPopup relays project context into the ask() call"
```

---

## Task 3: Compute the project fields in `GlobalHighlighter` and pass them down

**Files:**
- Modify: `components/highlighter/GlobalHighlighter.tsx` (imports `:1-14`; hooks `:35-44`; early return `:54`; `threadKey` `:60`; `<HighlightPopup>` `:64-78`)

**Interfaces:**
- Consumes: the `PopupProps` fields from Task 2; `useAiContext` / `useBriefcase` / `describePage` / `projectPageContextForPath` / `briefcaseDigest` / `getAiContext` (mirroring `BriefcaseChat`).
- Produces: nothing downstream (this is the leaf wiring).

- [ ] **Step 1: Add the five imports** — at the top of `GlobalHighlighter.tsx`, after the existing `import { DiscoveryTicker } from "./DiscoveryTicker";` (line 14). These are verbatim from `BriefcaseChat.tsx` (lines 7, 8, 10, 11, 14); none exist in this file yet:

```ts
import { useBriefcase } from "@/components/briefcase/BriefcaseProvider";
import { useAiContext } from "@/components/briefcase/use-ai-context";
import { describePage, projectPageContextForPath } from "@/lib/chat/page-context";
import { briefcaseDigest } from "@/lib/briefcase/briefcase-digest";
import { getAiContext } from "@/lib/project/ai-context-store";
```

- [ ] **Step 2: Add the two new hook calls ABOVE the early return** — directly after `const setChipFact = hctx?.setChipFact ?? null;` (line 42), still above the `if (!shouldMountHighlighter(pathname)) return null;` at line 54:

```ts
  // Project signal — the SAME store the pill reads (useAiContext). Hooks must stay above
  // the only early return (line 54). Both subscribe, so the popup's grounding stays current
  // when the active project or the briefcase changes while the popup is open.
  const aiContext = useAiContext();
  const briefcaseCtx = useBriefcase();
```

- [ ] **Step 3: Derive the four fields + project-precedence threadKey BELOW the early return** — replace the existing `threadKey` line (line 60):

```ts
  const threadKey = reportCtx?.reportId ?? "outside";
```

with:

```ts
  const projectId = aiContext?.projectId ?? null;
  // Off-report selections share ONE bucket; /r/* keeps per-report threads; inside a project,
  // its own per-project bucket. This is the conversation-thread key, NOT a grounding id.
  const threadKey = reportCtx?.reportId ?? projectId ?? "outside";
  // PROJECT AI when a project is open, else OUTSIDE — never the public funnel voice. Mirrors
  // the pill's getExtraBody (BriefcaseChat.tsx:91-106): getAiContext() is the IMPERATIVE store
  // snapshot used inside pageContext (not the hook); describePage/briefcaseDigest are pure.
  const assistantContext = projectId ? ("project" as const) : ("outside" as const);
  const pageContext = describePage(pathname, projectPageContextForPath(pathname, getAiContext()));
  const briefcaseText = briefcaseDigest(briefcaseCtx?.draftItems ?? []);
```

- [ ] **Step 4: Pass the four fields into `<HighlightPopup>`** — add them to the props (lines 64-78), after `threadKey={threadKey}`:

```tsx
        <HighlightPopup
          reportId={reportCtx?.reportId}
          threadKey={threadKey}
          context={assistantContext}
          projectId={projectId ?? undefined}
          pageContext={pageContext}
          briefcase={briefcaseText}
          fact={fact}
          suggestions={fact.mode === "section" ? [] : resolveSuggestions(fact, carried)}
          fileableMetric={fact.mode === "section" ? null : resolveMetric(fact, carried)}
          conclusion={reportCtx?.conclusion}
          freshnessToken={reportCtx?.freshnessToken}
          onClose={close}
        />
```

- [ ] **Step 5: Typecheck + lint the change**

Run: `bunx tsc --noEmit && bunx eslint components/highlighter/GlobalHighlighter.tsx`
Expected: no type errors; eslint clean — specifically **zero** `react-hooks/rules-of-hooks` (hooks are above line 54) and **zero** `react-hooks/set-state-in-effect` (no effect was added).

- [ ] **Step 6: Commit**

```bash
git add components/highlighter/GlobalHighlighter.tsx
git commit -m "feat(highlighter): GlobalHighlighter grounds on the open project inside /project/[id]"
```

---

## Task 4: Full verification + live PROJECT-AI proof + session log

**Files:**
- Modify: `SESSION_LOG.md` (top-of-file entry)
- Append: `verification/answer-proofs.jsonl` (one live proof line — produced by the proof tool, not hand-written)

**Interfaces:**
- Consumes: the completed wiring from Tasks 1-3.
- Produces: a green test/build/lint run and a captured live proof so the pre-push gate passes.

- [ ] **Step 1: Run the full relevant test suite**

Run: `bun test lib/highlighter/ lib/briefcase/page-mount-coverage.test.ts`
Expected: ALL pass. The coverage test passes **untouched** (Layer 1 added no report-context publisher).

- [ ] **Step 2: Run the real type gate**

Run: `bunx next build`
Expected: exit 0. (If it fails, read the actual Vercel-equivalent error from the build log — do not guess; see `feedback_verify-with-next-build-not-npx-tsc`.)

- [ ] **Step 3: Lint the three touched files**

Run: `bunx eslint lib/highlighter/converse.ts components/highlighter/HighlightPopup.tsx components/highlighter/GlobalHighlighter.tsx`
Expected: clean.

- [ ] **Step 4: Capture a LIVE PROJECT-AI grounded proof (the answer-fix-proof gate)**

This touches the answer path, so `.claude/hooks/check-prepush-gate.mjs` / the answer-proof hook will block the push without a fresh, non-deflecting, leak-free proof line in `verification/answer-proofs.jsonl` (see memory `project_answer-fix-proof-hook`).

- First read the hook to learn the exact required format/command: open `.claude/hooks/` (the answer-proof check) and `package.json` scripts for the `prove-*` tool Phase 1 used (e.g. a `scripts/prove-*.mts`).
- Run that proof tool against the PROJECT path — a selection inside `/project/[id]` that sends `context:"project"` + a real `project_id`. The captured answer MUST: (a) be grounded on the open project (reference project/filed/uploaded data), (b) NOT deflect ("I can't…"), (c) contain no raw freshness token / internal-id leak.
- Confirm the new proof line is appended to `verification/answer-proofs.jsonl`.

Expected: one new proof line; re-running the answer-proof check reports PASS.

- [ ] **Step 5: Write the SESSION_LOG.md entry** — prepend a newest-first entry (RULE 0):

```markdown
## 2026-06-22 (main) — Project Highlighter Phase 2 · Layer 1 (highlighter grounds on the open project) [LOCAL]

The app-root Highlighter now speaks as PROJECT AI inside /project/[id]: it sends context:"project" + project_id + pageContext + briefcase to /api/assistant (which already grounds server-side), mirroring the pill's getExtraBody. Pure client wiring, no server/route/schema change.
- **lib/highlighter/converse.ts:** ConverseInput gains context/projectId/pageContext/briefcase; streamConverse sends them (context defaults to "outside" → off-project body byte-identical). New converse.test.ts case (present→sent, absent→omitted).
- **HighlightPopup.tsx:** 4 new props relayed into ask().
- **GlobalHighlighter.tsx:** computes the 4 from useAiContext()+useBriefcase() (hooks above the line-54 return); project-precedence threadKey (reportId ?? projectId ?? "outside").
- Filing stays tray-based (F1). Layer 2 (in-deliverable edit) is its own plan. F2 (direct projects.items filing) deferred.
- **Gates:** bun test green (incl. page-mount-coverage untouched); bunx next build exit 0; eslint clean; live PROJECT-AI proof captured.
- Spec: docs/superpowers/specs/2026-06-22-project-highlighter-phase2-design.md. Plan: docs/superpowers/plans/2026-06-22-project-highlighter-phase2-layer1.md.
- **Prod verify after deploy:** inside /project/[id], select text → answer grounds on the OPEN project (cites project/uploaded data); /r/* unchanged; off-everything still OUTSIDE AI.
```

- [ ] **Step 6: Commit the log + proof**

```bash
git add SESSION_LOG.md verification/answer-proofs.jsonl
git commit -m "log: Project Highlighter Phase 2 Layer 1 — highlighter grounds on the open project"
```

- [ ] **Step 7: STOP — hand to the operator for diff review + push**

Do NOT push (touches the assistant client → RULE 1 diff review; no-autonomous-push). Report: branch state, the 4 commits, and that `node scripts/safe-push.mjs` is ready when the operator approves. The pre-push hooks (session-log, answer-proof, gates) will run on their push.

---

## Self-Review

**Spec coverage (§2 of the design):**
- §2A grounding (4 fields threaded converse→popup→root) → Tasks 1-3. ✅
- §2B threadKey project precedence → Task 3 Step 3. ✅
- §2C filing F1 (mirror the pill, no change) → no task needed (already files via `fileItem`); stated in the log. ✅
- §2E invariants (use-highlight untouched, coverage test green untouched, hooks-above-return) → Global Constraints + Task 3 Step 2/5 + Task 4 Step 1. ✅
- §2F files touched → matches the File Structure table exactly. ✅
- §2G verification (bun test, next build, eslint, answer-proof) → Task 4. ✅

**Placeholder scan:** every code step shows complete code; the only "go read it" step is Task 4 Step 4 (the answer-proof tool), which is a real, hook-enforced mechanism the executor must use as-is, not a code placeholder. ✅

**Type consistency:** `context?: Exclude<AssistantContext, "public">` is identical across `ConverseInput` (Task 1) and `PopupProps` (Task 2); `projectId?: string` consistent; `pageContext?: string` / `briefcase?: string` match `describePage`/`briefcaseDigest` return types; the body field names (`project_id`, `pageContext`, `briefcase`) match `lib/assistant/contract.ts`. ✅
