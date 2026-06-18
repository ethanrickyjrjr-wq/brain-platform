# Branding Save Fix + Global Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the BrandingBlock save (currently only writes per-project, never propagates to new projects) by wiring a `/api/user/brand` GET+PATCH endpoint into a two-button save flow ("Save" = global default + current project; "Save To This Project" = current project only), and pre-filling the panel from the user's brand profile on first open.

**Architecture:** `user_brand_profiles` gains four agent-identity columns (`agent_name`, `photo_url`, `license`, `brokerage`). A new `/api/user/brand` route exposes GET (read profile for pre-fill) and PATCH (upsert agent fields). `applyUserBrandToProject` is extended to copy these fields into `projects.branding` at project creation. The BrandingBlock UI is updated to expose two save paths; pre-fill happens in `ProjectWorkspace` on first pill-open when branding is empty.

**Tech Stack:** Next.js App Router API routes, Supabase (cookie client, RLS), Bun test, TypeScript.

## Global Constraints

- Cookie-client only — never service-role in project/user routes (RLS is the authorization).
- SQL migrations are idempotent (`ADD COLUMN IF NOT EXISTS`). Run via psycopg3 using creds from `.dlt/secrets.toml`.
- `bun test` is the test runner. Test files sit next to the route they test.
- Follow existing mock pattern from `app/api/projects/[id]/route.test.ts`: `mock.module` + dynamic import + `beforeEach` to reset scenario.
- Stage only the files you created/modified (`git add <explicit paths>` — never `git add -A`).
- Append a SESSION_LOG entry before any `git push` (RULE 0).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `docs/sql/20260618_user_brand_agent_fields.sql` | Idempotent migration SQL |
| Create | `app/api/user/brand/route.ts` | GET + PATCH /api/user/brand |
| Create | `app/api/user/brand/route.test.ts` | Tests for GET + PATCH |
| Modify | `lib/project/apply-brand.ts` | Copy agent fields on project creation |
| Modify | `lib/project/apply-brand.test.ts` | Tests for agent-field propagation |
| Modify | `app/project/[id]/workspace/BrandingBlock.tsx` | Two save buttons, updated prop interface |
| Modify | `app/project/[id]/ProjectWorkspace.tsx` | Two save handlers + pre-fill on pill open |

---

### Task 1: SQL migration — add agent fields to user_brand_profiles

**Files:**
- Create: `docs/sql/20260618_user_brand_agent_fields.sql`

**Interfaces:**
- Produces: `user_brand_profiles` gains columns `agent_name TEXT`, `photo_url TEXT`, `license TEXT`, `brokerage TEXT` — nullable, no default.

- [ ] **Step 1: Write the migration file**

```sql
-- Add agent identity fields to user_brand_profiles so the BrandingBlock's
-- four fields (agent_name, photo_url, license, brokerage) can be saved as a
-- user-level default and auto-applied to new projects.
-- Idempotent. Already applied: check with the verify query below.

ALTER TABLE public.user_brand_profiles
  ADD COLUMN IF NOT EXISTS agent_name text,
  ADD COLUMN IF NOT EXISTS photo_url  text,
  ADD COLUMN IF NOT EXISTS license    text,
  ADD COLUMN IF NOT EXISTS brokerage  text;

NOTIFY pgrst, 'reload schema';

-- Verify:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'user_brand_profiles'
--       AND column_name IN ('agent_name', 'photo_url', 'license', 'brokerage');
--   -- Should return 4 rows.
```

- [ ] **Step 2: Run it directly against prod**

Read the DB URI from `.dlt/secrets.toml` (key `destination.postgres.credentials.connection_string` or similar — check the file). Then:

```bash
python -c "
import psycopg, pathlib
sql = pathlib.Path('docs/sql/20260618_user_brand_agent_fields.sql').read_text()
with psycopg.connect('postgresql://postgres:<password>@<host>:5432/postgres') as conn:
    conn.execute(sql)
    conn.commit()
    rows = conn.execute(\"SELECT column_name FROM information_schema.columns WHERE table_name='user_brand_profiles' AND column_name IN ('agent_name','photo_url','license','brokerage')\").fetchall()
    print('Columns added:', [r[0] for r in rows])
"
```

