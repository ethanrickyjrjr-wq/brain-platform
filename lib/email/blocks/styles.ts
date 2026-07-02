// lib/email/blocks/styles.ts
//
// Shared style atoms for the pure block components. No React — just constants +
// a font-family resolver, so blocks stay consistent across the canvas DOM view
// and the server render() export.

import { BRAND_FONTS } from "@/lib/brand/fonts";
import type { FontFamily, PaddingSize } from "../doc/types";

// Stacks + webfont URLs live in lib/brand/fonts.ts (the one font root, wave 2) —
// this module keeps its export shape and derives from the registry.
export function fontStack(family: FontFamily): string {
  return BRAND_FONTS[family].stack;
}

/** Google Fonts CSS2 <link> URLs for web-font families — derived from the one font root. */
export const WEB_FONT_URLS: Partial<Record<FontFamily, string>> = Object.fromEntries(
  Object.entries(BRAND_FONTS).flatMap(([k, v]) => (v.webfontUrl ? [[k, v.webfontUrl]] : [])),
);

const PAD_Y: Record<PaddingSize, string> = {
  none: "0px 28px",
  sm: "12px 28px",
  md: "24px 28px",
  lg: "36px 28px",
};

export function sectionPad(paddingY?: PaddingSize): string {
  return PAD_Y[paddingY ?? "md"];
}

export const SECTION_PAD = "24px 28px";
export const MUTED = "#6B7280";
export const BORDER = "#E5E7EB";
export const CARD_BG = "#ffffff";
