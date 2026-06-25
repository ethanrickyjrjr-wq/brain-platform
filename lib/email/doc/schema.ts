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
  ButtonProps,
  DividerProps,
  EmailGlobalStyle,
  FooterProps,
  HeaderProps,
  HeroProps,
  ImageProps,
  SignalProps,
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
}) satisfies z.ZodType<HeroProps>;

const StatItemSchema = z.object({
  value: z.string().max(24),
  label: z.string().max(60),
});

const StatsPropsSchema = z.object({
  stats: z.array(StatItemSchema).min(1).max(3),
}) satisfies z.ZodType<StatsProps>;

const SignalPropsSchema = z.object({
  kicker: z.string().max(60).optional(),
  title: z.string().max(120).optional(),
  body: z.string().max(500).optional(),
  bgColor: color().optional(),
}) satisfies z.ZodType<SignalProps>;

const TextPropsSchema = z.object({
  body: z.string().max(2000).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
}) satisfies z.ZodType<TextProps>;

const ImagePropsSchema = z.object({
  url: z.string().optional(),
  alt: z.string().max(160).optional(),
  caption: z.string().max(200).optional(),
}) satisfies z.ZodType<ImageProps>;

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
  unsubscribeUrl: z.string().optional(),
}) satisfies z.ZodType<FooterProps>;

export const GlobalStyleSchema = z.object({
  primaryColor: z.string(),
  accentColor: z.string(),
  fontFamily: z.enum(["MODERN_SANS", "BOOK_SERIF", "GEOMETRIC_SANS"]),
  textColor: z.string(),
  backdropColor: z.string(),
}) satisfies z.ZodType<EmailGlobalStyle>;

// `id` is optional ON THE WAY IN (saved docs carry one; new/AI blocks don't) and
// minted by the transform when absent — so every parsed block has a string id.
const idIn = z.string().optional();

const BlockSchema = z
  .discriminatedUnion("type", [
    z.object({ id: idIn, type: z.literal("header"), props: HeaderPropsSchema }),
    z.object({ id: idIn, type: z.literal("hero"), props: HeroPropsSchema }),
    z.object({ id: idIn, type: z.literal("stats"), props: StatsPropsSchema }),
    z.object({ id: idIn, type: z.literal("signal"), props: SignalPropsSchema }),
    z.object({ id: idIn, type: z.literal("text"), props: TextPropsSchema }),
    z.object({ id: idIn, type: z.literal("image"), props: ImagePropsSchema }),
    z.object({ id: idIn, type: z.literal("agent-card"), props: AgentCardPropsSchema }),
    z.object({ id: idIn, type: z.literal("agent-hero"), props: AgentHeroPropsSchema }),
    z.object({ id: idIn, type: z.literal("button"), props: ButtonPropsSchema }),
    z.object({ id: idIn, type: z.literal("divider"), props: DividerPropsSchema }),
    z.object({ id: idIn, type: z.literal("footer"), props: FooterPropsSchema }),
  ])
  .transform((b) => ({ ...b, id: b.id ?? mintBlockId() }));

export const EmailDocSchema = z.object({
  globalStyle: GlobalStyleSchema,
  blocks: z.array(BlockSchema).min(1).max(20),
});

// ── AI content patch ────────────────────────────────────────────────────────
// Text props ONLY, keyed by block id. `z.strictObject` REJECTS any non-text key
// (bgColor / color / *Url / logoUrl / photoUrl / companyName / name / globalStyle …)
// — enforcing "the AI fills content, never restyles, relinks, or restructures"
// at the schema layer (spec → AI + data contract). The route re-validates the
// whole doc with EmailDocSchema after applying the patch.

const StatPatchSchema = z.strictObject({
  value: z.string().max(24),
  label: z.string().max(60),
});

export const BlockContentPatchSchema = z.strictObject({
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
});

export const ContentPatchSchema = z.record(z.string(), BlockContentPatchSchema);

export type ContentPatch = z.infer<typeof ContentPatchSchema>;
export type BlockContentPatch = z.infer<typeof BlockContentPatchSchema>;
