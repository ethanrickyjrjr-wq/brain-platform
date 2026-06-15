import { test, expect, describe } from "bun:test";
import { renderVerdictLine, renderVerdictSection } from "./render-verdict";
import type { ReconciliationVerdict } from "./types";

const SRC = {
  url: "https://www.swfldatagulf.com/r/housing-swfl",
  fetched_at: "2026-06-10T12:00:00Z",
  tier: 2 as const,
  citation: "SWFL Data Gulf — housing (90-day window)",
};

const verified: ReconciliationVerdict = {
  status: "verified",
  ours: {
    value: 362000,
    metric_slug: "median_sale_price",
    expires: "2026-07-10T12:00:00Z",
    source: SRC,
  },
  theirs: { value: "362000", freshness_token: "SWFL-7421-v5-20260610" },
  fresher_side: "tie",
  grain: { lake: "zip-month", mismatch: false },
  reason: 'value matches at "zip-month" and the lake fact is fresh',
};

const needsReview: ReconciliationVerdict = {
  status: "needs_review",
  ours: {
    value: 362000,
    metric_slug: "median_sale_price",
    expires: "2026-07-12T12:00:00Z",
    source: SRC,
  },
  theirs: { value: "360000", freshness_token: "SWFL-7421-v4-20260601" },
  delta_pct: -0.55,
  fresher_side: "ours",
  grain: { lake: "zip-month", mismatch: false },
  reason: "values differ by -0.55%",
};

const stale: ReconciliationVerdict = {
  status: "cannot_assert_stale",
  theirs: { value: "362000", freshness_token: "SWFL-7421-v3-20260401" },
  fresher_side: "unknown",
  expires_at: "2026-05-01T12:00:00Z",
  grain: { lake: "zip-month", mismatch: false },
  reason: "lake fact expired 2026-05-01T12:00:00Z — refuse to assert; offer re-pull",
};

const outOfGrain: ReconciliationVerdict = {
  status: "out_of_grain",
  ours: {
    value: 362000,
    metric_slug: "median_sale_price",
    expires: "2026-07-10T12:00:00Z",
    source: SRC,
  },
  theirs: { value: "489000", freshness_token: "SWFL-7421-v5-20260610" },
  fresher_side: "tie",
  grain: { lake: "zip-month", asserted: "parcel", mismatch: true },
  reason: 'asserted grain "parcel" finer than lake grain "zip-month" — not held',
};

const notFound: ReconciliationVerdict = {
  status: "not_found",
  theirs: { value: "0.97", freshness_token: "SWFL-7421-v5-20260610" },
  reason: 'no lake metric resolves for "Median list-to-sale ratio"',
};

describe("renderVerdictLine — customer-clean, rules-of-engagement", () => {
  test("verified cites both sides + source + freshness, never a slug", () => {
    const line = renderVerdictLine(verified);
    expect(line.toLowerCase()).toContain("verified");
    expect(line).toContain("362000");
    expect(line).toContain(SRC.citation);
    expect(line).toContain("SWFL-7421-v5-20260610");
    expect(line).not.toContain("median_sale_price"); // no internal slug
  });

  test("needs_review surfaces both numbers, the delta, and which side is fresher", () => {
    const line = renderVerdictLine(needsReview);
    expect(line.toLowerCase()).toContain("review");
    expect(line).toContain("360000");
    expect(line).toContain("362000");
    expect(line).toContain("-0.55");
    expect(line.toLowerCase()).toContain("fresher");
  });

  test("cannot_assert_stale refuses with the expiry date and NEVER the number", () => {
    const line = renderVerdictLine(stale);
    expect(line.toLowerCase()).toContain("expired");
    expect(line).toContain("2026-05-01");
    expect(line.toLowerCase()).toMatch(/pull|fresh|re-pull/);
    expect(line).not.toContain("362000"); // the withheld value never leaks
  });

  test("out_of_grain offers the grain we hold, never fabricates the finer one", () => {
    const line = renderVerdictLine(outOfGrain, "Median sale price");
    expect(line).toContain("zip-month");
    expect(line).toContain("parcel");
    expect(line).toContain("362000"); // our real, fresh ZIP-grain value
    expect(line).not.toContain("489000"); // never echo their finer-grain claim as ours
  });

  test("not_found says what we don't have and offers to pull (never 'expired')", () => {
    const line = renderVerdictLine(notFound, "Median list-to-sale ratio");
    expect(line).toContain("Median list-to-sale ratio");
    expect(line.toLowerCase()).toMatch(/pull|don't hold|do not hold/);
    expect(line.toLowerCase()).not.toContain("expired");
  });
});

describe("never speaks an internal slug (rules of engagement)", () => {
  test("not_found with a snake_case slug label drops the slug → 'that'", () => {
    const line = renderVerdictLine(notFound, "median_sale_price");
    expect(line).not.toContain("median_sale_price");
    expect(line).toContain("that");
  });

  test("out_of_grain with a slug label drops the slug → 'this'", () => {
    const line = renderVerdictLine(outOfGrain, "median_sale_price");
    expect(line).not.toContain("median_sale_price");
    expect(line).toContain("this at");
  });

  test("a real human label is preserved", () => {
    expect(renderVerdictLine(notFound, "Median sale price")).toContain("Median sale price");
  });
});

describe("renderVerdictSection — 'X verified, Y needs review', token once", () => {
  test("summarizes counts, lists lines, and quotes the freshness token once", () => {
    const section = renderVerdictSection(
      [
        { verdict: verified, label: "Median sale price" },
        { verdict: needsReview, label: "Median sale price (alt)" },
        { verdict: stale, label: "Days on market" },
      ],
      "SWFL-7421-v5-20260610",
    );
    expect(section.toLowerCase()).toContain("1 verified");
    expect(section.toLowerCase()).toContain("1 need"); // "1 needs review"
    expect(section.split("SWFL-7421-v5-20260610").length - 1).toBe(1); // token exactly once
  });

  test("empty verdict list → empty string (no section)", () => {
    expect(renderVerdictSection([], "SWFL-7421-v5-20260610")).toBe("");
  });
});