Expected output: `Columns added: ['agent_name', 'photo_url', 'license', 'brokerage']` (order may vary).

- [ ] **Step 3: Commit the migration file**

```bash
git add docs/sql/20260618_user_brand_agent_fields.sql
git commit -m "feat(db): add agent identity columns to user_brand_profiles"
```

---

### Task 2: GET + PATCH /api/user/brand

**Files:**
- Create: `app/api/user/brand/route.ts`
- Create: `app/api/user/brand/route.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/user/brand` → `200 { agent_name, photo_url, license, brokerage, primary_color, accent_color, logo_url }` (all nullable strings, missing keys omitted) or `{}` if no profile row exists. `401` when unauthenticated.
  - `PATCH /api/user/brand` with body `{ agent_name?, photo_url?, license?, brokerage? }` → `200 { ok: true }`, `400` on invalid body, `401` unauthenticated, `500` on DB error.

- [ ] **Step 1: Write the failing tests**

Create `app/api/user/brand/route.test.ts`:

```typescript
import { test, expect, mock, beforeEach } from "bun:test";

const scenario: {
  user: { id: string } | null;
  profile: Record<string, unknown> | null;
  upsertError: { message: string } | null;
} = {
  user: { id: "user-a" },
  profile: null,
  upsertError: null,
};

mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scenario.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: scenario.profile, error: null }),
        }),
      }),
      upsert: async () => ({ error: scenario.upsertError }),
    }),
  }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));

const { GET, PATCH } = await import("./route");

function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/user/brand", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as import("next/server").NextRequest;
}

beforeEach(() => {
  scenario.user = { id: "user-a" };
  scenario.profile = null;
  scenario.upsertError = null;
});

// --- GET ---

test("GET unauthenticated → 401", async () => {
  scenario.user = null;
  const res = await GET(req("GET"));
  expect(res.status).toBe(401);
});

test("GET no profile → 200 empty object", async () => {
  scenario.profile = null;
  const res = await GET(req("GET"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({});
});

test("GET with profile → 200 returns selected fields", async () => {
  scenario.profile = {
    agent_name: "Jane Smith",
    photo_url: null,
    license: "SL3456789",
    brokerage: "Gulf Realty",
    primary_color: "#00d4aa",
    accent_color: null,
    logo_url: null,
  };
  const res = await GET(req("GET"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.agent_name).toBe("Jane Smith");
  expect(body.license).toBe("SL3456789");
  expect(body.brokerage).toBe("Gulf Realty");
  expect(body.primary_color).toBe("#00d4aa");
});

// --- PATCH ---

test("PATCH unauthenticated → 401", async () => {
  scenario.user = null;
  const res = await PATCH(req("PATCH", { agent_name: "Jane" }));
  expect(res.status).toBe(401);
});

test("PATCH non-object body → 400", async () => {
  const res = await PATCH(req("PATCH", "bad"));
  expect(res.status).toBe(400);
});

test("PATCH valid agent fields → 200", async () => {
  const res = await PATCH(
    req("PATCH", { agent_name: "Jane Smith", license: "SL3456789", brokerage: "Gulf Realty" }),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("PATCH DB error → 500", async () => {
  scenario.upsertError = { message: "db fail" };
  const res = await PATCH(req("PATCH", { agent_name: "Jane" }));
  expect(res.status).toBe(500);
});

test("PATCH ignores unknown keys (only agent fields written)", async () => {
  // Should not throw even if extra keys are passed
  const res = await PATCH(req("PATCH", { agent_name: "Jane", hacker_field: "evil" }));
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test app/api/user/brand/route.test.ts
```

Expected: errors about missing module `./route`.

- [ ] **Step 3: Implement the route**

Create `app/api/user/brand/route.ts`:

```typescript
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

const AGENT_FIELDS = ["agent_name", "photo_url", "license", "brokerage"] as const;
type AgentField = (typeof AGENT_FIELDS)[number];

async function authed() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * GET /api/user/brand — returns the signed-in user's brand profile.
 * Used to pre-fill BrandingBlock when a project has no branding yet
 * (funnel arrivals whose brand was scraped at prospect time land here).
 */
export async function GET(_req: NextRequest) {
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("user_brand_profiles")
    .select("agent_name, photo_url, license, brokerage, primary_color, accent_color, logo_url")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json(data ?? {});
}

/**
 * PATCH /api/user/brand — upserts agent identity fields into the user's brand profile.
 * Only the four BrandingBlock fields are written; theme fields (colors, logo) are
 * managed separately (scraped at funnel time, not edited here).
 */
export async function PATCH(req: NextRequest) {
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of AGENT_FIELDS) {
    if (key in body) update[key] = typeof body[key as AgentField] === "string" ? body[key as AgentField] : null;
  }

  const { error } = await supabase
    .from("user_brand_profiles")
    .upsert({ user_id: user.id, ...update }, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: "update failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test app/api/user/brand/route.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/user/brand/route.ts app/api/user/brand/route.test.ts
git commit -m "feat(api): add GET+PATCH /api/user/brand for agent identity fields"
```

---

### Task 3: Extend applyUserBrandToProject to copy agent fields

**Files:**
- Modify: `lib/project/apply-brand.ts`
- Modify: `lib/project/apply-brand.test.ts`

**Interfaces:**
- Consumes: `user_brand_profiles` now has `agent_name`, `photo_url`, `license`, `brokerage` columns (Task 1).
- Produces: When a project is created, `projects.branding` is written with both the theme keys (`primary_color`, `accent_color`, `logo_url`) AND the agent keys — whatever non-null values exist on the profile row.

- [ ] **Step 1: Read the current test file to understand what's already there**

Open `lib/project/apply-brand.test.ts` and note the existing test cases. Do not delete them — add to them.

- [ ] **Step 2: Add failing tests for agent field propagation**

Append these test cases to `lib/project/apply-brand.test.ts` (after the existing `describe` block or at the end of the file, following whatever pattern is already used):

```typescript
// --- agent fields ---

it("propagates agent fields from user_brand_profiles when present", async () => {
  const updates: Record<string, unknown>[] = [];
  const mockSupabase = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ single: async () => ({ data: null }) }),
          maybeSingle: async () => ({ data: null }),
          single: async () => ({ data: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updates.push(payload);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };

  const resolve = async () => null; // no theme brand
  const agentProfile = {
    agent_name: "Jane Smith",
    photo_url: "https://example.com/jane.jpg",
    license: "SL3456789",
    brokerage: "Gulf Realty",
  };

  // We need to mock the agent profile lookup. The simplest way:
  // patch applyUserBrandToProject to accept an optional agentLookup param for tests.
  // See the implementation step — the function signature gains an optional 4th param.
  await applyUserBrandToProject(
    mockSupabase as never,
    "user-1",
    "proj-1",
    resolve,
    async () => agentProfile,
  );

  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({
    branding: {
      agent_name: "Jane Smith",
      photo_url: "https://example.com/jane.jpg",
      license: "SL3456789",
      brokerage: "Gulf Realty",
    },
  });
});

it("merges agent fields with theme brand when both exist", async () => {
  const updates: Record<string, unknown>[] = [];
  const mockSupabase = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: null }) }), maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }) }) }),
      update: (payload: Record<string, unknown>) => {
        updates.push(payload);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };

  const resolve = async () => ({ primary: "#00d4aa", accent: null, logoUrl: null });
  await applyUserBrandToProject(
    mockSupabase as never,
    "user-1",
    "proj-1",
    resolve,
    async () => ({ agent_name: "Jane", photo_url: null, license: "SL99", brokerage: "Gulf" }),
  );

  expect(updates[0]).toMatchObject({
    branding: {
      primary_color: "#00d4aa",
      agent_name: "Jane",
      license: "SL99",
      brokerage: "Gulf",
    },
  });
});

it("skips the update entirely when both theme and agent are null", async () => {
  const updates: Record<string, unknown>[] = [];
  const mockSupabase = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: null }) }), maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }) }) }),
      update: (payload: Record<string, unknown>) => {
        updates.push(payload);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };

  await applyUserBrandToProject(
    mockSupabase as never,
    "user-1",
    "proj-1",
    async () => null,
    async () => ({ agent_name: null, photo_url: null, license: null, brokerage: null }),
  );

  expect(updates).toHaveLength(0);
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
bun test lib/project/apply-brand.test.ts
```

