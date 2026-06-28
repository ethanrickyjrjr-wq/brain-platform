# Email Lab Full Upgrade Plan

> **Recommended model:** 🧠 Opus — 9 tasks, keywords: migration, schema, architecture

**Date:** 2026-06-28
**Excludes:** Per-block AI + inline text editing (other session owns those)
**Covers:**
- Merge tags (`{{first_name}}`)
- Block-level padding + section background
- Aesthetic quality upgrades (GoodEmails patterns)
- Link embedding (`linkUrl` on text/image/hero)
- Photo upload (`/api/email-lab/media`)
- Two-column block (`two-col`)
- Open pixel + click tracking

---

## Actual code baseline

Every block renderer imports `SECTION_PAD = "20px 24px"`, `CARD_BG = "#ffffff"`, `BORDER = "#E5E7EB"`, `MUTED = "#6B7280"` from `lib/email/blocks/styles.ts`. These are the four shared tokens.

Every block's outer `Section` hardcodes `backgroundColor: CARD_BG` and `padding: SECTION_PAD`. There is no per-block spacing or background control today.

`ImagePropsSchema` in `schema.ts:93` already has `kind: z.enum(["chart", "photo"]).optional()` but `ImageProps` in `types.ts` does not — a silent schema-types gap. Fix it in Task 1.

`ContentPatchSchema` uses strip mode (`z.object`, not `z.strictObject`) — unknown keys are silently dropped. Any new prop added to props interfaces that is NOT in `BlockContentPatchSchema` is automatically AI-safe without any schema.ts change to the patch validator.

`StatsBlock` and `AgentCardBlock` already use react-email's `Row` + `Column` — the two-col renderer can follow the exact same pattern.

`blast/route.ts` renders `baseHtml` once, then calls `withFooter(baseHtml, webUrl, unsubUrl)` per-recipient. Merge tag substitution and tracking injection slot into the same per-recipient pass.

---

## Task 1: Fix the types.ts / schema.ts gap + add shared BlockBase

**Files:** `lib/email/doc/types.ts`

Add `BlockBase` interface and apply it to the five blocks that have controllable padding. Add `kind` to `ImageProps` to close the schema gap.

```typescript
// After the KnownPlatform / SocialPlatformType types, before the block interfaces:

export type PaddingSize = "none" | "sm" | "md" | "lg";

/** Optional per-block layout controls. Styling/identity — the AI never writes these. */
export interface BlockBase {
  paddingY?: PaddingSize;  // none=0 sm=12px md=20px(default) lg=36px
  sectionBg?: string;      // hex — overrides CARD_BG for this block's outer Section only
}

// Then extend the interfaces:
export interface HeroProps extends BlockBase {
  kicker?: string;
  value?: string;
  label?: string;
  prose?: string;
  linkUrl?: string;   // wraps entire block in <Link>; AI never writes this
}

export interface TextProps extends BlockBase {
  body?: string;
  align?: TextAlign;
  linkUrl?: string;
}

export interface StatsProps extends BlockBase {
  stats: StatItem[];
}

export interface SignalProps extends BlockBase {
  kicker?: string;
  title?: string;
  body?: string;
  bgColor?: string;
}

export interface ImageProps extends BlockBase {
  url?: string;
  alt?: string;
  caption?: string;
  kind?: "chart" | "photo";  // closes schema gap — already in schema.ts:93
  linkUrl?: string;
}
```

**Files:** `lib/email/doc/schema.ts`

For each of the five updated interfaces, add `paddingY` and `sectionBg` to the props schema. Also add `linkUrl` to Hero, Text, Image schemas:

