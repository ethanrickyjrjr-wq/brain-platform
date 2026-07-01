# AI Deliverable Design Quality — Research (2026-07-01)

Scope: current (2025-2026) best practices for getting an LLM (Claude, via the Anthropic API) to produce
professional layout/design decisions, chart/graph choices, and social-media graphics when it is authoring
Email Lab deliverables and Social AI posts. This is prompting/design-rule research, distinct from the
render-stack research already done in `docs/superpowers/specs/2026-06-28-email-lab-ai-design-research.md`
(react-grid-layout, Craft.js, Photopea, react-email, Resend, Graphite, Inkscape — not re-covered here).

All facts below were fetched live via crawl4ai (`C:\Users\ethan\crawl4ai-venv\Scripts\python.exe`,
`AsyncWebCrawler`) in this session, per CLAUDE.md RULE 0.4. No Firecrawl, no WebFetch, no memory.

---

## 1. Layout / design rules an LLM can follow reliably

### 1.1 8pt grid + the "internal ≤ external" spacing rule
**Source:** https://cieden.com/book/sub-atomic/spacing/spacing-best-practices (fetched via crawl4ai)

Verbatim facts:
- "The principle of 8pt grid is that it uses multiples of 8 (8, 16, 24, 32, 40, 48, 56, etc.) to layout,
  dimensions, padding, and margin of elements."
- **Internal ≤ external rule**: "the space around elements (external) should be equal to or, ideally,
  greater than the space within them (internal)." This is explicitly grounded in Gestalt proximity —
  elements spaced closely are perceived as one group, elements spaced apart are perceived as separate.
- Concrete implementation numbers given: 12-column layout with a 24px gutter (Bootstrap-standard); a
  1440px desktop artboard gets a 60px margin on each side; vertical rhythm/element height uses 8px
  multiples; line-height should be a multiple of 8 (or, for finer control, a multiple of 4: 4, 8, 12, 16…).
- Three-step workflow given for applying it: (1) start from the 8px grid, (2) apply internal ≤ external
  within that grid, (3) adjust contextually — bigger elements/sections get more external space, never less
  than their own internal padding.

**Applies to Email Lab / Social AI:** This is a rule an LLM can mechanically check, not just aspire to —
it's the single most "codeable" design instruction found. Bake it into the system prompt as a hard
constraint: "all spacing values (padding, margin, gaps between grid blocks) must be multiples of 8px (4px
allowed for line-height/fine typography only); the margin around any grid block must be ≥ the padding
inside it." This turns "make it look professional" into something the AI can self-verify against the JSON
layout it emits before returning it, and it maps directly onto react-grid-layout's `margin`/`padding` grid
props already in use.

### 1.2 Material Design 3 — grouping/rhythm/proximity + type scale ratio
**Sources:**
- https://m3.material.io/foundations/layout/understanding-layout/spacing (fetched via crawl4ai)
- https://m3.material.io/styles/typography/type-scale-tokens (fetched via crawl4ai)

Verbatim facts:
- Grouping principles for visual hierarchy, stated as concrete named techniques: **explicit grouping**
  (outlines/dividers/shadows around related items), **implicit grouping** (proximity + open space alone,
  e.g. a carousel), **rhythm** (consistent spacing between repeating elements even when their height
  varies — "cards should maintain consistent horizontal spacing to establish a strong rhythm when their
  height varies"), **similarity** (same-sized/aligned leading elements — thumbnails, avatars, icons — to
  signal relatedness), **proximity** (e.g. "Reply" and "Reply all" buttons placed close to the content they
  act on), **continuity** (related items placed in one container/row/column), and **negative space** used
  deliberately to give the most important content "the brightest surfaces" and emphasis.
- **Type scale ratio**: "Material Design uses the Major Second (1.125) type scale with 14 as its key base
  size." (Confirmed verbatim on the M3 site itself, not just a third-party summary — it links out to
  cieden.com's type-scale-ratio glossary for the definition of "Major Second".) M3 ships 15 baseline +
  15 emphasized type styles (Display → Headline → Title → Body → Label), and explicitly warns: "Sizes on
  the rendered type scale should aim to provide impactful contrast between sizes by avoiding small
  differences" — i.e. don't pick two adjacent scale steps that look the same.
