// lib/email/doc/schema.ts
//
// Runtime validators for the Email Lab block canvas (Card 00). Conforms to
// ./types.ts (the hand-authored static contract). The AI route and the client
// both parse state through these — a malformed/partial payload is REJECTED and
// reported, never coerced into garbage (spec → Pushback 4).
//
// Vendor surface verified IN-SESSION against zod v4 docs (zod.dev, 2026-06-24;
// installed zod 4.4.3 — RULE 0.4):
//   • z.discriminatedUnion("type", [z.object({type: z.literal(...) ...}), …])
//   • z.strictObject({...})  → rejects unknown keys (the AI no-restyle guard)
//   • z.array(x).min(1).max(20)
//   • .transform()           → output type is what z.infer returns
//   • z.record(z.string(), valueSchema)

import { z } from "zod";
import type {
  AgentCardProps,
  AgentHeroProps,
  BlockLayout,
  ButtonProps,
  DividerProps,
  EmailGlobalStyle,
  FooterProps,
  HeaderProps,
  HeroProps,
  ImageProps,
  ListingProps,
  MultiColumnProps,
  SignalProps,
  SocialIconsProps,
  StatsProps,
  TextProps,
} from "./types";

/**
 * Mint a stable block id. Repo-canonical client+server-safe generator
 * (`crypto.randomUUID`, the same call `lib/briefcase/metric-item.ts` uses to id
 * filed items in the browser). NOT `nanoid` — that is not a dependency, and the
 * foundation card may not add one. Ids are minted on arrival, NEVER taken from
 * the model.
 */
export function mintBlockId(): string {
  return `block_${crypto.randomUUID().slice(0, 8)}`;
}

// Colors are free-form CSS strings (hex / rgb / named) — validated as strings,
// not regex-locked, so brand pickers can pass anything CSS accepts.
const color = () => z.string();
const paddingY = () => z.enum(["none", "sm", "md", "lg"]).optional();
const sectionBg = () => z.string().optional();

// ── Per-block prop schemas ──────────────────────────────────────────────────
// `satisfies z.ZodType<…>` ties each schema to its interface in ./types.ts so a
// renamed/dropped field is caught at build time. Field lists are kept in lock-
// step with types.ts; the round-trip test (schema.test.ts) proves no field is
// silently stripped.

const HeaderPropsSchema = z.object({
  logoUrl: z.string().optional(),
  companyName: z.string().max(80).optional(),
  tagline: z.string().max(120).optional(),
  bgColor: color().optional(),
}) satisfies z.ZodType<HeaderProps>;

const HeroPropsSchema = z.object({
  kicker: z.string().max(60).optional(),
  value: z.string().max(24).optional(),
  label: z.string().max(80).optional(),
  prose: z.string().max(500).optional(),
  linkUrl: z.string().optional(),
  paddingY: paddingY(),
  sectionBg: sectionBg(),
}) satisfies z.ZodType<HeroProps>;

const StatItemSchema = z.object({
  value: z.string().max(24),
  label: z.string().max(60),
});

const StatsPropsSchema = z.object({
  stats: z.array(StatItemSchema).min(1).max(3),
  paddingY: paddingY(),
  sectionBg: sectionBg(),
}) satisfies z.ZodType<StatsProps>;

const SignalPropsSchema = z.object({
  kicker: z.string().max(60).optional(),
  title: z.string().max(120).optional(),
  body: z.string().max(500).optional(),
  bgColor: color().optional(),
  linkUrl: z.string().optional(),
  paddingY: paddingY(),
  sectionBg: sectionBg(),
}) satisfies z.ZodType<SignalProps>;

const TextPropsSchema = z.object({
  body: z.string().max(2000).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  linkUrl: z.string().optional(),
  paddingY: paddingY(),
  sectionBg: sectionBg(),
}) satisfies z.ZodType<TextProps>;

const ImagePropsSchema = z.object({
  url: z.string().optional(),
  alt: z.string().max(160).optional(),
  caption: z.string().max(200).optional(),
  kind: z.enum(["chart", "photo"]).optional(),
  linkUrl: z.string().optional(),
  paddingY: paddingY(),
  sectionBg: sectionBg(),
  overlayTitle: z.string().max(120).optional(),
  overlayBody: z.string().max(300).optional(),
  overlayTextColor: z.string().optional(),
  overlayBg: z.string().optional(),
  overlayAlign: z.enum(["left", "center", "right"]).optional(),
}) satisfies z.ZodType<ImageProps>;

