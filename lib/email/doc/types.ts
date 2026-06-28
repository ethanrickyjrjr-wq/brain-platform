// lib/email/doc/types.ts
//
// Shared static contract for the Email Lab block canvas (Card 00).
// PURE data layer — no React, no imports. Everything downstream imports FROM
// here; this file imports from no one. Runtime validation lives in ./schema.ts
// (which conforms to these types); seed docs + factories live in ./default-docs.ts.
//
// Block prop fields are OPTIONAL by design: props are *options*, never a required
// set (spec → "Tokens are optional, never required"). A build renders only the
// fields it has; the rest fall back to component defaults or simply don't render.
// `stats[]` is the one structural exception (an array of cells).

export type BlockType =
  | "header"
  | "hero"
  | "stats"
  | "signal"
  | "text"
  | "image"
  | "agent-card"
  | "agent-hero"
  | "social-icons"
  | "button"
  | "divider"
  | "footer";

export type TextAlign = "left" | "center" | "right";

export type FontFamily = "MODERN_SANS" | "BOOK_SERIF" | "GEOMETRIC_SANS";

// ── Social platforms ────────────────────────────────────────────────────────
// The eight pre-baked platforms. The runtime registry (label, brand color, URL
// detection, branding-token key) lives in `lib/email/social/platforms.ts` — the
// ONE root both the footer's social row AND the `social-icons` block read from.
// This type stays here (types.ts imports from no one); platforms.ts imports it.
export type KnownPlatform =
  "instagram" | "facebook" | "linkedin" | "x" | "tiktok" | "youtube" | "pinterest" | "threads";

/** A platform in a `social-icons` block: a known platform, or "custom" with a
 *  user-supplied label + resolved logo URL (favicon, else globe glyph). */
export type SocialPlatformType = KnownPlatform | "custom";
export type SocialDisplayMode = "icon" | "text" | "icon+text";
export type SocialLayout = "row" | "column";
export type SocialIconSize = "sm" | "md" | "lg";
export type SocialIconColor = "original" | "brand" | "custom";

// ── Per-block prop interfaces ───────────────────────────────────────────────
// Styling/link/identity fields (bgColor, *Url, companyName, name…) are
// USER-OWNED and sticky — the AI content-patch can never write them
// (enforced in ./schema.ts ContentPatchSchema). The AI writes message content
// only: kicker/value/label/prose/title/body/caption/alt/stats.

export interface HeaderProps {
  logoUrl?: string;
  companyName?: string;
  tagline?: string;
  bgColor?: string;
}

export interface HeroProps {
  kicker?: string;
  value?: string;
  label?: string;
  prose?: string;
  linkUrl?: string;
}

export interface StatItem {
  value: string;
  label: string;
}

export interface StatsProps {
  stats: StatItem[]; // 2–3 KPI cells
}

export interface SignalProps {
  kicker?: string;
  title?: string;
  body?: string;
  bgColor?: string;
  linkUrl?: string;
}

export interface TextProps {
  body?: string;
  align?: TextAlign;
  linkUrl?: string;
}

export interface ImageProps {
  url?: string;
  alt?: string;
  caption?: string;
  /** Distinguishes an auto-injected hero PHOTO ("photo" — a listing/website
   *  og:image) from an auto-injected market CHART (untagged) so the two `image`
   *  blocks coexist: the chart upsert skips kind:"photo". User-owned/sticky —
   *  the AI content-patch can never set it. */
  kind?: "chart" | "photo";
  /** Optional click-through URL — wraps the image in an <a> tag. */
  linkUrl?: string;
}

export interface AgentCardProps {
  photoUrl?: string;
  name?: string;
  title?: string;
  bio?: string;
  phone?: string;
  ctaUrl?: string;
  ctaLabel?: string;
}

/** Full-bleed rectangular agent photo — banner height, name + designation in a
 *  brand-colored strip below. Not a circle. Meant to be the first impression. */
export interface AgentHeroProps {
  photoUrl?: string;
  alt?: string;
  name?: string;
  designation?: string;
  tagline?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

/** One entry in a `social-icons` block. `url` is the destination; `type` selects
 *  the pre-baked icon, or "custom" → render `logoUrl` (resolved) with `label`. */
export interface SocialPlatformEntry {
  type: SocialPlatformType;
  url: string;
  /** Custom platforms: the display name. Known platforms auto-label from the registry. */
  label?: string;
  /** Custom platforms only: favicon-resolved icon URL. */
  logoUrl?: string;
}

/** Standalone social row. `platforms[]` is the structural exception (ordered by
 *  array position — no separate `order` field, one source of truth). The rest
 *  are options with component defaults: icon+text · row · md · original color. */
export interface SocialIconsProps {
  platforms: SocialPlatformEntry[];
  displayMode?: SocialDisplayMode;
  layout?: SocialLayout;
  iconSize?: SocialIconSize;
  iconColor?: SocialIconColor;
  /** Hex — used only when iconColor === "custom". */
  customIconColor?: string;
}

export interface ButtonProps {
  label?: string;
  url?: string;
  bgColor?: string;
}

export interface DividerProps {
  color?: string;
}

export interface FooterProps {
  companyName?: string;
  address?: string;
  websiteUrl?: string;
  phone?: string;
  email?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  linkedinUrl?: string;
  /** Display order of the footer social icons. Only platforms with a URL set
   *  render; omitted → registry default order. Footer always renders icon+text. */
  socialOrder?: KnownPlatform[];
  /** Required for CAN-SPAM. Always rendered when present; block cannot be deleted when it's the last footer. */
  unsubscribeUrl?: string;
}

/** Type-level map from block type → its props shape. Single source for per-type
 *  props, used to derive both `EmailBlock` and the default-props table. */
export interface BlockPropsMap {
  header: HeaderProps;
  hero: HeroProps;
  stats: StatsProps;
  signal: SignalProps;
  text: TextProps;
  image: ImageProps;
  "agent-card": AgentCardProps;
  "agent-hero": AgentHeroProps;
  "social-icons": SocialIconsProps;
  button: ButtonProps;
  divider: DividerProps;
  footer: FooterProps;
}

/**
 * A single block. Discriminated on `type`; `id` is always present post-parse
 * (the schema's transform mints one when absent — ids never come from the model).
 * Built from `BlockPropsMap` so each variant carries its precise props type.
 */
export type EmailBlock = {
  [K in BlockType]: { id: string; type: K; props: BlockPropsMap[K] };
}[BlockType];

/** Narrow `EmailBlock` to a single type's variant (used by block components). */
export type BlockOf<K extends BlockType> = Extract<EmailBlock, { type: K }>;

export interface EmailGlobalStyle {
  primaryColor: string; // e.g. "#0f1d24"
  accentColor: string; // e.g. "#3DC9C0"
  fontFamily: FontFamily;
  textColor: string; // e.g. "#242424"
  backdropColor: string; // e.g. "#F8F8F8"
}

export interface EmailDoc {
  globalStyle: EmailGlobalStyle;
  blocks: EmailBlock[]; // ordered array — index = render order
}
