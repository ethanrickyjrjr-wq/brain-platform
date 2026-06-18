# PDF Extraction + Contact List + Email Blast — Design Spec

**Date:** 2026-06-18  
**Status:** Approved for implementation  
**Scope:** Phase B only. Phase C (audience segmentation, scheduling per audience) and phone import (Google OAuth, QR/vCard) are in `GET DONE/`.

---

## Problem

When a user uploads a PDF to a project and clicks "Create Email," the system has only a UUID storage path — no content. The AI correctly reports "no extractable content available." Two additional gaps compound this: there is no contact list to send the finished email to, and no blast mechanism to deliver it.

---

## Solution Overview

Three components, built in order:

1. **PDF Extraction** — at upload time, Claude vision reads the PDF and stores extracted content on the file item. All downstream deliverable builds (email, BOV, one-pager) get real content automatically.
2. **Contact List** — user-level table of contacts (name, email, phone, tags). CSV import + manual add. Reusable across all their projects.
3. **Email Blast** — "Send to contacts" action on a built email deliverable. Contact picker → confirm → sends via existing email infrastructure → audit trail.

**Paid gate:** Both PDF extraction and email blast are paid-user features. The upload itself (file storage) remains available to all users.

---

## Component 1 — PDF Extraction

### What changes

**Upload flow (currently):**
`UploadDrop.tsx` → Supabase Storage → `ProjectItem { kind: "file", storage_path, mime, size, caption }`

**Upload flow (new):**
Same storage upload. After storage succeeds and the `ProjectItem` is written, the client fires a second async call to a new route. The upload UI does not block on this — the file appears immediately, with an extraction status indicator.

### New route — `POST /api/projects/[id]/extract-pdf`

**Request body:**
```json
{ "item_id": "<uuid of the ProjectItem>" }
```

**Server steps:**
1. Verify `user_id` owns the project (existing RLS pattern)
2. Verify user is on paid plan (check `users.plan` or equivalent)
3. Fetch PDF bytes from Supabase Storage using service-role client
4. Send bytes to Claude Sonnet via **base64 inline** (not Files API — this is a one-shot extraction; we store the result and never re-query the same file, so Files API adds complexity with no benefit). Request headers must include `anthropic-beta: files-api-2025-04-14` for PDF support. Prompt:
   > "Extract all key facts, figures, descriptions, prices, dates, addresses, financial data, and any other meaningful information from this document. Return a structured plain-text summary suitable for drafting a professional email. Be complete — include every number and named detail you can read."
