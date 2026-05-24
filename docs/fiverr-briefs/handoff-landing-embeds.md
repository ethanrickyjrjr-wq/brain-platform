# Designer Handoff — SWFL Data Gulf Landing ("The Gulf Knows")

**Status:** Working agreement with Saimum (Fiverr) per 2026-05-23 chat. Script locked. Tech split locked. BP hit list (§12) blocks Milestone 2 — read it first.
**Date:** 2026-05-24
**Contact:** Ricky Cooper (Brain Platform)
**Repo (this brief + assets + viz components):** https://github.com/ethanrickyjrjr-wq/builder-saimum-landing
**Build target:** Framer for non-data sections + script tech stack (Next.js / three.js / GSAP / deck.gl / Mapbox GL / recharts / d3 / GLSL) for data sections, delivered by Saimum's full-stack dev + 3D designer.

> **BP owns 4 items before Milestone 2 — see §12.** Until these ship, Saimum's tech team has nothing to wire the data sections against.

---

## 1. The job

Design and build the SWFL Data Gulf landing page — "The Gulf Knows." Saimum's team covers everything: Framer for the non-data sections, a full-stack developer + 3D designer for the data sections that need the script's tech specs. Brain Platform supplies brand identity, live API endpoints, fixture JSON for the charts, and a `/embed/swfl-map` iframe for Scene 5.

The site needs to do three things for a first-time visitor:

1. Make them believe the data is real.
2. Make them want access.
3. Capture an email — both for the general waitlist and for the MCP install notification.

The script in §2–§7 is final. Use the copy verbatim.

---

## 2. Scene 1 — Hero (full viewport, 3D parallax entry)

A dark, near-black aerial view of the Gulf coastline — Naples, Marco Island, Fort Myers Beach rendered in a stylized 3D topographic map. Not photorealistic. Mapbox GL + custom shader: water has a subtle animated shimmer; coastline glows faintly in teal.

Data nodes pulse across the map — tiny orbs of light at real locations:

- An SBA loan cluster in Cape Coral
- A CRE vacancy hotspot on the US-41 corridor
- Storm surge risk rings around Estero Bay
- Traffic flow lines on I-75 glowing like fiber optic strands

**Mouse parallax:** cursor tilts the entire map 8–12° on both axes. Data nodes have different parallax depths — closer ones move faster, giving true 3D layering.

**Headline (floats above the map):**

> Southwest Florida knows things.
> We teach that to AI.

**Subhead (fades in beneath):**

> Verified. Fresh. Auditable. Built in Naples.

**One CTA button** — frosted glass style, slight 3D shadow: **See What We Know →** (anchors to Scene 5 map).

---

## 3. Scene 2 — The Data River (scroll trigger, horizontal reveal)

As you scroll, the map tilts to a near-flat bird's-eye view and a "data river" animates outward from the coast — flowing lines of light representing data streams. Each stream has a label that fades in as the river reaches it:

- **46,201 SBA loans** — verified outcomes
- **287,000 parcels** — Lee County assessed
- **$4.1B in freight flows** — regional logistics
- **12 active storm tracks** — 1851–present

The rivers converge at the center of the screen into a glowing brain-shaped node. Text appears:

> Raw data is noise. We turn it into intelligence.

---

## 4. Scene 3 — The Charts Section (animated, interactive)

Three floating "cards" descend into view like tablets floating in water. Each card has:

- A live-rendered chart (recharts for cards 1–2, d3 Sankey for card 3, custom dark theme — Gulf palette in §10)
- A confidence bar in the corner showing the actual confidence score from the brain output
- Subtle 3D rotation as the card enters viewport (CSS perspective + rotateX/Y), settling flat

**Card 1 — Franchise Survival Map**
County-level heatmap of franchise survival rates. Hover a zip code → tooltip shows: _"Pizza franchises: 64% survival (36-mo). Resolved loans: 847."_
Data source: `fixtures/franchise-survival.json` (BP ships — see §12 item 2)

