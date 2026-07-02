// lib/email/brand/branding-to-tokens.ts
//
// THE single brand→email mapping — the "one root" bridge. A project's `branding`
// blob (snake_case, edited by BrandingBlock and saved to projects.branding /
// user_brand_profiles) maps to the UPPER token names `applyBrand` reads onto a
// doc's globalStyle + brand-bearing blocks. Both the project Email Lab page
// (server) and the lab's live brand panel call this, so editing brand in the lab
// and editing brand in the project produce the SAME email — one mapping, no fork.
//
// Pure + total: unknown/empty fields are simply skipped. Scope-derived tokens
// (e.g. HERO_LABEL from the project's place/zip) are NOT brand and are added by
// the caller, not here.

/** The four brand colors map 1:1 onto the four EmailGlobalStyle colors. */
const COLOR_TOKENS: Record<string, string> = {
  primary_color: "PRIMARY",
  accent_color: "ACCENT",
  text_color: "TEXT",
  backdrop_color: "BACKDROP",
};

/** Social/URL fields that map straight through to a same-named UPPER token. */
const SOCIAL_TOKENS: Record<string, string> = {
  instagram_url: "INSTAGRAM_URL",
  facebook_url: "FACEBOOK_URL",
  linkedin_url: "LINKEDIN_URL",
  x_url: "X_URL",
  tiktok_url: "TIKTOK_URL",
  youtube_url: "YOUTUBE_URL",
  pinterest_url: "PINTEREST_URL",
  threads_url: "THREADS_URL",
  unsubscribe_url: "UNSUBSCRIBE_URL",
};

import { isFontFamily } from "@/lib/brand/fonts";

/** Map a project/account branding blob → email brand tokens (UPPER keys). */
export function brandingToTokens(
  branding: Record<string, string> | null | undefined,
): Record<string, string> {
  const b = branding ?? {};
  const t: Record<string, string> = {};
  const set = (key: string, token: string) => {
    const v = b[key];
    if (typeof v === "string" && v.trim()) t[token] = v.trim();
  };

  // visual identity
  for (const [key, token] of Object.entries(COLOR_TOKENS)) set(key, token);
  set("logo_url", "LOGO_URL");

  // brand fonts — enum KEYS only (validated); an unknown value is skipped so no
  // user free-text ever reaches email CSS. Surfaces are plain hex pass-throughs.
  const setFont = (key: string, token: string) => {
    const v = b[key];
    if (typeof v === "string" && isFontFamily(v.trim())) t[token] = v.trim();
  };
  setFont("font_display", "FONT_DISPLAY");
  setFont("font_body", "FONT_BODY");
  set("surface_color", "SURFACE");
  set("surface_dark_color", "SURFACE_DARK");

  // agent identity — agent_name feeds COMPANY_NAME (masthead) AND the agent card
  if (b.agent_name && b.agent_name.trim()) {
    t.COMPANY_NAME = b.agent_name.trim();
    t.AGENT_NAME = b.agent_name.trim();
  }
  set("agent_title", "AGENT_TITLE");
  set("agent_bio", "AGENT_BIO");
  set("photo_url", "AGENT_PHOTO_URL");
  set("brokerage", "TAGLINE");

  // contact
  set("contact_email", "CONTACT_EMAIL");
  set("contact_phone", "CONTACT_PHONE");

  // socials + unsubscribe
  for (const [key, token] of Object.entries(SOCIAL_TOKENS)) set(key, token);

  // website doubles as the CTA destination
  if (b.website_url && b.website_url.trim()) {
    t.WEBSITE_URL = b.website_url.trim();
    t.CTA_URL = b.website_url.trim();
  }

  return t;
}
