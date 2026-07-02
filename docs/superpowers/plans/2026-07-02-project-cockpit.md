# Project Cockpit (ready-for-you week) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** 🧠 Opus — 10 tasks, 28 files, keywords: schema, architecture, breaking

**Spec:** `docs/superpowers/specs/2026-07-02-project-cockpit-design.md` (rev 2)
**Check:** `project_cockpit_live_verify` (already open)

**Goal:** Opening a project lands on a ready-for-you week — this week's email + social posts already generated from lake data — under an Overview · Email · Social tool switcher, with the grid canvas as the default email editor and the standalone labs redirecting signed-in users into their project.

**Architecture:** Promotion, not construction. The week generates server-side through the existing build roots (`buildContentDoc` for the email, `buildWeek` for socials), persists as ordinary `deliverables` materials plus a `ui_state.this_week` pointer bag (no new table — probe confirmed `/api/email-lab/social-calendar` writes nothing). A nested `app/project/[id]/layout.tsx` adds the tool switcher without remounting the rail/AI. Both email shells gain `onDocChange` so the canvas toggle can detect in-flight edits; the grid shell gains `initialAiPrompt`/`autoGenerate` mirroring the block shell.

**Tech Stack:** Next.js App Router (RSC + client components), Supabase (cookie client for owner-RLS reads/writes, service-role only where `deliverables` lacks owner INSERT), bun test for unit tests, `bunx next build` as the type/build gate.

## Global Constraints

