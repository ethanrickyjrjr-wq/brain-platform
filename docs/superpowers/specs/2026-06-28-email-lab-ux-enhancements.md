# Email Lab UX Enhancements

**Date:** 2026-06-28
**Covers:** Per-block AI · Inline text editing · Photo upload · Link embedding · Click/open tracking

---

## Current state

- `BlockInspector.tsx` — form panel for the selected block; all fields at once; no per-block AI
- `CanvasBlock.tsx` — `pointer-events-none` on the block body; click = select; double-click does nothing
- `image` block in Inspector — URL field only; no upload
- `text` / `hero` blocks — no linkUrl prop; no way to make block text clickable
- `blast/route.ts` — renders HTML once, injects per-recipient unsubscribe footer; no pixel or click wrapping

---

## Feature 1: Per-Block AI

### What

A compact AI prompt lives at the bottom of the BlockInspector (just above Delete). It sends only the selected block to the AI — not the whole doc. Fast (Haiku, ≤256 tokens), scoped, doesn't touch other blocks.

### How it works

Client builds a one-block EmailDoc (just the selected block, same globalStyle), POSTs to `/api/email-lab/ai` with the normal body shape, gets back a patch for that one block id, applies it to the full doc.

No API changes. The endpoint already handles a single-block doc correctly — the patch just happens to have one key.

### Files touched

Modify `components/email-lab/BlockInspector.tsx`:
- Add props: `scope?: BuildScope` and `onAiFill: (prompt: string) => Promise<void>`
- At the bottom of the inspector (above Delete button), add:
  ```tsx
  <div className="mt-3 border-t border-gray-100 pt-3">
    <label className="mb-1 block text-xs font-medium text-gray-500">Ask AI</label>
    <textarea
      rows={2}
      value={blockPrompt}
      onChange={(e) => setBlockPrompt(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void runBlockAi(); }}
      placeholder="Rewrite the headline with this month's median price…"
      className="w-full resize-none rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900 focus:border-gulf-teal focus:outline-none"
    />
    <button
      type="button"
      disabled={blockFilling || !blockPrompt.trim()}
      onClick={runBlockAi}
      className="mt-1.5 w-full rounded-md bg-gulf-teal/10 py-1.5 text-xs font-medium text-gray-800 hover:bg-gulf-teal/20 disabled:opacity-40"
    >
      {blockFilling ? "Filling…" : "Fill this block"}
    </button>
  </div>
  ```
- `runBlockAi()` calls `onAiFill(blockPrompt)` and clears the field on success

Modify `components/email-lab/EmailLabShell.tsx`:
- Pass `scope` and `onAiFill` to BlockInspector
- `handleBlockAiFill(blockId, prompt)`:
  ```ts
  async function handleBlockAiFill(blockId: string, prompt: string) {
    const block = doc.blocks.find((b) => b.id === blockId);
    if (!block) return;
    const miniDoc: EmailDoc = { globalStyle: doc.globalStyle, blocks: [block] };
    const res = await fetch("/api/email-lab/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, doc: miniDoc, scope }),
    });
    const data = (await res.json()) as { doc?: unknown; applied?: boolean };
    if (!data.doc) return;
    const parsed = EmailDocSchema.safeParse(data.doc);
    if (!parsed.success) return;
    // Merge the filled block back into the full doc
    const filledBlock = parsed.data.blocks[0];
    if (!filledBlock) return;
    commit({ ...doc, blocks: doc.blocks.map((b) => (b.id === blockId ? filledBlock : b)) });
  }
  ```

---

## Feature 2: Inline Text Editing

### What

Double-clicking a text-editable block (text, hero, signal) opens a lightweight floating edit panel that overlays the canvas directly above or below the block — no side panel required. Single-click still selects (opens inspector). Double-click opens the inline editor.

Text-editable block types: `text`, `hero`, `signal`. Other types always use the inspector.

### Approach

A floating overlay (fixed position, z-50) that renders just the writable text fields for the block. The overlay knows which block it's attached to by tracking `inlineEditId` state. Clicking outside or pressing Escape commits and closes.

### Files touched

Modify `CanvasBlock.tsx`:
- Add prop: `onDoubleClick?: () => void`
- Change the wrapper `onClick` to `onClick={onSelect}` (unchanged)
- Add `onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}` on the wrapper div

Modify `BlockCanvas.tsx`:
- Add state: `const [inlineEditId, setInlineEditId] = useState<string | null>(null)`
- Pass `onDoubleClick={() => setInlineEditId(block.id)}` to each CanvasBlock
- Render `<InlineEditOverlay>` when `inlineEditId` is set (see below)
- Close the overlay on Escape: add a `useEffect` keydown listener when `inlineEditId !== null`

