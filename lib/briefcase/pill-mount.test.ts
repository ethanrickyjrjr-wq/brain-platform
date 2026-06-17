import { describe, it, expect } from "bun:test";
import { pageFromPath, shouldRenderStandalone } from "./pill-mount";

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
  it("maps anything else to generic", () => {
    expect(pageFromPath("/welcome")).toEqual({ kind: "generic" });
    expect(pageFromPath("/billing")).toEqual({ kind: "generic" });
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
});