- Verify with `bunx next build`, NEVER bare `npx tsc` (local tsc ≠ Vercel).
- Unit tests run with `bun test <path>`.
- Heights: `h-full` / `dvh`, never `h-screen`.
- `projects.ui_state` is an ADDITIVE key bag — new keys only, never repurpose one (`app/project/[id]/workspace/types.ts:79-95`).
- `deliverables` has public SELECT and NO owner INSERT/UPDATE policy — prove ownership on `projects` via the cookie client FIRST, then write via service-role (pattern: `app/api/projects/[id]/materials/route.ts`).
- `applyBrand` lives in the `"use client"` module `components/email-lab/EmailLabShell.tsx:93` — NEVER import it into a route handler. Server-generated docs are saved unbranded; brand applies client-side on load (established pattern, see `docs/superpowers/specs/2026-06-28-social-calendar-lab-PLAN.md:36`).
- No system nouns in user-facing copy (no "master", "brain", pack ids, "§").
- Never invent a number — generation goes through `buildContentDoc`/`buildWeek`, which enforce the four lanes. This plan adds NO new narrative-producing code.
- Git: stage explicit paths only (never `git add -A`); commit per task; **do NOT push** — the operator confirms pushes. SESSION_LOG entry comes with the final (pre-push) step.
- `react-hooks/set-state-in-effect` is a hard ESLint error — no synchronous setState in effects; async fetch-then-set is fine.
- The schedulers are paused platform-wide (cron blocks commented out in `email-scheduler.yml`/`social-scheduler.yml`). All schedule confirmations added by this plan say "Queued — sending activates at launch." (exit criterion #1).
- Scheduled/social vocabulary: the 5 publishable platforms are `x, facebook, instagram, linkedin, google_business` (`app/api/social/schedule/route.ts:34-40`).

## Interfaces produced by this plan (cross-task contract)

```ts
// lib/project/this-week.ts (Task 1)
export type QueueItemState = "pending" | "approved" | "skipped" | "scheduled";
export interface ThisWeekEmail { did: string; state: QueueItemState }
export interface ThisWeekSocial {
  day: "mon" | "tue" | "wed" | "thu" | "fri";
  did: string; theme: string; caption: string; hashtags: string[]; state: QueueItemState;
}
export interface ThisWeekState {
  week_of: string; generated_at: string;
  email: ThisWeekEmail | null; social: ThisWeekSocial[];
  errors?: { email?: boolean; social?: boolean };
}
export function weekIsCurrent(week: ThisWeekState | null | undefined, monday: string): boolean
export function missingSides(week: ThisWeekState | null | undefined): { email: boolean; social: boolean }
export const DAY_OF_WEEK: Record<ThisWeekSocial["day"], number> // mon=1..fri=5

// lib/project/tool-tabs.ts (Task 2)
export type ProjectTool = "overview" | "email" | "social";
export function activeTool(pathname: string, id: string): ProjectTool

// lib/email/doc/grid-layouts.ts (Task 3)
export function hasGridLayouts(doc: EmailDoc): boolean
export function ensureGridLayouts(doc: EmailDoc, heights?: Partial<Record<BlockType, number>>): EmailDoc

// lib/email/lab/canvas-pref.ts (Task 4)
export type EmailCanvas = "grid" | "block";
export type SwitchChoice = "save" | "discard" | "cancel";
export function emailCanvasPref(uiState: { email_canvas?: unknown } | null | undefined): EmailCanvas
export function nextCanvasAfterChoice(current: EmailCanvas, choice: SwitchChoice): EmailCanvas

// lib/project/lab-redirect.ts (Task 9)
export function labDestination(projects: { id: string }[]): string | null

// Shell prop additions (Task 3), both shells:
//   onDocChange?: (doc: EmailDoc) => void
// Grid shell only (mirrors block shell):
//   initialAiPrompt?: string; autoGenerate?: boolean

// POST /api/projects/[id]/week (Task 6)
//   body: { force?: boolean } → { week: ThisWeekState, cached?: boolean } | { error }
// POST /api/projects/[id]/track (Task 8)
//   body: { event: "week_schedule_all", approved: number, skipped: number } → { ok: true }
```

---

### Task 1: This-week domain types + guards

**Files:**
- Create: `lib/project/this-week.ts`
- Test: `lib/project/this-week.test.ts`
- Modify: `app/project/[id]/workspace/types.ts` (ProjectUiState — two additive keys)

**Interfaces:**
- Consumes: `CalendarDay` from `@/lib/email/social-calendar/types`.
- Produces: everything under `lib/project/this-week.ts` in the contract block above; `ProjectUiState.this_week?: ThisWeekState` and `ProjectUiState.email_canvas?: "grid" | "block"`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/project/this-week.test.ts
import { describe, expect, test } from "bun:test";
import {
  DAY_OF_WEEK,
  missingSides,
  weekIsCurrent,
  type ThisWeekState,
} from "./this-week";

const week: ThisWeekState = {
  week_of: "2026-06-29",
  generated_at: "2026-06-29T12:00:00.000Z",
  email: { did: "d1", state: "pending" },
  social: [
    { day: "mon", did: "d2", theme: "Market Monday", caption: "c", hashtags: [], state: "pending" },
  ],
};

describe("weekIsCurrent (once-per-week guard)", () => {
  test("true only when week_of matches the given Monday", () => {
    expect(weekIsCurrent(week, "2026-06-29")).toBe(true);
    expect(weekIsCurrent(week, "2026-07-06")).toBe(false);
  });
  test("false for null/undefined", () => {
    expect(weekIsCurrent(null, "2026-06-29")).toBe(false);
    expect(weekIsCurrent(undefined, "2026-06-29")).toBe(false);
  });
});

describe("missingSides (partial-failure retry)", () => {
  test("nothing generated yet → both missing", () => {
    expect(missingSides(null)).toEqual({ email: true, social: true });
  });
  test("full week → nothing missing", () => {
    expect(missingSides(week)).toEqual({ email: false, social: false });
  });
  test("email failed (null) → only email missing", () => {
    expect(missingSides({ ...week, email: null })).toEqual({ email: true, social: false });
  });
  test("social failed (empty) → only social missing", () => {
    expect(missingSides({ ...week, social: [] })).toEqual({ email: false, social: true });
  });
});

describe("DAY_OF_WEEK", () => {
  test("maps mon..fri to 1..5 (Sun=0 convention)", () => {
    expect(DAY_OF_WEEK).toEqual({ mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/project/this-week.test.ts`
Expected: FAIL — `Cannot find module './this-week'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/project/this-week.ts
//
// The ready-for-you week (project cockpit D0). Queue items are ordinary
// `deliverables` materials; this module is the ui_state.this_week pointer bag
// that ties them to a week + approval state. No new table — probe 07/02/2026
// confirmed /api/email-lab/social-calendar persists nothing, so the week's
// docs are saved through the materials endpoints and referenced by `did`.
import type { CalendarDay } from "@/lib/email/social-calendar/types";

export type QueueItemState = "pending" | "approved" | "skipped" | "scheduled";

export interface ThisWeekEmail {
  did: string;
  state: QueueItemState;
}

export interface ThisWeekSocial {
  day: CalendarDay;
  did: string;
  theme: string;
  caption: string;
  hashtags: string[];
  state: QueueItemState;
}

export interface ThisWeekState {
  /** Monday of the generated week — ISO date (lib/email/social-calendar/week.ts mondayOf). */
  week_of: string;
  generated_at: string;
  /** null = email-side generation failed (retryable via missingSides). */
  email: ThisWeekEmail | null;
  /** [] = social-side generation failed (retryable via missingSides). */
  social: ThisWeekSocial[];
  errors?: { email?: boolean; social?: boolean };
}

/** Once-per-week guard: the stored week is current for the given Monday. */
export function weekIsCurrent(
  week: ThisWeekState | null | undefined,
  monday: string,
): boolean {
  return !!week && week.week_of === monday;
}

/** Which sides still need generation (drives the partial-failure retry chip). */
export function missingSides(week: ThisWeekState | null | undefined): {
  email: boolean;
  social: boolean;
} {
  if (!week) return { email: true, social: true };
  return { email: week.email == null, social: week.social.length === 0 };
}

/** Calendar day → social_schedules day_of_week (Sun=0 convention, matches
 *  ScheduleSocialModal's DAYS array). */
export const DAY_OF_WEEK: Record<CalendarDay, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
};
```

- [ ] **Step 4: Add the two ui_state keys**

In `app/project/[id]/workspace/types.ts`, add an import at the top and two documented keys inside `ProjectUiState` (before the `[key: string]: unknown;` line):

```ts
import type { ThisWeekState } from "@/lib/project/this-week";
```

```ts
  /** Cockpit D0: the ready-for-you week — pointers into `deliverables` + approval state. */
  this_week?: ThisWeekState;
  /** Cockpit D2: preferred email canvas for this project ("grid" default when absent). */
  email_canvas?: "grid" | "block";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test lib/project/this-week.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/project/this-week.ts lib/project/this-week.test.ts "app/project/[id]/workspace/types.ts"
git commit -m "feat(cockpit): this-week domain types + once-per-week/partial-retry guards"
```

---

### Task 2: Tool switcher (Overview · Email · Social)

**Files:**
- Create: `lib/project/tool-tabs.ts`
- Create: `app/project/[id]/layout.tsx`
- Create: `app/project/[id]/ToolSwitcher.tsx`
- Test: `lib/project/tool-tabs.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `activeTool(pathname: string, id: string): ProjectTool` — also used by Task 2's own client component. The layout wraps `/project/[id]`, `/project/[id]/email-lab`, and `/project/[id]/social` (Task 5 adds the third route; until then the Social tab 404s on click, which is fine mid-plan but Task 5 must land before verification).

**Why a nested layout:** `app/project/layout.tsx` holds the rail + search and must not change (its HARD GUARD comment). A nested `app/project/[id]/layout.tsx` renders once per project subtree — rail/AI/switcher never remount when switching tools. Layouts can't read the pathname (vendor-doc confirmed in spec), so the active highlight is a small client component using `usePathname()`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/project/tool-tabs.test.ts
import { describe, expect, test } from "bun:test";
import { activeTool } from "./tool-tabs";

describe("activeTool", () => {
  test("project root → overview", () => {
    expect(activeTool("/project/abc123", "abc123")).toBe("overview");
    expect(activeTool("/project/abc123/", "abc123")).toBe("overview");
  });
  test("email-lab (with or without query-less subpaths) → email", () => {
    expect(activeTool("/project/abc123/email-lab", "abc123")).toBe("email");
  });
  test("social → social", () => {
    expect(activeTool("/project/abc123/social", "abc123")).toBe("social");
  });
  test("unknown subpath → overview", () => {
    expect(activeTool("/project/abc123/whatever", "abc123")).toBe("overview");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/project/tool-tabs.test.ts`
Expected: FAIL — `Cannot find module './tool-tabs'`

- [ ] **Step 3: Write the helper**

```ts
// lib/project/tool-tabs.ts
export type ProjectTool = "overview" | "email" | "social";

/** Which cockpit tool the current pathname is on (drives the switcher highlight). */
export function activeTool(pathname: string, id: string): ProjectTool {
  const base = `/project/${id}`;
  if (pathname.startsWith(`${base}/email-lab`)) return "email";
  if (pathname.startsWith(`${base}/social`)) return "social";
  return "overview";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/project/tool-tabs.test.ts`
Expected: PASS

- [ ] **Step 5: Write the client switcher**

```tsx
// app/project/[id]/ToolSwitcher.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeTool, type ProjectTool } from "@/lib/project/tool-tabs";

const TABS: { tool: ProjectTool; label: string; href: (id: string) => string }[] = [
  { tool: "overview", label: "Overview", href: (id) => `/project/${id}` },
  { tool: "email", label: "Email", href: (id) => `/project/${id}/email-lab` },
  { tool: "social", label: "Social", href: (id) => `/project/${id}/social` },
];

/** Cockpit D1 — the tool tabs. Client-only because layouts can't read the
 *  pathname; reads ONLY the id (no queries), so the layout stays static. */
export function ToolSwitcher({ id }: { id: string }) {
  const pathname = usePathname();
  const active = activeTool(pathname, id);
  return (
    <nav className="sticky top-0 z-30 border-b border-white/10 bg-[#070f14]/95 px-4 backdrop-blur">
      {/* Segmented control — three short labels fit ~360px */}
      <div className="mx-auto flex max-w-2xl gap-1 py-2">
        {TABS.map((t) => (
          <Link
            key={t.tool}
            href={t.href(id)}
            className={`flex-1 rounded-full px-3 py-1.5 text-center text-xs font-semibold transition-colors ${
              active === t.tool
                ? "bg-gulf-teal text-[#04121b]"
                : "text-white/50 hover:bg-white/5 hover:text-white/80"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
```

- [ ] **Step 6: Write the nested layout**

```tsx
// app/project/[id]/layout.tsx
import { ToolSwitcher } from "./ToolSwitcher";

/**
 * Cockpit D1 — per-project tool frame (Overview · Email · Social). Nested under
 * the persistent project-area layout (rail + search live THERE, not here), so
 * switching tools swaps only the child page: rail, AI, and this switcher never
 * remount. No data fetch here — the switcher needs only the id.
 */
export default async function ProjectToolLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ToolSwitcher id={id} />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
```

- [ ] **Step 7: Build to verify**

Run: `bunx next build`
Expected: compiles; no type errors.

- [ ] **Step 8: Commit**

```bash
git add lib/project/tool-tabs.ts lib/project/tool-tabs.test.ts "app/project/[id]/layout.tsx" "app/project/[id]/ToolSwitcher.tsx"
git commit -m "feat(cockpit): Overview/Email/Social tool switcher in nested project layout"
```

---

### Task 3: Grid-shell contract — `initialAiPrompt`/`autoGenerate`, `onDocChange`, grid-layout synthesis

**Files:**
- Create: `lib/email/doc/grid-layouts.ts`
- Test: `lib/email/doc/grid-layouts.test.ts`
- Modify: `components/email-lab/EmailLabGridShell.tsx` (props at `:169-197`, aiPrompt/aiLoading state at `:207-210`, new mount effect, onDocChange calls)
- Modify: `components/email-lab/EmailLabShell.tsx` (props at `:171-186`, onDocChange call)

**Interfaces:**
- Consumes: `GRID_COLS` from `@/lib/email/grid-schema`; `EmailDoc`/`EmailBlock`/`BlockLayout`/`BlockType` from `@/lib/email/doc/types`.
- Produces: `ensureGridLayouts(doc, heights?)` + `hasGridLayouts(doc)`; both shells accept `onDocChange?: (doc: EmailDoc) => void`; grid shell accepts `initialAiPrompt?: string; autoGenerate?: boolean` with the SAME semantics as the block shell (`EmailLabShell.tsx:315-333`): fire one build on mount, spinner until it resolves.

- [ ] **Step 1: Write the failing test**

`heights` is a parameter (not an import of `DEFAULT_H` from `GridCanvas`) so the helper stays importable in bun test without pulling a canvas component; the client caller passes `DEFAULT_H`.

```ts
// lib/email/doc/grid-layouts.test.ts
import { describe, expect, test } from "bun:test";
import { ensureGridLayouts, hasGridLayouts } from "./grid-layouts";
import { GRID_COLS } from "@/lib/email/grid-schema";
import type { EmailDoc } from "./types";

function doc(blocks: EmailDoc["blocks"]): EmailDoc {
  return { globalStyle: { fontFamily: "MODERN_SANS" }, blocks } as EmailDoc;
}
const bare = (id: string, type: string) => ({ id, type, props: {} }) as EmailDoc["blocks"][number];
const laid = (id: string, type: string, y: number, h: number) =>
  ({ id, type, props: {}, layout: { x: 0, y, w: GRID_COLS, h } }) as EmailDoc["blocks"][number];

describe("hasGridLayouts", () => {
  test("true when every block has a layout", () => {
    expect(hasGridLayouts(doc([laid("a", "hero", 0, 4)]))).toBe(true);
  });
  test("false when any block lacks one", () => {
    expect(hasGridLayouts(doc([laid("a", "hero", 0, 4), bare("b", "text")]))).toBe(false);
  });
});

describe("ensureGridLayouts", () => {
  test("fully-laid doc returned unchanged (same reference)", () => {
    const d = doc([laid("a", "hero", 0, 4)]);
    expect(ensureGridLayouts(d)).toBe(d);
  });
  test("stacks layout-less blocks full-width under existing content", () => {
    const d = doc([laid("a", "hero", 0, 4), bare("b", "text"), bare("c", "text")]);
    const out = ensureGridLayouts(d, { text: 3 });
    expect(out.blocks[1]!.layout).toEqual({ x: 0, y: 4, w: GRID_COLS, h: 3 });
    expect(out.blocks[2]!.layout).toEqual({ x: 0, y: 7, w: GRID_COLS, h: 3 });
  });
  test("unknown type falls back to h=4", () => {
    const out = ensureGridLayouts(doc([bare("a", "mystery")]));
    expect(out.blocks[0]!.layout).toEqual({ x: 0, y: 0, w: GRID_COLS, h: 4 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/email/doc/grid-layouts.test.ts`
Expected: FAIL — `Cannot find module './grid-layouts'`

- [ ] **Step 3: Write the helper**

```ts
// lib/email/doc/grid-layouts.ts
//
// A block-shell doc carries no `layout`; the grid canvas renders nothing
// without one (GRID_SEEDS filters on it). This synthesizes view-time layouts —
// stack full-width under existing grid content — WITHOUT rewriting the saved
// doc (cockpit D2: the toggle never converts). Heights come from the caller
// (the client passes GridCanvas's DEFAULT_H) so this stays test-importable.
import { GRID_COLS } from "@/lib/email/grid-schema";
import type { BlockLayout, BlockType, EmailBlock, EmailDoc } from "@/lib/email/doc/types";

export function hasGridLayouts(doc: EmailDoc): boolean {
  return doc.blocks.every((b) => b.layout != null);
}

export function ensureGridLayouts(
  doc: EmailDoc,
  heights: Partial<Record<BlockType, number>> = {},
): EmailDoc {
  if (hasGridLayouts(doc)) return doc;
  let y = doc.blocks.reduce((m, b) => (b.layout ? Math.max(m, b.layout.y + b.layout.h) : m), 0);
  const blocks = doc.blocks.map((b) => {
    if (b.layout) return b;
    const h = heights[b.type] ?? 4;
    const layout: BlockLayout = { x: 0, y, w: GRID_COLS, h };
    y += h;
    return { ...b, layout } as EmailBlock;
  });
  return { ...doc, blocks };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/email/doc/grid-layouts.test.ts`
Expected: PASS

- [ ] **Step 5: Add `initialAiPrompt`/`autoGenerate`/`onDocChange` to the grid shell**

In `components/email-lab/EmailLabGridShell.tsx`:

(a) Props interface (`:169`) — add three members:

```ts
export interface EmailLabGridShellProps {
  initialDoc: EmailDoc;
  brandTokens?: Record<string, string>;
  scope?: { kind?: string; value?: string };
  /** Mirrors the block shell's contract: seed the prompt box… */
  initialAiPrompt?: string;
  /** …and fire ONE author build on mount (project auto-fill path). */
  autoGenerate?: boolean;
  headerSlot: ReactNode;
  aiPlaceholder?: string;
  onSave?: (doc: EmailDoc, aiPrompt: string) => Promise<string | void>;
  saving?: boolean;
  autoOpenSchedule?: boolean;
  deliverableId?: string | null;
  projectId?: string;
  projectPhotos?: { storage_path: string; signedUrl: string; caption?: string }[];
  initialBranding?: Record<string, string>;
  /** Cockpit D2: reports every committed/live-edited doc so the canvas toggle
   *  can detect in-flight edits (unsaved-switch dialog). */
  onDocChange?: (doc: EmailDoc) => void;
}
```

(b) Destructure the three new props in the function signature.

(c) State seeds — change the two lines:

```ts
  const [aiPrompt, setAiPrompt] = useState(initialAiPrompt ?? "");
  // …
  const [aiLoading, setAiLoading] = useState(Boolean(autoGenerate));
```

(d) Add the mount effect directly after `runAuthor` (after `:312`) — same shape as the block shell's (`EmailLabShell.tsx:315-333`) but through the AUTHOR path (`build: true`), normalized like `runAuthor` does:

```ts
  // Auto-build on mount (project email tab lands on a generated email, not a
  // blank grid). Mirrors EmailLabShell's autoGenerate effect; author path here
  // because the grid composes whole layouts.
  useEffect(() => {
    if (!autoGenerate) return;
    fetch("/api/email-lab/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: (initialAiPrompt ?? "").trim(), doc, scope, build: true }),
    })
      .then((r) => r.json())
      .then((data: { doc?: unknown; applied?: boolean; message?: string }) => {
        if (data.applied === false) {
          setAiMessage(data.message ?? "The AI couldn't build the layout — try rephrasing.");
          return;
        }
        if (data.doc) {
          const parsed = EmailDocSchema.safeParse(data.doc);
          if (parsed.success) {
            commit(normalizeAuthorHeights(applyBrand(parsed.data, brandTokens)));
            setSelectedId(null);
          }
        }
      })
      .catch(() => setAiMessage("Something went wrong — try again."))
      .finally(() => setAiLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

(e) `onDocChange` — the grid shell mutates the doc through exactly two funnels; add one line at the end of each. Find `function commit(` and `function liveEdit(` (both call `setHistory`) and append after the `setHistory` call in each:

```ts
    onDocChange?.(next);
```

(where `next` is the doc each function receives — match the local parameter name).

- [ ] **Step 6: Add `onDocChange` to the block shell**

In `components/email-lab/EmailLabShell.tsx`:

(a) Add to `EmailLabShellProps` (after `initialBranding` at `:185`):

```ts
  /** Cockpit D2: reports every committed doc (see EmailLabGridShellProps). */
  onDocChange?: (doc: EmailDoc) => void;
```

(b) Destructure it; append `onDocChange?.(next);` at the end of the block shell's single `commit(next: EmailDoc)` function (the one at `:255-265` that handles both live-edit coalescing and history pushes).

- [ ] **Step 7: Build to verify**

Run: `bunx next build`
Expected: compiles. The standalone `EmailLabGridClient` doesn't pass the new props — all optional, unaffected.

- [ ] **Step 8: Commit**

```bash
git add lib/email/doc/grid-layouts.ts lib/email/doc/grid-layouts.test.ts components/email-lab/EmailLabGridShell.tsx components/email-lab/EmailLabShell.tsx
git commit -m "feat(email-lab): grid shell autoGenerate/initialAiPrompt + onDocChange on both shells + grid-layout synthesis"
```

---

### Task 4: Email tool — grid is the default canvas, toggle with unsaved-edits dialog

**Files:**
- Create: `lib/email/lab/canvas-pref.ts`
- Test: `lib/email/lab/canvas-pref.test.ts`
- Modify: `app/project/[id]/email-lab/page.tsx` (select `ui_state`, pass it down)
- Modify: `app/project/[id]/email-lab/ProjectEmailLabClient.tsx` (render grid by default, toggle, dialog)

**Interfaces:**
- Consumes: `ensureGridLayouts` (Task 3), grid-shell `initialAiPrompt`/`autoGenerate`/`onDocChange` (Task 3), `ProjectUiState.email_canvas` (Task 1), `DEFAULT_H` from `@/components/email-lab/GridCanvas`.
- Produces: `emailCanvasPref`, `nextCanvasAfterChoice`, `EmailCanvas`, `SwitchChoice` (used only here, but tested).

- [ ] **Step 1: Write the failing test**

```ts
// lib/email/lab/canvas-pref.test.ts
import { describe, expect, test } from "bun:test";
import { emailCanvasPref, nextCanvasAfterChoice } from "./canvas-pref";

describe("emailCanvasPref (ui_state.email_canvas round-trip)", () => {
  test("absent / null uiState → grid (the default canvas)", () => {
    expect(emailCanvasPref(undefined)).toBe("grid");
    expect(emailCanvasPref(null)).toBe("grid");
    expect(emailCanvasPref({})).toBe("grid");
  });
  test("stored block preference honored", () => {
    expect(emailCanvasPref({ email_canvas: "block" })).toBe("block");
  });
  test("junk value → grid", () => {
    expect(emailCanvasPref({ email_canvas: "classic" })).toBe("grid");
    expect(emailCanvasPref({ email_canvas: 42 })).toBe("grid");
  });
});

describe("nextCanvasAfterChoice (unsaved-toggle dialog paths)", () => {
  test("save and discard both switch", () => {
    expect(nextCanvasAfterChoice("grid", "save")).toBe("block");
    expect(nextCanvasAfterChoice("grid", "discard")).toBe("block");
    expect(nextCanvasAfterChoice("block", "save")).toBe("grid");
  });
  test("cancel stays", () => {
    expect(nextCanvasAfterChoice("grid", "cancel")).toBe("grid");
    expect(nextCanvasAfterChoice("block", "cancel")).toBe("block");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/email/lab/canvas-pref.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the helper**

```ts
// lib/email/lab/canvas-pref.ts
// Cockpit D2 — per-project canvas preference. Grid is the DEFAULT (per-section
// AI editing is the editing story); block is the opt-in fallback.

export type EmailCanvas = "grid" | "block";
export type SwitchChoice = "save" | "discard" | "cancel";

export function emailCanvasPref(
  uiState: { email_canvas?: unknown } | null | undefined,
): EmailCanvas {
  return uiState?.email_canvas === "block" ? "block" : "grid";
}

export function nextCanvasAfterChoice(current: EmailCanvas, choice: SwitchChoice): EmailCanvas {
  if (choice === "cancel") return current;
  return current === "grid" ? "block" : "grid";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/email/lab/canvas-pref.test.ts`
Expected: PASS

- [ ] **Step 5: Pass ui_state through the page**

In `app/project/[id]/email-lab/page.tsx`:
- Change the project select (`:65-69`) to include ui_state: `.select("id, title, items, branding, ui_state")`.
- Pass it to the client (add to the JSX at `:124-142`):

```tsx
      uiState={(project.ui_state ?? {}) as import("../workspace/types").ProjectUiState}
```

- [ ] **Step 6: Rewrite `ProjectEmailLabClient.tsx`**

Full replacement (keeps the existing save contract byte-for-byte; adds canvas selection, toggle, dialog):

```tsx
"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { EmailLabShell } from "@/components/email-lab/EmailLabShell";
import { EmailLabGridShell } from "@/components/email-lab/EmailLabGridShell";
import { DEFAULT_H } from "@/components/email-lab/GridCanvas";
import { ensureGridLayouts } from "@/lib/email/doc/grid-layouts";
import {
  emailCanvasPref,
  nextCanvasAfterChoice,
  type EmailCanvas,
  type SwitchChoice,
} from "@/lib/email/lab/canvas-pref";
import { defaultDoc } from "@/lib/email/doc/default-docs";
import type { EmailDoc } from "@/lib/email/doc/types";
import type { ProjectUiState } from "../workspace/types";

interface Props {
  projectId: string;
  projectTitle: string;
  /** Project branding mapped to email tokens by the page (PRIMARY, ACCENT,
   *  COMPANY_NAME, AGENT_*, CTA_URL, …). The shell applies these onto the doc's
   *  globalStyle + brand-bearing blocks. */
  initialTokens: Record<string, string>;
  /** The raw project branding blob (snake_case) — seeds the lab's live Brand
   *  panel so editing brand here writes back to the SAME projects.branding. */
  initialBranding?: Record<string, string>;
  scope?: { kind: string; value: string } | null;
  initialDoc?: EmailDoc | null;
  deliverableId?: string | null;
  /** Re-open the Schedule modal on mount (set when returning from contacts-upload). */
  autoOpenSchedule?: boolean;
  projectPhotos?: { storage_path: string; signedUrl: string; caption?: string }[];
  uiState: ProjectUiState;
}

// Project-scoped Email tool (cockpit D2). GRID is the default canvas (per-section
// AI editing); the block canvas is the fallback via a per-project toggle persisted
// in ui_state.email_canvas. Both canvases operate on the same EmailDoc — the
// toggle re-renders without converting or rewriting the saved doc. Auto-fills on
// mount when no saved doc is loaded (?did absent).
export function ProjectEmailLabClient({
  projectId,
  projectTitle,
  initialTokens,
  initialBranding,
  scope,
  initialDoc,
  deliverableId,
  autoOpenSchedule,
  projectPhotos,
  uiState,
}: Props) {
  const [savedId, setSavedId] = useState<string | null>(deliverableId ?? null);
  const [saving, setSaving] = useState(false);
  const [doc0] = useState<EmailDoc>(() => initialDoc ?? defaultDoc());
  const [canvas, setCanvas] = useState<EmailCanvas>(() => emailCanvasPref(uiState));
  // The doc the CURRENT canvas mount was seeded with (updated on switch).
  const [seedDoc, setSeedDoc] = useState<EmailDoc>(doc0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Refs, not state: the shells own the live doc; we only need it at toggle/save time.
  const currentDocRef = useRef<EmailDoc>(doc0);
  const savedDocRef = useRef<EmailDoc>(doc0);
  const dirtyRef = useRef(false);
  // autoGenerate fires ONCE per page load — never again after a canvas toggle.
  const toggledRef = useRef(false);

  const scopeLabel = scope
    ? `${scope.kind === "zip" ? "ZIP " : ""}${scope.value}`
    : "Southwest Florida";
  const effectiveScope = scope ?? { kind: "region", value: "swfl" };
  const aiPrompt = `Market spotlight email for ${scopeLabel} — fill in realistic market context and agent copy`;

  function handleDocChange(doc: EmailDoc) {
    currentDocRef.current = doc;
    dirtyRef.current = true;
  }

  // `ai_prompt` is persisted as the deliverable's build prompt so a SCHEDULED re-render
  // reproduces this exact email — chart included — with fresh data each occurrence (the
  // chart selector keys off the prompt; without it a scheduled send loses the chart).
  async function handleSave(doc: EmailDoc, prompt: string): Promise<string | void> {
    setSaving(true);
    try {
      if (savedId) {
        await fetch(`/api/projects/${projectId}/materials`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deliverable_id: savedId, doc, ai_prompt: prompt }),
        });
        savedDocRef.current = doc;
        dirtyRef.current = false;
        return savedId;
      }
      const res = await fetch(`/api/projects/${projectId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc, ai_prompt: prompt }),
      });
      if (res.ok) {
        const { id } = await res.json();
        setSavedId(id);
        savedDocRef.current = doc;
        dirtyRef.current = false;
        window.history.replaceState({}, "", `/project/${projectId}/email-lab?did=${id}`);
        return id;
      }
    } finally {
      setSaving(false);
    }
  }

  function switchTo(next: EmailCanvas, seed: EmailDoc) {
    toggledRef.current = true;
    setSeedDoc(seed);
    setCanvas(next);
    // Persist the preference — additive merge of the whole bag (established
    // patchUiState pattern). Best-effort; a miss just means the default next visit.
    void fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ui_state: { ...uiState, email_canvas: next } }),
    });
  }

  function onTogglePress() {
    if (!dirtyRef.current) {
      switchTo(nextCanvasAfterChoice(canvas, "discard"), currentDocRef.current);
      return;
    }
    // In-flight edits: canvases seed history independently, so switching would
    // silently lose them. Explicit dialog — no silent loss, no silent save.
    setConfirmOpen(true);
  }

  async function onChoice(choice: SwitchChoice) {
    setConfirmOpen(false);
    if (choice === "cancel") return;
    const next = nextCanvasAfterChoice(canvas, choice);
    if (choice === "save") {
      await handleSave(currentDocRef.current, "");
      switchTo(next, currentDocRef.current);
    } else {
      switchTo(next, savedDocRef.current); // discard in-flight edits
    }
  }

  const headerSlot = (
    <>
      <Link
        href={`/project/${projectId}`}
        className="mb-2 flex items-center gap-1.5 text-[10px] text-white/35 transition-colors hover:text-white/60"
      >
        ← {projectTitle}
      </Link>
      <p className="text-sm font-semibold text-white/80">Email</p>
      <p className="mt-0.5 text-[10px] text-gulf-teal">
        {scope ? `Scope: ${scopeLabel}` : "Southwest Florida"} · real data enabled
      </p>
      <button
        type="button"
        onClick={onTogglePress}
        className="mt-2 rounded-full border border-white/15 px-2.5 py-1 text-[10px] text-white/50 transition-colors hover:border-gulf-teal/50 hover:text-gulf-teal"
      >
        {canvas === "grid" ? "Switch to block canvas" : "Switch to grid canvas"}
      </button>
    </>
  );

  const shared = {
    brandTokens: initialTokens,
    initialBranding,
    scope: effectiveScope,
    initialAiPrompt: aiPrompt,
    autoGenerate: !savedId && !toggledRef.current,
    aiPlaceholder: `e.g. Listing announcement for ${scopeLabel} — 3BR condo, pool view, under market…`,
    onSave: handleSave,
    saving,
    autoOpenSchedule,
    deliverableId: savedId,
    projectId,
    projectPhotos,
    onDocChange: handleDocChange,
    headerSlot,
  };

  return (
    <>
      {canvas === "grid" ? (
        <EmailLabGridShell
          key="grid"
          initialDoc={ensureGridLayouts(seedDoc, DEFAULT_H)}
          {...shared}
        />
      ) : (
        <EmailLabShell key="block" initialDoc={seedDoc} {...shared} />
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0a1822] p-5 shadow-2xl">
            <h2 className="text-sm font-semibold text-white">You have unsaved changes</h2>
            <p className="mt-1 text-xs text-white/50">
              Switching canvases resets the edit history. Save this design first?
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void onChoice("save")}
                className="rounded-lg bg-gulf-teal py-2 text-sm font-semibold text-[#070f14] hover:bg-[#17a3b3]"
              >
                Save &amp; switch
              </button>
              <button
                type="button"
                onClick={() => void onChoice("discard")}
                className="rounded-lg border border-white/15 py-2 text-sm text-white/70 hover:bg-white/5"
              >
                Switch without saving
              </button>
              <button
                type="button"
                onClick={() => void onChoice("cancel")}
                className="py-1 text-xs text-white/40 hover:text-white/70"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

Notes for the implementer:
- The dialog's "Save & switch" passes `ai_prompt: ""` — the materials PATCH skips a blank prompt (never wipes the stored one, `materials/route.ts:108-110`), and POST stores null. Intentional: a dialog save is a doc save, not a prompt change.
- `autoGenerate` semantics: fires only on a fresh, unsaved page load; a toggle remount never re-fires (toggledRef).
- A `?did=` material saved from the block shell has no layouts — `ensureGridLayouts` synthesizes view-time stacking; the saved doc is not rewritten until the user saves from the grid (additive).

- [ ] **Step 7: Build to verify**

Run: `bunx next build`
Expected: compiles.

- [ ] **Step 8: Commit**

```bash
git add lib/email/lab/canvas-pref.ts lib/email/lab/canvas-pref.test.ts "app/project/[id]/email-lab/page.tsx" "app/project/[id]/email-lab/ProjectEmailLabClient.tsx"
git commit -m "feat(cockpit): grid is the default project email canvas, toggle persisted in ui_state.email_canvas with unsaved-edits dialog"
```

---

### Task 5: Social tool page (promotion, not construction)

**Files:**
- Create: `app/project/[id]/social/page.tsx`
- Create: `app/project/[id]/social/ProjectSocialClient.tsx`

**Interfaces:**
- Consumes: `useSocialComposer` (`components/email-lab/social/useSocialComposer.ts` — the full handle, incl. `scheduleOpen`/`setScheduleOpen`/`mediaUrl`/`design`), `SocialComposer`, `SocialElementInspector`, `SocialCalendarPanel` (its optional `onSchedule` exists precisely for this — `SocialCalendarPanel.tsx:13-15`), `ScheduleSocialModal`, `WeeklyCalendar`/`SocialDraft`/`CalendarDay` types, `brandingToTokens`, `applyBrand` (client-side OK here).
- Produces: the `/project/[id]/social` route the switcher (Task 2) links to. **Scope guard:** surface move only — publish engine (`lib/social/`) and calendar system (`lib/email/social-calendar/`) stay two systems.

- [ ] **Step 1: Write the server page**

Mirrors the email-lab page's load pattern (auth → project row → brand + inferred scope → client). No `?did` machinery — social has no saved-doc deep link in Phase 1.

```tsx
// app/project/[id]/social/page.tsx
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { inferScopeFromItems } from "@/lib/project/derive-name";
import type { ProjectItem } from "@/lib/project/items";
import { signedUploadUrls } from "@/lib/project/signed-upload-url";
import { ProjectSocialClient } from "./ProjectSocialClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Social" };

export default async function ProjectSocialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createClient(await cookies());
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { data: project } = await supabase
    .from("projects")
    .select("id, title, items, branding")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const branding = (project.branding ?? {}) as Record<string, string>;
  const items: ProjectItem[] = Array.isArray(project.items) ? project.items : [];
  const scope = inferScopeFromItems(items);

  // Filed image items + 1h signed URLs (same as the email tool's Photos feed).
  const imageItems = items.filter(
    (i): i is Extract<ProjectItem, { kind: "file" }> =>
      i.kind === "file" && Boolean(i.mime?.startsWith("image/")),
  );
  const imageSignedUrls =
    imageItems.length > 0
      ? await signedUploadUrls(
          supabase,
          imageItems.map((i) => i.storage_path),
        )
      : {};
  const projectPhotos = imageItems
    .filter((i) => imageSignedUrls[i.storage_path])
    .map((i) => ({
      storage_path: i.storage_path,
      signedUrl: imageSignedUrls[i.storage_path],
      caption: i.caption,
    }));

  return (
    <ProjectSocialClient
      projectId={id}
      projectTitle={project.title ?? "Project"}
      branding={branding}
      scope={
        scope.zip
          ? { kind: "zip", value: scope.zip }
          : scope.place
            ? { kind: "place", value: scope.place }
            : undefined
      }
      projectPhotos={projectPhotos}
    />
  );
}
```

- [ ] **Step 2: Write the client**

```tsx
// app/project/[id]/social/ProjectSocialClient.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SocialComposer } from "@/components/email-lab/social/SocialComposer";
import { SocialElementInspector } from "@/components/email-lab/social/SocialElementInspector";
import { useSocialComposer } from "@/components/email-lab/social/useSocialComposer";
import { SocialCalendarPanel } from "@/components/email-lab/SocialCalendarPanel";
import { ScheduleSocialModal } from "@/components/email-lab/ScheduleSocialModal";
import { PhotosPanel } from "@/components/email-lab/PhotosPanel";
import type { SocialElement } from "@/lib/social/design/types";
import { applyBrand } from "@/components/email-lab/EmailLabShell";
import { brandingToTokens } from "@/lib/email/brand/branding-to-tokens";
import { formatForClipboard } from "@/lib/email/social-calendar/week";
import type {
  CalendarDay,
  SocialDraft,
  WeeklyCalendar,
} from "@/lib/email/social-calendar/types";
import type { EmailDoc } from "@/lib/email/doc/types";

interface Props {
  projectId: string;
  projectTitle: string;
  branding: Record<string, string>;
  scope?: { kind: string; value: string };
  projectPhotos: { storage_path: string; signedUrl: string; caption?: string }[];
}

// Element palette for the "New post" section (mirrors the grid shell's private
// SOCIAL_PALETTE — chart is author-seeded, never palette-added).
const PALETTE: { type: SocialElement["type"]; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "stat", label: "Stat" },
  { type: "cta", label: "Button + link" },
  { type: "image", label: "Image" },
  { type: "logo", label: "Logo" },
];

// Cockpit D3 — the Social tool as a full page: the existing composer +
// Generate-Week calendar + schedule modal, PROMOTED out of the email shells.
// Surface move only: publish engine (lib/social/) and calendar system
// (lib/email/social-calendar/) remain two systems.
export function ProjectSocialClient({
  projectId,
  projectTitle,
  branding,
  scope,
  projectPhotos,
}: Props) {
  const router = useRouter();
  const social = useSocialComposer({ scope, projectId, branding });
  const tokens = brandingToTokens(branding);

  // Generate-Week state (exact generateWeek shape from EmailLabGridShell:507-525).
  const [calState, setCalState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [calendar, setCalendar] = useState<WeeklyCalendar | null>(null);
  const [expandedDay, setExpandedDay] = useState<CalendarDay | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<SocialDraft | null>(null);
  // Card-preview column: the day card rendered to email HTML with project brand.
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewCard, setPreviewCard] = useState<EmailDoc | null>(null);
  const [savingCard, setSavingCard] = useState(false);

  async function generateWeek() {
    setCalState("loading");
    try {
      const res = await fetch("/api/email-lab/social-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const data = (await res.json()) as { calendar?: WeeklyCalendar };
      if (data.calendar?.posts?.length) {
        setCalendar(data.calendar);
        setCalState("ready");
      } else {
        setCalState("error");
      }
    } catch {
      setCalState("error");
    }
  }

  // "Load Card" — render the day's EmailDoc with the project brand into the
  // preview column (brand applied client-side, the established card path).
  async function loadCard(card: EmailDoc) {
    const branded = applyBrand(card, tokens);
    setPreviewCard(branded);
    setPreviewHtml(null);
    try {
      const res = await fetch("/api/email-lab/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: branded }),
      });
      setPreviewHtml(((await res.json()) as { html?: string }).html ?? "");
    } catch {
      setPreviewHtml("");
    }
  }

  // "Edit in Email" — save the branded card as a material, deep-link the Email tab.
  async function editInEmail() {
    if (!previewCard || savingCard) return;
    setSavingCard(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: previewCard }),
      });
      if (res.ok) {
        const { id } = (await res.json()) as { id: string };
        router.push(`/project/${projectId}/email-lab?did=${id}`);
      }
    } finally {
      setSavingCard(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:flex-row">
      {/* Left rail — header + Generate Week calendar */}
      <aside className="w-full shrink-0 overflow-y-auto lg:w-72">
        <Link
          href={`/project/${projectId}`}
          className="mb-2 flex items-center gap-1.5 text-[10px] text-white/35 transition-colors hover:text-white/60"
        >
          ← {projectTitle}
        </Link>
        <p className="text-sm font-semibold text-white/80">Social</p>
        <p className="mt-0.5 text-[10px] text-gulf-teal">
          {scope ? `Scope: ${scope.kind === "zip" ? "ZIP " : ""}${scope.value}` : "Southwest Florida"}
          {" · real data enabled"}
        </p>
        <SocialCalendarPanel
          state={calState}
          calendar={calendar}
          expandedDay={expandedDay}
          onGenerate={generateWeek}
          onToggleDay={(d) => setExpandedDay((cur) => (cur === d ? null : d))}
          onCopyCaption={(d) => void navigator.clipboard.writeText(formatForClipboard(d))}
          onLoadCard={loadCard}
          onSchedule={setScheduleDraft}
        />

        {/* New post — the AI controls that drive the center canvas (the grid
            shell's right-aside social controls, promoted here). */}
        <div className="mt-4 border-t border-white/8 pt-3">
          <p className="text-[10px] uppercase tracking-[0.15em] text-white/35">New post</p>
          <textarea
            value={social.prompt}
            onChange={(e) => social.setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void social.author();
            }}
            placeholder="Describe the post — the AI builds it with real numbers…"
            rows={3}
            className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 p-2 text-xs text-white/80 focus:outline-none focus:ring-1 focus:ring-gulf-teal"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void social.author()}
              disabled={social.aiBusy}
              className="flex-1 rounded-lg bg-gulf-teal py-1.5 text-xs font-semibold text-[#070f14] hover:bg-[#17a3b3] disabled:opacity-40"
            >
              {social.aiBusy ? "Working…" : "Build post"}
            </button>
            <button
              type="button"
              onClick={() => void social.fill()}
              disabled={social.aiBusy}
              className="flex-1 rounded-lg border border-white/15 py-1.5 text-xs text-white/70 hover:bg-white/5 disabled:opacity-40"
            >
              Fill numbers
            </button>
          </div>
          {social.aiStatus && <p className="mt-1 text-[10px] text-gulf-teal">{social.aiStatus}</p>}
          {social.aiError && <p className="mt-1 text-[10px] text-amber-300/80">{social.aiError}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            {PALETTE.map((p) => (
              <button
                key={p.type}
                type="button"
                onClick={() => social.addElement(p.type)}
                className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/50 hover:border-gulf-teal/40 hover:text-gulf-teal"
              >
                + {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void social.openSchedule()}
            disabled={!social.hasElements || social.exporting}
            className="mt-3 w-full rounded-lg border border-gulf-teal/40 py-2 text-xs font-semibold text-gulf-teal hover:bg-gulf-teal/10 disabled:opacity-40"
          >
            {social.exporting ? "Exporting…" : "Schedule this post"}
          </button>
          {social.exportError && (
            <p className="mt-1 text-[10px] text-amber-300/80">{social.exportError}</p>
          )}
        </div>

        <PhotosPanel
          projectPhotos={projectPhotos}
          promotingPath={social.promotingPath}
          onApplyUrl={social.applyPhotoUrl}
          onPickFiled={(p) => void social.pickFiledPhoto(p)}
          onUploadFile={(f) => void social.uploadNewPhoto(f)}
        />
      </aside>

      {/* Center — the composer canvas + inspector */}
      <section className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <SocialComposer composer={social} />
        {social.selectedElement && (
          <div className="mt-3">
            <SocialElementInspector
              element={social.selectedElement}
              onChange={social.updateElement}
              onDelete={social.deleteSelected}
              onClose={() => social.setSelectedId(null)}
            />
          </div>
        )}
      </section>

      {/* Right — card preview column */}
      <aside className="w-full shrink-0 overflow-y-auto lg:w-80">
        <p className="text-[10px] uppercase tracking-[0.15em] text-white/35">Card preview</p>
        {previewHtml == null ? (
          <p className="mt-2 text-xs text-white/40">
            Generate a week, then Load Card to preview a day&apos;s post here.
          </p>
        ) : previewHtml === "" ? (
          <p className="mt-2 text-xs text-amber-300/80">Preview failed — try again.</p>
        ) : (
          <>
            <iframe
              title="Card preview"
              srcDoc={previewHtml}
              className="mt-2 h-[480px] w-full rounded-lg border border-white/10 bg-white"
            />
            <button
              type="button"
              onClick={() => void editInEmail()}
              disabled={savingCard}
              className="mt-2 w-full rounded-lg border border-gulf-teal/40 py-2 text-xs font-semibold text-gulf-teal hover:bg-gulf-teal/10 disabled:opacity-40"
            >
              {savingCard ? "Saving…" : "Edit in Email"}
            </button>
          </>
        )}
      </aside>

      {scheduleDraft && (
        <ScheduleSocialModal
          draft={scheduleDraft}
          projectId={projectId}
          scopeKind={scope?.kind ?? null}
          scopeValue={scope?.value ?? null}
          onClose={() => setScheduleDraft(null)}
        />
      )}
      {social.scheduleOpen && (
        <ScheduleSocialModal
          draft={
            {
              day: "mon",
              theme: "composed",
              caption: social.caption,
              hashtags: social.hashtags,
              card: { globalStyle: {}, blocks: [] },
              variants: social.variants,
            } as unknown as SocialDraft
          }
          projectId={projectId}
          scopeKind={scope?.kind ?? null}
          scopeValue={scope?.value ?? null}
          mediaUrl={social.mediaUrl}
          design={social.design}
          onClose={() => social.setScheduleOpen(false)}
        />
      )}
    </div>
  );
}
```

Verified contracts (probed 07/02/2026, don't re-derive): `SocialComposer({ composer }: { composer: SocialComposerHandle })` (`SocialComposer.tsx:18`); `SocialElementInspector({ element, onChange, onDelete, onClose })` (`SocialElementInspector.tsx:33-43`); `PhotosPanel({ projectPhotos, promotingPath, onApplyUrl, onPickFiled, onUploadFile })` (`PhotosPanel.tsx:10-20`). The composer-post `ScheduleSocialModal` draft above mirrors the grid shell's own call site byte-for-byte (`EmailLabGridShell.tsx:1330-1348` — `theme: "composed"`, empty card, cast `as unknown as SocialDraft`, `mediaUrl` + `design` from the handle). If `EmailDoc` is now unused after this shape, drop it from the type-only import.

- [ ] **Step 3: Build to verify**

Run: `bunx next build`
Expected: compiles; `/project/[id]/social` appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add "app/project/[id]/social/page.tsx" "app/project/[id]/social/ProjectSocialClient.tsx"
git commit -m "feat(cockpit): Social tool page — composer + Generate-Week + schedule, promoted to a first-class tab"
```

---

### Task 6: Week generation route (`POST /api/projects/[id]/week`)

**Files:**
- Create: `app/api/projects/[id]/week/route.ts`

**Interfaces:**
- Consumes: `weekIsCurrent`/`missingSides`/`ThisWeekState` (Task 1), `buildContentDoc` (`lib/email/build-doc.ts:338`), `buildWeek` (`lib/email/social-calendar/build-week.ts`, signature `buildWeek(scope?: BuildScope, weekOf?: string, opts?)`), `mondayOf` (`lib/email/social-calendar/week.ts:5`), `defaultDoc` (`lib/email/doc/default-docs`), `inferScopeFromItems`, `recordUse` (`lib/highlighter/meter.ts:43`), service-role client.
- Produces: `POST` body `{ force?: boolean }` → `{ week: ThisWeekState, cached?: boolean }`. Inserts queue docs as `deliverables` rows identical in shape to the materials POST (template `block-canvas`, status `ready`, `instruction` = build prompt) so they appear in MaterialsHub and are schedulable via the existing `fromDeliverable` path. Records the `week_generated` usage event (feeds the 7-day-return metric).

- [ ] **Step 1: Write the route**

```ts
// app/api/projects/[id]/week/route.ts
//
// Cockpit D0 — generate the ready-for-you week server-side, at most once per
// week per project (regenerate on demand with force:true; a partial failure
// retries only the missing side). Promotion, not construction: the email goes
// through buildContentDoc (the lab's auto-fill root) and socials through
// buildWeek (Generate-Week's root). Docs persist as ordinary block-canvas
// deliverables (service-role insert — deliverables has no owner INSERT policy;
// ownership proven on projects first, the materials-route pattern). Docs are
// saved UNBRANDED — brand applies client-side on load, like calendar cards.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { buildContentDoc, type BuildScope } from "@/lib/email/build-doc";
import { buildWeek } from "@/lib/email/social-calendar/build-week";
import { mondayOf } from "@/lib/email/social-calendar/week";
import { defaultDoc } from "@/lib/email/doc/default-docs";
import { EmailDocSchema } from "@/lib/email/doc/schema";
import { inferScopeFromItems } from "@/lib/project/derive-name";
import type { ProjectItem } from "@/lib/project/items";
import { recordUse } from "@/lib/highlighter/meter";
import {
  missingSides,
  weekIsCurrent,
  type ThisWeekSocial,
  type ThisWeekState,
} from "@/lib/project/this-week";

export const runtime = "nodejs";
export const maxDuration = 300;

const EMPTY_NARRATIVE = { exec_summary: "", sections: [], inference_notes: [] };

/** Insert one queue doc as a block-canvas material; returns its id or null. */
async function insertMaterial(
  admin: ReturnType<typeof createServiceRoleClient>,
  projectId: string,
  userId: string,
  doc: unknown,
  instruction: string | null,
): Promise<string | null> {
  const parsed = EmailDocSchema.safeParse(doc);
  if (!parsed.success) return null;
  const newId = crypto.randomUUID();
  const { error } = await admin.from("deliverables").insert({
    id: newId,
    project_id: projectId,
    user_id: userId,
    template: "block-canvas",
    doc: parsed.data,
    instruction,
    data_as_of: new Date().toISOString(),
    narrative: EMPTY_NARRATIVE,
    items_snapshot: [],
    status: "ready",
  });
  return error ? null : newId;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const db = createClient(await cookies());
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Ownership via owner-RLS'd projects select (materials-route pattern).
  const { data: project } = await db
    .from("projects")
    .select("id, items, ui_state")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  const monday = mondayOf(new Date());
  const uiState = (project.ui_state ?? {}) as Record<string, unknown> & {
    this_week?: ThisWeekState;
  };
  const existing =
    !body.force && weekIsCurrent(uiState.this_week, monday) ? uiState.this_week! : null;
  const missing = missingSides(existing);
  if (existing && !missing.email && !missing.social) {
    return NextResponse.json({ week: existing, cached: true });
  }

  const items: ProjectItem[] = Array.isArray(project.items) ? project.items : [];
  const inferred = inferScopeFromItems(items);
  const scope: BuildScope = inferred.zip
    ? { kind: "zip", value: inferred.zip }
    : inferred.place
      ? { kind: "place", value: inferred.place }
      : { kind: "region", value: "swfl" };
  const scopeLabel = inferred.place
    ? `${inferred.place}${inferred.zip ? ` ${inferred.zip}` : ""}`
    : (inferred.zip ?? "Southwest Florida");

  const admin = createServiceRoleClient();
  const week: ThisWeekState = existing ?? {
    week_of: monday,
    generated_at: new Date().toISOString(),
    email: null,
    social: [],
  };
  const errors: { email?: boolean; social?: boolean } = {};

  // ── Email side (the lab's auto-fill prompt, verbatim) ──────────────────────
  if (missing.email) {
    const prompt = `Market spotlight email for ${scopeLabel} — fill in realistic market context and agent copy`;
    try {
      const { payload } = await buildContentDoc({ prompt, rawDoc: defaultDoc(), scope });
      const did =
        payload.applied === false || !payload.doc
          ? null
          : await insertMaterial(admin, id, user.id, payload.doc, prompt);
      if (did) week.email = { did, state: "pending" };
      else errors.email = true;
    } catch {
      errors.email = true;
    }
  }

  // ── Social side (Generate-Week root) ───────────────────────────────────────
  if (missing.social) {
    try {
      const calendar = await buildWeek(scope, monday);
      const social: ThisWeekSocial[] = [];
      for (const post of calendar.posts) {
        const did = await insertMaterial(admin, id, user.id, post.card, null);
        if (did) {
          social.push({
            day: post.day,
            did,
            theme: post.theme,
            caption: post.caption,
            hashtags: post.hashtags,
            state: "pending",
          });
        }
      }
      if (social.length > 0) week.social = social;
      else errors.social = true;
    } catch {
      errors.social = true;
    }
  }

  week.errors = Object.keys(errors).length > 0 ? errors : undefined;
  week.generated_at = new Date().toISOString();

  // Persist the pointer bag (cookie client — owner RLS scopes the update).
  await db
    .from("projects")
    .update({ ui_state: { ...uiState, this_week: week } })
    .eq("id", id);

  // Verdict metric #2's anchor: the generated-week event (7-day return reads
  // project_open events after this one). Fire-and-forget, never blocks.
  if (week.email || week.social.length > 0) {
    await recordUse(req, { report_id: "", reach: [`project:${id}`], action: "week_generated" }, user.id);
  }

  return NextResponse.json({ week });
}
```

Implementer notes:
- **Probe before wiring `buildWeek`:** open `lib/email/social-calendar/build-week.ts` and confirm the exported signature (`buildWeek(scope?, weekOf?, opts?)` per `app/api/email-lab/social-calendar/route.ts:46`). Match it exactly.
- **Probe `BuildScope`:** it's `{ kind?: string; value?: string }` (`lib/email/build-doc.ts:66-69`). `kind: "place"`/`"region"` fall through to the region-wide dossier — that IS the unscoped-project fallback (error-handling rule: never blocks).
- `payload.doc` typing: `BuildResult.payload` is `Record<string, unknown>` — the `insertMaterial` schema-parse is the validation gate, same as the materials route.
- Two tabs racing can double-generate; the guard + client-side once-ref (Task 7) make it unlikely, and the loser's rows are just extra draft materials. Accepted for Phase 1.

- [ ] **Step 2: Build to verify**

Run: `bunx next build`
Expected: compiles; route listed.

- [ ] **Step 3: Guard-behavior check (unit level already covered)**

The once-per-week and partial-retry logic is the Task 1 pure functions (already tested). No route-level test harness exists in this repo for cookie-auth routes; the flow is exercised in Task 10's drive.

- [ ] **Step 4: Commit**

```bash
git add "app/api/projects/[id]/week/route.ts"
git commit -m "feat(cockpit): server-side week generation — email via buildContentDoc, socials via buildWeek, persisted as materials + ui_state.this_week"
```

---

### Task 7: This Week queue UI on the Overview

**Files:**
- Create: `app/project/[id]/workspace/ThisWeek.tsx`
- Modify: `app/project/[id]/ProjectWorkspace.tsx` (mount ThisWeek as the top section, pass props)

**Interfaces:**
- Consumes: `ThisWeekState`/`QueueItemState`/`DAY_OF_WEEK` (Task 1), `DeliverableRow` (has `doc`), `ScheduleSendModal` (`{deliverableId, projectId, scopeKind, scopeValue, onClose}`), `ScheduleSocialModal` (`{draft, projectId, scopeKind, scopeValue, onClose}`), `emailDeliverableScope` (`lib/deliverable/email-scope`), `POST /api/projects/[id]/week` (Task 6), `GET /api/social/schedule` (connected accounts), `POST /api/social/schedule`.
- Produces: `<ThisWeek …/>` with a `scheduleAll` handler that Task 8's track route instruments. Card actions: Approve → state flip; Tweak → `/project/[id]/email-lab?did=…` (the material opens in the preferred canvas — Task 4); Skip → state flip; Approve & schedule → the right modal.

- [ ] **Step 1: Write the component**

```tsx
// app/project/[id]/workspace/ThisWeek.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScheduleSendModal } from "@/components/email-lab/ScheduleSendModal";
import { ScheduleSocialModal } from "@/components/email-lab/ScheduleSocialModal";
import type { SocialDraft } from "@/lib/email/social-calendar/types";
import type { EmailDoc } from "@/lib/email/doc/types";
import {
  DAY_OF_WEEK,
  type QueueItemState,
  type ThisWeekSocial,
  type ThisWeekState,
} from "@/lib/project/this-week";
import type { DeliverableRow } from "./types";

const DAY_LABEL: Record<ThisWeekSocial["day"], string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
};

interface Props {
  projectId: string;
  week: ThisWeekState | null;
  /** Live material heads — resolves a queue item's did → its EmailDoc. */
  deliverables: DeliverableRow[];
  scopeKind: string | null;
  scopeValue: string | null;
  /** Persists the whole bag key (ProjectWorkspace.patchUiState). */
  onWeekChange: (next: ThisWeekState) => Promise<boolean>;
}

// Cockpit D0 — the ready-for-you queue. Opening a project never lands on an
// empty desk: this week's email + posts are already generated; each card offers
// Approve & schedule · Tweak · Skip; Schedule all closes the week. Generation
// failure degrades to the existing Overview below (never a blank screen, never
// a blocking spinner) with a retry chip.
export function ThisWeek({
  projectId,
  week: initialWeek,
  deliverables,
  scopeKind,
  scopeValue,
  onWeekChange,
}: Props) {
  const router = useRouter();
  const [week, setWeek] = useState<ThisWeekState | null>(initialWeek);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(false);
  const [emailScheduleFor, setEmailScheduleFor] = useState<string | null>(null);
  const [socialScheduleFor, setSocialScheduleFor] = useState<ThisWeekSocial | null>(null);
  const [scheduleAllBusy, setScheduleAllBusy] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null);
  const firedRef = useRef(false); // strict-mode / remount double-fire guard

  // ONE generation entry point, used by mount and retry. The SERVER owns
  // week_of currency (once-per-week guard + partial-side retry live in the
  // route), so the client always POSTs; a current, complete week comes back
  // {cached:true} instantly and nothing changes visually.
  function generate() {
    const hadContent = !!week && (week.email != null || week.social.length > 0);
    setGenError(false);
    if (!hadContent) setGenerating(true); // never a blocking spinner over an existing queue
    fetch(`/api/projects/${projectId}/week`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("week failed"))))
      .then((data: { week?: ThisWeekState; cached?: boolean }) => {
        if (data.week) {
          setWeek(data.week);
          setGenError(Boolean(data.week.errors?.email || data.week.errors?.social));
          // Materials were inserted server-side — refresh the RSC payload so
          // MaterialsHub + our did→doc lookups see them.
          if (!data.cached) router.refresh();
        } else {
          setGenError(true);
        }
      })
      .catch(() => setGenError(true))
      .finally(() => setGenerating(false));
  }

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function docByDid(did: string): EmailDoc | null {
    return deliverables.find((d) => d.id === did)?.doc ?? null;
  }

  async function persist(next: ThisWeekState) {
    setWeek(next);
    await onWeekChange(next);
  }

  function setEmailState(state: QueueItemState) {
    if (!week?.email) return;
    void persist({ ...week, email: { ...week.email, state } });
  }
  function setSocialState(did: string, state: QueueItemState) {
    if (!week) return;
    void persist({
      ...week,
      social: week.social.map((s) => (s.did === did ? { ...s, state } : s)),
    });
  }

  function draftFor(s: ThisWeekSocial): SocialDraft | null {
    const doc = docByDid(s.did);
    if (!doc) return null;
    return { day: s.day, theme: s.theme, caption: s.caption, hashtags: s.hashtags, card: doc };
  }

  // "Schedule all" — the week's closing action (the paywall moment lives here in
  // Phase 2; Phase 1 writes real schedule rows). Approved socials schedule with
  // defaults (all connected platforms, weekly on the post's day, 9am ET); the
  // email needs an audience — a genuine user choice — so it finishes in its modal.
  async function scheduleAll() {
    if (!week || scheduleAllBusy) return;
    setScheduleAllBusy(true);
    setScheduleMsg(null);
    try {
      const approvedSocial = week.social.filter((s) => s.state === "approved");
      const approvedCount =
        approvedSocial.length + (week.email?.state === "approved" ? 1 : 0);
      const skippedCount =
        week.social.filter((s) => s.state === "skipped").length +
        (week.email?.state === "skipped" ? 1 : 0);

      let scheduled = 0;
      let next = week;
      if (approvedSocial.length > 0) {
        const acctRes = await fetch("/api/social/schedule");
        const { accounts } = (
          acctRes.ok ? await acctRes.json() : { accounts: [] }
        ) as { accounts?: { platform: string }[] };
        const platforms = [...new Set((accounts ?? []).map((a) => a.platform))];
        if (platforms.length === 0) {
          setScheduleMsg("Connect a social account to schedule posts — the email can still go out.");
        } else {
          for (const s of approvedSocial) {
            const post = draftFor(s);
            if (!post) continue;
            const r = await fetch("/api/social/schedule", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                projectId,
                post,
                platforms,
                cadence: "weekly",
                day_of_week: DAY_OF_WEEK[s.day],
                send_hour_et: 9,
              }),
            });
            if (r.ok) {
              scheduled++;
              next = {
                ...next,
                social: next.social.map((x) =>
                  x.did === s.did ? { ...x, state: "scheduled" as const } : x,
                ),
              };
            }
          }
          await persist(next);
          setScheduleMsg(
            `${scheduled} post${scheduled === 1 ? "" : "s"} queued — sending activates at launch.`,
          );
        }
      }

      // Verdict metric #1 — fire regardless of how many landed (counts tell the story).
      void fetch(`/api/projects/${projectId}/track`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: "week_schedule_all",
          approved: approvedCount,
          skipped: skippedCount,
        }),
      });

      if (next.email?.state === "approved") setEmailScheduleFor(next.email.did);
    } finally {
      setScheduleAllBusy(false);
    }
  }

  const anyApproved =
    !!week &&
    (week.email?.state === "approved" || week.social.some((s) => s.state === "approved"));

  return (
    <section className="mb-6 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">This Week</h2>
        {week && (
          <span className="text-[10px] text-white/35">
            Week of {week.week_of.slice(5, 7)}/{week.week_of.slice(8, 10)}/{week.week_of.slice(0, 4)}
          </span>
        )}
      </div>

      {generating && (
        <p className="mt-2 flex items-center gap-2 text-xs text-white/50">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-gulf-teal" />
          Preparing your week — email and posts build from fresh data…
        </p>
      )}

      {genError && !generating && (
        <button
          type="button"
          onClick={generate}
          className="mt-2 rounded-full border border-amber-400/40 px-3 py-1 text-xs text-amber-300 hover:bg-amber-400/10"
        >
          Some of this week didn&apos;t generate — retry
        </button>
      )}

      {week && (week.email || week.social.length > 0) && (
        <>
          <ul className="mt-3 space-y-2">
            {week.email && (
              <QueueCard
                badge="Email"
                title="This week's market email"
                excerpt=""
                state={week.email.state}
                onApprove={() => {
                  setEmailState("approved");
                  setEmailScheduleFor(week.email!.did);
                }}
                onTweak={() => router.push(`/project/${projectId}/email-lab?did=${week.email!.did}`)}
                onSkip={() => setEmailState("skipped")}
              />
            )}
            {week.social.map((s) => (
              <QueueCard
                key={s.did}
                badge={DAY_LABEL[s.day]}
                title={s.theme}
                excerpt={s.caption}
                state={s.state}
                onApprove={() => {
                  setSocialState(s.did, "approved");
                  setSocialScheduleFor({ ...s, state: "approved" });
                }}
                onTweak={() => router.push(`/project/${projectId}/email-lab?did=${s.did}`)}
                onSkip={() => setSocialState(s.did, "skipped")}
              />
            ))}
          </ul>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void scheduleAll()}
              disabled={!anyApproved || scheduleAllBusy}
              className="rounded-full bg-gulf-teal px-4 py-1.5 text-xs font-semibold text-[#04121b] hover:bg-[#17a3b3] disabled:opacity-40"
            >
              {scheduleAllBusy ? "Scheduling…" : "Schedule all approved"}
            </button>
            {scheduleMsg && <span className="text-[11px] text-white/50">{scheduleMsg}</span>}
          </div>
        </>
      )}

      {emailScheduleFor && (
        <ScheduleSendModal
          deliverableId={emailScheduleFor}
          projectId={projectId}
          scopeKind={scopeKind}
          scopeValue={scopeValue}
          onClose={() => setEmailScheduleFor(null)}
        />
      )}
      {socialScheduleFor && draftFor(socialScheduleFor) && (
        <ScheduleSocialModal
          draft={draftFor(socialScheduleFor)!}
          projectId={projectId}
          scopeKind={scopeKind}
          scopeValue={scopeValue}
          onClose={() => setSocialScheduleFor(null)}
        />
      )}
    </section>
  );
}

function QueueCard({
  badge,
  title,
  excerpt,
  state,
  onApprove,
  onTweak,
  onSkip,
}: {
  badge: string;
  title: string;
  excerpt: string;
  state: QueueItemState;
  onApprove: () => void;
  onTweak: () => void;
  onSkip: () => void;
}) {
  const done = state === "scheduled" || state === "skipped";
  return (
    <li
      className={`rounded-lg border border-white/10 p-3 ${done ? "opacity-50" : "bg-white/[0.03]"}`}
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-gulf-teal/15 px-1.5 py-0.5 text-[10px] font-semibold text-gulf-teal">
          {badge}
        </span>
        <span className="truncate text-xs font-medium text-white/85">{title}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-white/35">{state}</span>
      </div>
      {excerpt && <p className="mt-1 line-clamp-2 text-[11px] text-white/45">{excerpt}</p>}
      {!done && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onApprove}
            className="rounded-full bg-gulf-teal/90 px-2.5 py-1 text-[10px] font-semibold text-[#04121b] hover:bg-gulf-teal"
          >
            Approve &amp; schedule
          </button>
          <button
            type="button"
            onClick={onTweak}
            className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] text-white/60 hover:bg-white/5"
          >
            Tweak
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="rounded-full px-2.5 py-1 text-[10px] text-white/35 hover:text-white/60"
          >
            Skip
          </button>
        </div>
      )}
    </li>
  );
}
```

Note: `retry` duplicates the effect's fetch on purpose — a second POST regenerates only the missing sides (route's `missingSides` logic), so retry is cheap and safe.

- [ ] **Step 2: Mount it in `ProjectWorkspace.tsx`**

Three edits:

(a) Imports (top of file):

```ts
import { ThisWeek } from "./workspace/ThisWeek";
import type { ThisWeekState } from "@/lib/project/this-week";
```

(`emailDeliverableScope` is already imported at `:9`.)

(b) Inside the component, before the `return`:

```ts
  const emailScope = emailDeliverableScope(items);
```

(c) In the JSX, directly after `<Breadcrumbs …/>` (`:471`) and before the `{seed && …}` block — This Week is the TOP section:

```tsx
      <ThisWeek
        projectId={id}
        week={(uiState.this_week as ThisWeekState | undefined) ?? null}
        deliverables={deliverables}
        scopeKind={emailScope?.scope_kind ?? null}
        scopeValue={emailScope?.scope_value ?? null}
        onWeekChange={(next) => patchUiState({ this_week: next })}
      />
```

- [ ] **Step 3: Build to verify**

Run: `bunx next build`
Expected: compiles. (The `/api/projects/[id]/track` fetch 404s until Task 8 — it's fire-and-forget `void`, non-breaking; Task 8 lands before verification.)

- [ ] **Step 4: Commit**

```bash
git add "app/project/[id]/workspace/ThisWeek.tsx" "app/project/[id]/ProjectWorkspace.tsx"
git commit -m "feat(cockpit): This Week ready-for-you queue on the project overview — approve/tweak/skip + schedule-all"
```

---

### Task 8: Instrumentation — the two verdict metrics

**Files:**
- Create: `app/api/projects/[id]/track/route.ts`
- Modify: `app/project/[id]/page.tsx` (project_open event)

**Interfaces:**
- Consumes: `recordUse`/`recordUseForClient` (`lib/highlighter/meter.ts:43,63` — writes `usage_events`, the existing event capture; probe confirmed no other product-event store fits better, so NO new table).
- Produces: `POST /api/projects/[id]/track` `{ event: "week_schedule_all", approved: number, skipped: number }` (whitelisted event names only). Metric derivations (offline SQL over `usage_events`): **schedule-all rate** = distinct projects with `week_schedule_all` ÷ distinct projects with `week_generated`; **7-day return** = `project_open` within 7 days after a `week_generated` for the same `project:<id>` reach tag.

- [ ] **Step 1: Write the track route**

```ts
// app/api/projects/[id]/track/route.ts
//
// Cockpit instrumentation — the verdict metrics ride the EXISTING event
// capture (usage_events via lib/highlighter/meter), no new table. Whitelisted
// event names only; counts travel in the reach tags (the column is a text[]).
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { recordUse } from "@/lib/highlighter/meter";

export const runtime = "nodejs";

const EVENTS = new Set(["week_schedule_all"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const db = createClient(await cookies());
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: project } = await db.from("projects").select("id").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    event?: string;
    approved?: number;
    skipped?: number;
  } | null;
  if (!body?.event || !EVENTS.has(body.event)) {
    return NextResponse.json({ error: "unknown event" }, { status: 400 });
  }

  await recordUse(
    req,
    {
      report_id: "",
      reach: [
        `project:${id}`,
        `approved:${Number.isFinite(body.approved) ? body.approved : 0}`,
        `skipped:${Number.isFinite(body.skipped) ? body.skipped : 0}`,
      ],
      action: body.event,
    },
    user.id,
  );
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Record `project_open` in the project page**

In `app/project/[id]/page.tsx`, add the import:

```ts
import { recordUseForClient } from "@/lib/highlighter/meter";
```

and directly after the project row is confirmed (after `if (!data) notFound();` at `:114`):

```ts
  // Cockpit verdict metric #2 anchor: every authenticated project open. The
  // 7-day-return query pairs these with week_generated events. recordUse* never
  // throws — metering must never break the page.
  await recordUseForClient(
    `uid:${user.id}`,
    { report_id: "", reach: [`project:${id}`], action: "project_open" },
    user.id,
  );
```

- [ ] **Step 3: Build to verify**

Run: `bunx next build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add "app/api/projects/[id]/track/route.ts" "app/project/[id]/page.tsx"
git commit -m "feat(cockpit): instrument the two verdict metrics — week_schedule_all + project_open into usage_events"
```

---

### Task 9: Retire the standalone labs for signed-in users

**Files:**
- Create: `lib/project/lab-redirect.ts`
- Test: `lib/project/lab-redirect.test.ts`
- Create: `app/email-lab/AutoCreateProject.tsx`
- Modify: `app/email-lab/page.tsx`
- Modify: `app/email-lab/grid/page.tsx`

**Interfaces:**
- Consumes: `POST /api/projects` (`app/api/projects/route.ts:19` — the tokenless create; applies the saved brand profile via `applyUserBrandToProject`. NOT `/api/claim`, which is the token-funnel path).
- Produces: `labDestination(projects)`. Anonymous visitors keep both standalone labs untouched (Phase 2 kills them). No shell code deleted — the pages become thin redirect-or-render wrappers.

- [ ] **Step 1: Write the failing test**

```ts
// lib/project/lab-redirect.test.ts
import { describe, expect, test } from "bun:test";
import { labDestination } from "./lab-redirect";

describe("labDestination (signed-in standalone-lab redirect chooser)", () => {
  test("most recent project wins (input is already updated_at-desc)", () => {
    expect(labDestination([{ id: "recent" }, { id: "older" }])).toBe(
      "/project/recent/email-lab",
    );
  });
  test("zero projects → null (caller auto-creates via POST /api/projects)", () => {
    expect(labDestination([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/project/lab-redirect.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the helper**

```ts
// lib/project/lab-redirect.ts
// Cockpit D4 — signed-in visits to the standalone labs land in a project's
// Email tab (grid is the default canvas there, so one destination covers both
// /email-lab and /email-lab/grid). Null = no projects; the caller auto-creates.
export function labDestination(projects: { id: string }[]): string | null {
  const first = projects[0];
  return first ? `/project/${first.id}/email-lab` : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/project/lab-redirect.test.ts`
Expected: PASS

- [ ] **Step 5: Write the auto-create client**

```tsx
// app/email-lab/AutoCreateProject.tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Cockpit D4 — a signed-in lab visitor with ZERO projects gets one made for
// them via POST /api/projects (tokenless; the saved brand profile applies
// server-side). Redirect race / create failure falls back to /project.
export function AutoCreateProject() {
  const router = useRouter();
  const firedRef = useRef(false); // strict-mode double-fire would create two projects

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("create failed"))))
      .then((data: { id?: string }) => {
        router.replace(data.id ? `/project/${data.id}/email-lab` : "/project");
      })
      .catch(() => router.replace("/project"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center">
      <p className="flex items-center gap-2 text-sm text-white/50">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-gulf-teal" />
        Setting up your project…
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Rewrite both standalone pages as redirect-or-render wrappers**

```tsx
// app/email-lab/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { labDestination } from "@/lib/project/lab-redirect";
import { AutoCreateProject } from "./AutoCreateProject";
import { EmailLabClient } from "./EmailLabClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Email Lab — Design Surface" };

// Cockpit D4 — signed-in users work in their project's Email tab; the
// standalone lab stays the anonymous taste-surface until Phase 2.
export default async function EmailLabPage() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data } = await supabase
      .from("projects")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1);
    const dest = labDestination((data as { id: string }[] | null) ?? []);
    if (dest) redirect(dest);
    return <AutoCreateProject />;
  }
  return <EmailLabClient />;
}
```

```tsx
// app/email-lab/grid/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { labDestination } from "@/lib/project/lab-redirect";
import { AutoCreateProject } from "../AutoCreateProject";
import { EmailLabGridClient } from "./EmailLabGridClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Email Lab — Grid (North Star)" };

// Cockpit D4 — same chooser as /email-lab; the project Email tab defaults to
// the grid canvas, so grid visitors lose nothing.
export default async function EmailLabGridPage() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data } = await supabase
      .from("projects")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1);
    const dest = labDestination((data as { id: string }[] | null) ?? []);
    if (dest) redirect(dest);
    return <AutoCreateProject />;
  }
  return <EmailLabGridClient />;
}
```

- [ ] **Step 7: Build to verify**

Run: `bunx next build`
Expected: compiles; both routes flip from static to dynamic (expected — they now read cookies).

- [ ] **Step 8: Commit**

```bash
git add lib/project/lab-redirect.ts lib/project/lab-redirect.test.ts app/email-lab/AutoCreateProject.tsx app/email-lab/page.tsx app/email-lab/grid/page.tsx
git commit -m "feat(cockpit): standalone labs redirect signed-in users into their project's Email tab (auto-create when none)"
```

---

### Task 10: Full verification + session bookkeeping

**Files:**
- Modify: `SESSION_LOG.md` (new top entry)
- No push in this task — operator confirms pushes.

- [ ] **Step 1: Full unit-test pass on everything this plan touched or neighbors**

Run:
```bash
bun test lib/project/this-week.test.ts lib/project/tool-tabs.test.ts lib/email/doc/grid-layouts.test.ts lib/email/lab/canvas-pref.test.ts lib/project/lab-redirect.test.ts
bun test lib/email lib/project lib/deliverable
```
Expected: all PASS (pre-existing known-flaky: `proposal-nonce` — if it reds, loop it locally before blaming the diff, per repo rules).

- [ ] **Step 2: Build gate**

Run: `bunx next build`
Expected: clean build.

- [ ] **Step 3: Drive the flow (dev server, manual)**

Run: `bun run dev`, then walk the spec's verification path and record what you see (do not claim success without observing it):
1. Open a signed-in project → **This Week** populates (email + Mon–Fri posts) after generation; reload → still there (once-per-week guard, no re-generation).
2. **Tweak** the email → lands on the Email tab, GRID canvas by default, per-section AI edit works; toggle to block canvas → with an in-flight edit the dialog appears (Save & switch / Switch without saving / Cancel); preference survives reload.
3. **Social tab** → Generate Week → Load Card previews with project brand; Schedule one post → row lands.
4. Back on Overview → Approve items → **Schedule all approved** → social rows in `social_schedules` with non-null `next_run_at`, email modal opens for audience; confirmation copy says "Queued — sending activates at launch."
5. `/email-lab` while signed in → redirected into the project Email tab; in a private window (anonymous) → the standalone lab renders unchanged.
6. Check `usage_events` for `week_generated`, `project_open`, `week_schedule_all` rows (SQL via Bun.SQL, creds in `.dlt/secrets.toml`).

- [ ] **Step 4: SESSION_LOG entry + final commit**

Append a top-of-file SESSION_LOG.md entry summarizing: what shipped (D0–D4 + instrumentation), test/build evidence, that `project_cockpit_live_verify` remains open for the operator, and the two exit criteria (scheduler go-live decision; both events verified firing in prod).

```bash
git add SESSION_LOG.md
git commit -m "log: project-cockpit Phase 1 implementation session entry"
```

Then STOP — show the operator `git log --oneline origin/main..HEAD` and wait for push confirmation (`node scripts/safe-push.mjs` after approval; check `git log origin/main..HEAD` for foreign commits first).

---

## Spec-coverage map (self-review)

| Spec section | Task(s) |
|---|---|
| D0 queue: generate once/week, persist as materials, degrade + retry chip, partial failure | 1, 6, 7 |
| D0 Schedule-all (paywall moment, against existing schedule rows) | 7 |
| D1 tool switcher (nested layout, usePathname client highlight, mobile segmented) | 2 |
| D2 grid default + `initialAiPrompt`/`autoGenerate` on grid shell + `ui_state.email_canvas` + unsaved-toggle dialog + `?did=` opens preferred canvas | 3, 4 |
| D3 social tool page (composer + Generate-Week + onSchedule + card preview + Edit in Email) | 5 |
| D4 signed-in lab retirement (redirect / auto-create via POST /api/projects / anonymous untouched / deleted-project fallback → /project) | 9 |
| Instrumentation (week_schedule_all with counts, 7-day return) | 6 (week_generated anchor), 8 |
| Error handling (unscoped → region fallback; Generate-Week error state unchanged; partial failure) | 5, 6, 7 |
| Testing list (switcher active-state; redirect chooser; email_canvas round-trip; unsaved-toggle paths; once-per-week guard; suites green; bunx next build; drive) | 2, 9, 4, 4, 1, 10 |
| Exit criteria (scheduler go-live OR honest copy; events firing in prod) | honest copy in 7; verification note in 10; go-live = operator call, NOT a code task |

## Known deferrals (explicitly out, per spec)

- Publish-engine ⇆ calendar wiring; quotas/Stripe; anonymous cockpit; homepage showcase; Phase 1.5 listing-lifecycle queue drafts; the weekly "your week is ready" notification.
- Stale queue items refresh through the existing per-material refresh (`/api/projects/[id]/materials/[did]/refresh`) — already live in MaterialsHub, nothing to build.