New component `components/email-lab/InlineEditOverlay.tsx`:
```tsx
"use client";
// Floating text-only editor that overlays the canvas. Positioned below the
// selected block using a ref on the block's DOM node. Only renders for
// text-editable types: text, hero, signal.
import { useEffect, useRef } from "react";
import type { EmailBlock } from "@/lib/email/doc/types";

const TEXT_EDITABLE = new Set(["text", "hero", "signal"]);

export function isTextEditable(block: EmailBlock): boolean {
  return TEXT_EDITABLE.has(block.type);
}

export function InlineEditOverlay({
  block,
  anchorRef,
  onChange,
  onClose,
}: {
  block: EmailBlock;
  anchorRef: React.RefObject<HTMLElement>;
  onChange: (next: EmailBlock) => void;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const props = block.props as Record<string, unknown>;
  const set = (key: string, value: string) =>
    onChange({ ...block, props: { ...props, [key]: value } } as EmailBlock);
  const str = (key: string) => (typeof props[key] === "string" ? (props[key] as string) : "");

  // Close when clicking outside the overlay
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Position overlay below the anchor block
  const rect = anchorRef.current?.getBoundingClientRect();
  const style = rect
    ? { top: rect.bottom + 8 + window.scrollY, left: rect.left, width: rect.width }
    : { top: "50%", left: "50%", transform: "translate(-50%,-50%)" };

  const inputCls =
    "w-full resize-none rounded border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900 focus:border-gulf-teal focus:outline-none";

  return (
    <div
      ref={overlayRef}
      className="fixed z-50 rounded-lg border border-gulf-teal/40 bg-white p-3 shadow-xl"
      style={style}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-600">Quick edit</span>
        <button type="button" onClick={onClose} className="text-xs text-gray-400 hover:text-gray-700">
          Done
        </button>
      </div>

      {block.type === "text" && (
        <textarea
          autoFocus
          rows={4}
          className={inputCls}
          value={str("body")}
          onChange={(e) => set("body", e.target.value)}
        />
      )}

      {block.type === "hero" && (
        <div className="space-y-2">
          <input autoFocus className={inputCls} value={str("kicker")} placeholder="Kicker" onChange={(e) => set("kicker", e.target.value)} />
          <input className={inputCls} value={str("value")} placeholder="Big value" onChange={(e) => set("value", e.target.value)} />
          <input className={inputCls} value={str("label")} placeholder="Label" onChange={(e) => set("label", e.target.value)} />
          <textarea rows={3} className={inputCls} value={str("prose")} placeholder="Prose" onChange={(e) => set("prose", e.target.value)} />
        </div>
      )}

      {block.type === "signal" && (
        <div className="space-y-2">
          <input autoFocus className={inputCls} value={str("kicker")} placeholder="Kicker" onChange={(e) => set("kicker", e.target.value)} />
          <input className={inputCls} value={str("title")} placeholder="Title" onChange={(e) => set("title", e.target.value)} />
          <textarea rows={3} className={inputCls} value={str("body")} placeholder="Body" onChange={(e) => set("body", e.target.value)} />
        </div>
      )}
    </div>
  );
}
```

In `BlockCanvas.tsx`, track a ref per block for positioning:
```tsx
// Map of blockId → DOM ref for overlay positioning
const blockRefs = useRef<Map<string, React.RefObject<HTMLDivElement>>>(new Map());

// In the block map:
const ref = blockRefs.current.get(block.id) ?? (() => {
  const r = { current: null } as React.RefObject<HTMLDivElement>;
  blockRefs.current.set(block.id, r);
  return r;
})();
<div ref={ref}>
  <CanvasBlock ... onDoubleClick={() => setInlineEditId(block.id)} />
</div>
```

---

## Feature 3: Photo Upload + Link Embedding

### 3a: Photo Upload

#### BlockInspector image block

Replace the URL-only TextField for `image` block with:
```tsx
{block.type === "image" && (
  <>
    <PhotoUploadField
      label="Photo"
      value={str("url")}
      onChange={(v) => set("url", v)}
    />
    <TextField label="Alt text" value={str("alt")} onChange={(v) => set("alt", v)} />
    <TextField label="Caption" value={str("caption")} onChange={(v) => set("caption", v)} />
  </>
)}
```

New `PhotoUploadField` component inside `BlockInspector.tsx`:
```tsx
function PhotoUploadField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/email-lab/media", { method: "PUT", body: fd });
      if (!res.ok) return;
      const { url } = (await res.json()) as { url: string };
      onChange(url);
    } finally {
      setUploading(false);
    }
  }

  return (
    <FieldShell label={label}>
      {value && (
        <img src={value} alt="" className="mb-2 w-full rounded-md border border-gray-200 object-cover" style={{ maxHeight: 120 }} />
      )}
      <div className="flex gap-2">
        <input
          type="text"
          className={inputCls}
          value={value}
          placeholder="https://… or upload →"
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="shrink-0 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          {uploading ? "…" : "Upload"}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}
      />
    </FieldShell>
  );
}
```