```typescript
const paddingY = () => z.enum(["none", "sm", "md", "lg"]).optional();
const sectionBg = () => z.string().optional();
const linkUrl = () => z.string().optional();

// HeroPropsSchema — replace existing:
const HeroPropsSchema = z.object({
  kicker: z.string().max(60).optional(),
  value: z.string().max(24).optional(),
  label: z.string().max(80).optional(),
  prose: z.string().max(500).optional(),
  linkUrl: linkUrl(),
  paddingY: paddingY(),
  sectionBg: sectionBg(),
}) satisfies z.ZodType<HeroProps>;

// TextPropsSchema — replace existing:
const TextPropsSchema = z.object({
  body: z.string().max(2000).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  linkUrl: linkUrl(),
  paddingY: paddingY(),
  sectionBg: sectionBg(),
}) satisfies z.ZodType<TextProps>;

// ImagePropsSchema — replace existing (adds linkUrl, closes kind gap):
const ImagePropsSchema = z.object({
  url: z.string().optional(),
  alt: z.string().max(160).optional(),
  caption: z.string().max(200).optional(),
  kind: z.enum(["chart", "photo"]).optional(),
  linkUrl: linkUrl(),
  paddingY: paddingY(),
  sectionBg: sectionBg(),
}) satisfies z.ZodType<ImageProps>;

// StatsPropsSchema — add padding only:
const StatsPropsSchema = z.object({
  stats: z.array(StatItemSchema).min(1).max(3),
  paddingY: paddingY(),
  sectionBg: sectionBg(),
}) satisfies z.ZodType<StatsProps>;

// SignalPropsSchema — add padding only (linkUrl doesn't apply):
const SignalPropsSchema = z.object({
  kicker: z.string().max(60).optional(),
  title: z.string().max(120).optional(),
  body: z.string().max(500).optional(),
  bgColor: z.string().optional(),
  paddingY: paddingY(),
  sectionBg: sectionBg(),
}) satisfies z.ZodType<SignalProps>;
```

`ContentPatchSchema` (`BlockContentPatchSchema`) does NOT need changes — `paddingY`, `sectionBg`, `linkUrl` are not in that schema, so strip mode drops them automatically. AI-safe without any additional work.

---

## Task 2: Shared padding resolver in styles.ts

**Files:** `lib/email/blocks/styles.ts`

```typescript
export type PaddingSize = "none" | "sm" | "md" | "lg";

const PAD_Y: Record<PaddingSize, string> = {
  none: "0px 24px",
  sm:   "12px 24px",
  md:   "20px 24px",   // current SECTION_PAD default
  lg:   "36px 24px",
};

/** Resolve per-block paddingY prop → CSS padding string. Falls back to SECTION_PAD. */
export function sectionPad(paddingY?: PaddingSize): string {
  return paddingY ? PAD_Y[paddingY] : SECTION_PAD;
}
```

---

## Task 3: Update renderers to read paddingY, sectionBg, linkUrl

**Pattern for every affected block:** replace hardcoded `padding: SECTION_PAD, backgroundColor: CARD_BG` with props-driven values. For linkUrl, wrap the Section in react-email `<Link>`.

**`HeroBlock.tsx`** — replace the Section's style:
```tsx
import { Section, Text, Link } from "@react-email/components";
import { fontStack, MUTED, BORDER, CARD_BG, sectionPad } from "./styles";

// Inside HeroBlock:
const outerStyle = {
  backgroundColor: props.sectionBg ?? CARD_BG,
  padding: sectionPad(props.paddingY),
  borderBottom: `1px solid ${BORDER}`,
};
const inner = (
  <Section style={outerStyle}>
    {/* existing content unchanged */}
  </Section>
);
return props.linkUrl
  ? <Link href={props.linkUrl} style={{ display: "block", textDecoration: "none", color: "inherit" }}>{inner}</Link>
  : inner;
```

**`TextBlock.tsx`** — same pattern:
```tsx
import { Section, Text, Link } from "@react-email/components";
import { fontStack, SECTION_PAD, CARD_BG, BORDER, sectionPad } from "./styles";

const outerStyle = {
  backgroundColor: props.sectionBg ?? CARD_BG,
  padding: sectionPad(props.paddingY),
  borderBottom: `1px solid ${BORDER}`,
};
const inner = (
  <Section style={outerStyle}>
    {props.body ? <Text style={{ ... }}>{props.body}</Text> : null}
  </Section>
);
return props.linkUrl
  ? <Link href={props.linkUrl} style={{ display: "block", textDecoration: "none", color: "inherit" }}>{inner}</Link>
  : inner;
```

