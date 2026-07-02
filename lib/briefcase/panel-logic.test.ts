import { describe, it, expect } from "bun:test";
import { panelState, resolveBuildAction } from "./panel-logic";

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
