# Deliverable-factory readiness — the handoff spec

**Written 07/02/2026, revised same day.** Source of truth for speccing the next build wave on the
email + social surfaces. Grounded in a live end-to-end test: a 6-piece branded listing campaign
(Coming Soon → New Listing → Comps → Pending → Sold + agent intro) and a 4-format social pack for
465 Gordonia Rd, Naples 34108 ($14.8M), built from the lake by the top-tier model working by hand.
Fixtures: `C:\Users\ethan\Downloads\latitude26-campaign\`. Data snapshot behind every figure:
07/01/2026.

**Two framing corrections (operator, 07/02/2026) that define what this doc is:**

1. **The campaign was NOT built with the grid lab.** The session was told to use it and hand-wrote
   email-table HTML instead. That IS the honest gap measurement: when an expert needs Latitude-26
   fidelity, the block canvas can't express it. Everything in §3 exists to close that gap.
2. **Its charts would break in real inboxes.** They're inline SVG, which Gmail and Outlook strip.
   The correct path already exists — `lib/email/chart-image.ts` + `lib/email/spec-to-png.ts`
   (data → PNG → hosted URL, brand-accent aware; SVG chart shapes in `lib/charts/svg/`: line-band,
   dot-plot, ranked-delta, donut-share).

**Therefore: the campaign is a DESIGN TARGET, not a technical template.** The build goal is: the
grid lab + social engine produce this fidelity from real components, with Sonnet in the loop, and
nothing hand-written.

---

## 1. Model verdict: is Opus the right choice?

**As the default workhorse — no. As a reachable tier and an auditor — yes, and it's already wired.**

- Per-deliverable builds (email fills, social fills, synthesis) target **Sonnet** once §5's
  guardrails are structural. The moat is structural no-invention, not model virtue (locked): if a
  fabricated number can't ship regardless of model, tier choice is a prose-quality/cost dial.
- What required top-tier judgment in the live test was ~15 unprompted integrity calls (§2). Every
  one is automatable as code. Automate them and Opus stops being load-bearing.
- **Opus earns its cost in three places:** the existing `max` mode
  (`lib/email/model-router.ts`); design-time authoring (templates, seeds, brand systems — low
  volume, amortized); and a sampled adversarial audit of Sonnet-built deliverables writing to the
  ops surface. NOT in the per-send path.

Current wiring (verified in code 07/02/2026):

- `refinery/agents/anthropic.mts` — TRIAGE `claude-haiku-4-5`, SYNTHESIS `claude-sonnet-4-6`;
  RATES table covers haiku/sonnet/opus-4-8 (pricing verified via crawl4ai 07/01/2026).
- `lib/email/model-router.ts` — interactive→haiku · quality→sonnet · max→opus. Dial exists.
- `lib/assistant/stream.ts` haiku stream · `lib/assistant/gap-fill.ts` sonnet.
- Ingest extractors: haiku (`ingest/lib/extract_client.py`).
- Any model-ID bump: crawl4ai the live model-ID docs first (RULE 0.4), then re-run golden evals
  (§5.7) before flipping a default. A newer Sonnet generation exists upstream — same drill.

---

## 2. What the live test proved a model must NOT be trusted to do

Each was an unprompted judgment call this session; each becomes a §5 rule:

1. **Sold price was 0** in `listing_transitions` (recording lag). Correct: disclosed placeholder +
   last list price. Failure mode: printing list price as sale price, or inventing one.
2. **Feeds disagree**: `active_listings_residential_zip_stats` says 100 listings in 34108;
   `listing_state` holds 182 at $2M+ alone (different sources/filters). Never print both where a
   reader can cross-compare.
3. **URL minting**: property_ids are realtor-shaped; constructing a realtor.com URL from one, or
   "improving" an rdcpix photo URL's size params, is an invented fact that 404s.
4. **Chart geometry**: SVG y-coordinates hand-computed from the raw ZHVI series. Mid-tier
   arithmetic drifts — the chart looks right and plots wrong. (Moot once §3.2 forces all charts
   through spec-to-png — geometry becomes code.)
5. **Narrative vs status**: Pending/Sold emails for a still-active listing are campaign-sequence
   templates; the disclosure line was a judgment call, not a template feature.
6. **Non-lake garnish**: corridor nicknames (Pelican Bay / Park Shore / Old Naples) and "26°N" came
   from general knowledge — fine disclosed, poison silent.

---

## 3. EMAIL — what the grid lab needs to reproduce the design target

The fidelity gap, block by block (compare any campaign file against the current block canvas):

1. **Block vocabulary.** The campaign uses compositions the canvas can't express today: full-bleed
   photo with linked overlay; two-tone stat-tile pairs; spec strips (4–5 stat columns with rule
   lines); side-by-side photo+text evidence rows; numbered service lists; a styled disclosure
   footer with collapsible sources. Spec these as grid blocks (photo-hero, stat-strip, tile-pair,
   evidence-row, numbered-list, provenance-footer) — each a `SEED_DOCS`-style factory with fixed
   element ids so the AI author patches by id (same LOAD-BEARING pattern as
   `lib/social/design/templates.ts`).
2. **Charts: PNG path only.** Every chart in a sent email goes data → `spec-to-png.ts` →
   hosted URL → `<img>`, via `buildChartForQuestion` (`lib/email/build-doc.ts`). The ZHVI trend
   shape maps to the existing `line-band`; comp bars to `ranked-delta`/bar; ZIP medians to bar.
   Gap to check in spec: can chart-image render at 2× for retina inboxes, and does it take brand
   tokens (accent/surface) rather than a fixed palette?
3. **Brand system depth.** The Latitude 26 look needs: display serif + body sans pairing, a
   second surface neutral (sand), light/dark section alternation, letter-spaced smallcaps labels.
   Today's branding record is too thin (see §4.5 — same fix serves email + social). Fonts must be
   email-safe stacks (Georgia/Arial), NOT webfonts — the three render engines diverge on fonts
   (locked memory: EmailDoc has THREE render engines) — the brand token must carry the full
   fallback stack, and the parity test must assert all three engines resolve it identically.
4. **Campaign sequences as a product object.** The 5-stage lifecycle kit (coming-soon → new →
   comps → pending → sold) should be ONE generated artifact: a `campaign` of 5 linked docs sharing
   brand + property payload, with stage-conditional copy slots and per-stage send triggers wired to
   `listing_transitions` events. This is the project-cockpit "ready-for-you week" pattern applied
   to a listing. The agent-intro page is a 6th doc type reusing the same brand record.
5. **Outlook reality** (already in lib/email/CLAUDE.md): no raw SVG anywhere, table layout only,
   social icons via the established fallback. The campaign files violate this on purpose (browser
   fixtures) — the block versions must not.

---

## 4. SOCIAL — what the publish engine needs

Built by hand 07/02/2026: 4 true-size cards (`social-01…04-*.html`) + captions index
(`07-social-pack.html`) in the engine's exact formats (`lib/social/formats.ts`: 1080×1080,
1080×1350, 1200×630, 1080×1920) for the 4 live adapters (meta, linkedin, x, gbp).

1. **Photo element + photo-led templates.** `lib/social/design/templates.ts` is stat/text-first;
   element vocabulary has `logo` (image-by-src) but no photo/hero element. The flagship post type —
   Just Listed with the listing photo — cannot be authored from the library. Add a `photo` element
   + templates: photo-top/stat-band (the square card), full-bleed/scrim/text-block (the story
   card). `safe-zones.ts` must gain text-over-photo rules (scrim required under text).
2. **Chart-in-card via shared shapes.** The landscape Market Pulse card is `line-band` on a canvas;
   the portrait corridor card is a 3-column bar. Social already has `chart-svg.ts` with a parity
   test — spec: social chart slots consume the SAME chart-spec objects as email's chart-image, so
   one data→spec builder feeds both surfaces (email gets PNG, social canvas gets SVG→resvg PNG).
3. **Render to PNG is the delivery** (`render-social-image.ts`, resvg). The "only 1 card arrived"
   incident this session (scaled-HTML preview read as one card) is the product lesson: HTML preview
   ≠ asset. The engine's PNG export already makes this a non-issue — the lab UI must always hand
   the user the rendered PNGs, never an HTML preview as the artifact.
4. **Caption composer per channel.** Captions differ structurally per adapter (X hard 280-char
   limit; LinkedIn long-form; GBP CTA-with-phone; Meta hashtags). Spec: per-channel caption
   templates with code-enforced length limits (truncation is a build FAILURE, not a silent cut) +
   the provenance line injected by the template (named source + as-of MM/DD/YYYY), never left to
   the model. Verify current limits during the crawl4ai pass (§7).
5. **Brand tokens — one root, more slots.** `tokensFromBranding` reads 4 slots
   (PRIMARY/ACCENT/TEXT/LOGO_URL); canvas font is hardcoded Arial. Add FONT_DISPLAY, FONT_BODY,
   SURFACE (sand), SURFACE_DARK slots to the SAME branding record the email side reads (one root),
   so an email and its sibling social card are provably the same brand. This is the single highest-
   leverage item for visual quality.
6. **Sold-price guard** in `render-model.ts`/`build-content.ts`: a sold/close slot never binds to
   0/null — falls back to last-list-price copy with the disclosure phrase (mirror of §5.3).
7. **Lifecycle trigger — ONE path.** `listing_transitions` is live and proved itself (the 07/01
   sold wave fed the Sold email). A listing project should auto-draft the stage-matched email AND
   social post from one transition event through one path — this is where the two unwired social
   systems (publish engine vs lab Generate-Week, locked memory) finally merge. Belongs to the
   cockpit Phase 1.5 state machine.
8. **Scheduler go-live.** Email/social crons are commented out platform-wide. Nothing above fires
   unattended until this lands (already a cockpit Phase 1 exit criterion).

---

## 5. GUARDRAILS — what makes Sonnet succeed by construction

Per rule C2, every item extends an existing seam. With 1–6 in place, model tier is a taste dial.

1. **Numbers computed in code, never by the model.** Refinery rule, extended to fills: the model
   chooses WHICH payload stat fills a slot; code writes the digits. Verify the social author
   (`design/author.ts` patch-by-id) and email token-fill both enforce this.
2. **All chart geometry in code** — §3.2/§4.2 make this structural (spec-to-png / chart-svg). Lint:
   any model-emitted `<svg>`/`<polyline>` in a fill is a build failure.
3. **Placeholder-over-invention gate.** Extend `gateNarrative` (`lib/deliverable/build.ts`): a
   "final/recorded" figure renders only when the payload carries a nonzero recorded value; else the
   template's disclosed-placeholder slot renders.
4. **URL allowlist.** Every href/src in compiled output must appear verbatim in payload, brand
   record, or user input. Post-render lint; model-constructed URLs fail the build.
5. **Single-source-per-surface.** One source tag per entity+metric per deliverable; two tags for
   the same metric in one artifact = lint failure. Discrepancies surface in the operator view
   ("X verified, Y needs review"), never in the customer artifact.
6. **Provenance owned by templates.** As-of date (MM/DD/YYYY, once) + named-source footer are
   code-filled slots on every email footer and social caption. Model can neither write nor omit.
7. **Golden evals.** Freeze this campaign (payload queries + expected artifacts) as fixtures.
   On any model/prompt/template change: rebuild against frozen payloads, diff for invented digits
   (any number absent from payload), minted URLs, missing disclosures, broken char limits.
8. **Opus audit lane.** Sampled N% of Sonnet builds re-read by Opus scoring invented figures /
   unsourced claims / framing violations → ops surface. Cheap at sample rates; catches guardrail
   gaps before customers do.

---

## 6. EXTRA DATA the lake needs (each gap hit during the live build)

1. **Recorded sale prices.** `listing_transitions.sold_price` is 0 at transition time. Collier
   sales need a recorder-side source (Collier Property Appraiser / Clerk recorded sales) the way
   Lee has LeePA `last_sale`. Backfill job: reconcile sold transitions with recorded deeds ~4–8
   weeks later, stamp `sold_price` + `source_tag`. Until then the Sold artifacts stay in
   placeholder mode — correct but weaker.
2. **Photo galleries + resolution.** One `photo_url` per listing, ≈960px rendition — below every
   social canvas (1080/1200). Ingest should capture the photo ARRAY at the max rendition the feed
   serves. Never synthesize larger URLs by editing CDN params (§5.4). Multi-photo unlocks the
   evidence-row email block and carousel posts.
3. **Feed join key.** The two listing feeds (`listing_state` api_feed vs
   `active_listings_residential` broker-site) share no key; this session joined by hand-normalized
   street strings and two comps had no URL match. Spec a normalized `address_key` on BOTH tables
   (one already has it) so photo (feed A) + listing_url (feed B) compose per listing.
4. **Missing listing fields**: `baths` null across the api_feed set used (campaign shipped
   bed/sqft/acre only); `listed_date`/`days_on_market` null on many `listing_state` rows (the
   broker feed had DOM); `subdivision` null in 34108 (corridor names came from general knowledge —
   see 5). Fill order per four-lane: our feeds → named web source, never invent.
5. **Neighborhood/subdivision names.** A small curated ZIP→corridor-names table (source-tagged,
   e.g. county GIS or curated-with-citation) turns the "common usage" caption disclosure into lake
   data. Cheap, high-frequency payoff — every localized artifact wants it.
6. **DOM benchmarks per segment.** "90 days vs 238/279-day rivals" was hand-assembled from comp
   rows. A per-ZIP × price-band DOM aggregate (median/p75, monthly) makes velocity claims a
   payload stat instead of an ad-hoc query.

---

## 7. crawl4ai RESEARCH AGENDA (run before/while speccing; findings → SESSION_LOG per RULE 0.4)

1. **Email client CSS support** — current Gmail/Outlook/Apple Mail support tables (caniemail):
   confirm SVG stripping, background-image rules, `object-fit` on img, webfont behavior → pins the
   block-renderer constraints and the §3.5 lint list.
2. **Platform image + caption specs, current** — Meta/IG (feed, story, carousel), LinkedIn, X, GBP:
   exact px minimums, aspect tolerance, file-size caps, caption/char limits, hashtag norms → pins
   `SOCIAL_FORMATS` (still correct?), safe-zones, and §4.4 caption limits.
3. **Listing photo** — Autozoom in to drop the watermark from bottom corner or cutoff bottom of photo
   so watermark is not visible.  Emded links need to go to users website listing of property.  Create
   property URL add section in each Project or we send to Realtor.com listing URL.    
4. **Recorded-sale sources for Collier** — Collier Property Appraiser / Clerk export surfaces,
   fields, cadence, terms → feeds §6.1 ingest spec (ODD scaffold if not auto-ingestable).
5. **Real-estate email benchmark teardown** — current best-in-class listing-campaign emails
   (structure, block patterns, CTA placement) to sanity-check the §3.1 block vocabulary against
   what converts, not just what looks right. (Prior 07/02/2026 research already found agents
   hand-building these in Canva for hours and paying $74/mo for generic templates — the wedge.)
6. **Deliverability baseline** — SPF/DKIM/DMARC + one-click-unsubscribe (RFC 8058) requirements at
   Gmail/Yahoo scale senders, current thresholds → prerequisite for scheduler go-live (§4.8), and
   the real CAN-SPAM surface stays the 3 requirements already pinned.

---

## 8. Build order (suggested)

1. §5.3/5.4/5.6 guards + §4.6 sold-guard — one-file changes, close the invention surface first.
2. §4.5 brand-token expansion (one root, email+social) — unlocks fidelity everywhere at once.
3. §3.1 email block vocabulary + §3.2 chart-PNG wiring — the grid lab hits the design target.
4. §4.1 photo element + photo templates + §4.2 shared chart specs — the social engine follows.
5. §6.2/6.3 photo-array + join-key ingest (data prerequisites for 3 and 4 at full quality).
6. §3.4 campaign object + §4.7 lifecycle trigger (with cockpit Phase 1.5) + §4.8 scheduler.
7. §5.7 golden evals + §5.8 Opus audit lane — then flip default build tier to Sonnet and measure.

Register each as a build (`node scripts/new-build.mjs <slug> "<label>"`) after its brainstorm pass;
this doc is the evidence base, not the spec.

---

*Local, uncommitted. Fixtures: `C:\Users\ethan\Downloads\latitude26-campaign\` — 6 emails,
4 true-size social cards, captions index, campaign index. All lake figures as of 07/01/2026.*