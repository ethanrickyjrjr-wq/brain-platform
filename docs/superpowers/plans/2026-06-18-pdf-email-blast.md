# PDF Extraction + Contact List + Email Blast — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload a property flyer PDF → Claude reads it → "Create Email" drafts a real email from real content → user blasts it to their contact list.

**Architecture:** Three sequential components: (1) PDF extraction patches the `ProjectItem` with `extracted_text` at upload time so all downstream builds get real content; (2) a user-level `contacts` table with CSV/vCard import; (3) a blast route that renders the frozen deliverable HTML and sends via Resend batch in chunks of 100.

**Tech Stack:** Next.js App Router API routes, Supabase (RLS cookie client + service-role for Storage), `@anthropic-ai/sdk` (PDF vision, base64 inline), Resend (`getMarketingResend()` batch), `vcf` npm package (vCard parsing), existing `parseContactsCsv()` from `lib/email/parse-contacts-csv.ts`.

## Global Constraints

- Auth pattern everywhere: `createClient(await cookies())` → `supabase.auth.getUser()` → 401 if no user; RLS proves ownership (non-owner rows are invisible → 404).
- Service-role client for Storage: `createServiceRoleClient()` from `utils/supabase/service-role.ts`.
- Anthropic SDK: `import Anthropic from "@anthropic-ai/sdk"` — use `ANTHROPIC_API_KEY` env var; add `anthropic-beta: files-api-2025-04-14` header on every PDF request.
- Paid gate: query `email_usage` via `checkUsageLimit(user.id)` from `lib/email/usage.ts`; blast counts against the user's email send quota.
- JSONB items patch: fetch full `items` array → mutate the one item → PATCH whole array back to `PATCH /api/projects/[id]`.
- Resend batch: `getMarketingResend().batch.send([...])` — full-access key (`RESEND_AUDIENCES_KEY`), chunks of 100 max per call.
- Unsubscribe endpoint must be stateless (no auth, no cookies) — Google posts to it directly.
- CSS in email HTML: all structural CSS must be inline; table-based layout for Outlook compatibility.
- `vcf` package for vCard; always normalize `.get('email')` with `Array.isArray()` guard.
- Never `git add -A` — stage only owned files. Run `node scripts/safe-push.mjs` not raw `git push`.

---

## File Map

### Created
- `app/api/projects/[id]/extract-pdf/route.ts` — PDF extraction POST handler
- `app/api/contacts/route.ts` — GET list + POST add one contact
- `app/api/contacts/[id]/route.ts` — PATCH + DELETE one contact
- `app/api/contacts/import/route.ts` — POST bulk import (CSV + vCard)
- `app/api/unsubscribe/route.ts` — POST one-click unsubscribe (stateless)
- `app/api/deliverables/[id]/blast/route.ts` — POST email blast
- `app/contacts/page.tsx` — contacts management UI
- `components/contacts/ContactPickerModal.tsx` — contact picker for blast flow
- `lib/contacts/types.ts` — shared Contact type

### Modified
- `lib/project/items.ts` — add `extracted_text?` + `extraction_status?` to `file` kind
- `lib/deliverable/build.ts:265` — render extracted content when present
- `components/project/UploadDrop.tsx` — fire extract-pdf after upload; show status + warn banner
- `app/p/[id]/page.tsx` — add "Send to contacts" button to action bar

---

## Task 1 — ProjectItem Schema: add extraction fields

**Files:**
- Modify: `lib/project/items.ts:69-74`
- Test: `lib/project/__tests__/items.test.ts` (create if absent)

**Interfaces:**
- Produces: `Extract<ProjectItem, { kind: "file" }>` gains `extracted_text?: string` and `extraction_status?: "processing" | "done" | "failed"`

- [ ] **Step 1: Write the failing test**

Create `lib/project/__tests__/items.test.ts` (or append if it exists):

```typescript
import { describe, it, expect } from "bun:test";
import { projectItemSchema } from "../items";

describe("file item schema", () => {
  it("accepts extraction fields", () => {
    const result = projectItemSchema.safeParse({
      id: "abc",
      added_at: new Date().toISOString(),
      origin: "web",
      kind: "file",
      storage_path: "uid/proj/uuid.pdf",
      mime: "application/pdf",
      size: 12345,
      extracted_text: "Some content",
      extraction_status: "done",
    });
    expect(result.success).toBe(true);
  });

  it("accepts file item without extraction fields", () => {
    const result = projectItemSchema.safeParse({
      id: "abc",
      added_at: new Date().toISOString(),
      origin: "web",
      kind: "file",
      storage_path: "uid/proj/uuid.pdf",
      mime: "application/pdf",
      size: 12345,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid extraction_status", () => {
    const result = projectItemSchema.safeParse({
      id: "abc",
      added_at: new Date().toISOString(),
      origin: "web",
      kind: "file",
      storage_path: "uid/proj/uuid.pdf",
      mime: "application/pdf",
      size: 12345,
      extraction_status: "bogus",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test lib/project/__tests__/items.test.ts
```

Expected: FAIL — `extraction_status` field not in schema.

- [ ] **Step 3: Add extraction fields to file kind in `lib/project/items.ts`**

Find the `file` kind object (lines 69-74) and add two optional fields:

