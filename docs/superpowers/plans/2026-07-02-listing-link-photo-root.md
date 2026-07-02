# Listing Link + Photo Root (Wave 1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** 🧠 Opus — 9 tasks, 21 files, keywords: migration, schema, architecture

**Goal:** One root for listing artifact links (`resolveArtifactLink`) and one root for listing artifact photos (sharp watermark-crop derivative), plus the per-project `property_url` field that feeds the link chain.

**Architecture:** A nullable `property_url` column on `public.projects` (edited via a third workspace pill, saved through the existing PATCH route). A pure resolver in `lib/listings/artifact-link.ts` implements the chain property URL → feed `listing_url` verbatim → null/unlinked. A derivative service in `lib/media/listing-photo.ts` fetches the payload-carried `photo_url`, trims the bottom watermark band with sharp, and upserts a JPEG to the existing public `email-media` bucket; `loadListingContext` enriches its top-ranked listings with the derived URL so email hero photos and the social calendar both consume the same cropped file.

**Tech Stack:** Next.js App Router (nodejs runtime), Supabase (typed client + storage), sharp (NEW dependency), bun:test, Bun.SQL migrations.

**Spec:** `docs/superpowers/specs/2026-07-02-listing-link-photo-root-design.md` · Check: `listing_link_photo_root_live_verify` (operator-run, stays open after this plan).

## Global Constraints

- Never push without operator confirmation. Commit per task; `node scripts/safe-push.mjs` only when the operator says push.
- Stage explicit paths only — never `git add -A`.
- Lockfile gate: the commit that touches `package.json` must run `bun install` and `git add bun.lock` in the same commit (pre-push hook enforces).
- `lib/media/listing-photo.ts` (which imports sharp) must NEVER be statically imported by client-reachable modules. `lib/listings/select.ts` takes the derive function via an options param and imports only the TYPE. (Track A lesson: `corridor-display.mts` once leaked `node:fs` into the `/project` client bundle and broke `next build`.)
- The derivative NEVER edits the source CDN URL (no size-param tricks — handoff §2.3). Fetch the `photo_url` verbatim, transform bytes locally.
- Derivative failure returns `null`; callers keep the ORIGINAL `photo_url` (degraded = watermark visible, never a broken artifact).
- Verify with `bunx next build`, never bare `npx tsc` (local tsc ≠ Vercel).
- Migrations: idempotent SQL, run via `bun scripts/run-migration.ts`, verify the column exists after, regenerate types with `bun run gen:types`.
- Final message of every task's commit: standard repo style (`feat:`/`test:`/`docs:` prefix).

---

### Task 1: `projects.property_url` migration + regenerated types