const ListingPropsSchema = z.object({
  photoUrl: z.string().optional(),
  price: z.string().max(40).optional(),
  beds: z.string().max(20).optional(),
  baths: z.string().max(20).optional(),
  sqft: z.string().max(24).optional(),
  address: z.string().max(160).optional(),
  badge: z.string().max(40).optional(),
  linkUrl: z.string().optional(),
  paddingY: paddingY(),
  sectionBg: sectionBg(),
}) satisfies z.ZodType<ListingProps>;

const MultiColumnColumnSchema = z.object({
  imageUrl: z.string().optional(),
  heading: z.string().max(120).optional(),
  body: z.string().max(500).optional(),
  linkUrl: z.string().optional(),
  linkLabel: z.string().max(40).optional(),
});

const MultiColumnPropsSchema = z.object({
  columns: z.array(MultiColumnColumnSchema).min(2).max(3),
  paddingY: paddingY(),
  sectionBg: sectionBg(),
}) satisfies z.ZodType<MultiColumnProps>;

const AgentCardPropsSchema = z.object({
  photoUrl: z.string().optional(),
  name: z.string().max(80).optional(),
  title: z.string().max(80).optional(),
  bio: z.string().max(400).optional(),
  phone: z.string().max(40).optional(),
  ctaUrl: z.string().optional(),
  ctaLabel: z.string().max(40).optional(),
}) satisfies z.ZodType<AgentCardProps>;

const AgentHeroPropsSchema = z.object({
  photoUrl: z.string().optional(),
  alt: z.string().max(160).optional(),
  name: z.string().max(80).optional(),
  designation: z.string().max(120).optional(),
  tagline: z.string().max(300).optional(),
  ctaLabel: z.string().max(40).optional(),
  ctaUrl: z.string().optional(),
}) satisfies z.ZodType<AgentHeroProps>;

const KNOWN_PLATFORM_ENUM = [
  "instagram",
  "facebook",
  "linkedin",
  "x",
  "tiktok",
  "youtube",
  "pinterest",
  "threads",
] as const;

const SOCIAL_TYPE_ENUM = [...KNOWN_PLATFORM_ENUM, "custom"] as const;

const SocialIconsPropsSchema = z.object({
  platforms: z
    .array(
      z.object({
        type: z.enum(SOCIAL_TYPE_ENUM),
        url: z.string(),
        label: z.string().max(60).optional(),
        logoUrl: z.string().optional(),
      }),
    )
    .max(12),
  displayMode: z.enum(["icon", "text", "icon+text"]).optional(),
  layout: z.enum(["row", "column"]).optional(),
  iconSize: z.enum(["sm", "md", "lg"]).optional(),
  iconColor: z.enum(["original", "brand", "custom"]).optional(),
  customIconColor: color().optional(),
}) satisfies z.ZodType<SocialIconsProps>;

const ButtonPropsSchema = z.object({
  label: z.string().max(40).optional(),
  url: z.string().optional(),
  bgColor: color().optional(),
}) satisfies z.ZodType<ButtonProps>;

const DividerPropsSchema = z.object({
  color: color().optional(),
}) satisfies z.ZodType<DividerProps>;

const FooterPropsSchema = z.object({
  companyName: z.string().max(80).optional(),
  address: z.string().max(200).optional(),
  websiteUrl: z.string().optional(),
  phone: z.string().max(40).optional(),
  email: z.string().max(100).optional(),
  instagramUrl: z.string().optional(),
  facebookUrl: z.string().optional(),
  linkedinUrl: z.string().optional(),
  socialOrder: z.array(z.enum(KNOWN_PLATFORM_ENUM)).optional(),
  unsubscribeUrl: z.string().optional(),
}) satisfies z.ZodType<FooterProps>;

export const GlobalStyleSchema = z.object({
  primaryColor: z.string(),
  accentColor: z.string(),
  fontFamily: z.enum([
    "MODERN_SANS",
    "BOOK_SERIF",
    "GEOMETRIC_SANS",
    "PLAYFAIR_SERIF",
    "LATO_SANS",
    "MONTSERRAT_SANS",
  ]),
  textColor: z.string(),
  backdropColor: z.string(),
}) satisfies z.ZodType<EmailGlobalStyle>;

