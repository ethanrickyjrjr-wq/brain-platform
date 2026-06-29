# Grid Email: File Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** ⚡ Sonnet — 7 files, keywords: schema, architecture

**Goal:** Auto-save the grid email doc to localStorage so closing the tab loses nothing, and add a named-save flow backed by the `deliverables` table so users can reload past grid designs from a right-panel picker.

**Architecture:** `EmailLabGridShell` gains a `draftKey` prop that enables 3-second debounced localStorage writes and a restore toast on mount. A new `GET|POST /api/email-lab/designs` and `GET|PATCH /api/email-lab/designs/[id]` pair stores free-standing block-canvas deliverables (`project_id: null`, `instruction` = design name). `EmailLabGridClient` (the standalone `/email-lab/grid` route) gets an `onSave` callback and a `SaveDesignModal` gate on first save. A "My Designs" accordion in the right panel lists and loads past designs.

**Tech Stack:** Next.js App Router API routes, Supabase service-role client, `EmailDocSchema` (Zod, `lib/email/doc/schema.ts`), `sonner` toast (already installed), `bun:test` mocks.

## Global Constraints

- All Supabase writes through `createServiceRoleClient()` — `deliverables` has no INSERT/UPDATE RLS.
- Reads via `createClient(await cookies())` with explicit `.eq("user_id", user.id)` filter.
- `EmailDocSchema.safeParse()` validates every incoming doc; reject with `400` on failure.
- `EMPTY_NARRATIVE = { exec_summary: "", sections: [], inference_notes: [] }` on all inserts.
- Design name stored in `instruction` column; max 100 chars trimmed; default `"Untitled Email"`.
- `draftKey` prop absent = no auto-draft (project-scoped shell already has `onSave`).
- `sonner` import: `import { toast } from "sonner"`.
- Runtime: `export const runtime = "nodejs"` on all new API routes.
- All routes return `NextResponse.json(...)`.

---

### Task 1: localStorage auto-draft + restore toast

**Files:**
- 🔴 Modify: `components/email-lab/EmailLabGridShell.tsx`

**Interfaces:**
- Produces: `draftKey?: string` prop on `EmailLabGridShellProps`; when set, shell auto-saves `doc` to `localStorage[draftKey]` every 3 s and restores on mount via `sonner` toast.

- [ ] **Step 1: Add `draftKey` to props interface**

In `EmailLabGridShell.tsx`, extend `EmailLabGridShellProps` (currently at line ~143):

```tsx
export interface EmailLabGridShellProps {
  // ... existing props ...
  draftKey?: string; // when set, enables localStorage auto-draft + restore
}
```

And destructure it in the function signature alongside the existing props.

- [ ] **Step 2: Add auto-save effect**

Inside `EmailLabGridShell`, after the existing `useEffect` blocks (after line ~646), add:

```tsx
// Auto-save draft to localStorage (only when draftKey prop is set)
useEffect(() => {
  if (!draftKey) return;
  const timer = setTimeout(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ doc, savedAt: Date.now() }));
    } catch {
      // quota exceeded — silently skip
    }
  }, 3000);
  return () => clearTimeout(timer);
}, [doc, draftKey]);
```

- [ ] **Step 3: Add restore effect**

Add a ref to track whether restore was attempted (prevents double-fire in StrictMode):

```tsx
const draftRestoreAttempted = useRef(false);

useEffect(() => {
  if (!draftKey || draftRestoreAttempted.current) return;
  draftRestoreAttempted.current = true;
  const raw = localStorage.getItem(draftKey);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as { doc?: unknown; savedAt?: number };
    const age = Date.now() - (parsed.savedAt ?? 0);
    if (age > 7 * 24 * 60 * 60 * 1000) return; // discard drafts older than 7 days
    const docParsed = EmailDocSchema.safeParse(parsed.doc);
    if (!docParsed.success) return;
    const restored = applyBrand(docParsed.data, brandTokens);
    setHistory((h) => ({ past: [h.present], present: restored, future: [] }));
    toast("Draft restored", {
      description: "Your unsaved work has been loaded.",
      action: {
        label: "Discard",
        onClick: () => {
          localStorage.removeItem(draftKey);
          setHistory(initHistory(applyBrand(initialDoc, brandTokens)));
        },
      },
      duration: 10000,
    });
  } catch {
    // malformed draft — ignore
  }
}, [draftKey]); // intentionally omits doc/brandTokens — runs once on mount
```

