import { describe, it, expect } from "bun:test";
import {
  pageFromPath,
  shouldRenderStandalone,
  shouldMountHighlighter,
  projectIdFromPath,
  shouldAutoOpenPill,
  isAiChromeFree,
} from "./pill-mount";
import { isHiddenPath } from "@/components/nav/nav-config";

/**
 * A-3 pill-mount logic — pure. pageFromPath drives A-7 context prompts;
 * shouldRenderStandalone guarantees EXACTLY ONE visible pill: the root standalone
 * pill suppresses on /r/* when the highlighter is on (the per-page bridged pill takes
 * over), but shows on /r/* as a fallback when the highlighter flag is off.
 */

describe("pageFromPath", () => {
  it("maps the home page", () => {
    expect(pageFromPath("/")).toEqual({ kind: "home" });
  });
  it("maps /charts", () => {
    expect(pageFromPath("/charts")).toEqual({ kind: "charts" });
  });
  it("maps a report page to report context", () => {
    expect(pageFromPath("/r/env-swfl")).toEqual({ kind: "report" });
    expect(pageFromPath("/r/zip-report/33931")).toEqual({ kind: "report" });
  });
  it("maps /project/[id] to project context with the decoded id (Piece 2)", () => {
    expect(pageFromPath("/project/abc123")).toEqual({ kind: "project", projectId: "abc123" });
    expect(pageFromPath("/project/FMB%2033931")).toEqual({
      kind: "project",
      projectId: "FMB 33931",
    });
  });
  it("leaves the /project list (no id) as generic", () => {
    expect(pageFromPath("/project")).toEqual({ kind: "generic" });
    expect(pageFromPath("/project/")).toEqual({ kind: "generic" });
  });
  it("maps anything else to generic", () => {
    expect(pageFromPath("/welcome")).toEqual({ kind: "generic" });
    expect(pageFromPath("/billing")).toEqual({ kind: "generic" });
  });
});

describe("projectIdFromPath (the single regex root)", () => {
  it("extracts + decodes the id on a project page, null elsewhere", () => {
    expect(projectIdFromPath("/project/abc123")).toBe("abc123");
    expect(projectIdFromPath("/project/abc123/edit")).toBe("abc123");
    expect(projectIdFromPath("/project/FMB%2033931")).toBe("FMB 33931");
    expect(projectIdFromPath("/project")).toBeNull();
    expect(projectIdFromPath("/")).toBeNull();
    expect(projectIdFromPath("/charts")).toBeNull();
  });
});

describe("shouldRenderStandalone (exactly one visible pill)", () => {
  it("renders off /r/* (home, charts, other)", () => {
    expect(shouldRenderStandalone("/", true)).toBe(true);
    expect(shouldRenderStandalone("/charts", true)).toBe(true);
    expect(shouldRenderStandalone("/welcome", true)).toBe(true);
  });
  it("SUPPRESSES on /r/* when the highlighter is enabled (bridged pill takes over)", () => {
    expect(shouldRenderStandalone("/r/env-swfl", true)).toBe(false);
  });
  it("FALLS BACK to rendering on /r/* when the highlighter flag is off (no bridged pill)", () => {
    expect(shouldRenderStandalone("/r/env-swfl", false)).toBe(true);
  });
  it("SUPPRESSES on /p/* (finished deliverables stay client-clean, regardless of flag)", () => {
    expect(shouldRenderStandalone("/p/abc123", true)).toBe(false);
    expect(shouldRenderStandalone("/p/abc123", false)).toBe(false);
  });
  it("SUPPRESSES on /embed/* (iframe fragments stay white-label clean, regardless of flag)", () => {
    expect(shouldRenderStandalone("/embed/charts", true)).toBe(false);
    expect(shouldRenderStandalone("/embed/waitlist", false)).toBe(false);
    expect(shouldRenderStandalone("/embed/cards/asking-rent", true)).toBe(false);
  });
});

describe("shouldMountHighlighter (the selection-triggered twin — broader suppression)", () => {
  it("mounts on the highlighter's home (/r/*) and on every ordinary page", () => {
    expect(shouldMountHighlighter("/r/env-swfl")).toBe(true);
    expect(shouldMountHighlighter("/r/zip-report/33931")).toBe(true);
    expect(shouldMountHighlighter("/")).toBe(true);
    expect(shouldMountHighlighter("/charts")).toBe(true);
    expect(shouldMountHighlighter("/map")).toBe(true);
    expect(shouldMountHighlighter("/project/abc123")).toBe(true);
  });
  it("SUPPRESSES on the white-label deliverable + iframe prefixes (parity with the pill)", () => {
    expect(shouldMountHighlighter("/p/abc123")).toBe(false);
    expect(shouldMountHighlighter("/embed/charts")).toBe(false);
  });
  it("ALSO suppresses /login + /auth — UNLIKE the pill (nothing to highlight on an auth form)", () => {
    // The load-bearing asymmetry (#6/M5): the pill shows on /login/auth, the highlighter does not.
    expect(shouldMountHighlighter("/login")).toBe(false);
    expect(shouldRenderStandalone("/login", true)).toBe(true);
    expect(shouldMountHighlighter("/auth/callback")).toBe(false);
    expect(shouldRenderStandalone("/auth/callback", true)).toBe(true);
  });
  it("treats a null pathname as suppressed", () => {
    expect(shouldMountHighlighter(null)).toBe(false);
  });
});

describe("isAiChromeFree (clean reviewer/marketing pages — nav stays, AI goes)", () => {
  it("matches /for-agents and its subpaths, nothing else", () => {
    expect(isAiChromeFree("/for-agents")).toBe(true);
    expect(isAiChromeFree("/for-agents/lee")).toBe(true);
    expect(isAiChromeFree("/")).toBe(false);
    expect(isAiChromeFree("/welcome")).toBe(false);
    // Must NOT greedily match an unrelated path that merely shares the prefix string.
    expect(isAiChromeFree("/for-agents-something-else")).toBe(false);
    expect(isAiChromeFree(null)).toBe(false);
  });
  it("SUPPRESSES both AI surfaces on /for-agents (no pill auto-open, no coachmark/ticker)", () => {
    expect(shouldRenderStandalone("/for-agents", true)).toBe(false);
    expect(shouldRenderStandalone("/for-agents", false)).toBe(false);
    expect(shouldMountHighlighter("/for-agents")).toBe(false);
  });
  it("KEEPS the page chrome (nav + footer) — unlike the white-label hidden prefixes", () => {
    // The whole point: /for-agents reads as a real product page (nav/footer present),
    // it just never pops the consumer AI funnel at an MLS reviewer.
    expect(isHiddenPath("/for-agents")).toBe(false);
  });
});

describe("shouldAutoOpenPill (first-visit funnel pop, at most once)", () => {
  it("opens for a brand-new anonymous visitor on the standalone pill", () => {
    expect(shouldAutoOpenPill({ firstVisit: true, authed: false, bridged: false })).toBe(true);
  });
  it("stays closed for a returning visitor (visit counter already bumped)", () => {
    expect(shouldAutoOpenPill({ firstVisit: false, authed: false, bridged: false })).toBe(false);
  });
  it("stays closed for a logged-in user even on a first visit (already past the funnel)", () => {
    expect(shouldAutoOpenPill({ firstVisit: true, authed: true, bridged: false })).toBe(false);
  });
  it("never auto-opens the bridged report dock (reportId present)", () => {
    expect(shouldAutoOpenPill({ firstVisit: true, authed: false, bridged: true })).toBe(false);
  });
});