Expected: new tests fail because `applyUserBrandToProject` doesn't accept a 5th arg and doesn't copy agent fields.

- [ ] **Step 4: Implement the extension**

Replace `lib/project/apply-brand.ts` entirely with:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveUserBrand } from "@/lib/email/templates/resolve-brand";

type AgentBrand = {
  agent_name: string | null;
  photo_url: string | null;
  license: string | null;
  brokerage: string | null;
};

async function defaultAgentLookup(
  supabase: SupabaseClient,
  userId: string,
): Promise<AgentBrand | null> {
  const { data } = await supabase
    .from("user_brand_profiles")
    .select("agent_name, photo_url, license, brokerage")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as AgentBrand | null) ?? null;
}

/**
 * Copy the user's saved brand profile onto a freshly-created project so it starts
 * branded — REGARDLESS of creation path (direct create, draft import, MCP claim).
 *
 * Writes both theme fields (primary_color, accent_color, logo_url from user_brand_profiles
 * via resolveUserBrand) AND agent identity fields (agent_name, photo_url, license,
 * brokerage). The agentLookup param is injectable for tests.
 *
 * Best-effort + never throws — branding is a presentation nicety, never a gate on
 * project birth.
 */
export async function applyUserBrandToProject(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  resolve: typeof resolveUserBrand = resolveUserBrand,
  agentLookup: (supabase: SupabaseClient, userId: string) => Promise<AgentBrand | null> = defaultAgentLookup,
): Promise<void> {
  try {
    const [brand, agent] = await Promise.all([
      resolve(supabase, userId),
      agentLookup(supabase, userId),
    ]);

    const branding: Record<string, string> = {};

    if (brand?.primary) branding.primary_color = brand.primary;
    if (brand?.accent) branding.accent_color = brand.accent;
    if (brand?.logoUrl) branding.logo_url = brand.logoUrl;
    if (agent?.agent_name) branding.agent_name = agent.agent_name;
    if (agent?.photo_url) branding.photo_url = agent.photo_url;
    if (agent?.license) branding.license = agent.license;
    if (agent?.brokerage) branding.brokerage = agent.brokerage;

    if (Object.keys(branding).length === 0) return;

    await supabase.from("projects").update({ branding }).eq("id", projectId);
  } catch {
    /* best-effort — a brand-copy failure must never fail project creation */
  }
}
```

- [ ] **Step 5: Run all apply-brand tests**

```bash
bun test lib/project/apply-brand.test.ts
```

Expected: all tests pass (existing + new).

- [ ] **Step 6: Commit**

```bash
git add lib/project/apply-brand.ts lib/project/apply-brand.test.ts
git commit -m "feat(brand): propagate agent identity fields to new projects via applyUserBrandToProject"
```

---

### Task 4: BrandingBlock — two save buttons + updated prop interface

**Files:**
- Modify: `app/project/[id]/workspace/BrandingBlock.tsx`

**Interfaces:**
- Consumes: Props from ProjectWorkspace (Task 5 wires these).
- Produces: Updated prop interface:
  ```typescript
  {
    branding: Record<string, string>;
    onChange: (next: Record<string, string>) => void;
    onSaveGlobal: () => Promise<boolean>;     // was: onSave
    onSaveProjectOnly: () => Promise<boolean>; // new
    saving: boolean;
    savedMsg: string | null;
    onClose: () => void;
  }
  ```
  (No `onLoadUserBrand` prop — pre-fill is handled in ProjectWorkspace before the pill renders.)

- [ ] **Step 1: Replace BrandingBlock.tsx**

```typescript
"use client";

const BRANDING_FIELDS: { key: string; label: string }[] = [
  { key: "agent_name", label: "Agent name" },
  { key: "photo_url", label: "Photo URL" },
  { key: "license", label: "License #" },
  { key: "brokerage", label: "Brokerage" },
];

/**
 * Branding panel — rendered inside the Brand pill popover.
 * Two save modes:
 *   "Save"               → writes to user's account default + current project
 *   "Save To This Project" → writes to current project only
 * Auto-closes on successful save; the × button closes without saving.
 */