- [ ] **Step 4: Clear draft on explicit save**

Find the `commit` function (line ~212). After the `setHistory` call, add a localStorage clear when `draftKey` is set:

```tsx
function commit(next: EmailDoc) {
  editingRef.current = false;
  if (idleRef.current) clearTimeout(idleRef.current);
  setHistory((h) => pushDoc(h, next));
  // Clear stale draft when user explicitly commits (Save button / AI build)
  if (draftKey) {
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
  }
}
```

Wait — this clears draft on EVERY commit (every block move, text edit, etc.). That's too aggressive. Instead, clear only when `onSave` completes. Revert the `commit` change above.

Instead, clear draft in the `openSend` / `openSchedule` / explicit Save flow. The cleanest place: clear in the `onSave` callback wrapper already in the shell. Add this inside the shell (NOT in `commit`):

```tsx
// Clear draft after a successful explicit save to deliverable
async function handleExplicitSave() {
  if (!onSave) return;
  const result = await onSave(doc, aiPrompt);
  if (result && draftKey) {
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
  }
}
```

Then replace the Save button's `onClick={()=>onSave(doc,aiPrompt)}` with `onClick={handleExplicitSave}` (line ~733 in the JSX).

- [ ] **Step 5: Run type check**

```
cd C:/Users/ethan/dev/brain-platform && bunx next build --no-lint 2>&1 | tail -20
```

Expected: build succeeds (0 TS errors in new code).

- [ ] **Step 6: Commit**

```bash
git add components/email-lab/EmailLabGridShell.tsx
git commit -m "feat(email-lab): localStorage auto-draft + restore toast in grid shell"
```

---

### Task 2: Designs API routes

**Files:**
- Create: `app/api/email-lab/designs/route.ts`
- Create: `app/api/email-lab/designs/[id]/route.ts`
- Create: `app/api/email-lab/designs/route.test.ts`
- Create: `app/api/email-lab/designs/[id]/route.test.ts`

**Interfaces:**
- `GET /api/email-lab/designs` → `{ designs: { id: string; name: string; created_at: string }[] }`
- `POST /api/email-lab/designs` body `{ doc: EmailDoc; name?: string }` → `{ id: string }` (201)
- `GET /api/email-lab/designs/[id]` → `{ id: string; name: string; doc: EmailDoc; created_at: string }`
- `PATCH /api/email-lab/designs/[id]` body `{ doc: EmailDoc }` → `{ ok: true }`

- [ ] **Step 1: Write failing tests for collection route**

Create `app/api/email-lab/designs/route.test.ts`:

