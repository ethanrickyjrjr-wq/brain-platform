// lib/email/brand/apply-brand-style.ts
//
// The globalStyle half of applyBrand, extracted pure so it's testable without
// importing the client shell. applyBrand (components/email-lab/EmailLabShell.tsx,
// the ONE brand-fill root — the grid shell imports it) delegates here.

import type { EmailGlobalStyle } from "@/lib/email/doc/types";
import { isFontFamily } from "@/lib/brand/fonts";

export function brandGlobalStyle(
  gs: EmailGlobalStyle,
  t: Record<string, string>,
): EmailGlobalStyle {
  return {
    ...gs,
    primaryColor: t.PRIMARY || gs.primaryColor,
    accentColor: t.ACCENT || gs.accentColor,
    textColor: t.TEXT || gs.textColor,
    backdropColor: t.BACKDROP || gs.backdropColor,
    fontFamily: t.FONT_BODY && isFontFamily(t.FONT_BODY) ? t.FONT_BODY : gs.fontFamily,
    displayFontFamily:
      t.FONT_DISPLAY && isFontFamily(t.FONT_DISPLAY) ? t.FONT_DISPLAY : gs.displayFontFamily,
    surfaceColor: t.SURFACE || gs.surfaceColor,
    surfaceDarkColor: t.SURFACE_DARK || gs.surfaceDarkColor,
  };
}
