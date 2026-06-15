import { describe, it, expect } from "bun:test";
import { panelState, resolveBuildAction } from "./panel-logic";
import { EXAMPLE_CARDS } from "./example-cards";

/**
 * A-5 panel logic — pure decisions the BriefcasePanel renders on. The create-gate
 * (resolveBuildAction) is the load-bearing one: a logged-out "Build" must resolve to
 * the login wall and NEVER to "build" (so the component never POSTs the build API).
 */

describe("panelState", () => {
  it("is 'pitch' when the draft is empty", () => {
    expect(panelState(0)).toBe("pitch");
  });
  it("is 'draft' once something is filed", () => {
    expect(panelState(1)).toBe("draft");
    expect(panelState(12)).toBe("draft");
  });
});

describe("resolveBuildAction (create-gate)", () => {
  it("a logged-out Build resolves to 'login' — NEVER 'build' (bypass test)", () => {
    expect(resolveBuildAction(false)).toBe("login");
    expect(resolveBuildAction(false)).not.toBe("build");
  });
  it("a logged-in Build resolves to 'build'", () => {
    expect(resolveBuildAction(true)).toBe("build");
  });
});

describe("EXAMPLE_CARDS (client-safe, logged-out popup)", () => {
  it("ships exactly 4 cards with unique example-* ids, titles, and blurbs", () => {
    expect(EXAMPLE_CARDS).toHaveLength(4);
    const ids = EXAMPLE_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(4);
    for (const c of EXAMPLE_CARDS) {
      expect(c.id.startsWith("example-")).toBe(true);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.blurb.length).toBeGreaterThan(0);
    }
  });
});
