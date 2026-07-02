# Listing link resolver + watermark-crop photo derivative (one root each)

**Date:** 2026-07-02 · **Check:** `listing_link_photo_root_live_verify` · **Wave:** 1.5 of the
deliverable-factory master plan (`docs/superpowers/plans/2026-07-02-deliverable-factory-waves.md`).

Pulled out of the readiness handoff's research agenda item 3
(`_AUDIT_AND_ROADMAP/# Deliverable-factory readiness — the ha.md` §7.3), which was three product
requirements written as a research note: per-project property URL, watermark handling on listing
photos, and an embed-link policy.

## Problem

1. Artifact links have no policy. The handoff's guardrails forbid constructing URLs
   (a realtor-shaped property_id minted into a URL 404s — handoff §2.3), but there is no single
   place a listing artifact gets its link from, and no way for a user to say "send readers to MY
   listing page."
2. Listing photos carry a feed watermark in the bottom corner. Campaign emails and social cards
   built from them ship the watermark to the customer's audience.
3. Both problems currently get solved ad hoc per artifact, which is exactly the invention surface
   the guard waves are closing.

## Goal

One root for artifact links, one root for artifact photos. Nothing outside these two modules ever
constructs a URL or transforms a photo. Both are prerequisites for the email block vocabulary
(wave 3) and social photo templates (wave 4).

## Decisions (operator, 07/02/2026)

- **Link fallback chain:** project `property_url` → feed-carried `listing_url` verbatim → unlinked.
  No minted URLs, no prompting gate, no constructed Realtor.com fallback.
- **Crop policy: all listing photos, always.** Operator explicitly chose this over subject-only
  after the attribution exposure was flagged: cropping the watermark off photos of OTHER
  brokerages' listings (e.g. comps) removes their attribution — a terms/copyright exposure that
  the operator accepted knowingly. Recorded here so no future session relitigates it silently;
  revisit only if the operator raises it.
- **Crop tech: sharp derivative service** (new dependency), not resvg-wrap. Research pass
  07/02/2026 (crawl4ai, live docs): resvg-js README confirms SVG→PNG "includes cropping, scaling"
  and v2 loads external raster links in `<image>` — so it could crop — but its only output is
  lossless PNG, which turns a ~960px photograph into a 1–2MB email asset. sharp
  (sharp.pixelplumbing.com) outputs JPEG, and its install docs confirm serverless deploys just
  need linux binaries, which Vercel's linux build install produces. resvg stays as the card
  rasterizer; sharp handles photo derivatives only.

## Design

### 1. `property_url` on projects

- Idempotent migration: `ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS property_url text`.
  Run directly per RULE 1 (creds in `.dlt/secrets.toml`), then mirror into
  `database-generated.types.ts` / `database.types.ts` (typed-client discipline: phantom columns are
  compile errors).
- One URL per project, same singular-anchor precedent as `subject_address`.
- Cockpit project settings gains a "Property URL" input: accepts any well-formed http(s) URL,
  stored verbatim, shape-validated only (no reachability check at save time).

### 2. Link resolver — `lib/listings/artifact-link.ts` (new, one root)

- `resolveArtifactLink({ propertyUrl, listing })` → `string | null`:
  1. `propertyUrl` (the project field, user-input lane) if present;
  2. `listing.listingUrl` — the verbatim feed-carried URL (broker-site feed) if present;
  3. `null` → the consuming block/caption renders the CTA/photo UNLINKED. Never an error,
     never a constructed URL.
- All email blocks, social captions, and CTA slots take their href from this function. Grep-able
  invariant: no other module under `lib/email/` or `lib/social/` builds a listing href.
- Known limitation, accepted: listings sourced from the api feed have no `listing_url` until the
  address join-key lands (wave 5, handoff §6.3) — those render unlinked in the interim.

### 3. Photo derivative — `lib/media/listing-photo.ts` (new, one root)

- Input: the payload-carried `photo_url` EXACTLY as the lake holds it. Editing CDN size params or
  otherwise synthesizing a variant URL stays forbidden (handoff §2.3 / §5.4).
- Pipeline: fetch → sharp → zoom-crop that trims a fixed bottom band (removes the bottom-corner
  watermark) → JPEG (~q80) → upload to the existing public `email-media` bucket (same
  upsert-by-key pattern as `lib/email/chart-image.ts`).
- Crop amount is a named design constant (`WATERMARK_CROP`) tuned once against the Latitude 26
  fixture photos (`C:\Users\ethan\Downloads\latitude26-campaign\`), carried in the storage key as
  a crop VERSION: `listing-photos/<listing_id>-v<N>.jpg`. Retuning bumps N; rebuilds upsert and
  reuse; stale versions are inert.
- Both surfaces consume the SAME derived file: email blocks put the hosted URL in `<img>`; social
  card SVGs put it in `<image href>` (resvg external-image loading confirmed). Identical crop on
  both surfaces by construction.
- Source photos are ~960px wide; social canvases are 1080+. Mild upscale (~1.13×) is accepted
  until the photo-array ingest (wave 5, handoff §6.2) raises source resolution. Never fabricate
  resolution by URL editing.

### 4. Guardrail tie-in (wave-1 URL allowlist)

The wave-1 allowlist lint admits exactly four href/src origins: payload-carried URLs, brand-record
URLs, the project's `property_url` (user-input lane), and code-generated `email-media` URLs. This
build is what makes that lint satisfiable — the resolver and derivative service produce the only
two link/image sources an artifact needs.

## Testing

- Resolver: unit tests for all three chain positions including the null/unlinked case; a test
  asserting no href construction from ids.
- Derivative: unit test with a fixture image — keying, crop-version bump behavior, JPEG output;
  mocked upload.
- Parity: an email doc and its sibling social card built from the same listing resolve the same
  derived photo URL and the same link.
- Verify with `bunx next build` (not bare tsc). Live verify (`listing_link_photo_root_live_verify`)
  is operator-run: a real listing project artifact shows cropped photo + correct link in a real
  inbox render.

## Out of scope

Photo arrays / carousel blocks (wave 5 data first), watermark DETECTION (fixed-band crop only),
per-project crop toggles (operator chose always-on), any change to `lib/listings/select.ts`
selection logic.
