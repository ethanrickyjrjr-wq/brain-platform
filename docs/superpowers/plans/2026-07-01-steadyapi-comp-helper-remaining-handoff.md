# Handoff — remaining work on the SteadyAPI comp helper (Phase 2B Part B)

**For:** a fresh Claude. **Date:** 2026-07-01. **Predecessor:** v1 core is BUILT + PUSHED.

## What already shipped (do not rebuild)

Commit `6027a608` on `main` — **v1 core**, offline-green (64/64 tests), `bunx next build` clean.
Files: `lib/geo/geocode-address.ts`, `lib/listings/steadyapi.ts` (`fetchNearbyValues` + `fetchSoldEvent`
+ pure normalizers), `lib/assistant/comp-helper.ts` (`looksLikeCompAsk`, `extractAddress`, `compHelper`,
`renderCompBlock`, `compSources`), `lib/assistant/conversation-path.ts` (`compForConversation` wired at
both hook points, precedence over web-fallback), `lib/welcome/frames.ts` (`WelcomeSource.value` → optional)
+ its 3 render call-sites. Approved design: `docs/superpowers/specs/2026-06-30-steadyapi-comp-helper-design.md`.

**Hard rules already enforced structurally — keep them true in every increment:** never the string
"SteadyAPI" in any rendered output; `RenderComp` carries no `propertyId` (MLS/id scrub is at the
normalizer, not at render); Lee (12071)/Collier (12021) only; ≤3 Steady calls/request; sources =
SWFL Data Gulf + `https://www.realtor.com` homepage only (never a permalink); plain text (no
blockquotes/tables); dates MM/DD/YYYY; never invent a number (a gap → a lane-4 `needs[]` ask).

---

## THE remaining items (this build)

### 1. LIVE-VERIFY — the single operator-gated item (no code)
`PHOTOS_API` is a **Vercel env var, not a repo secret** — no live SteadyAPI/Mapbox call is allowed
without an explicit operator go-ahead for the paid calls. When authorized: from prod, run one comp ask
(e.g. "comps near <a real Lee/Collier street address>") and confirm — cited nearby comps returned,
**≤3 Steady calls**, **no MLS# and no "SteadyAPI" anywhere**, date shown as **MM/DD/YYYY**, an
AVM/last-list is never worded as a sale. Capture the proof, then close check
`steadyapi_comp_helper_live_verify` (`node scripts/check.mjs close steadyapi_comp_helper_live_verify`).
Until then it stays OPEN.

### 2. Increment 2 — comps bar chart (subject vs comps)
Emit a `{type:"chart"}` prelude frame alongside the comp answer so the user sees a bar chart.
- **Reuse `buildCompsSpec(comps, facts, areaUrl, asOf?)` in `lib/email/listing-comps.ts:42`** — it already
  builds a bar `ChartSpec` (subject bar labeled "(Subject)" first, comps sorted price-desc, returns null
  when < 2 comps). Map `CompResult.comps` → its `Comp[]` (`{label, price}`) and pass a subject `facts`
  (`ListingFacts` — at minimum a price; for the comp path the "subject" is the geocoded address, which has
  no price yet, so either use the nearby `statistics` median as the subject bar or omit the subject and
  chart comps-only — decide during brainstorm).
- **Wire it in `compForConversation`** (`lib/assistant/conversation-path.ts`): when the comp path hits and
  produces ≥2 comps, also `prelude.push({ type: "chart", chart })`. The frame type + `ChartSpec` import
  already exist (`lib/welcome/frames.ts:104`, `@/components/charts/registry/chart-spec`). The LLM never
  touches the chart's numbers (the moat) — same as the located/region chart path already in the route.
- **Label honesty:** the chart must not turn an AVM/last-list into a "sold" bar. Carry the `priceKind`
  through so estimate bars read as estimates (a subtitle or per-bar note), never as sales.
- Test offline with a fixed `CompResult`; assert a valid `ChartSpec` (or null when < 2 comps).

