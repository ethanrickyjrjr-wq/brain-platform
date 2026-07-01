# FOLLOW-UP — Listing/Comp email sections: what's built, what's left

**Date:** 07/01/2026. **Status:** inventory verified against code (read-only). No code built for this file.
**Why:** operator asked to enrich the listing/comp email surface (multi-photo grids, AI description of
"the good things", comp cards + compare table, positive-by-default framing, per-section retone). A verified
build-status sweep shows **most of it already exists** — this file records what's real, what's genuinely
missing, and the parallel-session hazard so the next builder doesn't duplicate or collide.

---

## Naming rule (operator decree 07/01/2026 — LOCKED)

**User-facing listing/comp citations say "SWFL Data Gulf" or "lake". We do NOT say "SteadyAPI" anywhere,
and we do NOT say "RentCast" (dead vendor) or leak the MLS number.** Vendor API names and the MLS number are
internal provenance only — never in a citation, caption, or prose the reader sees. (Code comments documenting
which API is called are fine; this rule is about output.)

- **DONE (F1, this session):** `lib/listings/select.ts` `listingToFigure` + `listingsToFigures` now cite
  `source: "SWFL Data Gulf"` (was `RentCast (MLS …)` / `RentCast`). Tests assert the new contract AND that
  the source never matches `/RentCast|SteadyAPI|MLS/i` (`lib/listings/listings.test.ts`). `bunx next build`
  clean. This is the one root for BOTH email + social listing figures (`featuredContextLine` reads it too).
- **REMAINING inconsistency to decide:** the aggregated brain path `lib/email/market-context.ts` cites
  `source: "MLS active-listings"` for the same class of data. Not a vendor and not an MLS number, so not a
  hard violation — but if the operator wants strict "SWFL Data Gulf / lake" everywhere, that label changes
  too. Left untouched (separate surface, possible parallel-session ownership).

## Product decisions locked this session (operator)

- **Photos:** exactly ONE photo per listing today (single SteadyAPI `photo_url`; `listing_state.photo_url`,
  no gallery/array in the lake — confirmed). Ship single-photo + link-to-listing now; a `photos[]` pipeline
  is a *later* add, not now.
- **Framing rule:** listing = describe the good things (look, amenities, pool) by default. Comp = compare +
  what's strong about the subject. **Downsides appear ONLY when the user asks to "break it down" that way,
  and ONLY from real numbers** — the subject's current $/sqft vs where the area actually sat (lake trend),
  a real on-page number, etc. Never a fabricated con. If there's no real number to ground a concern, the
  section stays silent — the guard OMITS, it never errors. (This is the existing four-lane no-invention rule
  applied to comparison copy.)
- **Address selection:** user types a property address for a specific listing/comp; OR the project
  name/context supplies it; OR when unsure the AI asks a confirm turn — "is this listing/comp for 123 Main
  St?" — instead of guessing.
- **Per-grid sections:** each grid section is its own AI unit; retone one section without rebuilding the doc.

---

## BUILT and live — DO NOT rebuild

1. **Per-section / per-block AI edit** — `components/email-lab/EmailLabGridShell.tsx` `runBlockAi(block,
   prompt)` (~:351-369) builds a one-block mini-doc, POSTs `/api/email-lab/ai`
   (`app/api/email-lab/ai/route.ts:52-71` → `buildContentDoc`), returns `blocks[0]`, and re-pins the
   original block layout. The "✦ Ask AI to edit this block" button is per grid cell
   (`GridCanvas.tsx:239-241`). This IS the "click a section, retone just it" flow. Live.
   - **Small fix worth doing:** the BlockInspector helper copy (`EmailLabGridShell.tsx:~1128-1131`) wrongly
     says "the AI sees the whole layout … reflows the neighbors." It doesn't — `runBlockAi` sends only the
     one block. Correct the copy.
   - Design stub `docs/superpowers/specs/2026-06-28-email-lab-block-editing-design.md` is empty (headers
     only) — the feature shipped independently; the stub can be archived or backfilled.
2. **Grid "AI sections" (per-cell)** — same mechanism. Live.
3. **Comp helper (chat answer engine)** — `lib/assistant/comp-helper.ts` (`looksLikeCompAsk`,
   `extractAddress`, `compHelper` ≤3-call cap, `renderCompBlock`, `buildCompsChartSpec`) +
   `lib/assistant/pasted-link-comp.ts` (pasted-link lane) + `lib/listings/steadyapi.ts` (`fetchNearbyValues`
   :262, `fetchSoldEvent` :321). Wired live via `lib/assistant/conversation-path.ts` (`compForConversation`
   :115, pushed as chart prelude frames). Produces a comps **chart** + comparative **narrative** — but as
   **chat plain-text**, not email cards. Only the operator-gated live-verify is outstanding
   (`comp_helper_remaining_live_verify`, `steadyapi_comp_helper_prose_verify` — the latter blocked on
   Anthropic prod credits).