```ts
import { test, expect, mock, beforeEach } from "bun:test";

interface Scenario {
  user: { id: string } | null;
  rows: Record<string, unknown>[];
  insertError: unknown;
  lastInsert: Record<string, unknown> | null;
}
const sc: Scenario = { user: null, rows: [], insertError: null, lastInsert: null };

mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: sc.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ is: () => ({ is: () => ({
          order: () => ({ limit: async () => ({ data: sc.rows }) }),
        }) }) }) }),
      }),
    }),
  }),
}));
mock.module("@/utils/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        sc.lastInsert = row;
        return { async then(resolve: (v: { error: unknown }) => void) { resolve({ error: sc.insertError }); } };
      },
    }),
  }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));

beforeEach(() => {
  sc.user = null; sc.rows = []; sc.insertError = null; sc.lastInsert = null;
});

// Import after mocks
import { GET, POST } from "./route";
import { NextRequest } from "next/server";

const validDoc = {
  globalStyle: { fontFamily: "MODERN_SANS", primaryColor: "#000", accentColor: "#fff", textColor: "#222", backgroundColor: "#fff" },
  blocks: [{ id: "b1", type: "header", props: { title: "Test" } }],
};

test("GET 401 when unauthenticated", async () => {
  const res = await GET(new NextRequest("http://x/api/email-lab/designs"));
  expect(res.status).toBe(401);
});

test("GET returns designs list for authenticated user", async () => {
  sc.user = { id: "u1" };
  sc.rows = [{ id: "d1", instruction: "My Design", created_at: "2026-06-29T00:00:00Z" }];
  const res = await GET(new NextRequest("http://x/api/email-lab/designs"));
  expect(res.status).toBe(200);
  const body = await res.json() as { designs: unknown[] };
  expect(body.designs).toHaveLength(1);
});

test("POST 401 when unauthenticated", async () => {
  const res = await POST(new NextRequest("http://x/api/email-lab/designs", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ doc: validDoc }),
  }));
  expect(res.status).toBe(401);
});

test("POST 400 on invalid doc", async () => {
  sc.user = { id: "u1" };
  const res = await POST(new NextRequest("http://x/api/email-lab/designs", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ doc: { garbage: true } }),
  }));
  expect(res.status).toBe(400);
});

test("POST 201 with valid doc, stores instruction as name", async () => {
  sc.user = { id: "u1" };
  const res = await POST(new NextRequest("http://x/api/email-lab/designs", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ doc: validDoc, name: "Open house flyer" }),
  }));
  expect(res.status).toBe(201);
  const body = await res.json() as { id: string };
  expect(typeof body.id).toBe("string");
  expect(sc.lastInsert?.instruction).toBe("Open house flyer");
  expect(sc.lastInsert?.project_id).toBeNull();
  expect(sc.lastInsert?.template).toBe("block-canvas");
});

test("POST uses 'Untitled Email' when name omitted", async () => {
  sc.user = { id: "u1" };
  await POST(new NextRequest("http://x/api/email-lab/designs", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ doc: validDoc }),
  }));
  expect(sc.lastInsert?.instruction).toBe("Untitled Email");
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```
cd C:/Users/ethan/dev/brain-platform && bun test app/api/email-lab/designs/route.test.ts 2>&1 | tail -15
```

Expected: error about missing `./route`.

- [ ] **Step 3: Implement `app/api/email-lab/designs/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { EmailDocSchema } from "@/lib/email/doc/schema";

export const runtime = "nodejs";

const EMPTY_NARRATIVE = { exec_summary: "", sections: [], inference_notes: [] };

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const db = createClient(await cookies());
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data } = await db
    .from("deliverables")
    .select("id, instruction, created_at")
    .eq("user_id", user.id)
    .eq("template", "block-canvas")
    .is("project_id", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const designs = (data ?? []).map((r) => ({
    id: r.id,
    name: (r.instruction as string | null) ?? "Untitled Email",
    created_at: r.created_at,
  }));
  return NextResponse.json({ designs });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const db = createClient(await cookies());
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = EmailDocSchema.safeParse(body?.doc);
  if (!parsed.success) return NextResponse.json({ error: "invalid doc" }, { status: 400 });

  const name =
    typeof body?.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 100)
      : "Untitled Email";

  const newId = crypto.randomUUID();
  const admin = createServiceRoleClient();
  const { error } = await admin.from("deliverables").insert({
    id: newId,
    user_id: user.id,
    project_id: null,
    template: "block-canvas",
    doc: parsed.data,
    instruction: name,
    data_as_of: new Date().toISOString(),
    narrative: EMPTY_NARRATIVE,
    items_snapshot: [],
    status: "ready",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: newId }, { status: 201 });
}
```

- [ ] **Step 4: Run tests — expect PASS**

```
bun test app/api/email-lab/designs/route.test.ts 2>&1 | tail -15
```

Expected: all 6 tests green.

- [ ] **Step 5: Write failing tests for `[id]` route**

Create `app/api/email-lab/designs/[id]/route.test.ts`:

```ts
import { test, expect, mock, beforeEach } from "bun:test";

