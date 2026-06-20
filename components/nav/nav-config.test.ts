import { describe, it, expect } from "bun:test";
import type { User } from "@supabase/supabase-js";
import { NAV_GROUPS, SHELL_HIDDEN_PREFIXES, isHiddenPath, homeHref, isActive } from "./nav-config";

/**
 * Pure nav-config logic — the cross-build seam B1 exposes (and B2/B4/B5 extend).
 * The shell component itself is client/motion/scroll and not unit-tested here; these
 * guard the deterministic contract: which paths get chrome, which tab is active, and
 * where the logo points.
 */

describe("isHiddenPath (shell + footer suppression)", () => {
  it("hides the white-label + auth prefixes", () => {
    expect(isHiddenPath("/p/abc123")).toBe(true);
    expect(isHiddenPath("/embed/charts")).toBe(true);
    expect(isHiddenPath("/login")).toBe(true);
    expect(isHiddenPath("/auth/auth-code-error")).toBe(true);
  });
  it("does NOT hide home — it renders the home variant now", () => {
    expect(isHiddenPath("/")).toBe(false);
  });
  it("does NOT let /p/ match /privacy or /project (trailing-slash guard)", () => {
    expect(isHiddenPath("/privacy")).toBe(false);
    expect(isHiddenPath("/project")).toBe(false);
    expect(isHiddenPath("/project/abc123")).toBe(false);
  });
  it("shows the app surfaces", () => {
    expect(isHiddenPath("/r")).toBe(false);
    expect(isHiddenPath("/charts")).toBe(false);
    expect(isHiddenPath("/showcase")).toBe(false);
  });
  it("treats a null path as hidden (nothing to render against)", () => {
    expect(isHiddenPath(null)).toBe(true);
  });
  it("keeps the /p/ rule in the set (parity twin of pill-mount)", () => {
    expect(SHELL_HIDDEN_PREFIXES).toContain("/p/");
  });
});

describe("isActive (tab highlight)", () => {
  it("matches a tab on its own path and under it", () => {
    expect(isActive("/r", "/r")).toBe(true);
    expect(isActive("/r/env-swfl", "/r")).toBe(true);
    expect(isActive("/project/abc", "/project")).toBe(true);
  });
  it("does NOT match a sibling that merely shares a prefix", () => {
    expect(isActive("/report", "/r")).toBe(false);
    expect(isActive("/rsomething", "/r")).toBe(false);
  });
  it("only lights home on an exact /", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/charts", "/")).toBe(false);
  });
  it("is false for a null path", () => {
    expect(isActive(null, "/r")).toBe(false);
  });
});

describe("homeHref (B4 seam)", () => {
  it("points everyone at / today (signed-in or out)", () => {
    expect(homeHref(null)).toBe("/");
    expect(homeHref({ id: "u1" } as User)).toBe("/");
  });
});

describe("NAV_GROUPS (primary tabs)", () => {
  it("carries the four public app surfaces in order", () => {
    expect(NAV_GROUPS.map((n) => n.href)).toEqual(["/r", "/charts", "/showcase", "/project"]);
  });
  it("every item has a label and an absolute href", () => {
    for (const item of NAV_GROUPS) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.href.startsWith("/")).toBe(true);
    }
  });
});