### 3. Increment 3 — user-pasted-link lane
The user pastes a listing URL; fold that property in as a **candidate comp cited to that site's homepage**.
- **SSRF-safe fetch.** Reuse the *posture* in `lib/welcome/logo-allowlist.ts` (`safeLogoUrl` + the
  scheme/internal-IP checks) — **but NOT its `LOGO_HOST_ALLOWLIST`** (that allows only `swfldatagulf.com`,
  which would reject every real listing site). Increment 3 needs: **https only, block private/internal IPs
  and localhost, cap redirects/size** — allow any public host. Write a `safeListingUrl`-style guard next
  to (or generalizing) `safeLogoUrl`; keep the one-host logo allowlist intact for its caller.
- **Extraction.** Reuse `fetchListingFacts(url): Promise<ListingFacts|null>` in
  `lib/email/listing-scrape.ts:406` — JSON-LD `parseJsonLdFacts` / `parseListingFacts` first, `llmExtractFacts`
  (Haiku) fallback, `mergeFacts`. It returns `{ address, price, beds, baths, sqft, … }`.
- **Fold in:** add the scraped property as one comp in `CompResult`, cited to **that site's homepage** (add a
  third `WelcomeSource` for that host via the one citation root — `clean-url.ts`/`CitationList.tsx`; homepage
  only, never the deep URL). Unreadable page → a lane-4 `needs[]` ask for address + price.
- **User-*typed* comps already relay today** (no new code) — a figure the user gives is a valid lane
  ("figures you provided"); it charts through the existing user-figure path.
- **Cost note (the v1 caveat, still true):** the comp path fires live Mapbox + SteadyAPI on the public,
  unauthenticated `/welcome` surface, keyed per-address. What bounds it: `PHOTOS_API` unset → `[]` → lane-4
  (zero spend) until authorized, plus the route's existing per-client weekly cap + middleware IP burst
  limiter. If Increment 3 adds an outbound fetch of an arbitrary URL, the SSRF guard above is load-bearing.

### Process (per RULE 3.5 / RULE 0.4)
Increments 2 and 3 are **new behavior** → run `superpowers:brainstorming` with a crawl4ai research pass
before coding (the v1 spec's "brainstorming DONE" covered v1 only). Register each with
`node scripts/new-build.mjs`. Build TDD, verify with `bunx next build` (not bare tsc), stop before the
first push touching the live answer engine and confirm with the operator.

---

## Sibling tracks (SEPARATE — not this build, listed so the picture is complete)

- **Phase 2 Part A — organic sold capture (ingest).** A concurrent session is building this NOW in the same
  working tree: `ingest/pipelines/listing_lifecycle/{pipeline,extract_api,transitions,distill,constants_api}.py`,
  `ingest/tests/pipelines/listing_lifecycle/test_sold_capture.py`, `migrations/20260701_listing_transitions_sold_capture.sql`,
  spec `docs/superpowers/specs/2026-07-01-steadyapi-sold-capture-design.md`. **Do not touch these** — they
  were deliberately excluded from `6027a608`.
- **SteadyAPI sole-spine, other phases** (`docs/superpowers/plans/2026-06-30-steadyapi-sole-spine/`):
  Phase 1 inventory cutover, Phase 3 market brains, Phase 4 rentals, Phase 5 land/manufactured (parked).
- **Email Lab / Social RentCast→SteadyAPI rewire** — check `email_social_steadyapi_rewire` (tracked separately).
- **API usage logging** — `docs/superpowers/plans/2026-06-30-api-usage-logging-implementation.md` (untracked,
  another session's plan).

## Start-here probe (RULE 0.5 — the prior art is in the tree)
`lib/assistant/comp-helper.ts` (the pattern) · `lib/assistant/web-fallback.ts` (the original twin) ·
`lib/assistant/conversation-path.ts` (the two hook points + precedence) · `lib/email/listing-comps.ts`
(Increment 2) · `lib/email/listing-scrape.ts` + `lib/welcome/logo-allowlist.ts` (Increment 3) ·
`lib/assistant/CLAUDE.md` (area conventions — read before editing there).