**`ImageBlock.tsx`** — wrap the `<Img>` in a Link when `linkUrl` is set:
```tsx
const img = props.url
  ? <Img src={props.url} alt={props.alt ?? ""} style={{ width: "100%", maxWidth: "600px", display: "block", margin: 0 }} />
  : <Section style={{ ... }}>...</Section>;

const imgEl = props.linkUrl
  ? <Link href={props.linkUrl} style={{ display: "block" }}>{img}</Link>
  : img;

return (
  <Section style={{ backgroundColor: props.sectionBg ?? CARD_BG, borderBottom: `1px solid ${BORDER}` }}>
    {imgEl}
    {/* caption unchanged */}
  </Section>
);
```

**`StatsBlock.tsx`** and **`SignalBlock.tsx`** — only padding + bg, no linkUrl:
```tsx
// StatsBlock outer Section:
<Section style={{
  backgroundColor: props.sectionBg ?? CARD_BG,   // was: CARD_BG
  padding: sectionPad(props.paddingY),             // was: SECTION_PAD
  borderBottom: `1px solid ${BORDER}`,
}}>
```

---

## Task 4: BlockInspector — padding + sectionBg + linkUrl controls

**Files:** `components/email-lab/BlockInspector.tsx`

Add a `BlockBaseControls` helper component:
```tsx
function BlockBaseControls({
  paddingY,
  sectionBg,
  linkUrl,
  showLink = false,
  onChange,
}: {
  paddingY?: string;
  sectionBg?: string;
  linkUrl?: string;
  showLink?: boolean;
  onChange: (key: string, v: string) => void;
}) {
  return (
    <>
      <SelectField
        label="Spacing"
        value={paddingY ?? "md"}
        options={["none", "sm", "md", "lg"]}
        onChange={(v) => onChange("paddingY", v)}
      />
      <ColorField
        label="Section background"
        value={sectionBg ?? ""}
        onChange={(v) => onChange("sectionBg", v)}
      />
      {showLink && (
        <TextField
          label="Click-through URL"
          value={linkUrl ?? ""}
          onChange={(v) => onChange("linkUrl", v)}
          placeholder="https://…"
        />
      )}
    </>
  );
}
```

Add `<BlockBaseControls>` at the bottom of the hero, text, stats, signal, and image sections (above the Delete button). Pass `showLink={true}` for hero, text, image.

---

## Task 5: Aesthetic upgrades (GoodEmails patterns)

**Files:** `lib/email/blocks/styles.ts`, individual block renderers

These are value changes only — no interface changes.

**`styles.ts`:** tighten `SECTION_PAD` from `"20px 24px"` to `"24px 28px"` (more breathing room). This affects all blocks globally; test visual output after.

**`HeroBlock.tsx`:** increase `value` font from `40px` to `48px`, increase `prose` line-height from `1.6` to `1.7`, increase `prose` font-size from `15px` to `16px`.

**`StatsBlock.tsx`:** increase stat value from `26px` to `32px`, add `letterSpacing: "-0.01em"` to the stat value text for tighter high-impact feel. Cell padding from `"8px"` to `"12px"`.

**`SignalBlock.tsx`:** increase `title` font from `16px` to `18px`. Add `borderRadius: "6px"` to the inner box (currently `4px`). Increase inner padding from `"16px 18px"` to `"18px 20px"`.

**`TextBlock.tsx`:** increase `fontSize` from `15px` to `16px`, `lineHeight` from `1.7` to `1.75`.

**`ButtonBlock.tsx`:** padding from `"12px 28px"` to `"14px 32px"`, fontSize from `14px` to `15px`, borderRadius from `6px` to `8px`.

**`default-docs.ts`:** update the `Market Spotlight` seed's hero to `value: ""` (blank, so AI fills it) and add better prose placeholder text. Add a `stats` seed that demonstrates the `lg` paddingY option.

---

## Task 6: Two-column block

This is the only new block type. It uses react-email `Row` + `Column` exactly as `AgentCardBlock` already does.

**`lib/email/doc/types.ts`** — add to `BlockType` and define props:

```typescript
// Add to BlockType union:
export type BlockType =
  | "header" | "hero" | "stats" | "signal" | "text" | "image"
  | "agent-card" | "agent-hero" | "social-icons" | "button" | "divider"
  | "footer"
  | "two-col";  // NEW

export type TwoColCellType = "text" | "image";

export interface TwoColCell {
  type: TwoColCellType;
  // text cell
  body?: string;
  align?: TextAlign;
  // image cell
  imageUrl?: string;
  imageAlt?: string;
  imageCaption?: string;
}

export interface TwoColProps extends BlockBase {
  left: TwoColCell;
  right: TwoColCell;
  /** Width split. "50-50" = equal, "40-60" = left narrower, "60-40" = left wider. Default "50-50". */
  split?: "50-50" | "40-60" | "60-40";
}

// Add to BlockPropsMap:
export interface BlockPropsMap {
  // ... existing ...
  "two-col": TwoColProps;
}
```

**`lib/email/doc/schema.ts`** — add `TwoColCellSchema` and `TwoColPropsSchema`:

```typescript
const TwoColCellSchema = z.object({
  type: z.enum(["text", "image"]),
  body: z.string().max(1000).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  imageUrl: z.string().optional(),
  imageAlt: z.string().max(160).optional(),
  imageCaption: z.string().max(200).optional(),
});

const TwoColPropsSchema = z.object({
  left: TwoColCellSchema,
  right: TwoColCellSchema,
  split: z.enum(["50-50", "40-60", "60-40"]).optional(),
  paddingY: paddingY(),
  sectionBg: sectionBg(),
}) satisfies z.ZodType<TwoColProps>;

// Add to BlockSchema discriminatedUnion:
z.object({ id: idIn, type: z.literal("two-col"), props: TwoColPropsSchema }),
```

**`BlockContentPatchSchema`** — add two-col cell text fields so the AI CAN fill text/alt/caption in a two-col:
```typescript
export const BlockContentPatchSchema = z.object({
  // ... existing fields ...
  // Two-col cell text (stripped of imageUrl, type — those are identity)
  leftBody: z.string().max(1000).optional(),
  rightBody: z.string().max(1000).optional(),
  leftCaption: z.string().max(200).optional(),
  rightCaption: z.string().max(200).optional(),
  leftAlt: z.string().max(160).optional(),
  rightAlt: z.string().max(160).optional(),
});
```

**`lib/email/build-doc.ts`** — update `applyPatch` to handle two-col cell fields:
```typescript
// In applyPatch, after the normal prop merge:
if (block.type === "two-col") {
  const p = patch as Record<string, unknown>;
  const current = block.props as TwoColProps;
  const left = { ...current.left };
  const right = { ...current.right };
  if (p.leftBody !== undefined)   left.body = p.leftBody as string;
  if (p.leftCaption !== undefined) left.imageCaption = p.leftCaption as string;
  if (p.leftAlt !== undefined)    left.imageAlt = p.leftAlt as string;
  if (p.rightBody !== undefined)  right.body = p.rightBody as string;
  if (p.rightCaption !== undefined) right.imageCaption = p.rightCaption as string;
  if (p.rightAlt !== undefined)   right.imageAlt = p.rightAlt as string;
  return { ...block, props: { ...current, left, right } } as EmailBlock;
}
```

