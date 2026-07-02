# Deliverable-factory build waves — master execution plan

**Date:** 2026-07-02. Sequencing plan for the readiness handoff
(`_AUDIT_AND_ROADMAP/# Deliverable-factory readiness — the ha.md`); that doc stays the evidence
base, this doc is the order of operations. Per the session loop, open obligations live in the
`checks` ledger — this doc is a brief, not a status board. Each wave gets its own
brainstorm → `node scripts/new-build.mjs <slug>` → spec → plan → build cycle AT ITS TURN; only
wave 1.5 is registered today.

## Dependency spine

1 → 1.5 → 2 → 3 → 4 → 6 → 7. Wave 5's two ingest lanes start any time after wave 1 and must land
before wave 6 runs fully unattended. Each wave's crawl4ai research item runs at that wave's
brainstorm (findings → SESSION_LOG per RULE 0.4), not all upfront.

## Waves

### Wave 1 — Invention-surface guards · slug `invention-surface-guards`

The handoff's one-file changes, closing the invention surface first:
placeholder-over-invention gate extension in the deliverable build lint; URL allowlist lint
(every href/src in compiled output appears verbatim in payload, brand record, or user input);
single-source-per-surface lint (one source tag per entity+metric per artifact — discrepancies go
to the operator view, never the customer artifact); sold-price guard on the social model
(a sold/close slot never binds 0/null — falls back to last-list-price copy with disclosure).
Smallest wave, biggest risk reduction. Handoff evidence: guardrails section items 3–5 + social
item 6.

### Wave 1.5 — Listing link + photo roots · slug `listing-link-photo-root` · REGISTERED

Spec: `docs/superpowers/specs/2026-07-02-listing-link-photo-root-design.md` ·
check `listing_link_photo_root_live_verify`. Per-project `property_url`, the one-root link
resolver (property_url → feed listing_url verbatim → unlinked), and the sharp watermark-crop
photo derivative both surfaces share. Lands right after wave 1 because the allowlist lint needs
the resolver to be satisfiable, and every photo block in waves 3–4 needs the derivative.

### Wave 2 — Brand tokens, one root · slug `brand-tokens-one-root`

FONT_DISPLAY / FONT_BODY (email-safe fallback stacks carried IN the token — webfonts never),
SURFACE (sand) and SURFACE_DARK added to the single branding record both email and social read;
`tokensFromBranding` grows from 4 slots; canvas font stops being hardcoded Arial. Parity test
asserts all three email render engines resolve fonts identically (locked memory: EmailDoc has
three render engines). The handoff calls this the single highest-leverage visual item.

### Wave 3 — Email block vocabulary + chart-PNG wiring · slug `email-block-vocabulary`

Six grid blocks as seed factories with fixed element ids (photo-hero, stat-strip, tile-pair,
evidence-row, numbered-list, provenance-footer — same patch-by-id pattern as the social template
library); every chart in a sent email forced through the existing data→PNG→hosted-URL path; verify
2× retina rendering and brand-token colors in the chart image. Consumes waves 1.5 + 2. Research
at brainstorm: current caniemail support tables (SVG stripping, background-image, object-fit,
webfonts) → pins the renderer constraints and lint list.

### Wave 4 — Social photo + shared chart specs · slug `social-photo-templates`

Photo element in the social template vocabulary + photo-led templates (photo-top/stat-band square,
full-bleed/scrim story); safe-zones gain text-over-photo scrim rules; social chart slots consume
the SAME chart-spec objects as email's chart image (one data→spec builder, email gets PNG, card
canvas gets SVG→PNG); per-channel caption composer with code-enforced length limits (truncation is
a build FAILURE) and template-injected provenance line. Research at brainstorm: current platform
image + caption specs (Meta/IG, LinkedIn, X, GBP) → re-pin formats, safe zones, limits.

### Wave 5 — Lake gaps, two parallel ingest lanes

- `listing-photo-array-joinkey`: capture the photo ARRAY at max feed rendition (never synthesize
  larger URLs); normalized `address_key` on BOTH listing feeds so photo (one feed) + listing URL
  (the other) compose per listing. Unblocks full-quality waves 3–4 and richer link fallback.
- `collier-recorded-sales`: recorder-side sold prices for Collier (ODD scaffold if not
  auto-ingestable), backfill job reconciling sold transitions with recorded deeds, stamping
  `sold_price` + `source_tag`. Until it lands, Sold artifacts stay in disclosed-placeholder mode.
- Riders as they're specced: per-ZIP × price-band DOM benchmark aggregate; curated source-tagged
  corridor-names table. Research at brainstorm: Collier Property Appraiser / Clerk export
  surfaces, fields, cadence, terms.

### Wave 6 — Campaign object + lifecycle trigger + scheduler · slug `listing-campaign-object`

The 5-stage lifecycle kit as ONE generated artifact (5 linked docs sharing brand + property
payload, stage-conditional copy slots, per-stage send triggers on listing-transition events);
one transition event drafts BOTH the stage-matched email and social post through one path — this
is where the two social systems (publish engine vs lab generate-week) finally merge, with the
cockpit state machine. Scheduler go-live: the commented-out email/social crons come on.
Research at brainstorm (gate for go-live): SPF/DKIM/DMARC + RFC 8058 one-click-unsubscribe
thresholds at Gmail/Yahoo scale senders.

### Wave 7 — Golden evals + audit lane, then the tier flip · slug `golden-evals-tier-flip`

Freeze the Latitude 26 campaign (payload queries + expected artifacts) as fixtures; diff harness
on any model/prompt/template change (invented digits, minted URLs, missing disclosures, broken
char limits); sampled top-tier audit of default-tier builds scoring invented figures / unsourced
claims / framing violations → ops surface. Only after this is green: flip the default build tier
to Sonnet and measure. (Tier evidence: the handoff's model verdict — top tier stays for max mode,
design-time authoring, and the audit lane, not the per-send path.)

## Standing rules for every wave

- Brainstorm first (RULE 3.5) with its research item; register the build; spec; plan; build.
- Extend existing seams, never new mandatory pre-materialization gates (RULE C2).
- Numbers computed in code; the model picks WHICH payload stat fills a slot, code writes digits.
- Verify with `bunx next build`; live-verify checks are operator-run.