// `id` is optional ON THE WAY IN (saved docs carry one; new/AI blocks don't) and
// minted by the transform when absent — so every parsed block has a string id.
const idIn = z.string().optional();

// Optional grid position (paid tier). A strip-mode object merged onto the union via
// `.and()` so a no-`layout` (free-tier) block parses unchanged — `layout` is simply
// absent. The block `id` is the react-grid-layout item `i`.
const LayoutSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  minW: z.number().optional(),
  maxW: z.number().optional(),
  minH: z.number().optional(),
  maxH: z.number().optional(),
  static: z.boolean().optional(),
}) satisfies z.ZodType<BlockLayout>;

const BlockSchema = z
  .discriminatedUnion("type", [
    z.object({ id: idIn, type: z.literal("header"), props: HeaderPropsSchema }),
    z.object({ id: idIn, type: z.literal("hero"), props: HeroPropsSchema }),
    z.object({ id: idIn, type: z.literal("stats"), props: StatsPropsSchema }),
    z.object({ id: idIn, type: z.literal("signal"), props: SignalPropsSchema }),
    z.object({ id: idIn, type: z.literal("text"), props: TextPropsSchema }),
    z.object({ id: idIn, type: z.literal("image"), props: ImagePropsSchema }),
    z.object({ id: idIn, type: z.literal("listing"), props: ListingPropsSchema }),
    z.object({ id: idIn, type: z.literal("multi-column"), props: MultiColumnPropsSchema }),
    z.object({ id: idIn, type: z.literal("agent-card"), props: AgentCardPropsSchema }),
    z.object({ id: idIn, type: z.literal("agent-hero"), props: AgentHeroPropsSchema }),
    z.object({ id: idIn, type: z.literal("social-icons"), props: SocialIconsPropsSchema }),
    z.object({ id: idIn, type: z.literal("button"), props: ButtonPropsSchema }),
    z.object({ id: idIn, type: z.literal("divider"), props: DividerPropsSchema }),
    z.object({ id: idIn, type: z.literal("footer"), props: FooterPropsSchema }),
  ])
  .and(z.object({ layout: LayoutSchema.optional() }))
  .transform((b) => ({ ...b, id: b.id ?? mintBlockId() }));

export const EmailDocSchema = z.object({
  globalStyle: GlobalStyleSchema,
  blocks: z.array(BlockSchema).min(1).max(20),
});

// ── AI content patch ────────────────────────────────────────────────────────
// Text props ONLY, keyed by block id. `z.object` (strip mode) keeps ONLY the declared
// content keys; any non-text key (bgColor / color / *Url / logoUrl / photoUrl /
// companyName / name / globalStyle …) is STRIPPED, not rejected — so the AI still
// "fills content, never restyles, relinks, or restructures" (style/link/identity keys
// never survive the parse, proven in schema.test.ts), while an unexpected extra key
// the model invents (chart_data, items) no longer rejects the WHOLE patch and trips
// "try rephrasing". The route also re-validates the whole doc with EmailDocSchema after
// applying the stripped patch.

const StatPatchSchema = z.object({
  value: z.string().max(24),
  label: z.string().max(60),
});

export const BlockContentPatchSchema = z.object({
  kicker: z.string().max(60).optional(),
  value: z.string().max(24).optional(),
  label: z.string().max(80).optional(),
  prose: z.string().max(500).optional(),
  title: z.string().max(120).optional(),
  body: z.string().max(2000).optional(),
  caption: z.string().max(200).optional(),
  alt: z.string().max(160).optional(),
  tagline: z.string().max(300).optional(),
  stats: z.array(StatPatchSchema).min(1).max(3).optional(),
  overlayTitle: z.string().max(120).optional(),
  overlayBody: z.string().max(300).optional(),
});

export const ContentPatchSchema = z.record(z.string(), BlockContentPatchSchema);

export type ContentPatch = z.infer<typeof ContentPatchSchema>;
export type BlockContentPatch = z.infer<typeof BlockContentPatchSchema>;

