# Task B — WCAG contrast + palette-type: FIRST-PARTY verification (2026-07-01)

**Target B** of the AI-deliverable-design-quality work (handoff:
`2026-07-01-design-quality-BCD-handoff.md`). Re-verifies every load-bearing external number by fetching
the **authoritative W3C source live via crawl4ai this session** (`C:\Users\ethan\crawl4ai-venv`,
`AsyncWebCrawler` + `UndetectedAdapter`, `enable_stealth`), per RULE 0.4 — because the source research doc
(§2.2) used **WebAIM as a proxy** for the Cloudflare-gated W3C pages. The UndetectedAdapter cleared the
Cloudflare JS challenge that the plain adapter could not (plain: 307/403; undetected: 200).

## What W3C's OWN normative text states (verbatim, fetched 2026-07-01)

**Source: `https://www.w3.org/TR/WCAG22/` (200, 304 KB via UndetectedAdapter) — Appendix A definitions.**

**Relative luminance (sRGB), verbatim:**
> "the relative luminance of a color is defined as `L = 0.2126 * R + 0.7152 * G + 0.0722 * B` where R, G and B are defined as:
> - if RsRGB <= 0.04045 then R = RsRGB/12.92 else R = ((RsRGB+0.055)/1.055) ^ 2.4
> - if GsRGB <= 0.04045 then G = GsRGB/12.92 else G = ((GsRGB+0.055)/1.055) ^ 2.4
> - if BsRGB <= 0.04045 then B = BsRGB/12.92 else B = ((BsRGB+0.055)/1.055) ^ 2.4
> and RsRGB = R8bit/255, GsRGB = G8bit/255, BsRGB = B8bit/255."

> Note 2: "Before May 2021 the value of 0.04045 ... was 0.03928 ... It has no practical effect on the calculations."

**Contrast ratio, verbatim:**
> "`(L1 + 0.05) / (L2 + 0.05)`, where L1 is the relative luminance of the lighter of the colors, and L2 is
> the relative luminance of the darker of the colors."
> "Contrast ratios can range from 1 to 21 (commonly written 1:1 to 21:1)."

**SC 1.4.3 Contrast (Minimum) — Level AA, verbatim:**
> text/images of text: **4.5:1**; **large-scale** text (≥18pt, or ≥14pt bold): **3:1**. (Logos/incidental exempt.)

**SC 1.4.11 Non-text Contrast — Level AA, verbatim:**
> "The visual presentation of the following have a contrast ratio of at least **3:1** against adjacent
> color(s)" — governs **graphical objects** (chart bars/wedges/lines) and UI component states. This is the
> criterion that applies to chart *elements*, not just chart text.

## Palette-type rule (federal data-design standard — first-party fetched, secondary-authoritative)

**Source: `https://xdgov.github.io/data-design-standards/components/colors` (200, 16 KB).**

| Palette | When (verbatim gist) |
|---|---|
| **Sequential** | "data values can be ordered from low to high" — one hue, lower=lighter/higher=darker; "single category ... such as a bar chart" |
| **Qualitative** | "categorical data ... that has no inherent sequential order" (gender/race); "just enough variance in hue and brightness"; optional highlight color "with caution" |
| **Diverging** | ordered data with "a significant break point"; two end hues, "middle value ... represented as a neutral color" |

> WCAG line, verbatim: "text and interactive elements should have a color contrast ratio of at least
> **4.5:1**." Tooling: **colorbrewer2.org** for 508-compliant palettes; grayscale self-test ("if categories
> become indistinguishable in grayscale, they'll be indistinguishable to a colorblind viewer").

## Evidence tiers (for the spec)

| Fact | Tier | Treatment |
|---|---|---|
| Relative-luminance sRGB formula (0.2126/0.7152/0.0722; 0.04045; /12.92; ^2.4) | **W3C first-party, verbatim** | HARD code constants. Cite W3C TR/WCAG22 Appendix A. |
| Contrast ratio `(L1+0.05)/(L2+0.05)`, range 1–21 | **W3C first-party, verbatim** | HARD. |
| 4.5:1 text / 3:1 large-text (1.4.3); 3:1 non-text (1.4.11) | **W3C first-party, verbatim** | Gate thresholds. 1.4.11 = the chart-element gate. |
| Sequential / qualitative / diverging selection rule | federal std, first-party fetched | Decision table; label as fed standard, not W3C. |
| colorbrewer2.org 508-safe palettes | federal std | Seed source for accessible palettes. |

## Code ground-truth reconciled this session (RULE 0.5)

**Greenfield confirmed.** Grep `wcag|contrast|luminance|readableText|4.5:1|3:1` → only:
- Two `readableText(bg)` heuristics — `lib/email/templates/charts/chart-renderer.ts:97` and
  `lib/email/templates/components/_shared.ts:55` (badge). Both **rec601 luma**, not WCAG relative
  luminance. No `(L1+0.05)/(L2+0.05)` anywhere.