**`lib/email/blocks/TwoColBlock.tsx`** — new file:
```tsx
// lib/email/blocks/TwoColBlock.tsx — PURE. Two-column layout using react-email Row+Column.
import { Section, Row, Column, Text, Img, Link } from "@react-email/components";
import type { EmailGlobalStyle, TwoColCell, TwoColProps } from "../doc/types";
import { fontStack, MUTED, CARD_BG, BORDER, sectionPad } from "./styles";

const SPLITS: Record<NonNullable<TwoColProps["split"]>, [string, string]> = {
  "50-50": ["50%", "50%"],
  "40-60": ["40%", "60%"],
  "60-40": ["60%", "40%"],
};

function Cell({ cell, globalStyle }: { cell: TwoColCell; globalStyle: EmailGlobalStyle }) {
  const font = fontStack(globalStyle.fontFamily);
  if (cell.type === "image") {
    return (
      <>
        {cell.imageUrl
          ? <Img src={cell.imageUrl} alt={cell.imageAlt ?? ""} style={{ width: "100%", display: "block" }} />
          : <Section style={{ padding: "32px 16px", backgroundColor: "#F3F4F6", textAlign: "center" }}>
              <Text style={{ fontFamily: font, fontSize: "12px", color: MUTED, margin: 0 }}>Image</Text>
            </Section>
        }
        {cell.imageCaption
          ? <Text style={{ fontFamily: font, fontSize: "12px", color: MUTED, textAlign: "center", margin: "6px 0 0" }}>{cell.imageCaption}</Text>
          : null
        }
      </>
    );
  }
  return cell.body
    ? <Text style={{ fontFamily: font, fontSize: "15px", lineHeight: "1.7", color: globalStyle.textColor, textAlign: cell.align ?? "left", margin: 0 }}>{cell.body}</Text>
    : null;
}

export function TwoColBlock({ props, globalStyle }: { props: TwoColProps; globalStyle: EmailGlobalStyle }) {
  const [lw, rw] = SPLITS[props.split ?? "50-50"];
  return (
    <Section style={{ backgroundColor: props.sectionBg ?? CARD_BG, padding: sectionPad(props.paddingY), borderBottom: `1px solid ${BORDER}` }}>
      <Row>
        <Column style={{ width: lw, verticalAlign: "top", paddingRight: "12px" }}>
          <Cell cell={props.left} globalStyle={globalStyle} />
        </Column>
        <Column style={{ width: rw, verticalAlign: "top", paddingLeft: "12px" }}>
          <Cell cell={props.right} globalStyle={globalStyle} />
        </Column>
      </Row>
    </Section>
  );
}
```

**`BlockRenderer.tsx`** — add case:
```tsx
import { TwoColBlock } from "./TwoColBlock";
// In switch:
case "two-col":
  return <TwoColBlock props={block.props} globalStyle={globalStyle} />;
```

**`BlockInspector.tsx`** — add to LABELS and add two-col section:
```typescript
const LABELS = { ..., "two-col": "Two Column" };

// In the render:
{block.type === "two-col" && (
  <TwoColEditor
    props={block.props as TwoColProps}
    onChange={(next) => onChange({ ...block, props: next } as EmailBlock)}
  />
)}
```

`TwoColEditor` is a new local component in `BlockInspector.tsx` with split picker + left/right cell type + content fields for each side.

**`default-docs.ts`** — add to `DEFAULT_BLOCK_PROPS`:
```typescript
"two-col": {
  left: { type: "image", imageUrl: "", imageAlt: "", imageCaption: "" },
  right: { type: "text", body: "" },
  split: "50-50",
},
```

Add to `BLOCK_MENU` in `AddBlockPanel.tsx`:
```typescript
{ type: "two-col", label: "Two Column", icon: "⊞" },
```

---

## Task 7: Photo upload

**New file:** `app/api/email-lab/media/route.ts`

```typescript
// PUT /api/email-lab/media — upload image to email-media bucket; return public URL.
// Max 5MB. Images only. Path: user_id/uuid.ext
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
const BUCKET = "email-media";
const MAX_BYTES = 5 * 1024 * 1024;

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
  const { error } = await supabase.storage.from(BUCKET).upload(path, await file.arrayBuffer(), {
    contentType: file.type,
    upsert: false,
  });
  if (error) return NextResponse.json({ error: "upload failed" }, { status: 500 });

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
```

**Migration:** `supabase/migrations/YYYYMMDD_email_media_bucket.sql` — public bucket, users write their own prefix:
```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('email-media', 'email-media', true) ON CONFLICT (id) DO NOTHING;
CREATE POLICY "users upload own prefix" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'email-media' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "public read email media" ON storage.objects FOR SELECT TO public USING (bucket_id = 'email-media');
```

**`BlockInspector.tsx`** image section — add `PhotoUploadField` (replaces the plain URL TextField for image.url):