interface Scenario {
  user: { id: string } | null;
  row: Record<string, unknown> | null;
  updateError: unknown;
  lastUpdate: Record<string, unknown> | null;
}
const sc: Scenario = { user: null, row: null, updateError: null, lastUpdate: null };

mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: sc.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: sc.row }) }),
      }),
    }),
  }),
}));
mock.module("@/utils/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: sc.row }) }),
      }),
      update: (patch: Record<string, unknown>) => {
        sc.lastUpdate = patch;
        return { eq: async () => ({ error: sc.updateError }) };
      },
    }),
  }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));

beforeEach(() => { sc.user = null; sc.row = null; sc.updateError = null; sc.lastUpdate = null; });

import { GET, PATCH } from "./route";
import { NextRequest } from "next/server";

const params = Promise.resolve({ id: "d1" });

const validDoc = {
  globalStyle: { fontFamily: "MODERN_SANS", primaryColor: "#000", accentColor: "#fff", textColor: "#222", backgroundColor: "#fff" },
  blocks: [{ id: "b1", type: "header", props: { title: "Test" } }],
};

test("GET 401 unauthenticated", async () => {
  const res = await GET(new NextRequest("http://x/api/email-lab/designs/d1"), { params });
  expect(res.status).toBe(401);
});

test("GET 404 not found", async () => {
  sc.user = { id: "u1" };
  const res = await GET(new NextRequest("http://x/api/email-lab/designs/d1"), { params });
  expect(res.status).toBe(404);
});

test("GET 403 foreign design", async () => {
  sc.user = { id: "u1" };
  sc.row = { id: "d1", user_id: "other", instruction: "Foo", created_at: "2026-06-29", doc: validDoc, project_id: null };
  const res = await GET(new NextRequest("http://x/api/email-lab/designs/d1"), { params });
  expect(res.status).toBe(403);
});

test("GET 200 returns design with doc", async () => {
  sc.user = { id: "u1" };
  sc.row = { id: "d1", user_id: "u1", instruction: "My Design", created_at: "2026-06-29", doc: validDoc, project_id: null };
  const res = await GET(new NextRequest("http://x/api/email-lab/designs/d1"), { params });
  expect(res.status).toBe(200);
  const body = await res.json() as { name: string };
  expect(body.name).toBe("My Design");
});

test("PATCH 401 unauthenticated", async () => {
  const res = await PATCH(new NextRequest("http://x/api/email-lab/designs/d1", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ doc: validDoc }),
  }), { params });
  expect(res.status).toBe(401);
});

test("PATCH 403 foreign design", async () => {
  sc.user = { id: "u1" };
  sc.row = { id: "d1", user_id: "other", project_id: null };
  const res = await PATCH(new NextRequest("http://x/api/email-lab/designs/d1", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ doc: validDoc }),
  }), { params });
  expect(res.status).toBe(403);
});