- Font-size unit conversion given verbatim: web rem = sp/16 (16px default root), e.g. 24sp → 1.5rem.

**Applies to Email Lab / Social AI:** Give the LLM a small, named vocabulary instead of vague adjectives.
Instead of prompting "make the hierarchy clear," prompt with the specific technique names above — "use
implicit grouping (proximity, no border) for the stat block; use explicit grouping (card + divider) to
separate the CTA from the narrative body" — because LLMs follow named, citable rules far more reliably than
open-ended aesthetic language. For typography, hardcode a fixed type scale (e.g. Major-Second-derived: 14 /
15.75 / 17.7 / 19.9 / 22.4 / 25.2px) as selectable tokens in the Email Lab schema rather than letting the
LLM invent arbitrary font sizes — this closes off the most common LLM typography failure mode (near-
identical sizes with no real contrast).

### 1.3 LLM-specific UI-generation discipline (not generic design advice)
**Source:** https://sampiercelolla.com/tips-for-getting-llms-to-write-good-ui-code/ (fetched via crawl4ai,
Jan 2026 post)

Verbatim/paraphrased facts:
- "LLMs on their own don't do design consistency well" — getting good UI out of an LLM requires "design
  hygiene, good tooling, and context management," not just a better prompt.
- Concrete technique: **a single small markdown component/token index file** the LLM reads before every
  generation ("Make one markdown file that lists and explains all UI components... small enough for any
  reasonable context window"), referenced from a system-level instruction file (their example:
  `agents.md` saying "Use the design system in /design-system... Do not write new UI components inline").
- **Remove LLM footguns from the schema itself**: e.g. a freeform `className` prop is what an LLM reaches
  for to bypass design-system constraints; replace freeform styling props with closed semantic enums
  (`variant="destructive"` instead of `className="bg-red-500"`). "LLMs will use whatever props are
  available to them, so design your component API accordingly."
- Recommends a **linter pass** the LLM can run and self-correct against (e.g. "always use semantic color
  classes," "use heading components over literal text sizing") — "trust but verify," because LLMs "don't
  always get it right on the first shot" but can fix flagged violations.

**Applies to Email Lab / Social AI:** This is the most directly actionable finding for the product. The
Email Lab / Social AI schema should expose a **closed set of design tokens** (spacing steps, the type
scale from 1.2, an approved color-role enum, approved block "variants") rather than open CSS-like fields —
this is a schema decision, not a prompting trick, and it structurally prevents the AI from inventing
off-grid spacing or off-palette colors. Pair it with a deterministic post-generation validator (spacing
values are 8px multiples, contrast ratios meet 1.4.3/1.4.11 — see §2.2) that either auto-corrects or
forces a regeneration, mirroring this repo's existing `spec-validator` / `facts-only-lint` gate pattern.

---

## 2. AI-driven chart/graph generation from real data (marketing/report context)

### 2.1 Choosing chart type by data shape
**Source:** https://www.atlassian.com/data/charts/essential-chart-types-for-data-visualization (fetched
via crawl4ai)

Verbatim facts, decision rules the LLM can apply mechanically to a data shape:
- **Bar chart**: "values are indicated by the length of bars, each of which corresponds with a measured
  group." Horizontal orientation "is a good option when you have a lot of bars to plot, or the labels on
  them require additional space to be legible."
- **Line chart**: for "changes in value across continuous measurements, such as those made over time" —
  the up/down movement itself communicates positive/negative change and supports trend extrapolation.
- **Scatter plot**: for "the relationship between... two numeric variables" — correlation strength/
  direction, and for spotting outliers/gaps.
- **Histogram**: when bar-chart groups are actually continuous numeric ranges (push the bars together);
  bar length = count/frequency, distinguishing it from a bar chart of a non-frequency value.
- **Stacked bar chart**: compares primary group totals AND shows the breakdown of each group into parts.
- **Grouped (clustered) bar chart**: sacrifices primary-group-total comparison for easier sub-group-to-
  sub-group comparison — explicit trade-off the LLM should reason about, not just pick one at random.
- **Dot plot**: like a bar chart but by position, not length — useful "when the zero baseline is not
  informative," and works with unordered categorical variables (unlike a line chart).