```typescript
  z.object({
    kind: z.literal("file"),
    storage_path: z.string(),
    mime: z.string(),
    size: z.number(),
    caption: z.string().optional(),
    extracted_text: z.string().optional(),
    extraction_status: z.enum(["processing", "done", "failed"]).optional(),
  }),
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test lib/project/__tests__/items.test.ts
```

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/project/items.ts lib/project/__tests__/items.test.ts
git commit -m "feat(items): add extracted_text + extraction_status to file kind"
```

---

## Task 2 — Narrative builder: render extracted PDF content

**Files:**
- Modify: `lib/deliverable/build.ts:265`
- Test: check existing build tests still pass

**Interfaces:**
- Consumes: `Extract<ProjectItem, { kind: "file" }>` with optional `extracted_text` and `extraction_status` (from Task 1)

- [ ] **Step 1: Write the failing test**

Find or create the build test file. Search for existing tests:

```bash
find . -path "*/deliverable/*test*" -o -path "*/__tests__/build*" 2>/dev/null
```

Append to whichever test file covers `renderItem` (or create `lib/deliverable/__tests__/build.test.ts`):

```typescript
import { describe, it, expect } from "bun:test";

// Import the renderItem function — it may not be exported yet.
// If it isn't exported, export it from build.ts as a named export.
import { renderItem } from "../build";

describe("renderItem file kind", () => {
  const base = {
    id: "1",
    added_at: new Date().toISOString(),
    origin: "web" as const,
    kind: "file" as const,
    storage_path: "uid/proj/abc.pdf",
    mime: "application/pdf",
    size: 1000,
  };

  it("renders filename when no extracted_text", () => {
    const result = renderItem(base, 1);
    expect(result).toBe("[1] FILE — uid/proj/abc.pdf (pdf, content not available)");
  });

  it("renders caption when no extracted_text", () => {
    const result = renderItem({ ...base, caption: "Beach Condo Flyer" }, 1);
    expect(result).toBe("[1] FILE — Beach Condo Flyer (pdf, content not available)");
  });

  it("renders extracted text when present", () => {
    const result = renderItem({
      ...base,
      caption: "Beach Condo Flyer",
      extracted_text: "2BR/2BA, $450,000, 1,200 sqft, Fort Myers Beach FL 33931",
      extraction_status: "done" as const,
    }, 1);
    expect(result).toContain("[1] DOCUMENT — Beach Condo Flyer");
    expect(result).toContain("2BR/2BA, $450,000");
  });
});
```

- [ ] **Step 2: Export `renderItem` from `lib/deliverable/build.ts` if not already exported**

Open `lib/deliverable/build.ts`. Find the `renderItem` function definition. If it's not exported, add `export` to it:

```typescript
export function renderItem(item: ProjectItemSnapshot, n: number): string {
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun test lib/deliverable/__tests__/build.test.ts
```

Expected: FAIL on the file kind tests.

- [ ] **Step 4: Update the file case in `lib/deliverable/build.ts` at line 265**

Replace:
```typescript
    case "file":
      return `[${n}] FILE — ${item.caption ?? item.storage_path}`;
```

With:
```typescript
    case "file":
      if (item.extracted_text) {
        return `[${n}] DOCUMENT — ${item.caption ?? item.storage_path}\n${item.extracted_text}`;
      }
      return `[${n}] FILE — ${item.caption ?? item.storage_path} (pdf, content not available)`;
```

- [ ] **Step 5: Run tests**

```bash
bun test lib/deliverable/__tests__/build.test.ts
```

Expected: PASS — all 3 file kind tests green.

- [ ] **Step 6: Run full test suite to check no regressions**

```bash
bun test
```

Expected: same pass count as before (no regressions).

- [ ] **Step 7: Commit**

```bash
git add lib/deliverable/build.ts lib/deliverable/__tests__/build.test.ts
git commit -m "feat(build): render extracted PDF content in deliverable narrative"
```

---

## Task 3 — PDF extraction route

**Files:**
- Create: `app/api/projects/[id]/extract-pdf/route.ts`

**Interfaces:**
- Consumes: `POST { item_id: string }` — must be a `kind: "file"` item with `mime === "application/pdf"`
- Produces: `{ status: "done" }` or `{ status: "failed", reason: string }`
- Side effect: patches `projects.items` JSONB — sets `extracted_text` + `extraction_status` on the matching item

- [ ] **Step 1: Install Anthropic SDK if not already present**

```bash
bun add @anthropic-ai/sdk
```

If it's already in `package.json`, skip.

- [ ] **Step 2: Create the route file**

```typescript
// app/api/projects/[id]/extract-pdf/route.ts
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { projectItemsSchema } from "@/lib/project/items";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 60; // PDF extraction can take up to 30s for large docs

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Auth
  const supabase = createClient(await cookies());
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const itemId = body?.item_id;
  if (!itemId || typeof itemId !== "string") {
    return NextResponse.json({ error: "item_id required" }, { status: 400 });
  }

  // Fetch project (RLS proves ownership)
  const { data: project } = await supabase
    .from("projects")
    .select("id, items")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Find the item
  const items = projectItemsSchema.safeParse(project.items);
  if (!items.success) return NextResponse.json({ error: "invalid items" }, { status: 500 });

  const itemIndex = items.data.findIndex((it) => it.id === itemId);
  if (itemIndex === -1) return NextResponse.json({ error: "item not found" }, { status: 404 });

  const item = items.data[itemIndex];
  if (item.kind !== "file" || item.mime !== "application/pdf") {
    return NextResponse.json({ error: "item is not a PDF" }, { status: 400 });
  }

  // Mark as processing
  const processingItems = [...items.data];
  processingItems[itemIndex] = { ...item, extraction_status: "processing" };
  await supabase
    .from("projects")
    .update({ items: processingItems, updated_at: new Date().toISOString() })
    .eq("id", id);

  try {
    // Fetch PDF bytes from Storage (service role bypasses Storage RLS)
    const srClient = createServiceRoleClient();
    const { data: fileData, error: dlErr } = await srClient.storage
      .from("project-uploads")
      .download(item.storage_path);
    if (dlErr || !fileData) throw new Error(`Storage download failed: ${dlErr?.message}`);

    const pdfBuffer = await fileData.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");

    // Call Claude with base64 PDF
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: pdfBase64,
                },
              },
              {
                type: "text",
                text: "Extract all key facts, figures, descriptions, prices, dates, addresses, financial data, and any other meaningful information from this document. Return a structured plain-text summary suitable for drafting a professional email. Be complete — include every number and named detail you can read.",
              },
            ],
          },
        ],
      },
      {
        headers: { "anthropic-beta": "files-api-2025-04-14" },
      },
    );

    const extracted = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");

    // Patch the item with extracted content
    const doneItems = [...items.data];
    doneItems[itemIndex] = {
      ...item,
      extracted_text: extracted,
      extraction_status: "done",
    };
    await supabase
      .from("projects")
      .update({ items: doneItems, updated_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ status: "done" });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "extraction failed";

    // Mark as failed
    const failedItems = [...items.data];
    failedItems[itemIndex] = { ...item, extraction_status: "failed" };
    await supabase
      .from("projects")
      .update({ items: failedItems, updated_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ status: "failed", reason }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "extract-pdf" | head -20
```

Expected: no errors for this file.

- [ ] **Step 4: Manual smoke test**

Upload a PDF to a project in dev. Then in the browser console or Postman:

```
POST /api/projects/{project-id}/extract-pdf
{ "item_id": "{item-id-from-project-items}" }
```

Expected: `{ "status": "done" }`. Verify the project's items in Supabase Studio show `extracted_text` populated on that item.

- [ ] **Step 5: Commit**

```bash
git add app/api/projects/[id]/extract-pdf/route.ts
git commit -m "feat(api): add PDF extraction route — Claude vision reads uploaded PDFs"
```

---

## Task 4 — UploadDrop: trigger extraction + status UI

**Files:**
- Modify: `components/project/UploadDrop.tsx`

**Interfaces:**
- Consumes: new `POST /api/projects/[id]/extract-pdf` (Task 3)
- Produces: visual extraction status on file items; warn banner when unextracted PDFs exist; parent's `onUploaded` still called immediately (non-blocking)

- [ ] **Step 1: Add extraction trigger after upload (non-blocking)**

In `components/project/UploadDrop.tsx`, after `onUploaded(item, URL.createObjectURL(file))` (currently line 97), add a fire-and-forget extraction call for PDFs:

```typescript
      onUploaded(item, URL.createObjectURL(file));
      setCaption("");

      // Fire PDF extraction — non-blocking, result patches the item via parent re-fetch
      if (file.type === "application/pdf") {
        void (async () => {
          try {
            await fetch(`/api/projects/${projectId}/extract-pdf`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ item_id: item.id }),
            });
            // Parent component should re-fetch project items to pick up extraction_status update
            onExtractionComplete?.();
          } catch {
            // Silent — status already set to "failed" by the route
          }
        })();
      }
