import { describe, it, expect } from "bun:test";
import { describePage } from "./page-context";

/**
 * describePage maps the current pathname → a plain-English "where the user is"
 * clause, sent to the chat backend so no page is blind. Pure (no DOM / router).
 * It slots into "The user is currently on {clause}." so every return reads as a
 * place. Every route returns a non-empty clause — unknown routes included.
 */

describe("describePage", () => {
  it("describes the home page", () => {
    expect(describePage("/")).toMatch(/home/i);
  });

  it("describes the charts page by what it shows (not a bare 'this')", () => {
    const d = describePage("/charts");
    expect(d).toMatch(/chart|market trends/i);
    // names real subjects so the analyst can ground without on-screen context
    expect(d).toMatch(/home value|rent/i);
  });

  it("describes the welcome page", () => {
    expect(describePage("/welcome")).toMatch(/welcome/i);
  });

  it("extracts the ZIP from a zip-report path", () => {
    expect(describePage("/r/zip-report/33901")).toContain("33901");
    expect(describePage("/r/zip-report/33901")).toMatch(/report/i);
  });

  it("extracts the corridor slug from a cre-swfl path", () => {
    const d = describePage("/r/cre-swfl/airport-pulling-naples");
    expect(d).toContain("airport-pulling-naples");
    expect(d).toMatch(/corridor/i);
  });

  it("describes a generic report by slug", () => {
    expect(describePage("/r/master")).toMatch(/master|report/i);
  });

  it("describes a built deliverable page", () => {
    expect(describePage("/p/abc123")).toMatch(/deliverable/i);
  });

  it("describes a saved card page", () => {
    expect(describePage("/c/xyz")).toMatch(/card|chart/i);
  });

  it("distinguishes the projects list from a single project", () => {
    expect(describePage("/project")).toMatch(/project/i);
    expect(describePage("/project/abc")).toMatch(/project/i);
  });

  it("never returns empty — unknown routes still place the user", () => {
    const d = describePage("/totally-unknown-route");
    expect(d.length).toBeGreaterThan(0);
    expect(d).toContain("totally-unknown-route");
  });

  it("is tolerant of a trailing slash", () => {
    expect(describePage("/charts/")).toMatch(/chart|market trends/i);
  });

  it("never returns empty for the root edge cases", () => {
    expect(describePage("").length).toBeGreaterThan(0);
  });
});
