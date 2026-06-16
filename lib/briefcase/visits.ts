/**
 * A-7 anonymous visit store + context-aware prompt/CTA logic — pure, no React,
 * no DOM, no Date.now (storage injected so it's unit-testable directly).
 *
 * DECISION 3 (locked): copy is "context-aware" — it keys off the PAGE the pill is
 * on (report / charts / home) and an ANONYMOUS revisit count, NEVER user history.
 * This is not a "learns how you work" memory layer (that is a deferred Tier-2
 * per-user store). The counter is a single localStorage int; nothing identifies a user.
 */

export const VISITS_KEY = "sdg_briefcase_visits";

type ReadStore = Pick<Storage, "getItem"> | null | undefined;
type ReadWriteStore = Pick<Storage, "getItem" | "setItem"> | null | undefined;

/** Current anonymous visit count; 0 on absent / corrupt / null storage. */
export function readVisits(storage: ReadStore): number {
  if (!storage) return 0;
  const raw = storage.getItem(VISITS_KEY);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Increment the visit count, persist it, and return the new value. Never throws. */
export function bumpVisits(storage: ReadWriteStore): number {
  const next = readVisits(storage) + 1;
  if (storage) {
    try {
      storage.setItem(VISITS_KEY, String(next));
    } catch {
      /* quota / unavailable — the count just won't persist this session */
    }
  }
  return next;
}

// Module-scoped guard: the BriefcasePanel unmounts when the pill popover closes and
// remounts on reopen, so a per-mount bump would inflate "visits" by every pill toggle
// (jumping a single session straight to the "hard" CTA). A "visit" is a page load, so
// bump at most ONCE per loaded module instance; later opens just READ the count.
let bumpedThisLoad = false;

/** Bump exactly once per page load; subsequent calls return the current count
 *  WITHOUT incrementing. Use this from the (re-mounting) pill panel. */
export function bumpVisitsOnce(storage: ReadWriteStore): number {
  if (bumpedThisLoad) return readVisits(storage);
  bumpedThisLoad = true;
  return bumpVisits(storage);
}

/** Test-only: reset the once-per-load guard between cases. */
export function __resetVisitBumpGuardForTest(): void {
  bumpedThisLoad = false;
}

export type CtaIntensity = "soft" | "medium" | "hard";

/**
 * The CTA escalates with familiarity: gentle on the first couple of visits,
 * direct for a returning visitor. Still honest + ladder-aligned at every level
 * (build is always free; the only wall is branded SEND).
 */
export function ctaIntensity(n: number): CtaIntensity {
  if (n <= 1) return "soft";
  if (n <= 3) return "medium";
  return "hard";
}

/** A fuller set early (new visitors get more guidance), leaner later. */
function limitForVisits(n: number): number {
  if (n <= 1) return 4;
  if (n <= 3) return 3;
  return 2;
}

/** Where the pill is rendering — drives the prompt set + "create this now" copy. */
export type PillPage =
  | { kind: "report"; reportLabel?: string }
  | { kind: "charts" }
  | { kind: "home" }
  | { kind: "generic" };

const HOME_PROMPTS = [
  "What's the bottom line on SWFL right now?",
  "Show me flood risk by ZIP",
  "Which corridors are heating up?",
  "How are rents and home values moving?",
];

const REPORT_PROMPTS = [
  "Summarize this report for me",
  "Compare this to other SWFL areas",
  "What should I watch or worry about here?",
  "Pull the key numbers into a one-pager",
];

// The standalone pill chat (BriefcaseChat → /api/welcome/chat in "analyst" mode) is
// CONTEXT-FREE: it sends only the prompt text + the region-wide master read. It does
// NOT receive which of the charts on screen the user is looking at — so a charts prompt
// must be SELF-CONTAINED. Name the SWFL subject it's about; never a bare on-screen
// referent ("this trend", "this now", "these areas"). A deictic prompt here is
// unanswerable: the analyst has no "this" to resolve, so it answers blind or punts —
// the exact bug suggestions.ts already guards ("What's driving our freshness token").
// Each prompt below is verified answerable by the region-wide analyst grounding
// (master + corridor rents): names prices/rents/market direction, resolves no deixis.
const CHARTS_PROMPTS = [
  "What's driving SWFL home prices and rents right now?",
  "Where is the Southwest Florida market headed?",
  "What's the bottom line on SWFL home values?",
];

/** Generic SWFL prompt set, count-tuned (fuller early, leaner later). */
export function promptSetForVisits(n: number): string[] {
  return HOME_PROMPTS.slice(0, limitForVisits(n));
}

/** Context-aware prompts: page-specific set, count-tuned. */
export function promptsForPage(page: PillPage, n: number): string[] {
  const limit = limitForVisits(n);
  switch (page.kind) {
    case "report":
      return REPORT_PROMPTS.slice(0, limit);
    case "charts":
      return CHARTS_PROMPTS.slice(0, Math.min(limit, CHARTS_PROMPTS.length));
    case "home":
    case "generic":
    default:
      return promptSetForVisits(n);
  }
}

/** The "create this now" suggestion, derived from the current page context. */
export function createSuggestion(page: PillPage): string {
  switch (page.kind) {
    case "report":
      return "Turn this report into a branded one-pager";
    case "charts":
      return "Save this chart into a project";
    case "home":
      return "Start a project from what you're reading";
    case "generic":
    default:
      return "Create a deliverable from your briefcase";
  }
}