#### New API route: `app/api/email-lab/media/route.ts`

```ts
// PUT /api/email-lab/media — upload an image; return a public CDN URL.
// Stores in the 'email-media' Supabase Storage bucket under user_id/uuid.ext
// (RLS: users read/write own prefix only). Max 5MB. Images only.
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = "email-media";

export const runtime = "nodejs";

export async function PUT(req: NextRequest) {
  const supabase = createClient(await cookies());
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "max 5MB" }, { status: 413 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "images only" }, { status: 415 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const bytes = await file.arrayBuffer();

  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (error) return NextResponse.json({ error: "upload failed" }, { status: 500 });

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
```

#### Supabase migration: `supabase/migrations/YYYYMMDD_email_media_bucket.sql`

```sql
-- Storage bucket: email-media (public read, user-scoped write)
INSERT INTO storage.buckets (id, name, public)
VALUES ('email-media', 'email-media', true)
ON CONFLICT (id) DO NOTHING;

-- RLS: users upload to their own prefix only
CREATE POLICY "users upload own media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'email-media' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "public read email media"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'email-media');
```

### 3b: Link Embedding

#### Type changes — `lib/email/doc/types.ts`

Add `linkUrl?: string` to `TextProps`, `ImageProps`, and `HeroProps`:

```ts
export interface TextProps {
  body?: string;
  align?: TextAlign;
  linkUrl?: string;  // wraps the entire block in an <a>
}

export interface ImageProps {
  url?: string;
  alt?: string;
  caption?: string;
  linkUrl?: string;  // clicking the image navigates here
}

export interface HeroProps {
  kicker?: string;
  value?: string;
  label?: string;
  prose?: string;
  linkUrl?: string;  // wraps the hero in an <a>
}
```

`linkUrl` is identity/link — added to the ContentPatchSchema STRIP list (AI never writes it). No schema.ts change needed for the patch guard: `ContentPatchSchema` uses `z.object()` strict mode and only allows the listed text keys; `linkUrl` is silently stripped if an AI ever emits it.

#### Inspector changes

In the `text` block section of `BlockInspector.tsx`, add after the body + align fields:
```tsx
<TextField label="Link URL (optional)" value={str("linkUrl")} onChange={(v) => set("linkUrl", v)} placeholder="Makes the whole block clickable" />
```

Same for `image` (after alt/caption) and `hero` (after prose):
```tsx
<TextField label="Click-through URL" value={str("linkUrl")} onChange={(v) => set("linkUrl", v)} placeholder="https://…" />
```

#### Renderer changes

In `lib/email/blocks/TextBlock.tsx` (or wherever `text` is rendered), wrap in `<a>` when `linkUrl` is set:
```tsx
const inner = <Text ...>{props.body}</Text>;
return props.linkUrl
  ? <Link href={props.linkUrl} style={{ color: "inherit", textDecoration: "none" }}>{inner}</Link>
  : inner;
```

Same pattern for `HeroBlock.tsx` and `ImageBlock.tsx`. Use react-email's `<Link>` component (not a bare `<a>`) to keep email-client compatibility.

---

## Feature 4: Email Open + Click Tracking

### Schema

New Supabase table `email_events`:
```sql
CREATE TABLE email_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blast_id    uuid NOT NULL REFERENCES email_blasts(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  event_type  text NOT NULL CHECK (event_type IN ('open', 'click')),
  url         text,              -- null for 'open'; original href for 'click'
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX email_events_blast_idx ON email_events(blast_id);
CREATE INDEX email_events_contact_idx ON email_events(contact_id);

-- RLS: service role only (no direct user reads; ops dashboard queries via service key)
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
```

Add `email_events` to the TypeScript database type via `bun run gen:types` after migrating.

### Tracking pixel — `app/api/t/o/[blast_id]/[contact_id]/route.ts`

```ts
// GET /api/t/o/{blast_id}/{contact_id} — record open event, return 1×1 GIF
import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/utils/supabase/service";

// 1×1 transparent GIF (base64-decoded at runtime — no file dependency)
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ blast_id: string; contact_id: string }> },
) {
  const { blast_id, contact_id } = await params;
  // Fire-and-forget: don't block the pixel response on the DB write
  const supabase = createServiceRoleClient();
  void supabase
    .from("email_events")
    .insert({ blast_id, contact_id, event_type: "open" })
    .then(() => {}); // swallow — tracking is best-effort

  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
```

### Click redirect — `app/api/t/c/[blast_id]/[contact_id]/route.ts`

