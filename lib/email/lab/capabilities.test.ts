import { test, expect } from "bun:test";
import {
  EMAIL_LAB_CAPABILITIES,
  FEATURE_ROUTING,
  FONT_ROUTING,
  capabilitiesFor,
  fontsFor,
  type EmailLabCapabilities,
  type Routing,
} from "./capabilities";

// ── THE DIAL GUARD ────────────────────────────────────────────────────────────
// Enforces that every feature/font lands EXACTLY where it was routed. If an edit
// sends a paid-only thing to free, drops a "both" from one side, or downgrades
// paid, one of these reds. Don't relax them — fix the routing instead.

const { free, paid } = EMAIL_LAB_CAPABILITIES;

function expectRouting(inFree: boolean, inPaid: boolean, routing: Routing) {
  if (routing === "paid-only") return !inFree && inPaid;
  if (routing === "free-only") return inFree && !inPaid;
  return inFree && inPaid; // "both"
}

test("every feature lands exactly where it was routed", () => {
  for (const key of Object.keys(FEATURE_ROUTING) as (keyof EmailLabCapabilities)[]) {
    const routing = FEATURE_ROUTING[key];
    expect(expectRouting(free[key], paid[key], routing)).toBe(true);
  }
});

test("paid-only features never leak into free, and paid keeps them", () => {
  for (const [key, routing] of Object.entries(FEATURE_ROUTING)) {
    if (routing !== "paid-only") continue;
    const k = key as keyof EmailLabCapabilities;
    expect(free[k]).toBe(false); // no leak to free
    expect(paid[k]).toBe(true); // no downgrade of paid
  }
});

test("fonts land exactly where routed — premium → paid, never free", () => {
  const freeFonts = fontsFor("free");
  const paidFonts = fontsFor("paid");
  for (const [font, routing] of Object.entries(FONT_ROUTING)) {
    const inFree = freeFonts.includes(font as never);
    const inPaid = paidFonts.includes(font as never);
    expect(expectRouting(inFree, inPaid, routing as Routing)).toBe(true);
  }
  // paid is never font-poorer than the "both" baseline free gets
  for (const f of freeFonts) {
    if (FONT_ROUTING[f] === "both") expect(paidFonts).toContain(f);
  }
});

test("tiers are frozen and resolvable", () => {
  expect(capabilitiesFor("free")).toBe(free);
  expect(capabilitiesFor("paid")).toBe(paid);
  expect(Object.isFrozen(free)).toBe(true);
  expect(Object.isFrozen(paid)).toBe(true);
});