- **Area chart**: line chart foundation + shaded fill, most useful combined with stacking to show both a
  changing total over time and its components' changing contributions.
- **Pie chart**: called out (via the linked companion guide "How to choose between a bar chart and pie
  chart") as something to reach for cautiously and mainly for part-to-whole share, not general comparison.

**Applies to Email Lab / Social AI:** Encode this as a literal decision table in the chart-generation
system prompt / tool schema, keyed on the data's actual shape (not vibes): time-series numeric → line;
categorical counts, few categories → bar; categorical counts, many categories or long labels → horizontal
bar; two continuous numeric variables → scatter; continuous numeric distribution → histogram; part-to-
whole with ≤ ~5 slices → pie (else bar); category broken into sub-parts over time → stacked/grouped bar or
stacked area depending on whether the total-over-time or the sub-group comparison matters more. This
removes the single most common failure mode in AI chart generation — picking a chart type that doesn't
match what the underlying SWFL lake data (permits, DOM, price trends, ZIP counts) actually is.

### 2.2 Accessible color palettes for data viz + contrast minimums
**Sources:**
- https://xdgov.github.io/data-design-standards/components/colors (US federal government data-design
  standard, fetched via crawl4ai)
- https://webaim.org/articles/contrast/ (fetched via crawl4ai, standing in for the W3C WCAG 2.2
  Understanding doc, which is Cloudflare-gated against automated fetch — WebAIM quotes the criterion text
  verbatim and is the community-standard secondary reference)

Verbatim facts:
- **Three palette types, chosen by data type** — this is the load-bearing rule: **sequential** (single hue,
  light→dark) "can be used when data values can be ordered from low to high... most commonly used to
  render a single category of data, such as a bar chart"; **qualitative** (categorical, no inherent order,
  e.g. gender/race) — "try using colors with just enough variance in their hue and brightness to ensure all
  of the categories are represented similarly," with an optional single highlight color used "with
  caution" to bias attention toward one category; **diverging** (two hues radiating from a meaningful
  midpoint, e.g. above/below a threshold).
- Contrast requirement stated with citation: "text and interactive elements should have a color contrast
  ratio of at least 4.5:1" (WCAG), plus explicit tooling recommendation: ColorBrewer (colorbrewer2.org) for
  508-compliant categorical/sequential/diverging palettes, WebAIM's contrast checker for custom
  combinations.
- **WCAG 1.4.3 (Contrast Minimum, Level AA)**, quoted verbatim: "The visual presentation of text and images
  of text has a contrast ratio of at least 4.5:1," except **large text** (defined precisely: "18pt and
  larger, or 14pt and larger if it is bold") which drops to **3:1**. Level AAA tightens this to 7:1 / 4.5:1
  but AA is the legally-referenced bar.
- **WCAG 1.4.11 (Non-text Contrast, Level AA)**, quoted verbatim: "The visual presentation of the
  following have a contrast ratio of at least 3:1 against adjacent color(s)" — this is the one that
  applies directly to chart elements (a pie wedge against its neighbor, a bar against its background), not
  just to text.
- A concrete self-test given: view the visualization in grayscale — if categories become indistinguishable
  there, they'll be indistinguishable to a colorblind viewer regardless of palette; label data directly
  rather than relying on color alone as a second line of defense.

**Applies to Email Lab / Social AI:** Wire palette-type selection into the same decision layer as chart-
type selection in §2.1: the LLM should pick sequential/qualitative/diverging based on the *data's*
structure, not the brand palette's vibe, then apply the brand hue *within* that structural choice. Add an
automated post-generation contrast check (3:1 between adjacent chart elements per 1.4.11, 4.5:1 for any
in-chart text labels per 1.4.3) as a hard gate before a chart ships in a deliverable or social graphic —
this is a cheap, deterministic check that catches the most common "looks fine to me, illegible to ~8% of
male viewers" failure in AI-generated charts.

---

## 3. AI-generated social media graphics — platform-specific rules

### 3.1 Current (2026) platform dimensions
**Source:** https://www.canva.com/sizes/instagram/ (fetched via crawl4ai; Canva's public Design Wiki, a
well-known design-platform best-practice reference)

Verbatim facts:
- Instagram square post: up to **1080 × 1080px** (legacy cap was 640px square — full resolution now
  matters for image quality).