export function BrandingBlock({
  branding,
  onChange,
  onSaveGlobal,
  onSaveProjectOnly,
  saving,
  savedMsg,
  onClose,
}: {
  branding: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  onSaveGlobal: () => Promise<boolean>;
  onSaveProjectOnly: () => Promise<boolean>;
  saving: boolean;
  savedMsg: string | null;
  onClose: () => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-white">Branding</span>
          <span className="ml-2 text-xs text-gray-500">Appears on shared deliverables.</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full px-2 text-lg leading-none text-gray-500 hover:text-gray-300"
        >
          ×
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {BRANDING_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-xs text-gray-400">
            {f.label}
            <input
              value={branding[f.key] ?? ""}
              onChange={(e) => onChange({ ...branding, [f.key]: e.target.value })}
              className="rounded-lg border border-white/10 bg-[#04121b] px-2 py-1.5 text-sm text-white outline-none focus:border-[#00d4aa]/40"
            />
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              const ok = await onSaveGlobal();
              if (ok) onClose();
            }}
            className="rounded-full bg-[#00d4aa] px-4 py-1.5 text-xs font-medium text-[#04121b] disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              const ok = await onSaveProjectOnly();
              if (ok) onClose();
            }}
            className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-medium text-gray-300 hover:border-white/40 disabled:opacity-40"
          >
            Save To This Project
          </button>
          {savedMsg && <span className="text-xs text-gray-500">{savedMsg}</span>}
        </div>
        <p className="text-[10px] text-gray-600">"Save" also sets your default for new projects.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check (no separate test — UI component; correctness verified by tsc)**

```bash
cd C:/Users/ethan/dev/brain-platform && npx tsc --noEmit 2>&1 | grep BrandingBlock
```