```ts
// GET /api/t/c/{blast_id}/{contact_id}?url={encoded_url} — record click, redirect
import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/utils/supabase/service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ blast_id: string; contact_id: string }> },
) {
  const { blast_id, contact_id } = await params;
  const dest = req.nextUrl.searchParams.get("url") ?? "/";

  void createServiceRoleClient()
    .from("email_events")
    .insert({ blast_id, contact_id, event_type: "click", url: dest })
    .then(() => {});

  return NextResponse.redirect(dest, { status: 302 });
}
```

### Wire into blast route — `app/api/deliverables/[id]/blast/route.ts`

Add two helpers after `withFooter`:

```ts
/** Inject a tracking pixel before </body>. */
function withPixel(html: string, baseUrl: string, blastId: string, contactId: string): string {
  const src = `${baseUrl}/api/t/o/${blastId}/${contactId}`;
  const pixel = `<img src="${escAttr(src)}" width="1" height="1" style="display:none;border:0" alt="" />`;
  return html.includes("</body>") ? html.replace("</body>", `${pixel}</body>`) : html + pixel;
}

/** Rewrite all href="..." to go through the click-tracker.
 *  Skips: unsubscribe links, mailto:, tel:, already-tracked links. */
function withClickTracking(
  html: string,
  baseUrl: string,
  blastId: string,
  contactId: string,
): string {
  const trackBase = `${baseUrl}/api/t/c/${blastId}/${contactId}`;
  return html.replace(/href="([^"]+)"/g, (match, href: string) => {
    // Skip: unsubscribe, mailto, tel, already wrapped
    if (
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("#") ||
      href.includes("/api/unsubscribe") ||
      href.includes("/api/t/")
    ) {
      return match;
    }
    return `href="${escAttr(`${trackBase}?url=${encodeURIComponent(href)}`)}"`;
  });
}
```

Then in `messageFor()`, change:
```ts
const messageFor = (c: { id: string; email: string }) => {
  const unsubUrl = `${BASE_URL}/api/unsubscribe?id=${c.id}`;
  let html = withFooter(baseHtml, webUrl, unsubUrl);
  // Tracking (requires blast.id to be set — guaranteed: we insert the blast row above)
  if (blast?.id) {
    html = withClickTracking(html, BASE_URL, blast.id, c.id);
    html = withPixel(html, BASE_URL, blast.id, c.id);
  }
  return { from, to: [c.email], subject, html, ... };
};
```

Move `messageFor` below the blast insert (it currently precedes it, but now needs `blast?.id`).

### Stats read — `app/api/deliverables/[id]/blast/stats/route.ts`

```ts
// GET /api/deliverables/[id]/blast/stats — open + click counts for a deliverable
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient(await cookies());
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Verify ownership via RLS on deliverables
  const { data: deliverable } = await supabase
    .from("deliverables")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!deliverable) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Counts via email_blasts join
  const { data } = await supabase
    .from("email_events")
    .select("event_type, url, contact_id, created_at, email_blasts!inner(deliverable_id)")
    .eq("email_blasts.deliverable_id", id);

  const events = data ?? [];
  const opens = new Set(events.filter((e) => e.event_type === "open").map((e) => e.contact_id));
  const clicks = new Set(events.filter((e) => e.event_type === "click").map((e) => e.contact_id));
  const topLinks = Object.entries(
    events
      .filter((e) => e.event_type === "click" && e.url)
      .reduce<Record<string, number>>((acc, e) => {
        acc[e.url!] = (acc[e.url!] ?? 0) + 1;
        return acc;
      }, {}),
  )
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([url, count]) => ({ url, count }));

  return NextResponse.json({
    unique_opens: opens.size,
    unique_clicks: clicks.size,
    total_events: events.length,
    top_links: topLinks,
  });
}
```

---

## What is NOT in this spec

- Rich text (bold, italic, inline links within a paragraph) — needs a contentEditable editor; separate scope
- Real-time tracking dashboard UI — the stats API is ready; the UI component is a follow-on
- Per-link click heatmaps — derivable from `email_events.url` groupings; out of scope here
- Social calendar — covered separately in `2026-06-28-social-calendar-lab-design.md`

---

## Constraints

- `linkUrl` is AI-write-blocked (identity/link category in ContentPatchSchema) — no schema.ts change needed since strict mode already rejects it
- Open pixel must not be blocked by the unsubscribe skip list in `withClickTracking` — the pixel is injected AFTER click-tracking rewrites, so there's no ordering issue
- `messageFor()` must move after the blast INSERT so `blast?.id` is available
- Upload bucket `email-media` must be public so the stored image URL works in sent emails without signed-URL expiry
- Max 5MB upload per image — enforce at the route level, not just in the UI
- `createServiceRoleClient` must be an existing util (check `utils/supabase/` before wiring — if it's `createServiceClient` or similar, use the right name)
- Click tracking regex skips `#` anchors, `mailto:`, `tel:`, and `/api/unsubscribe` — these must not be wrapped or CAN-SPAM compliance breaks