// ── AI AUTHOR output (paid tier — build 03) ──────────────────────────────────
// What the AUTHOR model emits. Unlike ContentPatch (which only re-fills text into
// a FIXED skeleton), the author chooses WHICH blocks, in WHAT order, and how they
// group into rows — it composes the whole document.
//
// THE MOAT — the platform's two existing guarantees, composed (no third mechanism):
//   1. Numbers are SELECTED, never written. A number-bearing field carries a
//      `value_figure` (an id into the data MENU); the engine writes that figure's
//      verbatim value. The author literally cannot type a headline/stat number —
//      mirrors lib/assistant/compose-chart.ts ("select rows, never emit cells").
//      Free prose is gated post-hoc by the no-invention lint (gateNarrative
//      philosophy, lib/deliverable/narrative-lint.ts).
//   2. Brand/identity/links are NOT authored. Strip mode (z.object) keeps ONLY the
//      content + semantic-layout keys below; any color / *Url / logoUrl /
//      companyName / name / globalStyle the model emits is DROPPED, never applied
//      (applyBrand overlays brand AFTER — brand stays canonical, ONE root).
//
// LAYOUT IS SEMANTIC, NOT ABSOLUTE. The model emits a column `span` (1–12) and a
// `new_row` flag — it does NOT emit {x,y,w,h}. The engine derives exact, bounds-
// correct grid coordinates from the row grouping (LLMs are unreliable at absolute
// coordinates; deterministic derivation cannot overlap or overflow 12 cols and
// needs no compaction pass — so the engine takes NO react-grid-layout dependency,
// while the canvas (G1) still uses RGL v2: feeding RGL already-tight rows is a
// no-op, so both halves agree).
//
// `type` is a free string (validated at assembly time against the live block
// vocabulary — default-docs' DEFAULT_BLOCK_PROPS, the ONE root, which auto-grows
// when build 05 adds listing/multi-column) to avoid a schema↔default import cycle
// and stay forward-compatible without editing an enum here.

// Authored free-text is TRUNCATED to its cap, never REJECTED. A model that writes
// one paragraph slightly over a limit must NOT discard the whole authored doc —
// that made `callAuthor` return null and the UI report "couldn't author this".
// Caps mirror the final per-field EmailDoc maxima (assembly clamps the few that
// differ, e.g. signal.body 2000→500); this realizes the clamp the author engine
// already intended (author-doc.ts applyContent comment).
const authoredText = (n: number) =>
  z
    .string()
    .transform((s) => s.slice(0, n))
    .optional();

const AuthoredStatSchema = z.object({
  /** Menu id whose verbatim value fills this cell (id-selection moat). */
  value_figure: authoredText(40),
  /** A non-figure cell value (e.g. "Buyer's market"). The engine anchor-checks it at
   *  assembly (author-doc.ts `anchoredStatValue`): a value carrying an UNanchored
   *  number is blanked — so a number here cannot be invented either. */
  value: authoredText(24),
  label: authoredText(60),
});

export const AuthoredBlockSchema = z.object({
  type: z.string().max(40),
  /** Column span 1–12 (12 = full-bleed row). Engine clamps + derives x/w. */
  span: z.number().int().min(1).max(12).optional(),
  /** Start a new visual row (else sit beside the previous block in its row). */
  new_row: z.boolean().optional(),
  // ── content (text only — strip mode drops any key not listed here) ──
  kicker: authoredText(60),
  /** Menu id → the engine writes this figure's verbatim value as the headline. */
  value_figure: authoredText(40),
  label: authoredText(80),
  prose: authoredText(500),
  title: authoredText(120),
  body: authoredText(2000),
  caption: authoredText(200),
  alt: authoredText(160),
  tagline: authoredText(300),
  designation: authoredText(120),
  bio: authoredText(400),
  button_label: authoredText(40),
  align: z.enum(["left", "center", "right"]).optional(),
  /** For an image block: which auto-resolved asset the engine drops in. */
  image_role: z.enum(["chart", "photo"]).optional(),
  stats: z.array(AuthoredStatSchema).max(3).optional(),
});

export const ScheduleSuggestionSchema = z.object({
  cadence: z.enum(["weekly", "monthly"]),
  reason: z.string().max(200),
});

export const AuthorDocSchema = z.object({
  blocks: z.array(AuthoredBlockSchema).min(1).max(20),
  schedule_suggestion: ScheduleSuggestionSchema.optional(),
});

export type AuthoredStat = z.infer<typeof AuthoredStatSchema>;
export type AuthoredBlock = z.infer<typeof AuthoredBlockSchema>;
export type AuthoredDoc = z.infer<typeof AuthorDocSchema>;
