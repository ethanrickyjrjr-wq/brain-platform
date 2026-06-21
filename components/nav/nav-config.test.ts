import { describe, it, expect } from "bun:test";
import type { User } from "@supabase/supabase-js";
import {
  NAV_GROUPS,
  SHELL_HIDDEN_PREFIXES,
  isHiddenPath,
  homeHref,
  isActive,
  isItemActive,
  activeChildHref,
  type NavItem,
} from "./nav-config";

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

describe("homeHref (B4 — signed-in home base)", () => {
  it("sends a logged-OUT visitor to the marketing funnel", () => {
    expect(homeHref(null)).toBe("/");
  });
  it("sends a signed-IN user to their /project home base", () => {
    expect(homeHref({ id: "u1" } as User)).toBe("/project");
  });
});

describe("NAV_GROUPS (primary nav — grouped in B2)", () => {
  it("carries the top-level marquees + Explore group in order", () => {
    expect(NAV_GROUPS.map((n) => n.label)).toEqual([
      "Explore",
      "Charts",
      "Showcase",
      "Projects",
      "Alerts",
    ]);
  });
  it("folds the long tail into Explore (Search/Maps/ZIP Reports)", () => {
    const explore = NAV_GROUPS.find((n) => n.label === "Explore");
    expect(explore?.children?.map((c) => c.href)).toEqual(["/r", "/map", "/r/search"]);
  });
  it("does NOT surface /data-intel anywhere (internal-only, B6)", () => {
    const allHrefs = (item: NavItem): string[] => [
      ...(item.href ? [item.href] : []),
      ...(item.children ?? []).flatMap(allHrefs),
    ];
    const everyHref = NAV_GROUPS.flatMap(allHrefs);
    expect(everyHref).not.toContain("/data-intel");
  });
  it("every LEAF has a label and an absolute href; every GROUP has children", () => {
    const check = (item: NavItem) => {
      expect(item.label.length).toBeGreaterThan(0);
      if (item.children?.length) {
        item.children.forEach(check);
      } else {
        expect(item.href?.startsWith("/")).toBe(true);
      }
    };
    NAV_GROUPS.forEach(check);
  });
});

describe("isItemActive (group lights when any child is active)", () => {
  const explore = NAV_GROUPS.find((n) => n.label === "Explore")!;
  const charts = NAV_GROUPS.find((n) => n.label === "Charts")!;
  it("lights Explore on any of its children", () => {
    expect(isItemActive("/r", explore)).toBe(true);
    expect(isItemActive("/r/env-swfl", explore)).toBe(true);
    expect(isItemActive("/map", explore)).toBe(true);
    expect(isItemActive("/r/search", explore)).toBe(true);
  });
  it("does NOT light Explore on a marquee route", () => {
    expect(isItemActive("/charts", explore)).toBe(false);
    expect(isItemActive("/project/abc", explore)).toBe(false);
  });
  it("lights a leaf marquee on its own path", () => {
    expect(isItemActive("/charts", charts)).toBe(true);
    expect(isItemActive("/r", charts)).toBe(false);
  });
  it("is false for a null path", () => {
    expect(isItemActive(null, explore)).toBe(false);
  });
});

describe("activeChildHref (longest match wins in the dropdown)", () => {
  const children = NAV_GROUPS.find((n) => n.label === "Explore")!.children!;
  it("lights ZIP Reports (not also Search) on /r/search", () => {
    expect(activeChildHref("/r/search", children)).toBe("/r/search");
  });
  it("lights Search on a generic report path", () => {
    expect(activeChildHref("/r/env-swfl", children)).toBe("/r");
  });
  it("lights Maps on /map", () => {
    expect(activeChildHref("/map", children)).toBe("/map");
  });
  it("returns null when nothing under Explore matches", () => {
    expect(activeChildHref("/charts", children)).toBe(null);
    expect(activeChildHref(null, children)).toBe(null);
  });
});