```tsx
function PhotoUploadField({ value, onChange }: { value: string; onChange: (u: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/email-lab/media", { method: "PUT", body: fd });
      if (!res.ok) return;
      const { url } = await res.json() as { url: string };
      onChange(url);
    } finally { setUploading(false); }
  }
  return (
    <FieldShell label="Photo">
      {value && <img src={value} alt="" className="mb-2 w-full rounded object-cover" style={{ maxHeight: 100 }} />}
      <div className="flex gap-2">
        <input type="text" className={inputCls} value={value} placeholder="https://… or upload →" onChange={(e) => onChange(e.target.value)} />
        <button type="button" disabled={uploading} onClick={() => ref.current?.click()} className="shrink-0 rounded border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">{uploading ? "…" : "↑"}</button>
      </div>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
    </FieldShell>
  );
}
```

Also add the same `PhotoUploadField` for `agent-card.photoUrl` and `agent-hero.photoUrl` in their inspector sections (replace the raw URL TextField).

---

## Task 8: Merge tags

Merge tags are substitution tokens — `{{first_name}}`, `{{email}}` — replaced per-recipient at send time. No schema changes needed since they're just text in the `body`, `prose`, etc. fields.

**`app/api/deliverables/[id]/blast/route.ts`** — add substitution helper after `withFooter`:

```typescript
const MERGE_FIELDS: Record<string, (c: { name: string | null; email: string }) => string> = {
  "{{first_name}}": (c) => c.name?.split(" ")[0] ?? "Friend",
  "{{full_name}}":  (c) => c.name ?? "Friend",
  "{{email}}":      (c) => c.email,
};

function withMergeTags(html: string, contact: { name: string | null; email: string }): string {
  let out = html;
  for (const [tag, fn] of Object.entries(MERGE_FIELDS)) {
    out = out.split(tag).join(fn(contact));
  }
  return out;
}
```

In `messageFor()`, add merge tag substitution after withFooter:
```typescript
const messageFor = (c: { id: string; email: string; name: string | null }) => {
  const unsubUrl = `${BASE_URL}/api/unsubscribe?id=${c.id}`;
  let html = withFooter(baseHtml, webUrl, unsubUrl);
  html = withMergeTags(html, c);
  // ... tracking injection (Task 9) follows here
};
```

Update the `contacts` select to include `name`:
```typescript
const { data: contacts } = await supabase
  .from("contacts")
  .select("id, email, name")   // was: "id, email, name" — already there, confirm
  .in("id", contactIds)
  ...
```

**`BlockInspector.tsx`** — add a merge tag hint row in the text and hero sections:
```tsx
<p className="mt-1 text-[10px] text-gray-400">
  Available: <code>{"{{first_name}}"}</code> · <code>{"{{full_name}}"}</code> · <code>{"{{email}}"}</code>
</p>
```
Place this directly under the `TextAreaField` for `text.body` and `hero.prose`.

---

## Task 9: Open pixel + click tracking

**Migration:** `supabase/migrations/YYYYMMDD_email_events.sql`

```sql
CREATE TABLE email_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blast_id    uuid NOT NULL REFERENCES email_blasts(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  event_type  text NOT NULL CHECK (event_type IN ('open', 'click')),
  url         text,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX email_events_blast_idx   ON email_events(blast_id);
CREATE INDEX email_events_contact_idx ON email_events(contact_id);
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
-- Service role only for writes; reads via admin API key only.
```

Run `bun run gen:types` after migration.

**`app/api/t/o/[blast_id]/[contact_id]/route.ts`** — open pixel:

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/utils/supabase/service";

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(_req: NextRequest, { params }: { params: Promise<{ blast_id: string; contact_id: string }> }) {
  const { blast_id, contact_id } = await params;
  void createServiceRoleClient().from("email_events").insert({ blast_id, contact_id, event_type: "open" });
  return new NextResponse(PIXEL, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" },
  });
}
```

**`app/api/t/c/[blast_id]/[contact_id]/route.ts`** — click redirect:

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/utils/supabase/service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ blast_id: string; contact_id: string }> }) {
  const { blast_id, contact_id } = await params;
  const dest = req.nextUrl.searchParams.get("url") ?? "/";
  void createServiceRoleClient().from("email_events").insert({ blast_id, contact_id, event_type: "click", url: dest });
  return NextResponse.redirect(dest, { status: 302 });
}
```