**Card 2 — CRE Vacancy Corridor**
Animated bar race chart showing vacancy rates shifting across US-41, Pine Ridge, downtown Naples by quarter. Bars have subtle motion even at rest — a "breathing" animation.
Data source: `fixtures/corridors.json` (already shipped, 26 corridor rows with `vacancy_pct`)

**Card 3 — Freight Flow Sankey**
Sankey diagram of SWFL's top freight corridors (FAF5 data) — goods flowing in/out of Lee and Collier. Nodes glow on hover.
Data source: `fixtures/freight-flows.json` (BP ships — see §12 item 3)

---

## 5. Scene 4 — "How AI Gets Smarter" (the money section)

Dark background, single column, cinematic pacing. A terminal-style animation shows a Claude conversation in real time:

```
User: What's the franchise survival rate in Fort Myers?

Claude fetching → brain-platform-amber.vercel.app/api/b/master
freshness_token: SWFL-7421-v8-20260523 ✓

Claude: Based on 847 resolved SBA loans in Lee County,
franchise survival at 36 months is 64.2%...
```

The freshness token in the terminal is hardcoded to the current value (`SWFL-7421-v8-20260523`) — see §12 item 1 for the rationale. Saimum builds this as a Framer typewriter animation; no live fetch needed for Scene 4.

**Text beside the terminal:**

> **Without us, Claude guesses.**
> The national average. A Wikipedia article. A confident hallucination.
>
> **With us, Claude knows.**
> 847 resolved loans. Verified outcomes. A freshness token that expires if the data gets stale.
>
> We are the difference between an AI that sounds smart and one that actually is.

### Inline after Scene 4 — MCP install teaser