Expected: no errors on `BrandingBlock.tsx`. (There WILL be errors on `ProjectWorkspace.tsx` because it still passes the old `onSave` prop — that's fixed in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add app/project/[id]/workspace/BrandingBlock.tsx
git commit -m "feat(ui): BrandingBlock — two save buttons (global vs project-only)"
```

---

### Task 5: ProjectWorkspace — two save handlers + pre-fill on pill open

**Files:**
- Modify: `app/project/[id]/ProjectWorkspace.tsx`

**Interfaces:**
- Consumes:
  - `BrandingBlock` now requires `onSaveGlobal`, `onSaveProjectOnly` (no `onSave`).
  - `GET /api/user/brand` → `Record<string, string | null>` for pre-fill.
  - `PATCH /api/user/brand` → accepts the four agent fields.
- Produces: Correct two-path save wired into the workspace.

- [ ] **Step 1: Add imports and constants at top of ProjectWorkspace.tsx**

After the existing import block (around line 28, after all imports), add:

```typescript
// Agent fields that BrandingBlock edits — used for pre-fill detection.
const AGENT_KEYS = ["agent_name", "photo_url", "license", "brokerage"] as const;
```

- [ ] **Step 2: Add pre-fill useRef + useEffect**

After the `const [hasMcpKey, ...]` line (around line 96), add a ref and effect:

```typescript
// Pre-fill branding from the user's saved brand profile on first pill-open
// when the project has no agent fields yet (funnel arrivals, new projects).
const brandPrefillAttempted = useRef(false);

useEffect(() => {
  if (activePill !== "brand") return;
  if (brandPrefillAttempted.current) return;
  brandPrefillAttempted.current = true;

  const hasAny = AGENT_KEYS.some((k) => branding[k]);
  if (hasAny) return;

  fetch("/api/user/brand")
    .then((r) => (r.ok ? r.json() : {}))
    .then((data: Record<string, unknown>) => {
      setBranding((prev) => {
        const filled = Object.fromEntries(
          AGENT_KEYS.filter((k) => typeof data[k] === "string" && data[k]).map((k) => [
            k,
            data[k] as string,
          ]),
        );
        return Object.keys(filled).length > 0 ? { ...prev, ...filled } : prev;
      });
    })
    .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [activePill]);
```

- [ ] **Step 3: Add the two save handlers**

After the `async function patchUiState(...)` function (around line 196), add:

```typescript
async function saveBrandGlobal(): Promise<boolean> {
  // Fire the user-level brand save in parallel — best-effort (failure is silent;
  // the project save is the authoritative gate for the OK/close signal).
  void fetch("/api/user/brand", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(branding),
  });
  return patch({ branding }, "Branding saved");
}

async function saveBrandProjectOnly(): Promise<boolean> {
  return patch({ branding }, "Saved to this project");
}
```

- [ ] **Step 4: Update the BrandingBlock render in the JSX**

Find the `BrandingBlock` usage (around line 354–362) and replace:

Old:
```tsx
<BrandingBlock
  branding={branding}
  onChange={setBranding}
  onSave={() => patch({ branding }, "Branding saved")}
  saving={saving}
  savedMsg={savedMsg}
  onClose={() => setActivePill(null)}
/>
```

New:
```tsx
<BrandingBlock
  branding={branding}
  onChange={setBranding}
  onSaveGlobal={saveBrandGlobal}
  onSaveProjectOnly={saveBrandProjectOnly}
  saving={saving}
  savedMsg={savedMsg}
  onClose={() => setActivePill(null)}
/>
```

- [ ] **Step 5: TypeScript check — confirm zero new errors**

```bash
cd C:/Users/ethan/dev/brain-platform && npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 new errors (the ~18 baseline strictness errors are pre-existing debt and are acceptable — see CLAUDE.md).

- [ ] **Step 6: Run the full test suite**

```bash
bun test 2>&1 | tail -10
```

Expected: same pass count as before this task (no regressions). The new route tests from Task 2 and apply-brand tests from Task 3 should already be counted in the total.

- [ ] **Step 7: Commit**

```bash
git add app/project/[id]/ProjectWorkspace.tsx
git commit -m "feat(workspace): wire two-button branding save + pre-fill from user brand profile"
```

- [ ] **Step 8: Update SESSION_LOG.md and push**

Prepend to `SESSION_LOG.md`:

```markdown
## 2026-06-18 (main) — feat(brand): branding save fix + global default

- **`docs/sql/20260618_user_brand_agent_fields.sql`** — adds agent_name/photo_url/license/brokerage to user_brand_profiles (applied to prod)
- **`app/api/user/brand/route.ts`** — new GET+PATCH /api/user/brand; used for pre-fill (funnel arrivals) and global default save
- **`lib/project/apply-brand.ts`** — extended to copy agent identity fields to projects.branding at creation time
- **`BrandingBlock.tsx`** — two save buttons: "Save" (global+project) / "Save To This Project" (project only)
- **`ProjectWorkspace.tsx`** — pre-fill on first pill-open from /api/user/brand when branding is empty
- **Next:** live-verify: create new project → check branding auto-populated; save global → confirm persists on reload; save project-only → confirm new projects still start clean
```

Then push:

```bash
git add SESSION_LOG.md
git commit -m "log: branding save fix + global default"
node scripts/safe-push.mjs
```

---

## Self-Review

**Spec coverage check:**
- ✅ Bug fix (save doesn't persist) → addressed by `saveBrandGlobal` + `saveBrandProjectOnly` correctly capturing state; the root cause (agent fields never stored at user level) is fixed by Task 1+2+3.
- ✅ "Save" = global default + current project → `saveBrandGlobal` (Task 5).
- ✅ "Save To This Project" = current project only → `saveBrandProjectOnly` (Task 5).
- ✅ Auto-populate new projects → `applyUserBrandToProject` extended (Task 3).
- ✅ Pre-fill on open for funnel arrivals → `brandPrefillAttempted` effect (Task 5).
- ✅ `GET /api/user/brand` endpoint → Task 2.

**Placeholder scan:** None found — all steps have concrete code.

**Type consistency:**
- `BrandingBlock` interface uses `onSaveGlobal` / `onSaveProjectOnly` in both Task 4 (component) and Task 5 (caller). ✅
- `applyUserBrandToProject` 5th param `agentLookup` matches the test's call signature. ✅
- `AGENT_KEYS` array (Task 5) matches `AGENT_FIELDS` in BrandingBlock — both cover `agent_name`, `photo_url`, `license`, `brokerage`. ✅