**`app/api/deliverables/[id]/blast/route.ts`** — add tracking helpers and wire into messageFor:

```typescript
function withTrackingPixel(html: string, base: string, blastId: string, contactId: string): string {
  const src = `${base}/api/t/o/${blastId}/${contactId}`;
  const pixel = `<img src="${escAttr(src)}" width="1" height="1" alt="" style="display:none;border:0" />`;
  return html.includes("</body>") ? html.replace("</body>", `${pixel}</body>`) : html + pixel;
}

function withClickTracking(html: string, base: string, blastId: string, contactId: string): string {
  const track = `${base}/api/t/c/${blastId}/${contactId}`;
  return html.replace(/href="([^"]+)"/g, (match, href: string) => {
    if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#") ||
        href.includes("/api/unsubscribe") || href.includes("/api/t/")) return match;
    return `href="${escAttr(`${track}?url=${encodeURIComponent(href)}`)}"`;
  });
}
```

`messageFor` moves to AFTER the blast INSERT (it needs `blast?.id`). Updated:
```typescript
// After the blast insert:
const messageFor = (c: { id: string; email: string; name: string | null }) => {
  const unsubUrl = `${BASE_URL}/api/unsubscribe?id=${c.id}`;
  let html = withFooter(baseHtml, webUrl, unsubUrl);
  html = withMergeTags(html, c);
  if (blast?.id) {
    html = withClickTracking(html, BASE_URL, blast.id, c.id);
    html = withTrackingPixel(html, BASE_URL, blast.id, c.id);
  }
  return { from, to: [c.email], subject, html, ...(replyTo ? { replyTo } : {}), headers: { ... } };
};
```

**Stats endpoint:** `app/api/deliverables/[id]/blast/stats/route.ts` — read open/click counts for display in the project UI (no UI spec here; the route ships first):

```typescript
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Verify ownership via RLS, then:
  const { data } = await supabase
    .from("email_events")
    .select("event_type, url, contact_id, email_blasts!inner(deliverable_id)")
    .eq("email_blasts.deliverable_id", id);

  const opens   = new Set((data ?? []).filter(e => e.event_type === "open").map(e => e.contact_id));
  const clicks  = new Set((data ?? []).filter(e => e.event_type === "click").map(e => e.contact_id));
  const topLinks = Object.entries(
    (data ?? []).filter(e => e.event_type === "click" && e.url)
      .reduce<Record<string, number>>((a, e) => ({ ...a, [e.url!]: (a[e.url!] ?? 0) + 1 }), {})
  ).sort(([,a],[,b]) => b - a).slice(0, 5).map(([url, count]) => ({ url, count }));

  return NextResponse.json({ unique_opens: opens.size, unique_clicks: clicks.size, top_links: topLinks });
}
```

---

## Execution order

Tasks 1-3 are pure type/schema/renderer — no API, no DB. Do them first; they unblock everything downstream.
Task 4 (inspector controls) depends on Task 1.
Task 5 (aesthetic) is independent; can land any time.
Task 6 (two-col) depends on Tasks 1-3 for schema patterns.
Task 7 (photo upload) depends on the Supabase migration only.
Task 8 (merge tags) is self-contained in blast/route + inspector hint.
Task 9 (tracking) depends on the DB migration and blast route; stats endpoint is independent.

Tasks 1-5 can ship in one PR. Tasks 6, 7, 8, 9 can each be their own PR.

---

## What is NOT in this spec

- Actual two-col inspector subcomponent code (TwoColEditor) — structure is described; implementation follows the SocialIconsEditor pattern in BlockInspector.tsx
- Per-block AI and inline WYSIWYG — other session
- Social calendar — separate spec at `2026-06-28-social-calendar-lab-design.md`
- Tracking stats UI component — route ships first; UI is a follow-on
- Row-level nesting / full BeeFree column model — two-col block covers the 80% use case (image+text split) without an architecture rewrite
- Mobile show/hide, countdown timers, video embeds — out of scope