- Instagram portrait feed post: **1080 × 1350px**. Instagram landscape feed post: **1080 × 566px**
  (both held to 1080px width).
- Instagram Stories: **1080 × 1920px** (9:16), scalable down at the same ratio to 900×1600 or 720×1280.

These match the four platform sizes the product brief already targets (square 1080×1080, portrait
1080×1350, landscape 1200×630, story 1080×1920) — landscape 1200×630 is the Open Graph link-preview
standard rather than an Instagram-native size (confirmed separately via WebSearch against Meta's own
link-preview behavior), so it's correct to keep it as a distinct "link card" format rather than folding it
into the Instagram-native landscape spec.

### 3.2 Safe zones and the March-2026 Meta unification
**Source:** https://billo.app/blog/meta-ads-safe-zones/ (fetched via crawl4ai; cites Meta's own
business.facebook.com ad-guide pages inline, dated March 2026 — the most current safe-zone spec found)

Verbatim facts:
- **As of March 2026, Meta unified the safe zone across Facebook Stories, Facebook Reels, Instagram
  Stories, and Instagram Reels into a single 9:16 rule set** — one correctly designed vertical asset now
  works across all four placements.
- Exact unified margins, stated against a 1440×2560 production canvas (scales linearly to 1080×1920):
  **top 14% (~358px safe-zone exclusion)**, **bottom 20%–35% (~512–896px)** — the range exists because Reels
  captions expand with length, so "conservative teams should treat the full 35% (896px) as the danger
  zone" — and **sides 6% each (~87px)**.
- Stories-only (no Reels cross-post) safe zone is smaller: top **14% (~358px)** and bottom **14% (~358px)**
  only — no side margins needed for pure Stories.
- **Center all critical content within the middle ~80% of the horizontal canvas** to survive Meta's
  automatic "Smart Zoom" (crop) or "Letterbox" (black-bar) handling on ultra-tall 20:9 devices, since the
  advertiser cannot choose which of the two Meta applies.
- 2026 aspect-ratio shift, with cited performance deltas: Meta now recommends **4:5 (not 1:1)** for
  Instagram Feed single-image ads and **9:16** for video — "a 4:5 image occupies approximately 31% more
  vertical screen space than a square," delivering "approximately 1% higher CTR" for images and "7% higher
  CTR" for 9:16 video versus square/16:9.

**Applies to Email Lab / Social AI:** The safe-zone numbers should become hard layout constraints in the
Social AI composer, not suggestions the LLM might honor: reserve the top 14% and bottom 35% of every
1080×1920 canvas as a no-text/no-logo exclusion zone by default (the conservative Reels-compatible number,
since a Story asset may get cross-posted as a Reel), and keep all text within the center 80% width. Given
Meta's 2026 push away from 1:1 toward 4:5/9:16, the Social AI's default output format should shift
accordingly — square should stop being the fallback default for Instagram feed posts. This is a case where
platform-vendor guidance actively changed in early 2026, which is exactly the kind of drifted spec RULE 0.4
exists to catch rather than trust from training-data memory.

---

## Sources (all fetched live via crawl4ai this session)

1. https://cieden.com/book/sub-atomic/spacing/spacing-best-practices — 8pt grid + internal ≤ external rule
2. https://m3.material.io/foundations/layout/understanding-layout/spacing — Material Design 3 grouping/rhythm/proximity
3. https://m3.material.io/styles/typography/type-scale-tokens — Material Design 3 type scale (Major Second, 1.125, base 14sp)
4. https://sampiercelolla.com/tips-for-getting-llms-to-write-good-ui-code/ — LLM-specific UI generation discipline
5. https://www.atlassian.com/data/charts/essential-chart-types-for-data-visualization — chart-type-by-data-shape decision rules
6. https://xdgov.github.io/data-design-standards/components/colors — US federal sequential/qualitative/diverging palette standard
7. https://webaim.org/articles/contrast/ — WCAG 1.4.3 / 1.4.11 contrast ratios quoted verbatim
8. https://www.canva.com/sizes/instagram/ — current Instagram post/story pixel dimensions
9. https://billo.app/blog/meta-ads-safe-zones/ — March 2026 unified Meta safe-zone specs + aspect-ratio shift