```

- [ ] **Step 2: Add `onExtractionComplete` to the Props interface**

```typescript
interface Props {
  projectId: string;
  fileCount: number;
  onUploaded: (item: FileItem, objectUrl: string) => void;
  /** Called after PDF extraction completes (success or failure) so parent can re-fetch. */
  onExtractionComplete?: () => void;
}
```

- [ ] **Step 3: Add extraction status display**

The `UploadDrop` component currently shows only upload status. Add a prop to receive file items for status display, or pass extraction state from the parent. The simplest approach: accept an optional `extractingItemIds: Set<string>` prop from the parent (parent tracks which items have `extraction_status: "processing"`).

Add to Props:
```typescript
  /** Item IDs currently being extracted — shows spinner next to those files. */
  processingItemIds?: Set<string>;
```

Then wherever file items are displayed in the component's render, show status. If the parent workspace uses a separate file list component, the extraction status lives there rather than in UploadDrop.

- [ ] **Step 4: Add warn banner when unextracted PDFs exist**

In the parent workspace component that renders `UploadDrop` and the file list, add a banner above the Build button when any file item has `extraction_status: "processing"` or `extraction_status: "failed"`:

```tsx
{hasUnextractedPdfs && (
  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
    <span>PDF hasn't been fully read yet — your email will use the file name only.</span>
    <div className="mt-2 flex gap-3">
      <button
        className="text-xs underline underline-offset-2 opacity-70 hover:opacity-100"
        onClick={onGenerateAnyway}
      >
        Generate anyway
      </button>
      <button
        className="text-xs underline underline-offset-2 opacity-70 hover:opacity-100"
        onClick={onWriteManually}
      >
        I&apos;ll write it
      </button>
    </div>
  </div>
)}
```

Where `hasUnextractedPdfs` is derived from the project items:

```typescript
const hasUnextractedPdfs = items.some(
  (it) => it.kind === "file" &&
           it.mime === "application/pdf" &&
           it.extraction_status !== "done",
);
```

- [ ] **Step 5: Verify behavior manually**

1. Upload a PDF → file appears immediately with "Reading document…" spinner
2. After extraction: spinner → green check "Content extracted"  
3. Upload a large/scanned PDF → confirm extraction completes (check Supabase Studio items)
4. Try clicking "Generate anyway" during processing → build proceeds without PDF content

- [ ] **Step 6: Commit**

```bash
git add components/project/UploadDrop.tsx
git commit -m "feat(upload): trigger PDF extraction after upload + show status + warn banner"
```

---

## Task 5 — Database: contacts + email_blasts tables

**Files:**
- Create: `docs/sql/20260618_contacts_and_blasts.sql`

**Interfaces:**
- Produces: `contacts` table (user-level) + `email_blasts` audit table, both RLS-protected

- [ ] **Step 1: Write the SQL**

Create `docs/sql/20260618_contacts_and_blasts.sql`:

```sql
-- contacts: user-level contact list, one row per email address per user
CREATE TABLE IF NOT EXISTS contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text,
  email       text NOT NULL,
  phone       text,
  tags        text[] DEFAULT '{}',
  unsubscribed boolean DEFAULT false,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, email)
);

