// lib/email/doc/default-docs.ts
//
// "Start from" seed EmailDocs + block factories (Card 00). PURE data layer.
// The legacy TEMPLATES picker maps onto SEED_DOCS (spec → Template regression:
// the picker becomes a seed list, it is not deleted). Each `build()` mints FRESH
// block ids so picking a seed twice never aliases two docs to the same ids.

import { mintBlockId } from "./schema";
import type { BlockOf, BlockPropsMap, BlockType, EmailDoc, EmailGlobalStyle } from "./types";

/** SWFL house brand. The brand pickers overwrite these per project; they are
 *  user-owned and sticky (the AI never rewrites globalStyle). */
export const DEFAULT_GLOBAL_STYLE: EmailGlobalStyle = {
  primaryColor: "#0f1d24",
  accentColor: "#1BB8C9",
  fontFamily: "MODERN_SANS",
  textColor: "#242424",
  backdropColor: "#F8F8F8",
};

/** Default props for each block type — used by the add-block palette and by the
 *  seed builder below. Sensible placeholders; the user/AI fills real content. */
export const DEFAULT_BLOCK_PROPS: { [K in BlockType]: BlockPropsMap[K] } = {
  header: { companyName: "Your Company", tagline: "Southwest Florida Real Estate" },
  hero: {
    kicker: "Market Spotlight",
    value: "$485K",
    label: "Median Sale Price · Lee County",
    prose: "A quick read on where the local market is heading this month.",
  },
  stats: {
    stats: [
      { value: "34", label: "Median DOM" },
      { value: "3.2 mo", label: "Months of Supply" },
      { value: "↑ 4%", label: "YoY Price" },
    ],
  },
  signal: {
    kicker: "Signal to Watch",
    title: "Inventory is ticking up",
    body: "More listings are reaching the market while demand holds — a shift worth watching.",
  },
  text: { body: "Write your message here.", align: "left" },
  image: { url: "", alt: "", caption: "" },
  "agent-card": {
    name: "Your Name",
    title: "Realtor®",
    bio: "A short bio that builds trust with your readers.",
    phone: "",
    ctaLabel: "Get in touch",
  },
  button: { label: "View Full Report", url: "" },
  divider: { color: "#E5E7EB" },
  footer: { companyName: "Your Company", address: "", websiteUrl: "" },
};

/** Fresh, mutable copy of a block type's default props. */
export function defaultPropsFor<K extends BlockType>(type: K): BlockPropsMap[K] {
  return structuredClone(DEFAULT_BLOCK_PROPS[type]);
}

/** Mint a brand-new block with default props (used by the add-block palette). */
export function createBlock<K extends BlockType>(type: K): BlockOf<K> {
  return { id: mintBlockId(), type, props: defaultPropsFor(type) } as BlockOf<K>;
}

/** Seed-builder helper: a block with default props plus optional overrides. */
function seedBlock<K extends BlockType>(
  type: K,
  overrides: Partial<BlockPropsMap[K]> = {},
): BlockOf<K> {
  return {
    id: mintBlockId(),
    type,
    props: { ...defaultPropsFor(type), ...overrides },
  } as BlockOf<K>;
}

export interface SeedDoc {
  id: string;
  name: string;
  description: string;
  /** Builds a fresh EmailDoc with newly-minted block ids each call. */
  build: () => EmailDoc;
}

const style = (): EmailGlobalStyle => ({ ...DEFAULT_GLOBAL_STYLE });

/**
 * Linear "start from" seeds. These cover the single-column templates; the 5
 * structural templates (shell-two-col, email-compare, email-hbar, email-table,
 * email-ranked) stay on the legacy token rail (spec → Template regression).
 */
export const SEED_DOCS: SeedDoc[] = [
  {
    id: "market-spotlight",
    name: "Market Spotlight",
    description: "Big headline number, KPIs, and a signal to watch.",
    build: () => ({
      globalStyle: style(),
      blocks: [
        seedBlock("header"),
        seedBlock("hero"),
        seedBlock("stats"),
        seedBlock("signal"),
        seedBlock("button"),
        seedBlock("footer"),
      ],
    }),
  },
  {
    id: "just-sold",
    name: "Just Sold",
    description: "Lead with the win, back it with numbers, sign off as the agent.",
    build: () => ({
      globalStyle: style(),
      blocks: [
        seedBlock("header"),
        seedBlock("hero", {
          kicker: "Just Sold",
          value: "$512K",
          label: "Sale Price · Cape Coral",
          prose: "Another home closed above asking — here's what the numbers say.",
        }),
        seedBlock("stats"),
        seedBlock("agent-card"),
        seedBlock("footer"),
      ],
    }),
  },
  {
    id: "market-letter",
    name: "Market Letter",
    description: "An editorial note: intro, narrative, a signal, and your sign-off.",
    build: () => ({
      globalStyle: style(),
      blocks: [
        seedBlock("header"),
        seedBlock("hero", { kicker: "This Month in SWFL", label: "Lee & Collier Counties" }),
        seedBlock("text", {
          body: "Open with the story behind the month's numbers — what shifted and why it matters to your readers.",
        }),
        seedBlock("signal"),
        seedBlock("divider"),
        seedBlock("agent-card"),
        seedBlock("footer"),
      ],
    }),
  },
  {
    id: "listing-feature",
    name: "Listing Feature",
    description: "A photo-led feature for a single property or neighborhood.",
    build: () => ({
      globalStyle: style(),
      blocks: [
        seedBlock("header"),
        seedBlock("hero", { kicker: "Featured Listing", value: "", label: "" }),
        seedBlock("image", { alt: "Featured property", caption: "Add a caption for this photo." }),
        seedBlock("text", { body: "Describe what makes this property stand out." }),
        seedBlock("button", { label: "See the Listing" }),
        seedBlock("footer"),
      ],
    }),
  },
  {
    id: "welcome",
    name: "Welcome",
    description: "Onboard a new subscriber: who you are and what to expect.",
    build: () => ({
      globalStyle: style(),
      blocks: [
        seedBlock("header"),
        seedBlock("hero", {
          kicker: "Welcome",
          value: "",
          label: "",
          prose: "Thanks for subscribing — here's what you can expect from us each month.",
        }),
        seedBlock("agent-card"),
        seedBlock("button", { label: "Explore the Data" }),
        seedBlock("footer"),
      ],
    }),
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "A clean header, one message, and a call to action.",
    build: () => ({
      globalStyle: style(),
      blocks: [
        seedBlock("header"),
        seedBlock("hero", { kicker: "", value: "", label: "" }),
        seedBlock("button"),
        seedBlock("footer"),
      ],
    }),
  },
];

/** Look up a seed by id (used by the "Start from" picker). */
export function seedById(id: string): SeedDoc | undefined {
  return SEED_DOCS.find((s) => s.id === id);
}

/** The default doc a fresh canvas opens with. */
export function defaultDoc(): EmailDoc {
  return SEED_DOCS[0].build();
}
