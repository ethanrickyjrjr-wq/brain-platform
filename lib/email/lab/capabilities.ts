// lib/email/lab/capabilities.ts
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ EMAIL LAB TIER DIAL — THE ONE SOURCE OF TRUTH. THIS IS THE POINT.         │
// │                                                                           │
// │ Free (`/email-lab`) and paid (`/email-lab/grid`) share one panel + shell. │
// │ Every feature (and every font) declares ONE target here:                  │
// │                                                                           │
// │     "free-only" → free YES, paid no                                       │
// │     "both"      → free YES, paid YES                                      │
// │     "paid-only" → free no,  paid YES                                      │
// │                                                                           │
// │ Want a thing in paid? Route it "paid-only". Want it everywhere? "both".   │
// │ Free only? "free-only". One line, both tiers follow, nothing leaks by     │
// │ accident. capabilities.test.ts enforces the dial — a feature can't ship   │
// │ where you didn't send it, and paid can't be silently downgraded.          │
// └─────────────────────────────────────────────────────────────────────────┘
import type { FontFamily } from "@/lib/email/doc/types";

export type EmailLabTier = "free" | "paid";

/** Where a feature is allowed to appear. */
export type Routing = "free-only" | "both" | "paid-only";

export interface EmailLabCapabilities {
  /** Author engine — "Build the email" lays out the whole doc from one prompt. */
  authorEngine: boolean;
  /** 2D drag/resize grid canvas + width presets + duplicate. */
  gridCanvas: boolean;
  /** In-canvas photo editor (Filerobot). */
  photoEditor: boolean;
  /** Classic-templates preview rail. */
  classicTemplates: boolean;
  /** Social calendar panel. */
  socialCalendar: boolean;
}

// ── THE DIAL. Route every feature here; that's the whole build. ───────────────
export const FEATURE_ROUTING: Record<keyof EmailLabCapabilities, Routing> = {
  authorEngine: "paid-only",
  gridCanvas: "paid-only",
  photoEditor: "paid-only",
  classicTemplates: "free-only",
  // PAID-ONLY — social calendar is a premium feature. NOTE the wiring is currently
  // backwards vs this dial: the FREE shell still renders SocialCalendarPanel and the
  // PAID shell doesn't. Bringing reality into compliance = gate the free shell's
  // calendar OFF on `capabilitiesFor("free").socialCalendar` (false) and render it in
  // the paid panel (true). The dial is the intent; the shells follow it.
  socialCalendar: "paid-only",
};

/** Does `tier` get something routed `routing`? */
function reaches(routing: Routing, tier: EmailLabTier): boolean {
  return routing === "both" || routing === `${tier}-only`;
}

function buildTier(tier: EmailLabTier): Readonly<EmailLabCapabilities> {
  const caps = {} as EmailLabCapabilities;
  for (const key of Object.keys(FEATURE_ROUTING) as (keyof EmailLabCapabilities)[]) {
    caps[key] = reaches(FEATURE_ROUTING[key], tier);
  }
  return Object.freeze(caps); // frozen so runtime code can't mutate a tier down
}

export const EMAIL_LAB_CAPABILITIES: Record<
  EmailLabTier,
  Readonly<EmailLabCapabilities>
> = Object.freeze({ free: buildTier("free"), paid: buildTier("paid") });

/** Resolve the frozen capability set for a tier. */
export function capabilitiesFor(tier: EmailLabTier): Readonly<EmailLabCapabilities> {
  return EMAIL_LAB_CAPABILITIES[tier];
}

// ── Fonts route the same way — "better fonts in paid" is the headline example. │
//    The `Record<FontFamily, …>` makes it IMPOSSIBLE to add a font without
//    routing it: add a value to FontFamily and TS forces a target here. Basic
//    fonts = "both" (free keeps them, never downgraded); premium fonts from the
//    14-font work = "paid-only" → paid gets them, free never does. ────────────
export const FONT_ROUTING: Record<FontFamily, Routing> = {
  MODERN_SANS: "both",
  BOOK_SERIF: "both",
  GEOMETRIC_SANS: "both",
  PLAYFAIR_SERIF: "both",
  LATO_SANS: "both",
  MONTSERRAT_SANS: "both",
  // Premium fonts (the 8 that take the set to 14) get added here as "paid-only".
};

/** The fonts a tier may offer, in declaration order. The picker maps over this. */
export function fontsFor(tier: EmailLabTier): FontFamily[] {
  return (Object.keys(FONT_ROUTING) as FontFamily[]).filter((f) => reaches(FONT_ROUTING[f], tier));
}
