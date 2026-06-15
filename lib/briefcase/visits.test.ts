import { describe, it, expect } from "bun:test";
import {
  VISITS_KEY,
  readVisits,
  bumpVisits,
  bumpVisitsOnce,
  __resetVisitBumpGuardForTest,
  ctaIntensity,
  promptSetForVisits,
  promptsForPage,
  createSuggestion,
} from "./visits";

/**
 * A-7 visit store — pure, anonymous, storage-injected (no DOM, no Date.now in
 * tested paths). The unified pill renders promptsForPage()/createSuggestion()
 * and escalates its CTA via ctaIntensity(). Copy is "context-aware" (page +
 * revisit count), NEVER "learns how you work" (no user history).
 */

function memStorage(seed?: Record<string, string>) {
  const m = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    map: m,
  };
}

describe("readVisits", () => {
  it("returns 0 when nothing stored", () => {
    expect(readVisits(memStorage())).toBe(0);
  });
  it("parses a stored integer", () => {
    expect(readVisits(memStorage({ [VISITS_KEY]: "3" }))).toBe(3);
  });
  it("returns 0 on corrupt / non-numeric / null storage", () => {
    expect(readVisits(memStorage({ [VISITS_KEY]: "abc" }))).toBe(0);
    expect(readVisits(null)).toBe(0);
  });
});

describe("bumpVisits", () => {
  it("increments from 0 to 1 and persists", () => {
    const s = memStorage();
    expect(bumpVisits(s)).toBe(1);
    expect(s.getItem(VISITS_KEY)).toBe("1");
  });
  it("increments an existing count", () => {
    const s = memStorage({ [VISITS_KEY]: "4" });
    expect(bumpVisits(s)).toBe(5);
    expect(s.getItem(VISITS_KEY)).toBe("5");
  });
  it("no-ops gracefully on null storage (returns 1, never throws)", () => {
    expect(bumpVisits(null)).toBe(1);
  });
});

describe("bumpVisitsOnce (per-page-load guard)", () => {
  it("bumps on the first call but NOT on subsequent calls in the same load", () => {
    __resetVisitBumpGuardForTest();
    const s = memStorage();
    expect(bumpVisitsOnce(s)).toBe(1); // first open this load → counts
    expect(bumpVisitsOnce(s)).toBe(1); // pill re-open → reads, does NOT inflate
    expect(bumpVisitsOnce(s)).toBe(1);
    expect(s.getItem(VISITS_KEY)).toBe("1");
  });
  it("after a reset (new page load) it counts the visit again", () => {
    __resetVisitBumpGuardForTest();
    const s = memStorage({ [VISITS_KEY]: "2" });
    expect(bumpVisitsOnce(s)).toBe(3); // returning visitor, this load
    expect(bumpVisitsOnce(s)).toBe(3); // toggles don't move it
    __resetVisitBumpGuardForTest(); // simulate a fresh page load
    expect(bumpVisitsOnce(s)).toBe(4);
  });
});

describe("ctaIntensity", () => {
  it("is soft for a first/second visit", () => {
    expect(ctaIntensity(0)).toBe("soft");
    expect(ctaIntensity(1)).toBe("soft");
  });
  it("is medium for a few visits", () => {
    expect(ctaIntensity(2)).toBe("medium");
    expect(ctaIntensity(3)).toBe("medium");
  });
  it("is hard for a returning visitor", () => {
    expect(ctaIntensity(4)).toBe("hard");
    expect(ctaIntensity(12)).toBe("hard");
  });
});

describe("promptSetForVisits", () => {
  it("returns a fuller set early and a leaner set later", () => {
    const early = promptSetForVisits(0);
    const later = promptSetForVisits(6);
    expect(early.length).toBeGreaterThan(later.length);
    expect(later.length).toBeGreaterThan(0);
  });
  it("never returns an empty set", () => {
    for (const n of [0, 1, 2, 5, 20]) expect(promptSetForVisits(n).length).toBeGreaterThan(0);
  });
});

describe("promptsForPage (context-aware)", () => {
  it("on a report surfaces a 'this report' prompt", () => {
    const ps = promptsForPage({ kind: "report", reportLabel: "Fort Myers Beach" }, 0);
    expect(ps.length).toBeGreaterThan(0);
    expect(ps.some((p) => /this report|summari/i.test(p))).toBe(true);
  });
  it("on charts surfaces a trend prompt", () => {
    const ps = promptsForPage({ kind: "charts" }, 0);
    expect(ps.some((p) => /trend|chart|driv/i.test(p))).toBe(true);
  });
  it("on home surfaces a SWFL bottom-line prompt", () => {
    const ps = promptsForPage({ kind: "home" }, 0);
    expect(ps.some((p) => /SWFL|bottom line|right now/i.test(p))).toBe(true);
  });
  it("tunes length by visit count (fuller early, leaner later)", () => {
    const early = promptsForPage({ kind: "home" }, 0);
    const later = promptsForPage({ kind: "home" }, 6);
    expect(early.length).toBeGreaterThanOrEqual(later.length);
    expect(later.length).toBeGreaterThan(0);
  });
});

describe("createSuggestion", () => {
  it("on a report suggests creating from this report", () => {
    expect(/report|one-pager|brief/i.test(createSuggestion({ kind: "report" }))).toBe(true);
  });
  it("always returns non-empty actionable copy", () => {
    for (const page of [
      { kind: "report" as const },
      { kind: "charts" as const },
      { kind: "home" as const },
      { kind: "generic" as const },
    ]) {
      expect(createSuggestion(page).length).toBeGreaterThan(0);
    }
  });
});