**Files:**
- Create: `docs/sql/20260702_projects_property_url.sql`
- Regenerate: `database-generated.types.ts` (via `bun run gen:types` — do NOT hand-edit)
- No edit needed: `database.types.ts` (it's a `MergeDeep` override for `items`/`doc`/`frozen_post` only; new scalar columns flow through from the generated file)

**Interfaces:**
- Produces: `projects.property_url: string | null` on Row/Insert/Update of `Database["public"]["Tables"]["projects"]` — Tasks 7 and 8 rely on this exact name.

- [ ] **Step 1: Write the migration SQL**

```sql
-- docs/sql/20260702_projects_property_url.sql
-- Wave 1.5 (listing-link-photo-root): the user's own listing-page URL for a project.
-- Link chain: property_url → feed listing_url verbatim → unlinked. Never minted.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS property_url text;
```

- [ ] **Step 2: Run the migration against prod**

Run: `bun scripts/run-migration.ts docs/sql/20260702_projects_property_url.sql`
Expected: `Running docs/sql/20260702_projects_property_url.sql...` then `✓ done` then `Migrations complete.`

- [ ] **Step 3: Verify the column landed**

Run:
```bash
bun -e "const s=require('fs').readFileSync('.dlt/secrets.toml','utf8');const t=k=>s.match(new RegExp('^'+k+'\\\\s*=\\\\s*\"([^\"]+)\"','m'))[1];const port=(s.match(/^port\\s*=\\s*(\\d+)/m)||[])[1]||'5432';const sql=new Bun.SQL('postgres://'+t('username')+':'+encodeURIComponent(t('password'))+'@'+t('host')+':'+port+'/'+t('database')+'?sslmode=require');const r=await sql.unsafe(\"SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='property_url'\");console.log(r);await sql.end()"
```
Expected: one row `{ column_name: "property_url", is_nullable: "YES" }`. Zero rows = migration didn't land — stop and investigate.

- [ ] **Step 4: Regenerate the typed client**

Run: `bun run gen:types`
Then: `git diff database-generated.types.ts` — expect `property_url: string | null;` added to the `projects` Row (and `property_url?: string | null;` in Insert/Update). If the diff contains OTHER new columns from parallel sessions, keep them (the generator reads live prod — the file must match reality).

- [ ] **Step 5: Typecheck via the real gate**

Run: `bunx next build`
Expected: build succeeds (the column is additive; nothing consumes it yet).

- [ ] **Step 6: Commit**

```bash
git add docs/sql/20260702_projects_property_url.sql database-generated.types.ts
git commit -m "feat(projects): property_url column + regenerated types (wave 1.5)"
```

---

### Task 2: `Listing.listingUrl` type field

**Files:**
- Modify: `lib/listings/rentcast.ts:38-40` (the `Listing` interface, after `photoUrl`)

**Interfaces:**
- Produces: `Listing.listingUrl?: string` — Task 3's resolver reads it. TYPE-ONLY this wave: `data_lake.listing_state` has no `listing_url` column, so `lakeRowToListing` cannot populate it; the broker feed carries it and the wave-5 address join key will wire it. Do NOT touch `lakeRowToListing` or `normalizeListing`.

- [ ] **Step 1: Add the field**

In `lib/listings/rentcast.ts`, directly after the `photoUrl?: string;` line inside `interface Listing`:

```ts
  /** Feed-carried listing page URL, VERBATIM (broker-site feed). Never constructed
   *  from an id (handoff §2.3 — minted URLs 404). Unset until the wave-5 feed
   *  join populates it; the artifact-link resolver treats absence as "no link". */
  listingUrl?: string;
```

- [ ] **Step 2: Verify nothing breaks**

Run: `bun test lib/listings/`
Expected: all existing tests PASS (additive optional field).

- [ ] **Step 3: Commit**

```bash
git add lib/listings/rentcast.ts
git commit -m "feat(listings): optional feed-carried listingUrl on the Listing shape"
```

---

### Task 3: `resolveArtifactLink` — the one link root

**Files:**
- Create: `lib/listings/artifact-link.ts`
- Test: `lib/listings/artifact-link.test.ts`

**Interfaces:**
- Consumes: `Listing` type from `lib/listings/rentcast.ts` (Task 2's `listingUrl`).
- Produces: `resolveArtifactLink(args: { propertyUrl?: string | null; listing?: Pick<Listing, "listingUrl"> | null }): string | null` and `isValidPropertyUrl(u: unknown): u is string`. Task 6 wires the resolver into the featured-photo path; Task 7's PATCH route uses `isValidPropertyUrl`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/listings/artifact-link.test.ts
import { describe, it, expect } from "bun:test";
import { resolveArtifactLink, isValidPropertyUrl } from "./artifact-link";

describe("isValidPropertyUrl", () => {
  it("accepts http(s) URLs", () => {
    expect(isValidPropertyUrl("https://myagentsite.com/homes/465-gordonia")).toBe(true);
    expect(isValidPropertyUrl("http://example.com/x")).toBe(true);
  });
  it("rejects non-strings, non-http schemes, and junk", () => {
    expect(isValidPropertyUrl(null)).toBe(false);
    expect(isValidPropertyUrl(42)).toBe(false);
    expect(isValidPropertyUrl("javascript:alert(1)")).toBe(false);
    expect(isValidPropertyUrl("ftp://example.com")).toBe(false);
    expect(isValidPropertyUrl("not a url")).toBe(false);
    expect(isValidPropertyUrl("")).toBe(false);
  });
});

describe("resolveArtifactLink — property_url → feed listing_url → null", () => {
  it("the project's property URL wins when present", () => {
    expect(
      resolveArtifactLink({
        propertyUrl: "https://myagentsite.com/homes/465-gordonia",
        listing: { listingUrl: "https://broker.example.com/listing/1" },
      }),
    ).toBe("https://myagentsite.com/homes/465-gordonia");
  });
  it("falls back to the feed-carried listing URL verbatim", () => {
    expect(
      resolveArtifactLink({
        propertyUrl: null,
        listing: { listingUrl: "https://broker.example.com/listing/1" },
      }),
    ).toBe("https://broker.example.com/listing/1");
  });
  it("returns null when neither exists — render unlinked, never construct", () => {
    expect(resolveArtifactLink({ propertyUrl: null, listing: {} })).toBeNull();
    expect(resolveArtifactLink({})).toBeNull();
  });
  it("an invalid property URL does not shadow the feed fallback", () => {
    expect(
      resolveArtifactLink({
        propertyUrl: "javascript:alert(1)",
        listing: { listingUrl: "https://broker.example.com/listing/1" },
      }),
    ).toBe("https://broker.example.com/listing/1");
  });
  it("trims whitespace on the property URL", () => {
    expect(resolveArtifactLink({ propertyUrl: "  https://a.com/x  " })).toBe("https://a.com/x");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/listings/artifact-link.test.ts`
Expected: FAIL — module `./artifact-link` not found.

- [ ] **Step 3: Implement**

```ts
// lib/listings/artifact-link.ts — THE one root for listing artifact links.
// Chain (spec 2026-07-02-listing-link-photo-root): the project's own property_url
// (user-input lane) → the feed-carried listing_url VERBATIM → null (render unlinked).
// Nothing anywhere else may build a listing href; a URL constructed from an id is
// an invented fact that 404s (handoff §2.3). The wave-1 URL-allowlist lint admits
// exactly: payload URLs, brand-record URLs, property_url, and email-media URLs.
import type { Listing } from "./rentcast";

const HTTP_RE = /^https?:\/\//i;

/** Shape-only validation (no reachability probe): a real http(s) URL. */
export function isValidPropertyUrl(u: unknown): u is string {
  if (typeof u !== "string") return false;
  const s = u.trim();
  if (!s || !HTTP_RE.test(s)) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

export function resolveArtifactLink(args: {
  propertyUrl?: string | null;
  listing?: Pick<Listing, "listingUrl"> | null;
}): string | null {
  if (isValidPropertyUrl(args.propertyUrl)) return (args.propertyUrl as string).trim();
  const feed = args.listing?.listingUrl;
  if (typeof feed === "string" && HTTP_RE.test(feed.trim())) return feed.trim();
  return null;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test lib/listings/artifact-link.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/listings/artifact-link.ts lib/listings/artifact-link.test.ts
git commit -m "feat(listings): resolveArtifactLink one-root link resolver (property_url -> feed -> unlinked)"
```

---

### Task 4: sharp dependency + `lib/media/listing-photo.ts` derivative service

**Files:**
- Modify: `package.json` + `bun.lock` (add sharp — lockfile gate: same commit)
- Modify: `lib/email/chart-image.ts:328-336` (generalize the upload helper)
- Create: `lib/media/listing-photo.ts`
- Test: `lib/media/listing-photo.test.ts`

**Interfaces:**
- Consumes: `hostEmailMedia` (created here inside chart-image.ts), `createServiceRoleClient` (already imported there).
- Produces:
  - `hostEmailMedia(key: string, buf: Buffer, contentType: string): Promise<string>` exported from `lib/email/chart-image.ts` (existing `hostEmailPng` delegates to it — signature unchanged).
  - From `lib/media/listing-photo.ts`: `WATERMARK_CROP = { bottomFraction: 0.08, version: 1 }`, `listingPhotoKey(listingId: string, version?: number): string`, `cropWatermarkBand(input: Buffer): Promise<Buffer>`, `deriveListingPhoto(args: { listingId: string; photoUrl: string }, deps?: DerivePhotoDeps): Promise<string | null>`, and `type DeriveListingPhoto = typeof deriveListingPhoto`. Task 5 consumes `deriveListingPhoto` + the type.

- [ ] **Step 1: Add sharp**

Run: `bun add sharp`
Expected: `package.json` gains `"sharp"` in dependencies; `bun.lock` updated. (Windows dev gets win32 binaries; Vercel's linux build installs linux binaries — verified against sharp's install docs 07/02/2026.)

- [ ] **Step 2: Generalize the email-media upload helper**

In `lib/email/chart-image.ts`, replace the existing `hostEmailPng` (lines 322–336) with:

```ts
/**
 * Upload a media buffer to the public `email-media` bucket and return its durable
 * URL. Idempotent on key (upsert). Throws on a real storage error (the caller
 * decides whether the asset is load-bearing). Shared by chart PNGs and the
 * listing-photo JPEG derivatives (lib/media/listing-photo.ts).
 */
export async function hostEmailMedia(
  key: string,
  buf: Buffer,
  contentType: string,
): Promise<string> {
  const admin = createServiceRoleClient();
  const { error } = await admin.storage
    .from(PUBLIC_BUCKET)
    .upload(key, buf, { contentType, upsert: true });
  if (error) throw new Error(`email-media upload failed: ${error.message}`);
  const { data } = admin.storage.from(PUBLIC_BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

/** Back-compat PNG path — every existing chart caller keeps this signature. */
export async function hostEmailPng(pngKey: string, png: Buffer): Promise<string> {
  return hostEmailMedia(pngKey, png, "image/png");
}
```

Run: `bun test lib/email/` — expected: existing chart-image consumers still PASS.

- [ ] **Step 3: Write the failing derivative tests**

```ts
// lib/media/listing-photo.test.ts
import { describe, it, expect } from "bun:test";
import sharp from "sharp";
import {
  WATERMARK_CROP,
  listingPhotoKey,
  cropWatermarkBand,
  deriveListingPhoto,
} from "./listing-photo";

/** A real in-memory 200x100 JPEG so the crop math is exercised end-to-end. */
async function fixtureJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .jpeg()
    .toBuffer();
}

describe("listingPhotoKey", () => {
  it("keys by sanitized listing id + crop version", () => {
    expect(listingPhotoKey("abc-123")).toBe(
      `listing-photos/abc-123-v${WATERMARK_CROP.version}.jpg`,
    );
  });
  it("sanitizes ids that would break a storage key", () => {
    expect(listingPhotoKey("a/b?c d")).toBe(
      `listing-photos/a_b_c_d-v${WATERMARK_CROP.version}.jpg`,
    );
  });
  it("a version bump changes the key (retune = new derivative, old ones inert)", () => {
    expect(listingPhotoKey("abc", 2)).toBe("listing-photos/abc-v2.jpg");
  });
});

describe("cropWatermarkBand", () => {
  it("trims the bottom band and outputs JPEG", async () => {
    const out = await cropWatermarkBand(await fixtureJpeg());
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(200);
    // 100 * (1 - 0.08) = 92
    expect(meta.height).toBe(Math.round(100 * (1 - WATERMARK_CROP.bottomFraction)));
  });
  it("throws on a non-image buffer (deriveListingPhoto turns this into null)", async () => {
    await expect(cropWatermarkBand(Buffer.from("not an image"))).rejects.toThrow();
  });
});

describe("deriveListingPhoto", () => {
  it("fetch → crop → upload → hosted URL, keyed by listing id", async () => {
    const jpeg = await fixtureJpeg();
    const uploaded: { key?: string; bytes?: number } = {};
    const url = await deriveListingPhoto(
      { listingId: "L1", photoUrl: "https://cdn.example.com/photo.jpg" },
      {
        fetchImage: async () => jpeg,
        upload: async (key, buf) => {
          uploaded.key = key;
          uploaded.bytes = buf.length;
          return `https://public.example.com/${key}`;
        },
      },
    );
    expect(url).toBe(`https://public.example.com/listing-photos/L1-v${WATERMARK_CROP.version}.jpg`);
    expect(uploaded.key).toBe(`listing-photos/L1-v${WATERMARK_CROP.version}.jpg`);
    expect(uploaded.bytes).toBeGreaterThan(0);
  });
  it("fetch failure → null (caller keeps the original photo, never breaks)", async () => {
    const url = await deriveListingPhoto(
      { listingId: "L1", photoUrl: "https://cdn.example.com/gone.jpg" },
      { fetchImage: async () => null, upload: async () => "unreachable" },
    );
    expect(url).toBeNull();
  });
  it("un-processable bytes → null, upload never called", async () => {
    let uploadCalled = false;
    const url = await deriveListingPhoto(
      { listingId: "L1", photoUrl: "https://cdn.example.com/x.jpg" },
      {
        fetchImage: async () => Buffer.from("junk"),
        upload: async () => {
          uploadCalled = true;
          return "x";
        },
      },
    );
    expect(url).toBeNull();
    expect(uploadCalled).toBe(false);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `bun test lib/media/listing-photo.test.ts`
Expected: FAIL — module `./listing-photo` not found.

- [ ] **Step 5: Implement the derivative service**

```ts
// lib/media/listing-photo.ts — THE one root for listing artifact photos.
// fetch the payload-carried photo_url VERBATIM (never edit CDN params — handoff
// §2.3/§5.4) → sharp trims the bottom watermark band → JPEG q80 → upsert to the
// public email-media bucket keyed by listing id + crop version. Email <img> and
// social card <image href> both reference the SAME derived file, so the crop is
// identical on both surfaces by construction. Failure → null; the caller keeps
// the ORIGINAL photo (degraded = watermark visible, never a broken artifact).
//
// SERVER-ONLY (sharp is a native dep): never import this from client-reachable
// code. lib/listings/select.ts takes deriveListingPhoto via a param and imports
// only the type.
import sharp from "sharp";
import { hostEmailMedia } from "@/lib/email/chart-image";

/** Crop tuning. bottomFraction was tuned against the Latitude 26 fixture photos
 *  (bottom-corner feed watermark). Retuning bumps `version` — a NEW storage key —
 *  so rebuilds upsert fresh derivatives and stale ones are inert. Operator policy
 *  (07/02/2026, recorded in the spec): crop applies to ALL listing photos. */
export const WATERMARK_CROP = { bottomFraction: 0.08, version: 1 } as const;

export function listingPhotoKey(
  listingId: string,
  version: number = WATERMARK_CROP.version,
): string {
  const safe = listingId.replace(/[^a-zA-Z0-9_-]+/g, "_");
  return `listing-photos/${safe}-v${version}.jpg`;
}

/** Pure transform: bytes in → cropped JPEG bytes out. Throws on unreadable input. */
export async function cropWatermarkBand(input: Buffer): Promise<Buffer> {
  const img = sharp(input);
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error("unreadable image");
  const height = Math.max(1, Math.round(meta.height * (1 - WATERMARK_CROP.bottomFraction)));
  return img
    .extract({ left: 0, top: 0, width: meta.width, height })
    .jpeg({ quality: 80 })
    .toBuffer();
}

export interface DerivePhotoDeps {
  /** Returns raw image bytes, or null on any miss (non-200, non-image, network). */
  fetchImage?: (url: string) => Promise<Buffer | null>;
  /** Uploads and returns the durable public URL. */
  upload?: (key: string, buf: Buffer) => Promise<string>;
}

async function defaultFetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function deriveListingPhoto(
  args: { listingId: string; photoUrl: string },
  deps: DerivePhotoDeps = {},
): Promise<string | null> {
  const fetchImage = deps.fetchImage ?? defaultFetchImage;
  const upload = deps.upload ?? ((k: string, b: Buffer) => hostEmailMedia(k, b, "image/jpeg"));
  const raw = await fetchImage(args.photoUrl);
  if (!raw) return null;
  try {
    const jpeg = await cropWatermarkBand(raw);
    return await upload(listingPhotoKey(args.listingId), jpeg);
  } catch {
    return null;
  }
}

export type DeriveListingPhoto = typeof deriveListingPhoto;
```

- [ ] **Step 6: Run tests to verify pass**

Run: `bun test lib/media/listing-photo.test.ts && bun test lib/email/`
Expected: all PASS.

- [ ] **Step 7: Tune the crop against a real fixture photo**

The Latitude 26 fixture HTML (`C:\Users\ethan\Downloads\latitude26-campaign\`) embeds real listing-photo CDN URLs. Extract one (grep the HTML files for `img src`), then:

```bash
bun -e "const {deriveListingPhoto}=await import('./lib/media/listing-photo.ts');const {cropWatermarkBand}=await import('./lib/media/listing-photo.ts');const res=await fetch('<REAL_PHOTO_URL_FROM_FIXTURE>');const buf=Buffer.from(await res.arrayBuffer());require('fs').writeFileSync('scratch-before.jpg',buf);require('fs').writeFileSync('scratch-after.jpg',await cropWatermarkBand(buf))"
```

Read `scratch-before.jpg` and `scratch-after.jpg` (the Read tool renders images): confirm the bottom-corner watermark is gone in the after image. If it isn't, raise `bottomFraction` in steps of 0.02 (0.08 → 0.10 → 0.12), re-run, and keep the smallest value that removes it. Update the test's height expectation if the constant changes. Delete both scratch files afterward (`rm scratch-before.jpg scratch-after.jpg` — never commit them).

- [ ] **Step 8: Commit (lockfile gate — all in ONE commit)**

```bash
git add package.json bun.lock lib/media/listing-photo.ts lib/media/listing-photo.test.ts lib/email/chart-image.ts
git commit -m "feat(media): sharp watermark-crop listing-photo derivative to email-media (one root)"
```

---

### Task 5: enrich `loadListingContext` with derived photos

**Files:**
- 🔴 Modify: `lib/listings/select.ts` (add `enrichListingPhotos`, extend `loadListingContext`)
- Modify: `lib/email/build-doc.ts:409` (pass the derive function)
- 🔴 Modify: `lib/email/social-calendar/build-week.ts:280` (pass the derive function)
- Test: `lib/listings/select.test.ts` (extend)

**Interfaces:**
- Consumes: `deriveListingPhoto` + `type DeriveListingPhoto` from Task 4.
- Produces: `enrichListingPhotos(listings: Listing[], derive: DeriveListingPhoto): Promise<Listing[]>` (exported for tests) and `loadListingContext(scope, today, opts?: { derivePhoto?: DeriveListingPhoto })`. Existing 2-arg callers keep working with NO enrichment (test hermeticity + no accidental sharp in client graphs); the two prod callers opt in explicitly.

- [ ] **Step 1: Write the failing tests**

Append to `lib/listings/select.test.ts` (it already mocks the supabase module at the top — reuse its existing fixture rows; the new tests only exercise the pure/DI surface):

```ts
// ── wave 1.5: photo enrichment (derived watermark-crop, one root) ────────────
// DYNAMIC import, matching this file's existing pattern (select.test.ts:51):
// a static `import { enrichListingPhotos }` would hoist ABOVE the mock.module
// calls at the top of the file and break the supabase mocking.
const { enrichListingPhotos } = await import("./select");

test("enrichListingPhotos swaps photoUrl for the derived URL on top-ranked listings", async () => {
  const listings = [
    { id: "L1", photoUrl: "https://cdn.example.com/1.jpg" },
    { id: "L2", photoUrl: "https://cdn.example.com/2.jpg" },
  ] as Parameters<typeof enrichListingPhotos>[0];
  const out = await enrichListingPhotos(listings, async ({ listingId }) => {
    return `https://media.example.com/listing-photos/${listingId}-v1.jpg`;
  });
  expect(out[0].photoUrl).toBe("https://media.example.com/listing-photos/L1-v1.jpg");
  expect(out[1].photoUrl).toBe("https://media.example.com/listing-photos/L2-v1.jpg");
});

test("derive failure (null) keeps the ORIGINAL photo — degraded, never broken", async () => {
  const listings = [
    { id: "L1", photoUrl: "https://cdn.example.com/1.jpg" },
  ] as Parameters<typeof enrichListingPhotos>[0];
  const out = await enrichListingPhotos(listings, async () => null);
  expect(out[0].photoUrl).toBe("https://cdn.example.com/1.jpg");
});

test("listings without a photo are untouched, and enrichment caps at the top 5", async () => {
  const listings = Array.from({ length: 8 }, (_, i) => ({
    id: `L${i}`,
    photoUrl: i === 3 ? undefined : `https://cdn.example.com/${i}.jpg`,
  })) as Parameters<typeof enrichListingPhotos>[0];
  const derivedFor: string[] = [];
  await enrichListingPhotos(listings, async ({ listingId }) => {
    derivedFor.push(listingId);
    return `https://media.example.com/${listingId}.jpg`;
  });
  // top 5 slots, minus the photo-less one = 4 derive calls, none past index 4
  expect(derivedFor).toEqual(["L0", "L1", "L2", "L4"]);
});
```

(The `as Parameters<...>` casts keep the fixtures minimal; `enrichListingPhotos` only reads `id` + `photoUrl`.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/listings/select.test.ts`
Expected: FAIL — `enrichListingPhotos` is not exported.

- [ ] **Step 3: Implement in `lib/listings/select.ts`**

Add near the top (type-only import — sharp must not enter this module's static graph):

```ts
import type { DeriveListingPhoto } from "@/lib/media/listing-photo";
```

Add above `loadListingContext`:

```ts
/** Wave 1.5: swap top-ranked listings' photoUrl for the watermark-cropped derivative
 *  (lib/media/listing-photo — the one photo root). Capped so a request derives at
 *  most PHOTO_ENRICH_LIMIT photos (fetch+sharp+upload each; upsert = rebuilds reuse).
 *  A null derive keeps the ORIGINAL photo: degraded (watermark visible), never broken. */
const PHOTO_ENRICH_LIMIT = 5;

export async function enrichListingPhotos(
  listings: Listing[],
  derive: DeriveListingPhoto,
): Promise<Listing[]> {
  const out = [...listings];
  await Promise.all(
    out.slice(0, PHOTO_ENRICH_LIMIT).map(async (l, i) => {
      if (!l.photoUrl) return;
      const derived = await derive({ listingId: l.id, photoUrl: l.photoUrl });
      if (derived) out[i] = { ...l, photoUrl: derived };
    }),
  );
  return out;
}
```

Replace `loadListingContext` with:

```ts
export async function loadListingContext(
  scope: BuildScope | undefined,
  today: Date,
  opts?: { derivePhoto?: DeriveListingPhoto },
): Promise<ListingContext> {
  const city = scopeCity(scope);
  const listings = await fetchLakeListings(city);
  let ranked = rankListings(listings);
  if (opts?.derivePhoto) ranked = await enrichListingPhotos(ranked, opts.derivePhoto);
  return {
    figures: listingsToFigures(listings, today, city),
    ranked,
    city,
  };
}
```

- [ ] **Step 4: Opt in the two prod callers**

In `lib/email/build-doc.ts` — add to the imports: `import { deriveListingPhoto } from "@/lib/media/listing-photo";` and change line 409 from `loadListingContext(scope, new Date()),` to:

```ts
    loadListingContext(scope, new Date(), { derivePhoto: deriveListingPhoto }),
```

In `lib/email/social-calendar/build-week.ts` — add the same import and change the `loadListingContext(scope, today),` call (line 280) to:

```ts
    loadListingContext(scope, today, { derivePhoto: deriveListingPhoto }),
```

- [ ] **Step 5: Run the full neighboring suites**

Run: `bun test lib/listings/ lib/email/`
Expected: all PASS — existing 2-arg `loadListingContext` tests unchanged (no enrichment without opt-in).

- [ ] **Step 6: Commit**

```bash
git add lib/listings/select.ts lib/listings/select.test.ts lib/email/build-doc.ts lib/email/social-calendar/build-week.ts
git commit -m "feat(listings): loadListingContext enriches top-ranked photos with the cropped derivative"
```

---

### Task 6: featured-photo link via the resolver

**Files:**
- 🔴 Modify: `lib/listings/select.ts:169-192` (`attachFeaturedAerial` gains optional `linkUrl`)
- 🔴 Modify: `lib/email/social-calendar/build-week.ts:254` (pass the resolved link)
- Test: `lib/listings/listings.test.ts` (extend the existing `attachFeaturedAerial` describe block)

**Interfaces:**
- Consumes: `resolveArtifactLink` from Task 3.
- Produces: `attachFeaturedAerial(card: EmailDoc, listing: Listing, linkUrl?: string | null): EmailDoc` — third param additive; existing 2-arg callers unchanged. `heroPhotoBlock` already accepts `linkUrl` (see `lib/email/author-doc.ts:483`).

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("attachFeaturedAerial", ...)` in `lib/listings/listings.test.ts`:

```ts
  it("threads a resolved artifact link into the hero photo block", () => {
    const out = attachFeaturedAerial(baseDoc(), LISTINGS[0], "https://broker.example.com/listing/1");
    const hero = out.blocks.find((b) => b.kind === "photo");
    expect(hero?.props.linkUrl).toBe("https://broker.example.com/listing/1");
  });
  it("no link resolved → hero photo renders unlinked (no linkUrl prop)", () => {
    const out = attachFeaturedAerial(baseDoc(), LISTINGS[0], null);
    const hero = out.blocks.find((b) => b.kind === "photo");
    expect(hero?.props.linkUrl).toBeUndefined();
  });
```

(If the doc's photo block lookup differs — check how the existing tests at `lib/listings/listings.test.ts:172-202` find the hero block and mirror that exact accessor.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/listings/listings.test.ts`
Expected: FAIL — third argument ignored / linkUrl undefined in the first new test.

- [ ] **Step 3: Implement**

In `lib/listings/select.ts`, change `attachFeaturedAerial`'s signature and both `heroPhotoBlock` calls:

```ts
export function attachFeaturedAerial(
  card: EmailDoc,
  listing: Listing,
  linkUrl?: string | null,
): EmailDoc {
  const where = [listing.addressLine1, listing.city].filter(Boolean).join(", ") || "this property";
  if (listing.photoUrl) {
    return upsertHeroPhoto(
      card,
      heroPhotoBlock({
        url: listing.photoUrl,
        alt: `Listing photo of ${where}`,
        caption: `${where}`,
        ...(linkUrl ? { linkUrl } : {}),
      }),
    );
  }
  if (listing.latitude == null || listing.longitude == null) return card;
  const url = aerialUrl({ lat: listing.latitude, lon: listing.longitude });
  if (!url) return card;
  return upsertHeroPhoto(
    card,
    heroPhotoBlock({
      url,
      alt: `Aerial satellite view of ${where}`,
      caption: `Aerial view · ${where}`,
      ...(linkUrl ? { linkUrl } : {}),
    }),
  );
}
```

(If `heroPhotoBlock`'s option type rejects `linkUrl`, check its definition — `author-doc.ts:483` calls it with `linkUrl`, so the option exists; match its exact key.)

In `lib/email/social-calendar/build-week.ts` — add `import { resolveArtifactLink } from "@/lib/listings/artifact-link";` and change line 254 to:

```ts
    if (draft && opts?.featured)
      draft.card = attachFeaturedAerial(
        draft.card,
        opts.featured,
        resolveArtifactLink({ listing: opts.featured }),
      );
```

(No `propertyUrl` here yet: the generate-week path has no project row in hand. The project-aware plumb rides the cockpit lifecycle work — wave 6; the resolver chain already returns the feed URL when wave 5's join populates `listingUrl`, and null/unlinked until then.)

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test lib/listings/ lib/email/social-calendar/`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/listings/select.ts lib/listings/listings.test.ts lib/email/social-calendar/build-week.ts
git commit -m "feat(listings): featured hero photo links through resolveArtifactLink"
```

---

### Task 7: PATCH route accepts `property_url`

**Files:**
- Modify: `app/api/projects/[id]/route.ts:57-80` (new update branch)
- Test: Create `app/api/projects/[id]/route.test.ts`

**Interfaces:**
- Consumes: `isValidPropertyUrl` from Task 3; `projects.property_url` from Task 1.
- Produces: `PATCH /api/projects/[id]` body key `property_url: string | null` — `""`/`null` clears, valid http(s) saves trimmed, anything else → 422. Task 8's UI calls this.

- [ ] **Step 1: Write the failing route test**

```ts
// app/api/projects/[id]/route.test.ts
// Mirrors the mutable-scenario harness of app/api/projects/route.test.ts:
// mock the cookie client, capture the UPDATE payload, vary auth per test.
import { test, expect, mock, beforeEach } from "bun:test";

const scenario: {
  user: { id: string } | null;
  captured: Record<string, unknown> | null;
} = { user: { id: "user-a" }, captured: null };

mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scenario.user } }) },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { id: "p1", title: null, items: [] }, error: null }),
        update: (row: Record<string, unknown>) => {
          if (table === "projects") scenario.captured = row;
          return chain;
        },
        insert: async () => ({ error: null }),
      };
      return chain;
    },
  }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));
mock.module("@/lib/project/feed", () => ({ markFeedSeen: async () => {} }));
mock.module("@/lib/project/activity", () => ({ logActivity: async () => {} }));

const { PATCH } = await import("./route");

function makePatch(body: unknown) {
  const req = new Request("http://localhost/api/projects/p1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as import("next/server").NextRequest;
  return PATCH(req, { params: Promise.resolve({ id: "p1" }) });
}

beforeEach(() => {
  scenario.user = { id: "user-a" };
  scenario.captured = null;
});

test("valid property_url is saved trimmed", async () => {
  const res = await makePatch({ property_url: "  https://myagentsite.com/homes/465  " });
  expect(res.status).toBe(200);
  expect(scenario.captured?.property_url).toBe("https://myagentsite.com/homes/465");
});

test("empty string clears to null", async () => {
  const res = await makePatch({ property_url: "" });
  expect(res.status).toBe(200);
  expect(scenario.captured?.property_url).toBeNull();
});

test("explicit null clears to null", async () => {
  const res = await makePatch({ property_url: null });
  expect(res.status).toBe(200);
  expect(scenario.captured?.property_url).toBeNull();
});

test("non-http(s) URL → 422, nothing written", async () => {
  const res = await makePatch({ property_url: "javascript:alert(1)" });
  expect(res.status).toBe(422);
  expect(scenario.captured).toBeNull();
});

test("body without property_url leaves the column untouched", async () => {
  const res = await makePatch({ title: "renamed" });
  expect(res.status).toBe(200);
  expect(scenario.captured && "property_url" in scenario.captured).toBe(false);
});

test("unauthenticated PATCH → 401", async () => {
  scenario.user = null;
  const res = await makePatch({ property_url: "https://a.com" });
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test app/api/projects/[id]/route.test.ts`
Expected: the `property_url` tests FAIL (unknown key ignored → captured lacks it / no 422).

- [ ] **Step 3: Implement the branch**

In `app/api/projects/[id]/route.ts`, add to the imports:

```ts
import { isValidPropertyUrl } from "@/lib/listings/artifact-link";
```

and after the `ui_state` branch (line 80), add:

```ts
  // Wave 1.5: the user's own listing-page URL — head of the artifact link chain
  // (property_url → feed listing_url → unlinked; lib/listings/artifact-link.ts).
  // Stored VERBATIM (trimmed); shape-validated only, no reachability probe.
  if ("property_url" in body) {
    if (body.property_url === null || body.property_url === "") {
      update.property_url = null;
    } else if (isValidPropertyUrl(body.property_url)) {
      update.property_url = (body.property_url as string).trim();
    } else {
      return NextResponse.json({ error: "invalid property_url" }, { status: 422 });
    }
  }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test app/api/projects/`
Expected: all PASS (old POST suite + new PATCH suite).

- [ ] **Step 5: Commit**

```bash
git add "app/api/projects/[id]/route.ts" "app/api/projects/[id]/route.test.ts"
git commit -m "feat(projects): PATCH accepts property_url (validated, trimmed, clearable)"
```

---

### Task 8: workspace "Listing link" pill UI

**Files:**
- Create: `app/project/[id]/workspace/PropertyUrlBlock.tsx`
- Modify: `app/project/[id]/ProjectWorkspace.tsx` (new prop, pill union, popover wiring)
- Modify: `app/project/[id]/page.tsx` (pass `propertyUrl` from the project row)

**Interfaces:**
- Consumes: Task 7's PATCH contract; Task 1's typed column.
- Produces: `<PropertyUrlBlock projectId initialUrl onSaved onClose />` and `ProjectWorkspace` prop `propertyUrl: string | null`.

- [ ] **Step 1: Build the block component**

```tsx
// app/project/[id]/workspace/PropertyUrlBlock.tsx
// The "Listing link" pill popover: one URL per project (same singular-anchor
// precedent as subject_address). Head of the artifact link chain — artifacts
// link here first, then the feed URL, else render unlinked. Saved via the
// project PATCH (owner-scoped by RLS); server re-validates shape.
"use client";
import { useState } from "react";

export function PropertyUrlBlock({
  projectId,
  initialUrl,
  onSaved,
  onClose,
}: {
  projectId: string;
  initialUrl: string | null;
  onSaved: (url: string | null) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const trimmed = value.trim();
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_url: trimmed || null }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Enter the full link, starting with https://");
      return;
    }
    onSaved(trimmed || null);
    onClose();
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-white">Property URL</p>
        <p className="mt-1 text-xs text-gray-400">
          Where readers land when they click this listing in your emails and posts —
          your own website&apos;s listing page. Leave blank to use the listing feed&apos;s
          page when available.
        </p>
      </div>
      <input
        type="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="https://youragentsite.com/homes/123-main-st"
        className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-gulf-teal focus:outline-none"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-1 text-xs font-semibold text-gray-300 hover:text-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-full bg-gulf-teal px-3 py-1 text-xs font-semibold text-[#04121b] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `ProjectWorkspace.tsx`**

Four edits, all mirroring the existing brand/mcp pill pattern:

1. Props (`interface Props`, ~line 56): add `propertyUrl: string | null;` and destructure it in the component signature as `propertyUrl: initialPropertyUrl`.
2. State (with the other `useState` calls, ~line 110): add

```ts
  const [propertyUrl, setPropertyUrl] = useState<string | null>(initialPropertyUrl);
```

3. Pill union (~line 123): change `useState<"brand" | "mcp" | null>` to `useState<"brand" | "mcp" | "link" | null>`.
4. Pill button — insert after the Connect-AI button (after line 550), same classes:

```tsx
          <button
            type="button"
            onClick={() => setActivePill((p) => (p === "link" ? null : "link"))}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              activePill === "link"
                ? "bg-gulf-teal text-[#04121b]"
                : "border border-gulf-teal/40 bg-gulf-teal/10 text-gulf-teal hover:bg-gulf-teal/20"
            }`}
          >
            {propertyUrl ? "✓ Listing link" : "Listing link"}
          </button>
```

5. Popover — inside the floating panel (with the `activePill === "mcp"` branch, ~line 572):

```tsx
            {activePill === "link" && (
              <PropertyUrlBlock
                projectId={id}
                initialUrl={propertyUrl}
                onSaved={setPropertyUrl}
                onClose={() => setActivePill(null)}
              />
            )}
```

plus the import: `import { PropertyUrlBlock } from "./workspace/PropertyUrlBlock";`

- [ ] **Step 3: Pass the prop from the server page**

In `app/project/[id]/page.tsx`, find where `<ProjectWorkspace` receives its props (the project row comes from a `projects` select) and add:

```tsx
        propertyUrl={project.property_url ?? null}
```

(using whatever local name the page gives the fetched project row — match its existing prop lines, e.g. `mcpKey`. After Task 1's regen the field is typed; if the page's select names explicit columns instead of `*`, add `property_url` to the column list.)

- [ ] **Step 4: Verify with the real gate**

Run: `bunx next build`
Expected: build succeeds. Then `bun test app/project/ lib/project/` — expected: PASS (no existing test constructs ProjectWorkspace props partially; if one does and now fails on the missing `propertyUrl` prop, add `propertyUrl: null` to its fixture).

- [ ] **Step 5: Commit**

```bash
git add "app/project/[id]/workspace/PropertyUrlBlock.tsx" "app/project/[id]/ProjectWorkspace.tsx" "app/project/[id]/page.tsx"
git commit -m "feat(cockpit): Listing link pill — per-project property_url input"
```

---

### Task 9: full gates + docs + hold for push

**Files:**
- Modify: `SESSION_LOG.md` (new top entry)
- Modify: `_AUDIT_AND_ROADMAP/build-queue.md` (wave-1.5 line: specced → built-offline)

- [ ] **Step 1: Full offline gates**

Run: `bun test`
Expected: entire suite green. (Known flake: the proposal-nonce test — if it reds WITHOUT touching its area, loop it locally to confirm flake before suspecting this diff.)

Run: `bunx next build`
Expected: green — this is the Vercel-parity typecheck.

- [ ] **Step 2: Update the build queue line**

In `_AUDIT_AND_ROADMAP/build-queue.md`, on the deliverable-factory wave line, change the wave-1.5 clause from "REGISTERED + SPECCED" to "BUILT offline (migration live, roots + PATCH + pill shipped); live-verify (`listing_link_photo_root_live_verify`) stays operator-run".

- [ ] **Step 3: SESSION_LOG entry**

Append a new top-of-file entry: what shipped (the four seams: migration+types, artifact-link root, listing-photo root + sharp, enrichment + pill), test counts from Step 1, and that `listing_link_photo_root_live_verify` remains open for the operator (real inbox render with cropped photo + correct link).

- [ ] **Step 4: Commit docs**

```bash
git add SESSION_LOG.md _AUDIT_AND_ROADMAP/build-queue.md
git commit -m "docs: session log + build-queue for listing-link-photo-root offline build"
```

- [ ] **Step 5: STOP — show the operator**

Do NOT push. Print `git log --oneline origin/main..HEAD` and ask the operator to confirm the push (`node scripts/safe-push.mjs` after confirmation; check `git log origin/main..HEAD` first for foreign commits). The live-verify check closes only on the operator's real-inbox test, never from this session.

---

## Parallel Safety

> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.

| Group | Tasks | Shared Files |
|-------|-------|--------------|
| 🔴 | Task 5, Task 6 | `lib/listings/select.ts`, `lib/email/social-calendar/build-week.ts` |

Tasks with no color badge have no file conflicts — safe to parallelize freely.
