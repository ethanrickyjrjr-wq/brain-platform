// lib/social/design/templates.ts
//
// The template library for the AI social author. Each template is a brand-aware
// factory `(tokens, format) => SocialDesign` whose elements are pre-positioned
// within the format's bounds — the human-positioned layout the author picks from.
// Mirrors the email `SEED_DOCS` registry.
//
// LOAD-BEARING: every element carries a DETERMINISTIC, readable id ("headline",
// "stat", "cta", …) — NEVER a minted id. The author shows the model
// `designToSkeleton(build(...))` (ids included), the model returns a patch keyed by
// those ids, then the code instantiates the template AGAIN and `applyDesignPatch`es.
// If ids were minted per call the skeleton ids ≠ instantiation ids, every patch key
// would miss, and the post would ship with placeholder text and no error. Fixed ids
// also make the id easier for the model to echo back.
import { SOCIAL_FORMATS, type SocialFormat } from "@/lib/social/formats";
import type { SocialDesign, SocialElement } from "@/lib/social/design/types";
import { BRAND_FONTS, isFontFamily } from "@/lib/brand/fonts";
import type { FontFamily } from "@/lib/email/doc/types";

export interface TemplateTokens {
  primary: string;
  accent: string;
  text: string;
  logoUrl?: string;
  /** Resolved preview stack (browser canvas) for headlines/kickers. */
  fontDisplay: string;
  /** Resolved preview stack for supporting/caption text. */
  fontBody: string;
  /** Light card surface (sand default). */
  surface: string;
  /** Dark card/canvas surface — dark templates' background. */
  surfaceDark: string;
}

/** brandingToTokens() emits a flat Record — read the 8 slots the canvas uses, with
 *  v1 defaults. Font tokens are FontFamily KEYS resolved through the one registry
 *  (lib/brand/fonts) to browser stacks; an unknown key falls back to the default
 *  family, never raw text. surfaceDark's default equals the old hardcoded primary
 *  default, so unbranded output is pixel-identical. */
export function tokensFromBranding(t: Record<string, string>): TemplateTokens {
  const font = (key: string): string => {
    const v = t[key];
    const fam: FontFamily = v && isFontFamily(v) ? v : "MODERN_SANS";
    return BRAND_FONTS[fam].previewStack;
  };
  return {
    primary: t.PRIMARY || "#0f1d24",
    accent: t.ACCENT || "#0ea5b7",
    text: t.TEXT || "#ffffff",
    logoUrl: t.LOGO_URL || undefined,
    fontDisplay: font("FONT_DISPLAY"),
    fontBody: font("FONT_BODY"),
    surface: t.SURFACE || "#f0ede6",
    surfaceDark: t.SURFACE_DARK || "#0f1d24",
  };
}

export interface SocialTemplate {
  id: string;
  label: string;
  description: string;
  formats: SocialFormat[];
  build: (tokens: TemplateTokens, format: SocialFormat) => SocialDesign;
}

// ── geometry helpers ─────────────────────────────────────────────────────────
// Fonts are sized off min(W,H) so a layout that fits the square also fits the short
// landscape strip (H=630). Vertical stacks are centered, so nothing runs off-canvas
// as long as the stack's total height ≤ H − 2·margin (asserted by the bounds test).
function dims(format: SocialFormat) {
  const { width, height } = SOCIAL_FORMATS[format];
  const W = width;
  const H = height;
  const base = Math.min(W, H);
  const m = Math.round(W * 0.07);
  const cw = W - 2 * m;
  const gap = Math.round(H * 0.03);
  return { W, H, base, m, cw, gap };
}

/** A logo element placed as the first item of a vertical stack (left-aligned), or null. */
function logoItem(
  tk: TemplateTokens,
  W: number,
): { h: number; make: (y: number) => SocialElement } | null {
  if (!tk.logoUrl) return null;
  const w = Math.round(W * 0.2);
  const h = Math.round(w * 0.375);
  const m = Math.round(W * 0.07);
  return {
    h,
    make: (y) => ({ id: "logo", type: "logo", x: m, y, width: w, height: h, src: tk.logoUrl! }),
  };
}