Small frosted-glass card, positioned between Scene 4 and Scene 5 (or inside Scene 7 — designer's call):

> **Install in Claude Desktop — coming soon.**
> One command, no scraping, no API keys. Claude reads SWFL Data Gulf directly.

Email input: **Get notified when MCP ships →** (posts to `POST /api/waitlist` with `source: 'mcp-waitlist'`).

---

## 6. Scene 5 — The Map (full bleed, interactive)

Full-width interactive map (deck.gl + Mapbox GL JS) centered on SWFL. Multiple toggleable layers:

| Layer          | What it shows                      | v1 ready? |
| -------------- | ---------------------------------- | --------- |
| Franchise heat | Survival rate by zip, SBA-verified | Yes       |
| CRE corridors  | Vacancy by major commercial strip  | Yes       |
| Storm history  | Track lines + surge zones          | Yes       |
| Freight flows  | Arrow lines, FAF5 tonnage          | v2        |
| Growth signal  | Building permit density            | v2        |

Toggle buttons float at top-left, pill-shaped, frosted glass. Switching layers triggers a ripple transition (deck.gl transitions). A data card appears in the bottom-right showing what's in the brain for whatever you hover.

This whole scene is delivered as `/embed/swfl-map` — Saimum drops the iframe in Scene 5 with the script's framing copy. BP owns the iframe build (see §12 item 4).

**Tagline over the map:**

> Every number on this map has a source, a date, and a confidence score.
> That's not normal. That's the point.

---

## 7. Scene 6 — Social proof / origin story

Two columns. Left: a photo or stylized illustration of downtown Naples + Fort Myers skyline. Right: copy.

> **Built here. For here.**
>
> SWFL Data Gulf is a Naples-based intelligence platform. We don't scrape headlines — we ingest primary source data: LEEPA property records, SBA loan archives, FDOT freight studies, NOAA storm tracks.
>
> When a CRE broker in Bonita Springs asks Claude about vacancy on US-41, we want Claude to give the same answer a 20-year local expert would give — not a national average from a press release.
>
> We are making AI locally intelligent, one verified dataset at a time.

**Below the copy — sample-memo card** (see §14 for full spec). Scrollable styled card formatted as a real Brain Platform output. Tagline: **"This is what an answer looks like."**

---

## 8. Scene 7 — The CTA / footer

Dark section. Gulf water texture (subtle, slow CSS animation). Large centered text:

> **AI that knows SWFL.**
> **Data you can audit.**
> **Intelligence you can trust.**

**Three elements:**

1. **Primary CTA — "See the live intelligence →"** (goes to `/r/master`)
2. **Email signup —** native Framer form posting to `POST /api/waitlist` with `source: 'landing'`. Single field + button. Inline microcopy: _"We'll only email you when early access opens. No spam, ever."_
3. **Talk to us** — mailto or simple contact form (designer's call)

**Footer** shows the freshness token of the current master brain — live, fetched on page load from the BP JSON endpoint:

> Master brain last refreshed: `SWFL-7421-v{N}-{YYYYMMDD}` · Confidence: {N}%

This proves the platform is alive to anyone who notices it.

---

## 9. Tech stack split

Per the 2026-05-23 agreement, the data sections use the script's full tech stack; the rest is Framer. Saimum's team covers both sides.

| Scene                | Build                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Hero 3D topo map | **Tech-spec build** — three.js + @react-three/fiber + GLSL shader for water shimmer (Saimum's 3D designer)                             |
| 2 — Data river       | **Framer** (animated SVG / Framer Motion). Numbers hardcoded from the script.                                                          |
| 3 — Charts (3 cards) | **Tech-spec build** — recharts (cards 1–2), d3 Sankey (card 3). Wired to BP fixtures with fake-data fallback for any unshipped source. |
| 4 — Terminal demo    | **Framer** typewriter UI + tech-spec code component for the live freshness fetch from BP JSON endpoint                                 |
| 5 — Interactive map  | **BP-owned iframe** at `/embed/swfl-map` — deck.gl + Mapbox GL JS, three layers v1                                                     |
| 6 — Origin story     | **Framer**. Includes the FMB sample-memo card (§14).                                                                                   |
| 7 — Footer + CTA     | **Framer** for layout + tech-spec code component for the live freshness footer. Native Framer form for the email signup.               |

---

## 10. Brand identity

### Wordmark

**SWFL DATA GULF** — bold geometric sans, all caps, wide tracking. Eyebrow **"LEE • COLLIER"** in small-caps teal beneath the wordmark when room permits.

### Glyph

Three stacked water-surface waves in a teal gradient (full → dim, top → bottom). Sizing rules:

| Width | Use                           |
| ----- | ----------------------------- |
| 80 px | Hero / standalone brand block |
| 56 px | Section-level header          |
| 32 px | Inline / favicon-adjacent     |
| 20 px | Footer mark — drop third wave |

At any size ≤20 px, drop the third wave for legibility.

### Brand-asset files

Logo HTML + inline SVG: Brain Platform delivers directly to Saimum. Favicon + OG image: BP delivers pre-launch.

---

## 11. Color palette

### Surfaces (dark → darker)

| Token           | Hex       | Use                             |
| --------------- | --------- | ------------------------------- |
| `gulf-midnight` | `#0A1419` | Page body, iframe background    |
| `gulf-deep`     | `#0F1D24` | Section backgrounds             |
| `gulf-slate`    | `#152832` | Cards                           |
| `gulf-slate-hi` | `#1C3340` | Card hover / elevated state     |
| `gulf-haze`     | `#22414F` | Borders, dividers, form borders |

### Brand accent (one full, one dim — discipline)

| Token           | Hex       | Use                                                       |
| --------------- | --------- | --------------------------------------------------------- |
| `gulf-teal`     | `#3DC9C0` | Primary CTA, focus rings, freshness indicator, brand glow |
| `gulf-teal-dim` | `#2A8C85` | Secondary borders, source-citation links                  |

**Rule:** one full-intensity teal per surface. CTA, hero focal element, or the freshness indicator — pick one per scene. Don't stack two full teals next to each other.

### Direction signals (state, not decoration)

| Token          | Hex       | Use     |
| -------------- | --------- | ------- |
| `mangrove`     | `#5BC97A` | Bullish |
| `sunset-coral` | `#E08158` | Bearish |
| `neutral-gold` | `#D4B370` | Mixed   |
| `text-neutral` | `#B8B4A8` | Neutral |

**Rule:** direction colors set instantly. Never animate the transition between them. Color is the only place state lives — don't double-encode with icons or words unless the icon is the primary signifier.

### Text

| Token            | Hex       | Use                                                 |
| ---------------- | --------- | --------------------------------------------------- |
| `text-primary`   | `#F0EDE6` | Headlines, metric values (not pure white)           |
| `text-secondary` | `#B8B4A8` | Body copy                                           |
| `text-tertiary`  | `#807E76` | Captions, source labels, freshness token, microcopy |

### Source-link discipline

Source citations render in `gulf-teal-dim` with **no underline** by default. On hover: 1 px underline, 120 ms ease. Never use full-intensity teal for links.

### CTA button (frosted glass)

Background `rgba(61,201,192,0.12)`, border `1px solid #3DC9C0`, text `#3DC9C0`. Hover background `rgba(61,201,192,0.22)`. Add `backdrop-filter: blur(12px)` for the Scene 1 + Scene 5 buttons.

---

## 12. ⚠️ BP OWNS BEFORE MILESTONE 2 — DELIVERY HIT LIST

**These four items block Saimum's tech team. Until they ship, the data sections cannot be wired.**

| #   | Item                                            | Why it blocks                                                                                                                                         | Status |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | **JSON output endpoint for master brain**       | Scene 7 footer handled by `/embed/footer-token` iframe (live). Scene 4 terminal hardcoded — see detail below. Only needed if Scene 4 goes live-fetch. | 🟡     |
| 2   | **`fixtures/franchise-survival.json`**          | Scene 3 Card 1 has no data feed.                                                                                                                      | 🔴     |
| 3   | **`fixtures/freight-flows.json`**               | Scene 3 Card 3 has no data feed.                                                                                                                      | 🔴     |
| 4   | **`/embed/swfl-map` route** (deck.gl, 3 layers) | Scene 5 has nothing to drop into the iframe slot.                                                                                                     | 🔴     |

Item 1 detail: **Scene 7 footer freshness token is already handled** — the `/embed/footer-token` iframe fetches live from the master brain and renders the token, confidence gauge, and "See What We Know →" link. Saimum drops that iframe; no code component needed for the footer.

The JSON endpoint is only needed if Scene 4 terminal goes live-fetch instead of hardcoded. **Recommendation: hardcode the terminal token** (already done in the script above — `SWFL-7421-v8-20260523`). The terminal is a demo moment, not a live dashboard; the footer already does the "live proof" job. Update the terminal copy quarterly when brain numbers change significantly. If Saimum prefers a live fetch for Scene 4, build `app/api/b/[slug]/output/route.ts` returning `{ freshness_token, confidence, conclusion, key_metrics, caveats }` — the shape is in `fixtures/brain-output.json`.

Item 4 detail: ship `/embed/swfl-map` with three layers in v1 (Franchise heat, CRE corridors, Storm history). Add Freight + Growth layers in v2 after their fixtures land.

---

## 13. Built-in scope per Saimum agreement (2026-05-23)

These are confirmed deliverables, not optional ideas:

- **Email signup in Scene 7** — native Framer form posting to `POST /api/waitlist` with `source: 'landing'`. Privacy microcopy below the input.
- **MCP install teaser** between Scene 4 and Scene 5 with a separate email capture (`source: 'mcp-waitlist'`). "Install in Claude Desktop — coming soon." No live `/connect` link yet; this is an interest probe.
- **Framer editor access** delivered post-publish so Ricky can update copy and numbers without round-tripping.
- **Live data fetch via code components** — Saimum confirmed Framer Code Components handle any embed code BP provides.

---

## 14. FMB sample-memo card in Scene 6

After "Built here. For here." copy, a scrollable styled card formatted as a real Brain Platform output — the **Fort Myers Beach 5-Year Accommodation Lease** memo (full sample output below).

**Format the card to render:**

- Title, date, question, bottom line
- The signal table with three columns: Signal · Reading · **Direction**
- Direction column values rendered in direction-signal colors:
  - "Tailwind" in `#5BC97A` (mangrove)
  - "Headwind" in `#E08158` (sunset-coral)
  - "Mixed" in `#D4B370` (neutral-gold)
- The narrative body below the table

**Tagline above the card:** "This is what an answer looks like."

The card proves the depth of what's behind the platform in a way abstract copy can't.

**Sample brain output to render in the card:**

```
SWFL Data Gulf — Brain Output
Fort Myers Beach — 5-Year Accommodation Lease Decision
Date: May 2026
Question: Should we commit to a 5-year accommodation lease at [property], Fort Myers Beach?

BOTTOM LINE
Conditional yes — tailwinds are real, but storm exposure and a 5-year
commitment in a coastal zone that took two direct hits in a decade warrant
a shorter initial term or a negotiated exit clause at year 3.

──────────────────────────────────────────────────
Signal                          Reading                         Direction
──────────────────────────────────────────────────
Post-Ian tourism recovery       TDT collections +18% YoY        Tailwind
Flood / storm risk              Zone AE · AAL $18,400/yr ·      Headwind
                                insurance 5.1% of NOI
Coastal occupancy trend         72% avg occupancy ·             Tailwind
                                +4 pts vs. 2023
Permit saturation (FMB)         z-score 0.3 · below baseline    Tailwind
Competitor density              4 STRs within 0.3 mi            Mixed
5-year commitment risk          2 major storm landfalls in       Mixed
                                10 years · 1 direct hit (Ian)
──────────────────────────────────────────────────

ANALYSIS
Tourism is recovering faster than the county average, and occupancy has
returned to pre-Ian levels — the demand signal is genuine. However, at
$18,400/yr in annualized flood loss and 5.1% of typical NOI going to
insurance, the carry cost on a bad storm year is material. The permit
environment is quiet (z-score below baseline), which means no near-term
supply shock. The four nearby STRs create moderate competition but not
saturation. On balance: proceed, but negotiate hard for a year-3 exit
option and verify flood insurance terms before signing.

Confidence: 74%
Sources: tourism-swfl · env-swfl · storm-history-swfl · permits-swfl
Freshness: SWFL-7421-v8-20260523
```

---

## 15. Out of scope

- Backend, auth, database, MCP server build itself, brain pipeline
- Analytics / pixel tracking (signups visible in Supabase directly)
- Writing the brain reports themselves (live data, BP owns)
- Mapbox account setup for Saimum's hero (BP provides production token at Milestone 2)
- Building any of the BP HIT LIST items in §12 (BP work, not Saimum's)

---

## 16. Milestones

| #   | Deliverable                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Scenes 1–2 concept (hero 3D topo + data river) — static screens or motion proof                                |
| 2   | Scenes 3–4 built (chart cards wired to BP fixtures + terminal with live freshness fetch + MCP teaser)          |
| 3   | Scenes 5–7 built (`/embed/swfl-map` iframe wired + origin with FMB card + footer/CTA with signups)             |
| 4   | One revision round across all scenes + polish + responsive QA + publish + Framer editor access handed to Ricky |

**Revision policy:** 2 revision rounds per scene included.
**Daily checkpoint:** end-of-day Loom or screenshot — async, no calls.
**Delivery:** published Framer URL + editor access to the Framer project + handed-over code components.

---

## 17. Appendix

### Production URLs (verified 2026-05-24)

- Master brain report page: `https://brain-platform-amber.vercel.app/r/master`
- Chart reference (Gulf-palette example): `https://brain-platform-amber.vercel.app/embed/charts`
- Freshness card reference: `https://brain-platform-amber.vercel.app/embed/footer-token`
- Waitlist endpoint: `POST https://brain-platform-amber.vercel.app/api/waitlist`
- Brain API base (text-speak format): `https://brain-platform-amber.vercel.app/api/b/{brain-id}?view=speak&tier={1|2|3}`
- **JSON output endpoint:** _coming — see §12 item 1_

### Brain IDs the script references (all live)

`master` · `cre-swfl` · `logistics-swfl` · `franchise-outcomes` · `storm-history-swfl` · `permits-swfl`

### Drop-in embed code (copy-paste into Framer Embed blocks)

CSP is already configured — `/embed/*` routes allow iframing from any domain. No whitelist needed.

```html
<!-- Scene 3 — Charts (two charts side-by-side, stacks under 960px) -->
<iframe
  src="https://brain-platform-amber.vercel.app/embed/charts"
  style="border:0;width:100%;height:720px;background:#0A1419"
  loading="lazy"
></iframe>

<!-- Scene 7 — Freshness token card -->
<iframe
  src="https://brain-platform-amber.vercel.app/embed/footer-token"
  style="border:0;width:100%;height:180px;background:#0A1419"
  loading="lazy"
></iframe>

<!-- Scene 7 — Waitlist form -->
<iframe
  src="https://brain-platform-amber.vercel.app/embed/waitlist"
  style="border:0;width:100%;height:120px;background:#0A1419"
  loading="lazy"
></iframe>
```

### Reference assets (committed to this repo — `docs/fiverr-briefs/assets/`)

| File                          | What it is                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Chat-Charts-Standalone.html` | **Open in browser.** Full interactive chart reference — Gulf palette, dark background, correct typography. Shows the ZHVI area chart, corridor bar chart, and metric cards as they should feel. Includes all source code. |
| `Type_Verdict.html`           | **Open in browser.** Bullish / Bearish / Mixed verdict word treatment — color, weight, sizing.                                                                                                                            |
| `Type_MetricStack.html`       | **Open in browser.** Metric label + value pattern — how numbers and labels sit together in a card.                                                                                                                        |
| `Colors_Accent.html`          | **Open in browser.** Brand accent color swatches — gulf-teal, gulf-teal-dim, neutral-gold with usage rules.                                                                                                               |
| `Colors_Direction.html`       | **Open in browser.** Direction signal colors — mangrove (bullish), sunset-coral (bearish), neutral-gold (mixed).                                                                                                          |
| `Colors_Surfaces.html`        | **Open in browser.** Full surface palette — gulf-midnight through gulf-haze, all background and card layers.                                                                                                              |
| `wordmark.svg`                | Full logo — "SWFL DATA GULF" wordmark + wave glyph                                                                                                                                                                        |
| `mark.svg`                    | Glyph only — for icon/favicon use per sizing rules in §10                                                                                                                                                                 |

**Background color — non-negotiable:** Every reference HTML has a dark background (`#0A1419`). The page and all components stay dark. No white backgrounds anywhere.

**Creative direction:** These references show the palette, typographic feel, and component patterns. You are not locked to these exact layouts. The charts in a chat box are constrained — on a landing page they can breathe. Scale them up, blow up the texture, create similar or build on top. Full creative authority within the Gulf palette.

**Logo note:** The wordmark and mark SVGs are the working identity. If you have a concept for the SWFL Data Gulf brand you'd like to propose, bring it to the Milestone 1 review. We're open to it. If no proposal, build against the SVGs above.

FMB sample brain output — inline in §14 above (no file attachment needed)