4. **Listing flyer (email)** — `lib/email/listing-flyer.ts:31-94` + listing branch
   `lib/email/build-doc.ts:355-396`. Deterministic: header → hero photo (`facts.photos[0]`) → price+address →
   beds/baths/sqft stats → **scraped remarks verbatim (clamped 2000 chars)** → agent card → CTA → comps
   chart (when ≥2 comps). No AI-authored narrative. Live-verify open (`listing_flyer_email_live_verify`).

---

## NOT built — the real follow-up work

### F1 — Email/Social listing provenance rewire (off dead RentCast → SteadyAPI/lake)
**Open check:** `email_social_steadyapi_rewire` (area email-lab). No plan/design doc exists — only deferral
references. **Evidence it's unbuilt:** `lib/listings/select.ts:121,143` still hard-codes
`source: "RentCast"` / `RentCast (MLS ${l.mlsNumber})`. RentCast is dead (no key in any runtime,
SESSION_LOG). So live listing citations mislabel their source AND leak the MLS number into copy (a citation
cleanliness + provenance violation). Fix: source listings from SteadyAPI/the lake, correct the citation
label, strip MLS# from user-facing text. Bounded, high-value, but touches the citation single-root — do it
carefully and confirm no parallel session owns this check first.

### F2 — Project-aware address + AI confirm-address turn
**Status:** slot reserved, mechanism absent. `scope.address?` exists on the type
(`lib/project/digest.ts:25,204,234-235`, `cross-project-index.ts`, `other-projects.ts`) but nothing ever
populates it — `withScheduleFallback` (`digest.ts:231-244`) only sets `zip`/`place`. Comp helper resolves
address purely by geocoding a typed address (`comp-helper.ts:178-198`); no project-context supply, no
confirm turn. **Build:** (a) populate `scope.address` from the project name/context when it denotes a
specific property; (b) when a listing/comp intent lacks a clear address, emit a confirm turn ("is this
listing/comp for {best-guess address}?") instead of guessing. Both piece2 and the comp-helper spec
explicitly reserved this as a "later add on the same seam" — the seam is `compHelper` + `extractAddress`.

### F3 — Listing/comp as rich EMAIL sections (cards + compare table + AI narrative + framing rule)
**Status:** the pieces exist in *chat* (comp helper) and as a *deterministic* flyer, but NOT as AI-authored
email sections. **Build:** (a) an AI "good-things" narrative section for a listing email, grounded strictly
in the real scraped/lake facts (default to AI-generated so we don't always scrape; scraped remarks remain a
fallback); (b) comp EMAIL sections — per-property stat cards (photo, beds/baths/sqft, price) + a compare
breakdown + keep the price chart; (c) the framing rule from the locked decisions (positive default;
grounded-downside-only-on-request; guard omits, never errors). Reuses the built per-section edit for retone.
**Data note:** comp stat cards need beds/baths/sqft per comp — today `fetchAreaComps`/`fetchNearbyValues`
returns list price (+ address); per-comp beds/baths/sqft is an extraction extension (cost/complexity).

### F4 — Single-photo + link on the lake-sourced listing path (minor)
The scrape flyer already uses `facts.photos[0]`. For lake-sourced listings, carry `photo_url` + link the
photo to `listing_url`. Small; folds into F1.

---

## Parallel-session hazard (read before building here)

As of 07/01/2026 this exact area has **multiple concurrent sessions**:
- A **social safe-zones** build is uncommitted in the shared working tree (`components/email-lab/social/
  KonvaStage.tsx`, `lib/social/render-social-image.ts`, `lib/social/safe-zones.*`) — claimed by another
  session. Do NOT stage, commit, or revert these.
- **Comp-helper** code (Increments 2 & 3) landed today from another session (`514658af`, `e4dd6588`,
  `1db8d402`, `aff14ef3`, `dc7629e6`); the `..._HANDOFF.md` claiming "zero tasks executed" is STALE.

**Therefore:** build any of F1–F3 in an isolated worktree (`node scripts/worktree.mjs new <label>`), stage
explicit paths only, and confirm ownership of `email_social_steadyapi_rewire` before touching F1.

---

## Recommended order

1. **F1** (provenance rewire) — smallest, highest integrity value; fixes a live citation defect. Confirm no
   owner first.
2. **F3** (listing/comp email sections + framing) — the core of the operator's request; the biggest build,
   needs its own spec.
3. **F2** (project-aware address + confirm turn) — enables address selection without a pasted URL.
4. Fold **F4** into F1.