/** Place a list of fixed-height items in a vertically-centered stack within H. */
function stackTop(H: number, totalH: number, m: number): number {
  return Math.max(m, Math.round((H - totalH) / 2));
}

// ── templates ──────────────────────────────────────────────────────────────────

const statHero: SocialTemplate = {
  id: "stat-hero",
  label: "Stat hero",
  description: "One big headline number with a short headline and a call-to-action button.",
  formats: ["square", "portrait", "story"],
  build: (tk, format) => {
    const { W, H, base, m, cw, gap } = dims(format);
    const valueFs = Math.round(base * 0.16);
    const labelFs = Math.round(base * 0.04);
    const statH = valueFs + 8 + labelFs;
    const headFs = Math.round(base * 0.07);
    const headH = headFs * 2;
    const ctaH = Math.round(base * 0.1);
    const logo = logoItem(tk, W);
    const heights = [logo?.h, statH, headH, ctaH].filter((h): h is number => h != null);
    const totalH = heights.reduce((a, b) => a + b, 0) + gap * (heights.length - 1);
    let y = stackTop(H, totalH, m);
    const els: SocialElement[] = [];
    if (logo) {
      els.push(logo.make(y));
      y += logo.h + gap;
    }
    els.push({
      id: "stat",
      type: "stat",
      x: m,
      y,
      width: cw,
      height: statH,
      value: "$0",
      label: "metric label",
      valueFontSize: valueFs,
      labelFontSize: labelFs,
      fill: tk.text,
      accent: tk.accent,
    });
    y += statH + gap;
    els.push({
      id: "headline",
      type: "text",
      x: m,
      y,
      width: cw,
      height: headH,
      text: "Your headline here",
      fontSize: headFs,
      fontFamily: tk.fontDisplay,
      fill: tk.text,
      align: "left",
      fontStyle: "bold",
    });
    y += headH + gap;
    els.push({
      id: "cta",
      type: "cta",
      x: m,
      y,
      width: Math.round(cw * 0.6),
      height: ctaH,
      text: "Learn more",
      url: "",
      fill: tk.accent,
      textFill: tk.primary,
      fontSize: Math.round(base * 0.03),
    });
    return { version: 1, format, background: tk.surfaceDark, elements: els };
  },
};

const headlineCta: SocialTemplate = {
  id: "headline-cta",
  label: "Headline + CTA",
  description: "A bold headline, a supporting line, and a call-to-action button. No stat.",
  formats: ["square", "portrait", "landscape", "story"],
  build: (tk, format) => {
    const { W, H, base, m, cw, gap } = dims(format);
    const headFs = Math.round(base * 0.085);
    const headH = headFs * 2;
    const subFs = Math.round(base * 0.034);
    const subH = subFs * 2;
    const ctaH = Math.round(base * 0.1);
    const logo = logoItem(tk, W);
    const heights = [logo?.h, headH, subH, ctaH].filter((h): h is number => h != null);
    const totalH = heights.reduce((a, b) => a + b, 0) + gap * (heights.length - 1);
    let y = stackTop(H, totalH, m);
    const els: SocialElement[] = [];
    if (logo) {
      els.push(logo.make(y));
      y += logo.h + gap;
    }
    els.push({
      id: "headline",
      type: "text",
      x: m,
      y,
      width: cw,
      height: headH,
      text: "Your headline here",
      fontSize: headFs,
      fontFamily: tk.fontDisplay,
      fill: tk.text,
      align: "left",
      fontStyle: "bold",
    });
    y += headH + gap;
    els.push({
      id: "subhead",
      type: "text",
      x: m,
      y,
      width: cw,
      height: subH,
      text: "A supporting line with a cited figure.",
      fontSize: subFs,
      fontFamily: tk.fontBody,
      fill: tk.text,
      align: "left",
    });
    y += subH + gap;
    els.push({
      id: "cta",
      type: "cta",
      x: m,
      y,
      width: Math.round(cw * 0.6),
      height: ctaH,
      text: "Learn more",
      url: "",
      fill: tk.accent,
      textFill: tk.primary,
      fontSize: Math.round(base * 0.03),
    });
    return { version: 1, format, background: tk.surfaceDark, elements: els };
  },
};

