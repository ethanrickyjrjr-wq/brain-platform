# High-res any-color all-types chart rendering for email + PDF

> **Recommended model:** ⚡ Sonnet




**Date:** 2026-06-28 · **Check:** `prochart_rendering_live_verify` (open)
**Full plan:** `~/.claude/plans/plan-this-out-c-users-ethan-dev-brain-pl-cached-quail.md` (approved)
**Companion:** `docs/superpowers/specs/2026-06-28-chart-ideas-and-dynamic-charts-handoff.md` (producer side)

## Problem
Email/deliverable charts were the bottleneck (not selection/data): rendered at intrinsic 600×300 (no
retina), only a single accent color was injectable, ~7 shapes had an email path, and PDFs rendered ZERO
charts. The producer handoff's "bottleneck = producer, not renderer" is WEB-only.

## Goal
One server-side chart→SVG→high-res PNG pipeline, fed deterministic cells + a full brand palette, embedded
identically in email (`<Img>`) and PDF (`<Image>` data-URI). Any color, retina, as many types as possible,
moat intact (every plotted/displayed number traces to a real source).

## What we're building
- **P1 (no new dep):** resvg `fitTo` high-res; full-palette `ChartTheme` through the SVG builders; PDF
  chart block reusing the SVG→PNG path; user/upload/web lanes into email/PDF (§1F).
- **P2 (adds `echarts`):** ECharts SSR (`renderToSVGString`) long-tail types + `lintEChartsOption`
  output-moat guard (no derived/`%`/trendline/`smooth` number that isn't a sourced cell).

## Progress (DONE, verified locally + live in Email Lab)
- **High-res:** `svgToPng(svg, {scale})` → resvg `fitTo:{mode:'zoom',value:scale}`, default 2×. Proven
  live: the lab's ZHVI chart loaded `naturalWidth 1200 × naturalHeight 600` displayed at 600.
  `lib/email/chart-image.ts`. 3 tests.
- **Any colors:** `barChartSvg` per-bar `series[]` palette; both builders take `grid`/`axisText`
  overrides; omit → today's look (regression-guarded). 3 tests.
- **Rule-2 caption fix:** `chartImageCaption()` extracted + uses `formatDisplayDate` — the email
  image-block caption was leaking the raw ISO (`2026-04-30` → now `04/30/2026`). `lib/email/spec-to-png.ts`.
  3 tests. Verified live in the lab.
- Whole `lib/email` suite green (575+). SWFL brand palette confirmed from `app/globals.css`:
  `--gulf-teal #3DC9C0`, `--gulf-deep #0F1D24`, `#F0EDE6`, gradient `#3DC9C0→#2A8C85`.
- **Lab "pick your chart type" control** — `lib/email/reshape-chart-type.ts` (`reshapeChartToType` +
  `chartTypeFits`) re-emits the routed data under bar/ranked/donut/dot-plot; threaded through
  `build-doc.ts` (`buildPromptChart` `chartType`) → `/api/email-lab/ai` → `EmailLabShell` chip row.
  Verified live (donut on demand). 9 reshaper tests.
- **Fit guardrail** — donut only for additive (count) data; ranked only with a real delta; else falls
  back to a bar with a user-facing note (`chartNote`). Stops the "$10.7M of median prices" nonsense.
- **Color cache-key fix** — the chart PNG key now includes the accent hex, so a brand-color change
  yields a NEW url (was serving the stale old-color image from the same address). `build-doc.ts`.
- **Dot-plot legend** — "this" → configurable `valueLabel` (default "value"); reference legend now
  positioned AFTER the value label (no overlap/scramble). `lib/charts/svg/dot-plot.ts`. +tests.

## Still to build (this build, piece by piece)
Palette end-to-end (widen shared `ChartTheme` + thread through `spec-to-png`) · PDF chart block
(`lib/email/doc/types.ts` + `lib/pdf/email-doc-pdf.tsx`, PNG as data-URI) · font bundle (Vercel-Arial
fix; proof = preview deploy) · 6 new shape builders (scatter/composition/gauge/radial/timeline/grouped-bar)
· §1F lane wiring · P2 ECharts + `lintEChartsOption`.

## DEFERRED follow-ups / parallel builds (captured so they aren't lost)

### A. Cadence-aware DATA FRESHNESS rule — BUILT for the email/headline lane (2026-06-28)
**Operator decree (escalating):** "we don't ship old data!!! AI FINDS THE DATA ONLINE OR FROM USER
UPLOADED DOCUMENTS." NOT "catch up our ingest" — the operator explicitly rejected that framing. The AI
must FIND today's number live when our held figure is stale.

**BUILT (TDD, green; verified live 2026-06-28):**
- `lib/assistant/freshness.ts` — pure cadence-aware staleness. `cadenceForFigure` maps a held figure's
  source/key to its PUBLISH cadence (ZHVI/ZORI/Redfin = monthly, MLS active-listings = daily, Census =
  annual); `isStale(asOf, cadence, today)` = behind one interval + a publish-lag grace (monthly = 45d, so
  the freshest published month reads fresh while a month behind reads stale); `staleFigures(figs, today)`.
  8 tests. NOT a flat "1 week" — a flat rule sends the AI hunting for data that doesn't exist (invention
  risk). "Stale" = behind the source's latest *published* vintage, not behind "today".
