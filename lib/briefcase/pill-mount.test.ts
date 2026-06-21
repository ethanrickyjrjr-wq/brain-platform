import { describe, it, expect } from "bun:test";
import {
  pageFromPath,
  shouldRenderStandalone,
  projectIdFromPath,
  shouldAutoOpenPill,
} from "./pill-mount";

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
