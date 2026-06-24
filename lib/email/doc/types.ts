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
  | "button"
  | "divider"
  | "footer";

export type TextAlign = "left" | "center" | "right";

export type FontFamily = "MODERN_SANS" | "BOOK_SERIF" | "GEOMETRIC_SANS";

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
}

export interface TextProps {
  body?: string;
  align?: TextAlign;
}

export interface ImageProps {
  url?: string;
  alt?: string;
  caption?: string;
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
  accentColor: string; // e.g. "#1BB8C9"
  fontFamily: FontFamily;
  textColor: string; // e.g. "#242424"
  backdropColor: string; // e.g. "#F8F8F8"
}

export interface EmailDoc {
  globalStyle: EmailGlobalStyle;
  blocks: EmailBlock[]; // ordered array — index = render order
}