- `lib/assistant/web-fallback.ts` — `staleFiguresToRequests(stale, placeHint)` turns stale held figures
  into FORCED web lookups (the probe never flags a figure we "hold"); `webFallback(..., { forced })` fills
  them via the SAME verbatim-citation moat (`fillExternalPoint`). +5 tests.
- `lib/email/build-doc.ts` — `buildContentDoc` now: load raw figures (each with as-of) → `staleFigures` →
  forced web refresh (scope-anchored `placeHint`) → `dropSuperseded` (exact-label) so the AI never sees
  the stale held number beside the fresh one → `renderWebFallbackBlock` grounding + a FRESHNESS directive
  ("the web-verified figure is now; describe the chart as history through its date — never call its last
  past point 'now'"). Returns `webRefreshed` + `webSources` in the payload. +3 tests. Legacy token route
  preserved via the `fetchLakeParts`/`composeLakeContext` split.

**Live-run findings (real lake + real web, 33904 Cape Coral, today 06/28/2026):**
- Source CSV (`Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`) publishes through **2026-05-31**; we
  hold **2026-04-30** → a newer vintage exists, so the web lane CAN move the date.
- BUT Zillow's live 33904 page shows **$342,030, −8.3% YoY** = our held April value. So for THIS ZIP the
  current public value equals what we hold — the number is flat/declining, not "behind." The web fetch
  confirms+cites it as current; it does not visibly "jump."
- **Bug caught + fixed:** a place-less figure label ("Home value, year over year") drifted the web fetch
  to the Cape Coral-Fort Myers METRO YoY (−3.4%) instead of the 33904 ZIP (−8.3%). Fixed by anchoring every
  forced query to the scope (`placeHint`). Replacing a ZIP figure with a metro figure is a provenance error.
- Census population (2022) could NOT be web-verified from the allowed domains → left held, NOT invented.
  Moat held.

**Still open (the CHART trend's endpoint):** the email headline/text now pulls the live cited current value;
the trend CHART still ends at its last held monthly point (a different producer — `buildChartForQuestion`
Layer 1 → `buildChartForIntent`, NOT touched). The FRESHNESS directive stops the AI captioning that point as
"now," but the plotted endpoint is still historical. Fork (a) — graft a live cited "now" dot onto the trend
(mixed-provenance rendering + two-source caption) — is deferred; for ZHVI it won't visibly jump (live ≈
April). Demo the "finds today's data" wow on a FAST metric (active listings / DOM / mortgage rate) where
today's genuinely differs. Broad cadence-registry-driven rule across all surfaces stays the larger follow-up.
- Minor: hero ($342,030, per-ZIP `zhvi_zip_latest`) vs chart caption ($346,620, trend array) — two ZHVI
  sources disagree by ~$4.5k; separate data-consistency cleanup.

### B. Multi-chart per email (the marketing "quad" + "deep scroll")
Today the AI build injects ONE chart (`upsertChartBlock` replaces a single image block,
`lib/email/inject-chart.ts`). A 4-chart quad and a multi-chart deep-scroll deliverable need a
multi-chart path: let the AI build emit N chart blocks (each real-data, each lint-passed), plus a
quad/grid layout block. Required for the richer marketing assets the operator asked to record.

### C. AI chart commentary in the deliverable (from the original plan §Follow-up)
AI-written commentary about each chart in the deliverable build path
(`lib/deliverable/build.ts` `buildDeliverableNarrative`), reusing the no-invention `gateNarrative` lint.
AI chart *selection* already lives upstream (compose-chart / chart-ideas) — not rebuilt here.

### D. MORE color options for the chart injector (operator decree 2026-06-28)
Today the chart takes a SINGLE seed color (`doc.globalStyle.accentColor`): the donut derives a tint ramp
from it, `barChartSvg` accepts a `series[]` palette, the other builders use the one accent. The cache-key
fix means a color change now actually re-renders — but the palette itself is thin. Wanted:
- **Full palette injection end-to-end:** widen the shared `ChartTheme`
  (`components/charts/registry/chart-spec.ts`) from `{primary,accent,logo}` to `{primary, accent,
  series[], grid, axisText, background}`; thread it through `chartSpecToEmailImage`/`chartSpecToEmailSvg`
  into every builder (today only the chart-image bar/trend builders read a palette — §1B/1C).
- **Seed choice:** let the chart lead with the brand PRIMARY (matches the email chrome) or ACCENT — the
  current default is accent, which can clash (purple chrome + dark-green chart in the operator's test).
- **A chart-palette control in the lab** (preset ramps + per-series pickers), distinct from the email
  brand colors, so the user dials chart colors directly.
- Per-segment donut colors + bar `series[]` already exist as plumbing to reuse.

## Verification / DoD
`bunx next build` green; new SVG-builder + guardrail + caption unit tests pass; preview-deploy render of
an email PNG and a deliverable PDF with a non-bar chart in brand colors, crisp at 2× (bundled font on
Linux, not a silent Arial fallback). Close `prochart_rendering_live_verify` only on the preview-deploy
evidence.

## Anti-patterns
Don't re-port the 5 already-SVG shapes · no QuickChart/hosted API (ships data off-box) · PDF `<Image>` =
data-URI, not a Supabase URL · no renderer paints a number absent from the source cells · bundle the TTF,
don't rely on `loadSystemFonts` "Arial".
