// lib/email/blocks/styles.ts
//
// Shared style atoms for the pure block components. No React — just constants +
// a font-family resolver, so blocks stay consistent across the canvas DOM view
// and the server render() export.

import type { FontFamily } from "../doc/types";

const FONT_STACKS: Record<FontFamily, string> = {
  MODERN_SANS: "Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif",
  BOOK_SERIF: "Georgia, 'Times New Roman', Times, serif",
  GEOMETRIC_SANS: "'Century Gothic', 'Trebuchet MS', Futura, sans-serif",
};

export function fontStack(family: FontFamily): string {
  return FONT_STACKS[family];
}

export const SECTION_PAD = "20px 24px";
export const MUTED = "#6B7280";
export const BORDER = "#E5E7EB";
export const CARD_BG = "#ffffff";