test("PATCH 200 updates doc", async () => {
  sc.user = { id: "u1" };
  sc.row = { id: "d1", user_id: "u1", project_id: null };
  const res = await PATCH(new NextRequest("http://x/api/email-lab/designs/d1", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ doc: validDoc }),
  }), { params });
  expect(res.status).toBe(200);
  expect(sc.lastUpdate).toHaveProperty("doc");
});
```

- [ ] **Step 6: Run tests — expect FAIL**

```
bun test "app/api/email-lab/designs/[id]/route.test.ts" 2>&1 | tail -10
```

- [ ] **Step 7: Implement `app/api/email-lab/designs/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { EmailDocSchema } from "@/lib/email/doc/schema";
import type { EmailDoc } from "@/lib/email/doc/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(
  _req: NextRequest,
  { params }: Params,
): Promise<NextResponse> {
  const { id } = await params;
  const db = createClient(await cookies());
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data } = await admin
    .from("deliverables")
    .select("id, user_id, instruction, created_at, doc")
    .eq("id", id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (data.user_id !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return NextResponse.json({
    id: data.id,
    name: (data.instruction as string | null) ?? "Untitled Email",
    doc: data.doc as EmailDoc,
    created_at: data.created_at,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: Params,
): Promise<NextResponse> {
  const { id } = await params;
  const db = createClient(await cookies());
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Verify ownership via cookie client (public SELECT — ownership proven by user_id check)
  const { data: existing } = await db
    .from("deliverables")
    .select("user_id, project_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.user_id !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = EmailDocSchema.safeParse(body?.doc);
  if (!parsed.success) return NextResponse.json({ error: "invalid doc" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("deliverables")
    .update({ doc: parsed.data })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 8: Run tests — expect PASS**

```
bun test "app/api/email-lab/designs/[id]/route.test.ts" 2>&1 | tail -10
```

Expected: all 7 tests green.

- [ ] **Step 9: Commit**

```bash
git add app/api/email-lab/designs/route.ts app/api/email-lab/designs/route.test.ts \
  "app/api/email-lab/designs/[id]/route.ts" "app/api/email-lab/designs/[id]/route.test.ts"
git commit -m "feat(email-lab): GET|POST /designs and GET|PATCH /designs/[id] routes"
```

---

### Task 3: SaveDesignModal component

**Files:**
- Create: `components/email-lab/SaveDesignModal.tsx`

**Interfaces:**
- Consumes: `POST /api/email-lab/designs` (Task 2)
- Produces: `SaveDesignModal` component with props `{ doc: EmailDoc; onSaved: (id: string, name: string) => void; onClose: () => void }`

- [ ] **Step 1: Create the component**

Create `components/email-lab/SaveDesignModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { EmailDoc } from "@/lib/email/doc/types";

interface Props {
  doc: EmailDoc;
  onSaved: (id: string, name: string) => void;
  onClose: () => void;
}

export function SaveDesignModal({ doc, onSaved, onClose }: Props) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/email-lab/designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc, name: trimmed }),
      });
      if (!res.ok) {
        setError("Save failed — try again.");
        return;
      }
      const { id } = (await res.json()) as { id: string };
      onSaved(id, trimmed);
    } catch {
      setError("Save failed — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div className="w-80 rounded-xl bg-[#131f27] p-5 shadow-2xl ring-1 ring-white/10">
        <p className="text-sm font-semibold text-white/85">Save design</p>
        <p className="mt-0.5 text-[11px] text-white/35">
          Give this layout a name so you can reload it later.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") onClose();
          }}
          placeholder="e.g. Open house flyer — Pine Ridge"
          maxLength={100}
          className="mt-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 placeholder:text-white/25 focus:border-gulf-teal/50 focus:outline-none focus:ring-1 focus:ring-gulf-teal"
        />
        {error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-white/40 hover:text-white/70"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!name.trim() || saving}
            className="rounded-lg bg-gulf-teal px-4 py-1.5 text-sm font-semibold text-[#070f14] disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify no TS errors**

```
bunx next build --no-lint 2>&1 | grep "SaveDesignModal\|error TS" | head -10
```

Expected: no output (no errors referencing this file).

- [ ] **Step 3: Commit**

```bash
git add components/email-lab/SaveDesignModal.tsx
git commit -m "feat(email-lab): SaveDesignModal component for naming grid designs"
```

---

### Task 4: Wire save + draft into `EmailLabGridClient`

**Files:**
- Modify: `app/email-lab/grid/EmailLabGridClient.tsx`

**Interfaces:**
- Consumes: `SaveDesignModal` (Task 3), `PATCH /api/email-lab/designs/[id]` (Task 2)
- Produces: standalone `/email-lab/grid` gains auto-draft + named save + URL `?did=` sync

- [ ] **Step 1: Rewrite `EmailLabGridClient.tsx`**

Replace the file entirely with:

```tsx
"use client";

import { useState, useRef } from "react";
import { EmailLabGridShell } from "@/components/email-lab/EmailLabGridShell";
import { SaveDesignModal } from "@/components/email-lab/SaveDesignModal";
import { seedById, SEED_DOCS } from "@/lib/email/doc/default-docs";
import type { EmailDoc } from "@/lib/email/doc/types";

const DRAFT_KEY = "email-grid-draft";

export function EmailLabGridClient() {
  const [initialDoc] = useState(() => (seedById("luxury-market-report") ?? SEED_DOCS[0]).build());
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  // pendingDoc holds the doc snapshot that triggered the save modal open
  const pendingDocRef = useRef<EmailDoc | null>(null);

  async function handleSave(doc: EmailDoc, _aiPrompt: string): Promise<string | void> {
    if (!savedId) {
      // First save: open name modal; return undefined so the shell's send/schedule flow
      // sees no id and stays closed until the user names the design.
      pendingDocRef.current = doc;
      setShowSaveModal(true);
      return undefined;
    }
    // Subsequent saves: PATCH in place
    setSaving(true);
    try {
      await fetch(`/api/email-lab/designs/${savedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc }),
      });
      return savedId;
    } finally {
      setSaving(false);
    }
  }

  function handleDesignSaved(id: string, _name: string) {
    setSavedId(id);
    setShowSaveModal(false);
    // Sync URL so a refresh reloads the same design (future: add ?did= loading on mount)
    window.history.replaceState({}, "", `/email-lab/grid?did=${id}`);
  }

  return (
    <>
      <EmailLabGridShell
        initialDoc={initialDoc}
        draftKey={DRAFT_KEY}
        onSave={handleSave}
        saving={saving}
        deliverableId={savedId}
        headerSlot={
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-gulf-teal">Email</span>
            <span className="text-gulf-teal">Lab</span>
            <span className="rounded bg-gulf-teal px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#0a1419]">
              Grid · paid
            </span>
          </span>
        }
      />
      {showSaveModal && pendingDocRef.current && (
        <SaveDesignModal
          doc={pendingDocRef.current}
          onSaved={handleDesignSaved}
          onClose={() => setShowSaveModal(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify build**

```
bunx next build --no-lint 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/email-lab/grid/EmailLabGridClient.tsx
git commit -m "feat(email-lab): wire onSave + auto-draft into standalone grid lab client"
```

---

### Task 5: "My Designs" accordion in the right panel

**Files:**
- 🔴 Modify: `components/email-lab/EmailLabGridShell.tsx`

**Interfaces:**
- Consumes: `GET /api/email-lab/designs` and `GET /api/email-lab/designs/[id]` (Task 2)
- Produces: "My Designs" accordion in the right panel; clicking a design commits it as the current doc

- [ ] **Step 1: Add design list state + loader**

Inside `EmailLabGridShell`, add state for the designs panel (near other `show*` state, ~line 200):

```tsx
const [showDesigns, setShowDesigns] = useState(false);
const [designs, setDesigns] = useState<{ id: string; name: string; created_at: string }[]>([]);
const [designsLoading, setDesignsLoading] = useState(false);
const designsFetchedRef = useRef(false);
```

Add a function to load designs (near other async functions):

```tsx
async function loadDesigns() {
  if (designsFetchedRef.current) return;
  designsFetchedRef.current = true;
  setDesignsLoading(true);
  try {
    const res = await fetch("/api/email-lab/designs");
    if (res.ok) {
      const data = (await res.json()) as { designs: { id: string; name: string; created_at: string }[] };
      setDesigns(data.designs);
    }
  } finally {
    setDesignsLoading(false);
  }
}
```

Add a function to load a single design and commit it:

```tsx
async function loadDesign(id: string) {
  const res = await fetch(`/api/email-lab/designs/${id}`);
  if (!res.ok) return;
  const data = (await res.json()) as { doc: unknown };
  const parsed = EmailDocSchema.safeParse(data.doc);
  if (!parsed.success) return;
  commit(applyBrand(parsed.data, brandTokens));
  setSelectedId(null);
  setAiStatus(null);
  setShowDesigns(false);
}
```

- [ ] **Step 2: Add the accordion to the right panel JSX**

In the right panel's `<div className="flex-1 overflow-y-auto">`, add a new section BEFORE the "Start from a layout" accordion (after the "Now editing" / empty-selection section):

```tsx
{/* ── My Designs ── */}
{onSave && (
  <div className="border-b border-white/8 px-4 pb-4 pt-3">
    <button
      onClick={() => {
        setShowDesigns((v) => !v);
        if (!showDesigns) void loadDesigns();
      }}
      className="flex w-full items-center justify-between py-1 text-[10px] uppercase tracking-[0.15em] text-white/35 hover:text-white/60"
    >
      <span>My Designs</span>
      <span className={`transition-transform ${showDesigns ? "rotate-180" : ""}`}>▾</span>
    </button>
    {showDesigns && (
      <div className="mt-2 space-y-1.5">
        {designsLoading && (
          <p className="text-[11px] text-white/30">Loading…</p>
        )}
        {!designsLoading && designs.length === 0 && (
          <p className="text-[11px] text-white/30">No saved designs yet — hit Save to create one.</p>
        )}
        {designs.map((d) => (
          <button
            key={d.id}
            onClick={() => void loadDesign(d.id)}
            className="w-full rounded-md border border-white/8 bg-white/4 px-3 py-2 text-left transition-colors hover:bg-white/8"
          >
            <span className="block text-xs font-medium text-white/75">{d.name}</span>
            <span className="block text-[10px] leading-tight text-white/35">
              {new Date(d.created_at).toLocaleDateString()}
            </span>
          </button>
        ))}
      </div>
    )}
  </div>
)}
```

Note: the panel only shows when `onSave` is provided, because designs require auth and a save flow.

- [ ] **Step 3: Build + manual smoke**

```
bunx next build --no-lint 2>&1 | tail -10
```

Open `/email-lab/grid`, save a design, open "My Designs", confirm the design appears and loads.

- [ ] **Step 4: Commit**

```bash
git add components/email-lab/EmailLabGridShell.tsx
git commit -m "feat(email-lab): My Designs panel — list and reload saved grid designs"
```

---

## Self-Review

**Spec coverage:**
- localStorage auto-draft → Task 1 ✓
- Named save modal → Task 3 ✓
- Save As API routes → Task 2 ✓
- Wire into standalone grid lab → Task 4 ✓
- My Designs picker → Task 5 ✓

**Placeholder scan:** None found — all steps contain actual code.

**Type consistency:**
- `draftKey?: string` defined in Task 1 props, consumed in Task 4 ✓
- `SaveDesignModal` props defined in Task 3, consumed in Task 4 ✓
- `designs` type `{ id, name, created_at }[]` consistent across Tasks 2 and 5 ✓
- `onSaved(id: string, name: string)` defined in Task 3, implemented in Task 4 as `handleDesignSaved` ✓

**Gap check:** No gaps.

---

## Parallel Safety

> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.

| Group | Tasks | Shared Files |
|-------|-------|--------------|
| 🔴 | Task 1, Task 5 | `components/email-lab/EmailLabGridShell.tsx` |

Tasks with no color badge have no file conflicts — safe to parallelize freely.