CREATE INDEX IF NOT EXISTS contacts_user_id_idx ON contacts(user_id);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_own" ON contacts
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- email_blasts: audit trail for each blast send
CREATE TABLE IF NOT EXISTS email_blasts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deliverable_id  text NOT NULL,
  contact_ids     uuid[] NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  sent_count      int DEFAULT 0,
  failed_count    int DEFAULT 0,
  sent_at         timestamptz,
  created_at      timestamptz DEFAULT now()
);

-- status values: pending | sending | sent | failed
ALTER TABLE email_blasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blasts_own" ON email_blasts
  USING (user_id = auth.uid());
```

- [ ] **Step 2: Run the migration**

Get DB credentials from `.dlt/secrets.toml` (the `destination.credentials.connection_string` value).

```python
python -c "
import psycopg, pathlib
sql = pathlib.Path('docs/sql/20260618_contacts_and_blasts.sql').read_text()
conn_str = 'postgresql://postgres:{PASSWORD}@{HOST}:5432/postgres'
with psycopg.connect(conn_str) as conn:
    conn.execute(sql)
    conn.commit()
print('Migration applied')
"
```

- [ ] **Step 3: Verify**

```python
python -c "
import psycopg
conn_str = 'postgresql://postgres:{PASSWORD}@{HOST}:5432/postgres'
with psycopg.connect(conn_str) as conn:
    cur = conn.execute(\"SELECT COUNT(*) FROM contacts\")
    print('contacts rows:', cur.fetchone()[0])
    cur = conn.execute(\"SELECT COUNT(*) FROM email_blasts\")
    print('email_blasts rows:', cur.fetchone()[0])
"
```

Expected: both print 0 (empty tables, no error).

- [ ] **Step 4: Commit**

```bash
git add docs/sql/20260618_contacts_and_blasts.sql
git commit -m "feat(db): add contacts + email_blasts tables with RLS"
```

---

## Task 6 — Contact types + shared Contact type

**Files:**
- Create: `lib/contacts/types.ts`

**Interfaces:**
- Produces: `Contact` type used by API routes, import logic, and UI

- [ ] **Step 1: Create the types file**

```typescript
// lib/contacts/types.ts
export interface Contact {
  id: string;
  user_id: string;
  name: string | null;
  email: string;
  phone: string | null;
  tags: string[];
  unsubscribed: boolean;
  created_at: string;
}

export interface ContactRow {
  name: string | null;
  email: string;
  phone: string | null;
  tags: string[];
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  skip_reasons: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/contacts/types.ts
git commit -m "feat(contacts): add shared Contact types"
```

---

## Task 7 — Contacts API routes (CRUD + import + unsubscribe)

**Files:**
- Create: `app/api/contacts/route.ts`
- Create: `app/api/contacts/[id]/route.ts`
- Create: `app/api/contacts/import/route.ts`
- Create: `app/api/unsubscribe/route.ts`

**Interfaces:**
- Consumes: `Contact`, `ImportResult` from `lib/contacts/types.ts` (Task 6)
- Consumes: `parseContactsCsv()` from `lib/email/parse-contacts-csv.ts` (already exists)
- Produces: REST API for contacts CRUD + import + unsubscribe

- [ ] **Step 1: Create `app/api/contacts/route.ts` (GET list + POST add one)**

```typescript
// app/api/contacts/route.ts
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

async function authed() {
  const supabase = createClient(await cookies());
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(_req: NextRequest) {
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "read failed" }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.email || typeof body.email !== "string") {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("contacts")
    .upsert(
      {
        user_id: user.id,
        email,
        name: typeof body.name === "string" ? body.name.trim() || null : null,
        phone: typeof body.phone === "string" ? body.phone.trim() || null : null,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      },
      { onConflict: "user_id,email" },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: "save failed" }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
```

- [ ] **Step 2: Create `app/api/contacts/[id]/route.ts` (PATCH + DELETE)**

```typescript
// app/api/contacts/[id]/route.ts
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

async function authed() {
  const supabase = createClient(await cookies());
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if ("name" in body) update.name = typeof body.name === "string" ? body.name.trim() || null : null;
  if ("phone" in body) update.phone = typeof body.phone === "string" ? body.phone.trim() || null : null;
  if ("tags" in body) update.tags = Array.isArray(body.tags) ? body.tags.map(String) : [];

  const { data, error } = await supabase
    .from("contacts")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id) // belt-and-suspenders alongside RLS
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: "update failed" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: "delete failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Create `app/api/contacts/import/route.ts` (CSV + vCard)**

First install the vCard package:

```bash
bun add vcf @types/vcf
```

Then create the route:

```typescript
// app/api/contacts/import/route.ts
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { parseContactsCsv } from "@/lib/email/parse-contacts-csv";
import vCard from "vcf";
import type { ImportResult } from "@/lib/contacts/types";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 5000;

export async function POST(req: NextRequest) {
  const supabase = createClient(await cookies());
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large (max 5 MB)" }, { status: 413 });

  const text = await file.text();
  const result: ImportResult = { added: 0, updated: 0, skipped: 0, skip_reasons: [] };

  interface RowToUpsert { email: string; name: string | null; phone: string | null; tags: string[] }
  const rows: RowToUpsert[] = [];

  if (file.name.endsWith(".vcf")) {
    // vCard parsing
    const cards = vCard.parse(text);
    for (const card of cards) {
      const fnProp = card.get("fn");
      const name = fnProp ? fnProp.valueOf() : null;

      const emailProp = card.get("email");
      const emailProps = emailProp
        ? (Array.isArray(emailProp) ? emailProp : [emailProp])
        : [];

      // Pick the first work email, or the first any email
      const workEmail = emailProps.find((e) => e.is("work"))?.valueOf();
      const anyEmail = emailProps[0]?.valueOf();
      const email = (workEmail ?? anyEmail ?? "").trim().toLowerCase();

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        result.skipped++;
        result.skip_reasons.push(`vCard ${name ?? "unknown"}: no valid email`);
        continue;
      }

      const telProp = card.get("tel");
      const telProps = telProp
        ? (Array.isArray(telProp) ? telProp : [telProp])
        : [];
      const phone = telProps[0]?.valueOf()?.trim() || null;

      rows.push({ email, name: typeof name === "string" ? name.trim() || null : null, phone, tags: [] });
    }
  } else {
    // CSV parsing — reuse existing parser
    const parsed = parseContactsCsv(text);
    result.skipped += parsed.skippedCount;
    for (const row of parsed.rows) {
      rows.push({
        email: row.email,
        name: row.name,
        phone: null, // existing parser doesn't emit phone; extend if needed
        tags: row.tags,
      });
    }
  }

  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Too many rows (max ${MAX_ROWS})` }, { status: 413 });
  }

  // Upsert in batches of 100
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100).map((r) => ({ ...r, user_id: user.id }));
    const { data: upserted, error } = await supabase
      .from("contacts")
      .upsert(batch, { onConflict: "user_id,email" })
      .select("id");

    if (error) {
      return NextResponse.json({ error: "import failed", detail: error.message }, { status: 500 });
    }
    // Supabase upsert doesn't distinguish added vs updated — count all as added for simplicity
    result.added += upserted?.length ?? 0;
  }

  return NextResponse.json(result);
}
```

- [ ] **Step 4: Create `app/api/unsubscribe/route.ts` (stateless one-click)**

```typescript
// app/api/unsubscribe/route.ts
// STATELESS — no auth, no session. Google's servers POST here directly.
import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contactId = searchParams.get("id");
  if (!contactId) return new NextResponse("ok", { status: 200 }); // silently accept malformed

  const supabase = createServiceRoleClient();
  await supabase
    .from("contacts")
    .update({ unsubscribed: true })
    .eq("id", contactId);

  return new NextResponse("unsubscribed", { status: 200 });
}