- WCAG mentions are **comments only**: 1.4.1 color-alone (`series.ts:6,30`, `types/viz.ts:98`), 2.5.5
  tap-target (`FactChip.tsx:43`, `metrics-table.tsx:152`). No ratio math.

**Locked gulf palette measured against the new formula (this session):**
`#3DC9C0` teal / `#5bc97a` mangrove / `#d4b370` gold (`lib/charts/series.ts:11-13`).

| Pair / relation | Ratio | 1.4.11 (≥3:1)? |
|---|---|---|
| teal vs mangrove (adjacent) | **1.02:1** | FAIL |
| teal vs gold (adjacent) | **1.02:1** | FAIL |
| mangrove vs gold (adjacent) | **1.04:1** | FAIL |
| teal vs white bg | **2.04:1** | FAIL |
| mangrove vs white bg | **2.08:1** | FAIL |
| gold vs white bg | **2.00:1** | FAIL |
| ink `#0a2540` on any fill (text) | **7.4–7.8:1** | PASS 1.4.3 |
| white on any fill (text) | **2.0:1** | FAIL 1.4.3 |

**Load-bearing consequence for the design:** the brand palette is **iso-luminant by identity** and already
documents this — `series.ts:5-7` uses `dash` (SVG strokeDasharray) as the WCAG-1.4.1 second channel *on
purpose*. So a gate that force-swaps colors to hit 3:1 adjacency would **recolor every branded SWFL chart**
(blast radius the handoff flagged). The gate must instead accept a **non-color second channel (dash /
pattern / direct label)** as the 1.4.11 escape valve — which is exactly what the code already does — and
reserve palette *generation* for surfaces without locked brand series (LLM-composed chat charts, single-
accent email charts). `readableText`'s rec601 pick happens to land correct here (ink, ~7.5:1) but is not a
real WCAG check and should be replaced by the real one.

Fetched via crawl4ai only; no Firecrawl, no WebFetch, no memory. Contrast ratios computed with the verbatim
W3C formula above.

---

## ADDENDUM — perceptual color distance for "not too close in similarity" (2026-07-01)

After operator scope-correction, Task B is **not** a WCAG send-blocker. It is a **palette-extension helper**:
brand colors are always applied as-is; the system only generates the *extra* fills a chart needs beyond the
brand, and those extras must be (a) visible against the background, (b) distinct from each other, (c) not so
close to the brand/chosen colors that they blur together — kept simple (a minimum-separation floor, not
near-tone harmony). "Too close in similarity" between two colors of similar brightness but different hue is a
**perceptual color-distance** question, not a WCAG-luminance one — so a second first-party pass was run.

**Source: `https://bottosson.github.io/posts/oklab/` (200, 26 KB) — Björn Ottosson, the author of OKLab
(2020). Linear-sRGB→OKLab, verbatim (matrices updated 2021-01-25):**
```
l = 0.4122214708 r + 0.5363325363 g + 0.0514459929 b   (r,g,b = LINEAR sRGB — reuse WCAG gamma-expansion)
m = 0.2119034982 r + 0.6806995451 g + 0.1073969566 b
s = 0.0883024619 r + 0.2817188376 g + 0.6299787005 b
l_=cbrt(l); m_=cbrt(m); s_=cbrt(s)
L = 0.2104542553 l_ + 0.7936177850 m_ - 0.0040720468 s_
a = 1.9779984951 l_ - 2.4285922050 m_ + 0.4505937099 s_
b = 0.0259040371 l_ + 0.7827717662 m_ - 0.8086757660 s_
```
OKLab is perceptually uniform (Euclidean distance ≈ perceived difference), D65 whitepoint, L∈[0,1]. It is
the modern replacement for CIELAB ΔE and is now in CSS Color 4 (`oklch()`). Chosen because generating "extra
colors in the same scheme, distinguishable" is naturally **even hue steps in OKLCH at the brand's L/C**.

**Source: `https://en.wikipedia.org/wiki/Color_difference` (200, 83 KB; citing CIE):**
> "All ΔE* formulae are originally designed to have the difference of 1.0 stand for a JND." … "the revision
> of CIE76 ΔE*ab JND to **2.3** being an example" — "ΔE*ab ≈ 2.3 corresponds to a JND (just noticeable
> difference)."

**Evidence-tier for the threshold:** the JND *principle* (ΔE=1 convention, 2.3 CIE76) is first-party-cited,
but it is in **CIELAB** units (L 0–100), not OKLab (L 0–1), and a single JND is "barely noticeable side by
side" — far too tight for categorical chart colors that must read as clearly distinct. So the spec's minimum
OKLab separation floor is a **conservative, tunable product constant** grounded in the JND principle (a
comfortable multiple of a JND), explicitly labeled as our choice — NOT presented as a first-party number.
The primary distinctness mechanism is **even hue spacing in OKLCH (360°/N)**, which guarantees separation by
construction; the ΔE floor is only a backstop guard (few colors, or a generated hue landing near the brand).