const threeStat: SocialTemplate = {
  id: "three-stat",
  label: "Three stats",
  description: "A kicker line over three side-by-side stats. Good for a market snapshot.",
  formats: ["square", "portrait", "landscape", "story"],
  build: (tk, format) => {
    const { W, H, base, m, cw, gap } = dims(format);
    const kickFs = Math.round(base * 0.045);
    const kickH = kickFs * 2;
    const valueFs = Math.round(base * 0.075);
    const labelFs = Math.round(base * 0.028);
    const statH = valueFs + 8 + labelFs;
    const totalH = kickH + gap + statH;
    let y = stackTop(H, totalH, m);
    const els: SocialElement[] = [];
    els.push({
      id: "kicker",
      type: "text",
      x: m,
      y,
      width: cw,
      height: kickH,
      text: "Market snapshot",
      fontSize: kickFs,
      fontFamily: tk.fontDisplay,
      fill: tk.text,
      align: "left",
      fontStyle: "bold",
    });
    y += kickH + gap;
    const colGap = Math.round(W * 0.03);
    const colW = Math.round((cw - 2 * colGap) / 3);
    (["stat1", "stat2", "stat3"] as const).forEach((id, i) => {
      els.push({
        id,
        type: "stat",
        x: m + i * (colW + colGap),
        y,
        width: colW,
        height: statH,
        value: "$0",
        label: "label",
        valueFontSize: valueFs,
        labelFontSize: labelFs,
        fill: tk.text,
        accent: tk.accent,
      });
    });
    return { version: 1, format, background: tk.surfaceDark, elements: els };
  },
};

const listingFeature: SocialTemplate = {
  id: "listing-feature",
  label: "Listing feature",
  description:
    "A real current listing: a photo/aerial on top, a price-and-beds stat, and a CTA. Pick this only to feature a specific home.",
  formats: ["square", "portrait", "landscape"],
  build: (tk, format) => {
    const { H, base, m, cw, gap } = dims(format);
    const imgH = Math.round(H * 0.5);
    const valueFs = Math.round(base * 0.09);
    const labelFs = Math.round(base * 0.03);
    const statH = valueFs + 8 + labelFs;
    const ctaH = Math.round(base * 0.1);
    const totalH = imgH + gap + statH + gap + ctaH;
    let y = stackTop(H, totalH, m);
    const els: SocialElement[] = [];
    els.push({ id: "image", type: "image", x: m, y, width: cw, height: imgH, src: "" });
    y += imgH + gap;
    els.push({
      id: "stat",
      type: "stat",
      x: m,
      y,
      width: cw,
      height: statH,
      value: "$0",
      label: "3BR/2BA · address",
      valueFontSize: valueFs,
      labelFontSize: labelFs,
      fill: tk.text,
      accent: tk.accent,
    });
    y += statH + gap;
    els.push({
      id: "cta",
      type: "cta",
      x: m,
      y,
      width: Math.round(cw * 0.6),
      height: ctaH,
      text: "See the listing",
      url: "",
      fill: tk.accent,
      textFill: tk.primary,
      fontSize: Math.round(base * 0.03),
    });
    return { version: 1, format, background: tk.surfaceDark, elements: els };
  },
};

export const SOCIAL_TEMPLATES: SocialTemplate[] = [
  statHero,
  headlineCta,
  threeStat,
  listingFeature,
];

export function getTemplate(id: string): SocialTemplate | undefined {
  return SOCIAL_TEMPLATES.find((t) => t.id === id);
}

/** Templates offerable to the author. `listing-feature` is hidden unless a real
 *  featurable listing exists (else the model picks it and has to source price elsewhere). */
export function offerableTemplates(opts?: { hasListing?: boolean }): SocialTemplate[] {
  return SOCIAL_TEMPLATES.filter((t) => t.id !== "listing-feature" || opts?.hasListing);
}