// Gmail also hits this with GET when rendering the unsubscribe button
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contactId = searchParams.get("id");
  if (contactId) {
    const supabase = createServiceRoleClient();
    await supabase.from("contacts").update({ unsubscribed: true }).eq("id", contactId);
  }
  return new NextResponse(
    "<html><body><h2>You've been unsubscribed.</h2></body></html>",
    { status: 200, headers: { "content-type": "text/html" } },
  );
}
```

- [ ] **Step 5: Test the import route manually**

Create a test CSV file `test-contacts.csv`:
```
name,email,phone
John Smith,john@example.com,239-555-0100
Jane Doe,jane@acme.com,
Bad Row,,
```

Use Postman or curl (with session cookie) to POST `multipart/form-data` with `file=test-contacts.csv` to `/api/contacts/import`.

Expected response:
```json
{ "added": 2, "updated": 0, "skipped": 1, "skip_reasons": ["row 4: no email"] }
```

- [ ] **Step 6: Commit**

```bash
git add app/api/contacts/route.ts app/api/contacts/[id]/route.ts app/api/contacts/import/route.ts app/api/unsubscribe/route.ts lib/contacts/types.ts bun.lock
git commit -m "feat(contacts): add CRUD API routes + CSV/vCard import + stateless unsubscribe"
```

---

## Task 8 — Contacts management page

**Files:**
- Create: `app/contacts/page.tsx`

**Interfaces:**
- Consumes: `GET /api/contacts`, `DELETE /api/contacts/[id]`, `POST /api/contacts`, `POST /api/contacts/import`
- Produces: `/contacts` page — table + search + tag filter chips + Add modal + Import CSV

- [ ] **Step 1: Create the page**

```tsx
// app/contacts/page.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import type { Contact } from "@/lib/contacts/types";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", phone: "", tags: "" });
  const [importResult, setImportResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch("/api/contacts");
    if (res.ok) setContacts(await res.json());
  }

  useEffect(() => { void load(); }, []);

  const allTags = Array.from(new Set(contacts.flatMap((c) => c.tags))).sort();

  const visible = contacts.filter((c) => {
    const matchSearch =
      !search ||
      c.email.includes(search.toLowerCase()) ||
      (c.name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchTag = !activeTag || c.tags.includes(activeTag);
    return matchSearch && matchTag;
  });

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: addForm.name || null,
        email: addForm.email,
        phone: addForm.phone || null,
        tags: addForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setShowAdd(false);
      setAddForm({ name: "", email: "", phone: "", tags: "" });
      await load();
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this contact?")) return;
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    await load();
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/contacts/import", { method: "POST", body: fd });
    const data = await res.json();
    setBusy(false);
    setImportResult(`Added ${data.added}, updated ${data.updated}, skipped ${data.skipped}`);
    await load();
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">
          Contacts <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-sm text-gray-400">{contacts.length}</span>
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10"
          >
            Import CSV / vCard
          </button>
          <input ref={fileRef} type="file" accept=".csv,.vcf" className="hidden" onChange={handleImport} />
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-lg bg-[#0a8078] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0a8078]/80"
          >
            Add contact
          </button>
        </div>
      </div>

      {importResult && (
        <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm text-green-300">
          {importResult}
          <button className="ml-3 opacity-60 hover:opacity-100" onClick={() => setImportResult(null)}>×</button>
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or email…"
        className="mb-4 w-full rounded-lg border border-white/10 bg-[#0d1e2b] px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#0a8078]"
      />

      {allTags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTag(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${!activeTag ? "bg-[#0a8078] text-white" : "border border-white/10 text-gray-400 hover:text-white"}`}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${activeTag === tag ? "bg-[#0a8078] text-white" : "border border-white/10 text-gray-400 hover:text-white"}`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">
          {contacts.length === 0
            ? "No contacts yet. Import a CSV or add one manually."
            : "No contacts match your search."}
        </p>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Tags</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visible.map((c) => (
                <tr key={c.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 text-white">{c.name ?? <span className="text-gray-500">—</span>}</td>
                  <td className="px-4 py-3 text-gray-300">{c.email}</td>
                  <td className="px-4 py-3 text-gray-400">{c.phone ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span key={t} className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-gray-300">{t}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="text-xs text-red-400 opacity-60 hover:opacity-100"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1e2b] p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Add contact</h2>
            <form onSubmit={handleAdd} className="space-y-3">
              <input
                placeholder="Name (optional)"
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500"
              />
              <input
                placeholder="Email address"
                required
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500"
              />
              <input
                placeholder="Phone (optional)"
                value={addForm.phone}
                onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500"
              />
              <input
                placeholder="Tags, comma-separated (e.g. investors, FMB)"
                value={addForm.tags}
                onChange={(e) => setAddForm((f) => ({ ...f, tags: e.target.value }))}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500"
              />
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)} className="text-sm text-gray-400 hover:text-white">Cancel</button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-[#0a8078] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save contact"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add Contacts link to nav**

Find the global nav component (likely `components/layout/GlobalNav.tsx` or similar). Add a "Contacts" link pointing to `/contacts`. Follow the exact style of existing nav links in that file.

- [ ] **Step 3: Verify the page manually**

1. Navigate to `/contacts` while logged in
2. Add one contact manually → it appears in the table
3. Import the test CSV from Task 7 → summary toast shows, contacts populate
4. Filter by tag → table filters correctly
5. Search by name → works
6. Remove a contact → row disappears

- [ ] **Step 4: Commit**

```bash
git add app/contacts/page.tsx
git commit -m "feat(contacts): add contacts management page with table, search, tag filter, import"
```

---

## Task 9 — Email blast route

**Files:**
- Create: `app/api/deliverables/[id]/blast/route.ts`

**Interfaces:**
- Consumes: `POST { contact_ids: string[] }` (array of contact UUIDs)
- Consumes: Resend via `getMarketingResend()` from `lib/email/marketing-client.ts`
- Produces: `{ sent: number, failed: number }` + `email_blasts` row written to DB

- [ ] **Step 1: Read the deliverable render function before writing this route**

Open `lib/email/grounded-report.ts` and `lib/email/grounded-report-briefcase.ts`. Find the function that produces the final HTML string from a deliverable/snapshot. It will be something like `renderGroundedReport(...)` or `buildEmailHtml(...)`. Note its exact name and parameters — you will call it in the blast route to produce the per-contact HTML body.

Also open `app/p/[id]/page.tsx` lines 444-469 to understand how the email template is currently rendered on the web. Mirror that render call in the blast route.

- [ ] **Step 2: Create the blast route**

```typescript
// app/api/deliverables/[id]/blast/route.ts
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getMarketingResend } from "@/lib/email/marketing-client";

export const runtime = "nodejs";
export const maxDuration = 120; // up to 500 contacts × ~200ms each

const MAX_CONTACTS = 500;
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.swfldatagulf.com";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Auth
  const supabase = createClient(await cookies());
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const contactIds: unknown[] = Array.isArray(body?.contact_ids) ? body.contact_ids : [];
  if (contactIds.length === 0) {
    return NextResponse.json({ error: "contact_ids required" }, { status: 400 });
  }
  if (contactIds.length > MAX_CONTACTS) {
    return NextResponse.json(
      { error: `Max ${MAX_CONTACTS} contacts per blast` },
      { status: 400 },
    );
  }

  // Fetch deliverable (RLS proves ownership)
  const { data: deliverable } = await supabase
    .from("deliverables")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!deliverable) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (deliverable.template !== "email") {
    return NextResponse.json({ error: "deliverable is not an email template" }, { status: 400 });
  }
  if (deliverable.status !== "ready") {
    return NextResponse.json({ error: "deliverable is not ready" }, { status: 400 });
  }

  // Fetch contacts — verify all belong to this user
  const { data: contacts, error: contactsErr } = await supabase
    .from("contacts")
    .select("id, email, name, unsubscribed")
    .in("id", contactIds as string[])
    .eq("user_id", user.id)
    .eq("unsubscribed", false);

  if (contactsErr) return NextResponse.json({ error: "contacts fetch failed" }, { status: 500 });
  if (!contacts || contacts.length === 0) {
    return NextResponse.json({ error: "no valid contacts found" }, { status: 400 });
  }

  // Resolve sender config (reuse existing pattern from broadcast route)
  // Read app/api/email/broadcast/route.ts to find the exact sender resolution helper
  // and copy the same `from` and `subject` resolution here.
  const from = deliverable.branding?.agent_email
    ? `${deliverable.branding.agent_name ?? "Your Agent"} <${deliverable.branding.agent_email}>`
    : "SWFL Data Gulf <hello@swfldatagulf.com>";
  const subject = deliverable.title ?? "Your SWFL Market Report";

  // Render email HTML from frozen snapshot
  // READ lib/email/grounded-report.ts or grounded-report-briefcase.ts to confirm
  // the exact function name and parameters, then import and call it here.
  // For now: render a minimal HTML wrapper with a link to the web version.
  // Replace this with the real render call once you confirm the function signature.
  const webUrl = `${BASE_URL}/p/${id}`;
  const fallbackHtml = `
    <table width="100%" cellpadding="0" cellspacing="0" style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <tr><td style="padding:24px">
        <p style="font-size:16px;color:#111">Your market report is ready.</p>
        <a href="${webUrl}" style="display:inline-block;background:#0a8078;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;margin:16px 0;">
          View Report
        </a>
        <p style="font-size:11px;color:#888;margin-top:32px;">
          SWFL Data Gulf · Fort Myers, FL<br>
          <a href="${BASE_URL}/api/unsubscribe?id=__CONTACT_ID__" style="color:#888;">Unsubscribe</a>
        </p>
      </td></tr>
    </table>
  `;

  // Insert blast record
  const { data: blast, error: blastErr } = await supabase
    .from("email_blasts")
    .insert({
      user_id: user.id,
      deliverable_id: id,
      contact_ids: contactIds,
      status: "sending",
    })
    .select("id")
    .single();
  if (blastErr || !blast) {
    return NextResponse.json({ error: "blast record failed" }, { status: 500 });
  }

  // Send in batches of 100 (Resend batch limit)
  const resend = getMarketingResend();
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < contacts.length; i += 100) {
    const batch = contacts.slice(i, i + 100);
    const messages = batch.map((c) => ({
      from,
      to: [c.email],
      subject,
      html: fallbackHtml.replace("__CONTACT_ID__", c.id),
      headers: {
        "List-Unsubscribe": `<${BASE_URL}/api/unsubscribe?id=${c.id}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "Precedence": "bulk",
      },
    }));

    try {
      const result = await resend.batch.send(messages);
      // resend.batch.send returns { data: Array<{id}> | null, error }
      const successCount = Array.isArray(result.data) ? result.data.length : 0;
      const failCount = batch.length - successCount;
      sent += successCount;
      failed += failCount;
    } catch {
      failed += batch.length;
    }
  }

  // Update blast record
  await supabase
    .from("email_blasts")
    .update({
      status: "sent",
      sent_count: sent,
      failed_count: failed,
      sent_at: new Date().toISOString(),
    })
    .eq("id", blast.id);

  return NextResponse.json({ sent, failed });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "blast" | head -20
```

Expected: no type errors for this file.

- [ ] **Step 4: Commit**

```bash
git add app/api/deliverables/[id]/blast/route.ts
git commit -m "feat(api): add email blast route — sends deliverable to contact list via Resend"
```

---

## Task 10 — Contact picker modal + deliverable page button

**Files:**
- Create: `components/contacts/ContactPickerModal.tsx`
- Modify: `app/p/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/contacts`, `POST /api/deliverables/[id]/blast`
- Consumes: `Contact` from `lib/contacts/types.ts`
- Produces: "Send to contacts" button on deliverable page → contact picker modal → blast

- [ ] **Step 1: Create `components/contacts/ContactPickerModal.tsx`**

```tsx
// components/contacts/ContactPickerModal.tsx
"use client";

import { useState, useEffect } from "react";
import type { Contact } from "@/lib/contacts/types";

interface Props {
  deliverableId: string;
  onClose: () => void;
}

export function ContactPickerModal({ deliverableId, onClose }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);

  useEffect(() => {
    fetch("/api/contacts")
      .then((r) => r.json())
      .then(setContacts)
      .catch(() => {});
  }, []);

  const allTags = Array.from(new Set(contacts.flatMap((c) => c.tags))).sort();

  const visible = contacts.filter((c) => {
    const matchSearch =
      !search ||
      c.email.includes(search.toLowerCase()) ||
      (c.name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchTag = !activeTag || c.tags.includes(activeTag);
    return matchSearch && matchTag && !c.unsubscribed;
  });

  function toggleAll() {
    if (selected.size === visible.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((c) => c.id)));
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSend() {
    if (selected.size === 0) return;
    setSending(true);
    const res = await fetch(`/api/deliverables/${deliverableId}/blast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact_ids: Array.from(selected) }),
    });
    const data = await res.json();
    setSending(false);
    setResult(data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex h-[80dvh] w-full max-w-lg flex-col rounded-2xl border border-white/10 bg-[#0d1e2b]">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Send to contacts</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">×</button>
        </div>

        {result ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="text-4xl">✓</div>
            <p className="text-lg font-semibold text-white">
              Sent to {result.sent} contact{result.sent !== 1 ? "s" : ""}
            </p>
            {result.failed > 0 && (
              <p className="text-sm text-yellow-300">{result.failed} failed to send</p>
            )}
            <button
              onClick={onClose}
              className="mt-4 rounded-lg bg-[#0a8078] px-6 py-2 text-sm font-medium text-white"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="border-b border-white/10 px-5 py-3 space-y-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contacts…"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none"
              />
              {allTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setActiveTag(null)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${!activeTag ? "bg-[#0a8078] text-white" : "border border-white/10 text-gray-400"}`}
                  >
                    All
                  </button>
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${activeTag === tag ? "bg-[#0a8078] text-white" : "border border-white/10 text-gray-400"}`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {visible.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  {contacts.length === 0 ? "No contacts yet — add some at /contacts" : "No contacts match"}
                </p>
              ) : (
                <>
                  <div
                    className="flex cursor-pointer items-center gap-3 border-b border-white/5 px-5 py-3 hover:bg-white/5"
                    onClick={toggleAll}
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={selected.size === visible.length && visible.length > 0}
                      className="h-4 w-4 accent-[#0a8078]"
                    />
                    <span className="text-sm text-gray-400">
                      {selected.size === visible.length && visible.length > 0
                        ? "Deselect all"
                        : `Select all (${visible.length})`}
                    </span>
                  </div>
                  {visible.map((c) => (
                    <div
                      key={c.id}
                      className="flex cursor-pointer items-center gap-3 border-b border-white/5 px-5 py-3 hover:bg-white/5"
                      onClick={() => toggle(c.id)}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={selected.has(c.id)}
                        className="h-4 w-4 accent-[#0a8078]"
                      />
                      <div className="min-w-0 flex-1">
                        {c.name && <div className="truncate text-sm font-medium text-white">{c.name}</div>}
                        <div className="truncate text-xs text-gray-400">{c.email}</div>
                      </div>
                      {c.tags.length > 0 && (
                        <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs text-gray-400">
                          {c.tags[0]}
                        </span>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className="border-t border-white/10 px-5 py-4">
              <button
                disabled={selected.size === 0 || sending}
                onClick={handleSend}
                className="w-full rounded-xl bg-[#0a8078] py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {sending
                  ? "Sending…"
                  : selected.size === 0
                  ? "Select contacts to send"
                  : `Send to ${selected.size} contact${selected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add "Send to contacts" button to `/app/p/[id]/page.tsx`**

Open `app/p/[id]/page.tsx`. Find the email template action bar section (around line 446-456 per the audit). Add the button and modal state. Follow the exact pattern of existing buttons in the file:

```tsx
// At the top of the component, add state:
const [showBlast, setShowBlast] = useState(false);

// In the action bar, add the button (after existing buttons, visible only if owner):
{isOwner && (
  <button
    onClick={() => setShowBlast(true)}
    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10"
  >
    Send to contacts
  </button>
)}

// At the end of the component (before final closing tag), add the modal:
{showBlast && (
  <ContactPickerModal
    deliverableId={deliverable.id}
    onClose={() => setShowBlast(false)}
  />
)}
```

Import at top of file:
```tsx
import { ContactPickerModal } from "@/components/contacts/ContactPickerModal";
```

- [ ] **Step 3: Test the full blast flow end-to-end**

1. Build an email deliverable from a project that has a PDF with extracted content
2. Go to `/p/[id]`
3. Click "Send to contacts"
4. Modal opens with your contacts list
5. Select 1-3 test contacts
6. Click "Send to 3 contacts"
7. Toast shows "Sent to 3 contacts"
8. Verify in Supabase Studio: `email_blasts` has a new row with `status: "sent"`, `sent_count: 3`
9. Verify the test contacts received the email

- [ ] **Step 4: TypeScript + lint check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add components/contacts/ContactPickerModal.tsx app/p/[id]/page.tsx
git commit -m "feat(blast): add contact picker modal + Send to contacts button on deliverable page"
```

---

## Task 11 — SESSION_LOG + safe-push

- [ ] **Step 1: Update SESSION_LOG.md** (newest entry at top)

```
## 2026-06-18 (main) — feat: PDF extraction + contacts + email blast

- PDF extraction: `app/api/projects/[id]/extract-pdf/route.ts` — Claude vision reads uploaded PDFs via base64 + files-api-2025-04-14 beta; patches ProjectItem with extracted_text + extraction_status
- lib/project/items.ts: file kind gains extracted_text? + extraction_status? fields
- lib/deliverable/build.ts: renders extracted content as [N] DOCUMENT when present
- UploadDrop.tsx: fires extraction after PDF upload; shows spinner + warn banner
- contacts table + email_blasts table: SQL migration applied to prod
- /api/contacts CRUD + import (CSV + vCard via vcf) + stateless /api/unsubscribe
- /contacts page: table + search + tag filters + add modal + CSV import
- /api/deliverables/[id]/blast: Resend batch send in chunks of 100, up to 500 contacts
- ContactPickerModal + "Send to contacts" button on /p/[id]
- Next: replace fallback HTML in blast route with real deliverable render (read grounded-report.ts)
```

- [ ] **Step 2: Push**

```bash
node scripts/safe-push.mjs
```

Expected: all pre-push gates pass, push succeeds.