**Design consequence:** the WCAG luminance math (above) answers "can it be seen against the background" +
"which label color is legible on this fill"; OKLab distance answers "are two fills too similar." Both live
inside the generator; neither ever blocks a send or touches brand colors or images.

---

## ADDENDUM 2 — "best way for AI + user" best-practice pass (2026-07-01)

Operator asked for how good companies actually do palette distinctness + auto text-color. Six first-party
sources fetched live via crawl4ai (undetected). All 200/301-OK.

**Q1 — is there a magic `MIN_OKLAB_DISTANCE`? No. The mechanism matters more than the number.**
- `colorjs.io/docs/color-difference` (Lea Verou + Chris Lilley, **CSS Color 4/5 co-editors** — authoritative)
  verbatim: "Euclidean distance … as long as the measurement is done in a **perceptually uniform color
  space**"; "**For most DeltaE algorithms, 2.3 is considered the Just Noticeable Difference (JND)**." That
  2.3 is the ONLY first-party number and it is CIELAB-scale + "barely noticeable side by side" — far too
  tight for categories that must read as *clearly* distinct. There is no first-party "clearly distinct"
  threshold; anything above JND is practitioner judgment.
- `blog.datawrapper.de/beautifulcolors` (Datawrapper — a leading data-viz company) — the load-bearing rule:
  distinctness comes from **lightness, not just hue**. Verbatim: neighboring elements with "the same
  lightness" is a bug — "convert your colors to black & white … If they all have the same gray, they're the
  same lightness." Also: "don't dance all over the color wheel" (few hues + neighbors, not all-wheel);
  "**Change the saturation and lightness first** [before adding a hue]"; warm colors + blue are versatile
  AND colorblind-safe (blue vs orange/red distinguishable); **pure green is colorblind-risky** vs red/orange
  — shift green toward yellow or blue.
- **This is the same failure I measured**: the gulf palette is iso-luminant (1.02:1) → identical in
  grayscale → the exact anti-pattern Datawrapper names. So generated extras MUST vary lightness, not rotate
  hue at constant L.

**Q1 verdict:** primary mechanism = vary **hue AND lightness** (grayscale-distinct), few hues + neighbors,
not constant-L rotation. Backstop = a minimum perceptual distance in OKLab, floor anchored to the 2.3 JND
and set to a conservative multiple, **labeled our tunable choice, not a first-party number** (FOCUS rule 1).

**Q4 — how many distinct categorical colors? Cap + graceful fallback.**
- `spectrum.adobe.com` (Adobe) verbatim: "**Use up to 6 categorical colors** … become more difficult to
  comprehend starting at 6 colors, and extremely difficult … at 12. If you have a need for more than 6 …
  try alternative visual encoding, such as position." Its 6-color palette is "optimized to be
  distinguishable for users with color vision deficiencies."
- `carbondesignsystem.com` (IBM Carbon): categorical sequence "carefully curated to **maximize contrast
  between neighboring colors**"; offers fixed palettes "if the exact number of data categories is
  predictable."
- `observablehq.com/@d3/color-schemes` (D3): the de-facto categorical schemes cap at ~10 — **Tableau10,
  Category10, Observable10** (10); Set2/Dark2 (8); Paired (12).
- **Verdict:** soft cap 6 (recommended), hard practical cap ~10. Beyond the cap, stop adding hues → ramp
  lightness / group "other", but ALWAYS still render (never refuse — FOCUS rule 4).

**Q2 — auto text color: WCAG 2 or APCA?**
- `git.apcacontrast.com` (APCA / Myndex): APCA is the perceptually-accurate model and is "**the candidate
  … for WCAG 3 [which] is still in development**." It shows WCAG 2's real weakness: "4.5:1 can be
  functionally unreadable when a color is near black" (dark-mode/near-black). APCA reports Lc 0–105+ (Lc 75
  min body text, Lc 90 preferred).
- **Verdict:** APCA is not ratified — adopting a draft as a hard dependency is premature. `readableLabel` is
  a **binary pick** (ink vs white), where WCAG 2 and APCA agree on the winner in nearly all cases; the
  divergence is at absolute thresholds, which we don't rely on. **Use stable WCAG 2 relative-luminance now;
  leave a code note to revisit APCA when WCAG 3 ratifies.**

**Q3 — generation color space: OKLCH.** colorjs.io confirms a perceptually-uniform space is required for
meaningful distance; OKLab/OKLCH is that family and the modern CSS Color 4 choice. Keep OKLCH.

**Q5 — colorblind safety: cheap wins only (respect "keep simple").** No full CVD simulator now. Two
free wins folded in: (a) lightness variation (already mandatory from Q1 — the grayscale test doubles as a
CVD test), (b) prefer blue↔warm hue separation, avoid pure red-green adjacency when generating. Full
deuteranopia/protanopia simulation = future, out of MVP scope.