5. Patch the `ProjectItem` in `projects.items` JSONB:
   - Add `extracted_text: string` (Claude's response)
   - Add `extraction_status: "done"` (or `"failed"`)
6. Return `{ status: "done" }` or `{ status: "failed", reason: string }`

**Only runs on PDFs** (`mime === "application/pdf"`). Image uploads (JPG, PNG, WebP) are not extracted.

**Encrypted/password-protected PDFs are not supported** — Claude vision cannot open them. Return `extraction_status: "failed"` with a user-friendly reason.

**Cost:** ~1,500–3,000 input tokens per page. A 10-page offering memo ≈ 15k–30k tokens ≈ 1–3 cents on Sonnet. A dense 20-page market report can reach 5–10 cents. Logged but not individually billed — covered by the paid plan.

### ProjectItem schema change

`lib/project/items.ts` — the `file` kind gains two optional fields:

```typescript
kind: "file"
storage_path: string
mime: string
size: number
caption?: string
extracted_text?: string        // NEW — Claude's vision read of the PDF
extraction_status?: "processing" | "done" | "failed"  // NEW
```

### Narrative builder change

`lib/deliverable/build.ts` — item renderer for `kind: "file"`:

**Before:**
```
[N] FILE — ffa37ac0-....pdf (pdf)
```

**After (when extracted_text exists):**
```
[N] DOCUMENT — {caption or filename}
{extracted_text}
```

**After (when no extracted_text):**
```
[N] FILE — {caption or filename} (pdf, content not available)
```

The LLM's existing lint rules apply to document content the same as any other item — no invented numbers, no smoothing.

### UI changes — `UploadDrop.tsx`

- After upload completes, show extraction spinner: "Reading document…"
- On extraction `done`: show green check "Content extracted"
- On extraction `failed`: show muted "Couldn't read content — see options below"
- **Warn, don't block.** If any file item has `extraction_status: "processing"` or `"failed"`, show a soft warning banner above the Build button:
  > "PDF hasn't been read yet — the AI will use the file name only. You can wait, generate anyway, or paste your content into the email body above."
  
  Two inline options:
  1. **"Generate anyway"** — proceeds with filename only; AI still drafts from all other project items + user signature appended
  2. **"I'll write it"** — opens/scrolls to a free-text body field at the top of the email compose view, pre-populated with the user's saved signature
  
  If all files have `extraction_status: "done"`, no banner, no friction.
- Non-PDF files: no spinner, no extraction

### Multiple deliverables — no issue

`extracted_text` is stored once on the `ProjectItem`. Each deliverable's `freezeSnapshot()` copies the item's current state into its own immutable `items_snapshot`. Deliverables built before extraction have no content; deliverables built after have it. Existing frozen deliverables are never modified.

---

## Component 2 — Contact List

### Database

```sql
CREATE TABLE contacts (
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

CREATE INDEX contacts_user_id_idx ON contacts(user_id);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts_own" ON contacts
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

**User-level, not project-level.** One contact list reused across all projects.

### API routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/contacts` | List all contacts for the authed user |
| POST | `/api/contacts` | Add one contact |
| PATCH | `/api/contacts/[id]` | Update name / phone / tags |
| DELETE | `/api/contacts/[id]` | Remove contact |
| POST | `/api/contacts/import` | Bulk import from CSV or vCard |
| POST | `/api/unsubscribe` | One-click unsubscribe (stateless, no auth — Google posts here) |

### CSV import

**Flexible column mapping** — accept common CRM export column names:

| Canonical field | Accepted column names |
|---|---|
| `name` | `name`, `full name`, `contact name`, `first name` + `last name` (merged) |
| `email` | `email`, `email address`, `e-mail` |
| `phone` | `phone`, `phone number`, `mobile`, `cell` |
| `tags` | `tags`, `groups`, `lists` (comma-separated values in the cell) |

**Import behavior:**
- Skip rows with no valid email
- Upsert on `(user_id, email)` — existing contact updated, not duplicated
- Return summary: `{ added: 47, updated: 3, skipped: 2, skip_reasons: ["row 4: no email", "row 12: invalid email format"] }`

**File size limit:** 5 MB, max 5,000 rows per import.

**Accepted formats:** `.csv`, `.vcf` (vCard — parsed for FN, EMAIL, TEL fields using the `vcf` npm package). Critical implementation note: `card.get('email')` returns a single `Property` when there is exactly one email address, or a `Property[]` when there are two or more — always normalize with `Array.isArray()` before iterating or the parser crashes on real-world exports. Old Android/Nokia vCard 2.1 files may use quoted-printable encoding — use the `quoted-printable` npm package to decode if names show garbled characters.

### Manual add

Modal with three fields: Name (optional), Email (required), Phone (optional), Tags (optional, comma-separated). Submits to `POST /api/contacts`. Duplicate email shows "Contact updated" not an error.

### Tags (sending groups)

Tags are free-form strings on each contact. No separate table — just `text[]` on the contact row.

Users add tags at import (via a `tags` column in CSV) or manually via the contact edit flow. Common use: "investors", "buyers", "FMB", "Naples".

When blasting, the contact picker lets users filter by tag or select all.

### UI — `/contacts` page

Accessible from the global nav (account menu or top bar).

**Layout:**
- Header: "Contacts" + count badge + "Add contact" button + "Import CSV" button
- Search bar (client-side filter on name/email)
- Tag filter chips (All | investor | buyer | FMB | …)
- Table: Name | Email | Phone | Tags | Added | Delete
- Empty state: "No contacts yet. Import a CSV or add one manually."

**Import CSV flow:**
1. File picker opens → user selects `.csv`
2. Server parses, returns column mapping preview: "We found: name → Name, email → Email Address, phone → Mobile. Look right?"
3. User confirms → import runs → summary toast

---

## Component 3 — Email Blast

### Database

```sql
CREATE TABLE email_blasts (
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

### API route — `POST /api/deliverables/[id]/blast`

**Request body:**
```json
{ "contact_ids": ["uuid1", "uuid2", ...] }
```

**Server steps:**
1. Verify user owns the deliverable
2. Verify user is on paid plan
3. Verify deliverable `template === "email"` and `status === "ready"`
4. Fetch contacts — verify all `contact_ids` belong to `auth.uid()`
5. Insert `email_blasts` row with `status: "sending"`
6. Loop contacts:
   - Render email HTML using the existing deliverable HTML renderer in `lib/deliverable/` (confirm exact function name at implementation — frozen snapshot, same output every call)
   - Send via the existing email sender already wired in the platform (confirm transport at implementation — do not add a new sender)
   - Track per-contact success/failure
7. Update blast row: `status: "sent"`, `sent_count`, `failed_count`, `sent_at`
8. Return `{ sent: N, failed: M }`

**Email transport:** Use **Resend** — already wired. Use `resend.batch.send([...])` in chunks of 100 (Resend batch limit) to cover up to 500 contacts in 5 calls. The full-access key (`RESEND_AUDIENCES_KEY`) is required for batch sends; the sending-only key will 401. Import via `getMarketingResend()` from `lib/email/marketing-client.ts`.

**Required headers on every blast email** (researched — these are not optional):
- `List-Unsubscribe: <https://yourdomain.com/unsubscribe?id={contact_id}>, <mailto:unsubscribe@yourdomain.com>`
- `List-Unsubscribe-Post: List-Unsubscribe=One-Click` — Google/Yahoo require this for marketing mail; their servers POST to the HTTPS URL directly (no cookies/session allowed)
- `Message-ID: <{unique-id}@yourdomain.com>` — required by RFC 5322
- `Precedence: bulk` — suppresses auto-replies

**Required body content (CAN-SPAM):**
- Physical mailing address in the email body — most commonly missed requirement
- Unsubscribe link — required even for one-time blasts to opted-in contacts

**Unsubscribe endpoint** — new route needed: `POST /api/unsubscribe?id={contact_id}`. Must be stateless (no session, no cookies, no auth) — Google's servers POST to it directly, not the user's browser. Writes `unsubscribed: true` to the contacts table; blast query excludes unsubscribed contacts.

**HTML CSS:** All structural CSS must be inlined — Gmail mobile apps strip `<style>` blocks. Use table-based layout (not flexbox/grid) for Outlook Windows compatibility.

**Error handling:** If a send fails for an individual contact, continue the loop. Log the failure. Never abort the whole blast for one bad address.

**Rate limiting:** Max 500 contacts per blast (first version). If the list exceeds 500, server returns a 400 with "Split into smaller groups — max 500 per send." Phase C handles large-list batching.

### UI — deliverable page `/p/[id]`

**Paid users only** — "Send to contacts" button appears in the deliverable action bar.

**Flow:**
1. User clicks "Send to contacts"
2. Modal opens: contact picker
   - Search bar
   - Tag filter (All | investor | buyer | …)
   - Checkbox list of contacts (name + email)
   - "Select all" toggle
   - Count badge: "23 selected"
3. "Send to 23 contacts" confirm button
4. On confirm: POST blast, show progress toast "Sending…"
5. On completion: toast "Sent to 23 contacts" (or "Sent to 21, 2 failed")
6. Modal closes

**Blast history** (optional v1 addition): small "Sent X times" link under the deliverable title that opens a log of past blasts (date, count sent).

---

## Data Flow — End to End

```
User uploads PDF
  → Supabase Storage (existing)
  → ProjectItem { kind: "file", storage_path, mime, size } (existing)
  → POST /api/projects/[id]/extract-pdf (NEW)
      → Claude vision reads PDF bytes
      → ProjectItem gains extracted_text + extraction_status: "done"

User clicks "Create Email"
  → Build button enabled (extraction done)
  → POST /api/projects/[id]/build (existing)
      → freezeSnapshot() copies items including extracted_text (existing + minor change)
      → buildDeliverableNarrative() renders [N] DOCUMENT — {content} (existing + minor change)
      → LLM drafts real email from actual PDF content
      → deliverable row inserted, status: "ready"
  → User lands on /p/[id] (existing)

User clicks "Send to contacts"
  → Contact picker modal (NEW)
  → POST /api/deliverables/[id]/blast (NEW)
      → Render frozen email HTML per contact
      → Send via email infrastructure
      → email_blasts row written
```

---

## What is NOT changing

- The deliverable freeze/snapshot system — untouched
- The existing email render pipeline — reused as-is
- The `email_schedules` / recurring send system — untouched (blast is a separate one-time action)
- The deliverable lint rules — apply to PDF-extracted content the same as any other item

---

## Out of Scope (Phase B)

- PDF as visual template (different numbers, same layout) → `GET DONE/pdf-template-and-user-data-token.md`
- Cross-project Document Library → same file
- User Data Token Documents → same file
- Google Contacts / QR code phone import → `GET DONE/contacts-phone-import.md`
- Audience segmentation + per-audience scheduling → `GET DONE/email-audience-system-phase-c.md`
- Unsubscribe / bounce handling → Phase C
- Blast batching >500 contacts → Phase C
