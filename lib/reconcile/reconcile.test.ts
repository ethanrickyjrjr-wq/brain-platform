import { describe, test, expect } from "bun:test";
import { reconcileMetric } from "./reconcile";
import type { LaneOneFact, LaneTwoAssertion, VerdictStatus } from "./types";

import verified from "./fixtures/verified.json";
import needsReview from "./fixtures/needs-review.json";
import cannotAssertStale from "./fixtures/cannot-assert-stale.json";
import outOfGrain from "./fixtures/out-of-grain.json";
import notFoundAmbiguous from "./fixtures/not-found-ambiguous.json";
import notFoundNoTtl from "./fixtures/not-found-no-ttl-basis.json";

interface Fixture {
  lane_source: string;
  scenario: string;
  now: string;
  fact: LaneOneFact | null;
  assertion: LaneTwoAssertion;
  expect: {
    status: VerdictStatus;
    ours_present: boolean;
    delta_pct?: number;
    fresher_side?: string;
    grain_mismatch?: boolean;
  };
}

const FIXTURES: Fixture[] = [
  verified,
  needsReview,
  cannotAssertStale,
  outOfGrain,
  notFoundAmbiguous,
  notFoundNoTtl,
].map((f) => f as unknown as Fixture);

// ---------------------------------------------------------------------------
// Data-driven: one fixture per status, each tagged lane_source:"fixture".
// ---------------------------------------------------------------------------

test("every fixture is lane-tagged synthetic (never mistaken for live data)", () => {
  for (const fx of FIXTURES) expect(fx.lane_source).toBe("fixture");
});

for (const fx of FIXTURES) {
  test(`fixture → ${fx.expect.status}: ${fx.scenario}`, () => {
    const v = reconcileMetric(fx.fact, fx.assertion, fx.now);
    expect(v.status).toBe(fx.expect.status);
    expect(v.ours !== undefined).toBe(fx.expect.ours_present);
    // `theirs` is ALWAYS present — the assertion is the thing being checked.
    expect(v.theirs.value).toBe(fx.assertion.value);
    expect(v.theirs.freshness_token).toBe(fx.assertion.freshness_token);
    if (fx.expect.delta_pct !== undefined) {
      expect(v.delta_pct).toBeCloseTo(fx.expect.delta_pct, 2);
    }
    if (fx.expect.fresher_side !== undefined) {
      expect(v.fresher_side).toBe(fx.expect.fresher_side);
    }
    if (fx.expect.grain_mismatch !== undefined) {
      expect(v.grain?.mismatch).toBe(fx.expect.grain_mismatch);
    }
  });
}

// ---------------------------------------------------------------------------
// Prime-directive invariants
// ---------------------------------------------------------------------------

describe("cannot_assert_stale withholds the number", () => {
  test("omits `ours`, keeps `expires` in the reason, never the value", () => {
    const fx = cannotAssertStale as unknown as Fixture;
    const fact = fx.fact as LaneOneFact;
    const v = reconcileMetric(fact, fx.assertion, fx.now);
    expect(v.status).toBe("cannot_assert_stale");
    expect(v.ours).toBeUndefined();
    expect(v.fresher_side).toBe("unknown");
    // The held-but-expired VALUE (362000) must never leak into the reason...
    expect(v.reason).not.toContain("362000");
    // ...but the expires timestamp (the basis for refusing) is surfaced.
    expect(v.reason).toContain(fact.expires as string);
  });
});

describe("no-TTL-basis is not_found, never cannot_assert_stale (R1 / B2)", () => {
  test("`expires === undefined` (uncataloged) → not_found", () => {
    const fx = notFoundNoTtl as unknown as Fixture;
    const v = reconcileMetric(fx.fact, fx.assertion, fx.now);
    expect(v.status).toBe("not_found");
    expect(v.reason.toLowerCase()).toContain("ttl");
  });

  test("a present-but-CORRUPT `expires` ('') falls through to the gate → cannot_assert_stale", () => {
    // The gate tests `=== undefined`, NOT `!expires`. An empty string is a
    // stamped-but-corrupt value, not a missing basis; freshnessGate fail-closes
    // garbage to expired. This must NOT short-circuit to not_found.
    const fact: LaneOneFact = {
      brain_id: "housing-swfl",
      metric_slug: "median_sale_price",
      label: "Median sale price",
      value: 362000,
      grain: "zip-month",
      source: {
        url: "https://example.com",
        fetched_at: "2026-06-10T12:00:00Z",
        tier: 2,
        citation: "x",
      },
      expires: "",
    };
    const assertion: LaneTwoAssertion = {
      report_id: "housing-swfl",
      label: "Median sale price",
      value: "362000",
      freshness_token: "SWFL-7421-v5-20260610",
      origin: "mcp",
    };
    const v = reconcileMetric(fact, assertion, "2026-06-15T00:00:00Z");
    expect(v.status).toBe("cannot_assert_stale");
    expect(v.ours).toBeUndefined();
  });
});

describe("out_of_grain surfaces the fresh lake value but flags the mismatch", () => {
  test("parcel assertion vs zip-month lake → out_of_grain, ours present, mismatch true", () => {
    const fx = outOfGrain as unknown as Fixture;
    const v = reconcileMetric(fx.fact, fx.assertion, fx.now);
    expect(v.status).toBe("out_of_grain");
    expect(v.ours).toBeDefined();
    expect(v.grain).toEqual({ lake: "zip-month", asserted: "parcel", mismatch: true });
  });

  test("a COARSER assertion (county) vs zip lake is NOT out_of_grain — it compares", () => {
    // Only finer-than-lake fabricates; a coarser assertion falls through to value compare.
    const fact: LaneOneFact = {
      brain_id: "housing-swfl",
      metric_slug: "median_sale_price",
      label: "Median sale price",
      value: 362000,
      grain: "zip-month",
      source: { url: "x", fetched_at: "2026-06-10T12:00:00Z", tier: 2, citation: "x" },
      expires: "2026-07-10T12:00:00Z",
    };
    const assertion: LaneTwoAssertion = {
      report_id: "housing-swfl",
      label: "Median sale price",
      value: "362000",
      freshness_token: "SWFL-7421-v5-20260610",
      asserted_grain: "county-month",
      origin: "web",
    };
    const v = reconcileMetric(fact, assertion, "2026-06-15T00:00:00Z");
    expect(v.status).toBe("verified");
  });
});

// ---------------------------------------------------------------------------
// Value compare + delta
// ---------------------------------------------------------------------------

describe("delta_pct is signed (theirs − ours)/ours and 2dp", () => {
  function metricFact(value: number): LaneOneFact {
    return {
      brain_id: "housing-swfl",
      metric_slug: "median_sale_price",
      label: "Median sale price",
      value,
      grain: "zip-month",
      source: { url: "x", fetched_at: "2026-06-10T12:00:00Z", tier: 2, citation: "x" },
      expires: "2026-07-10T12:00:00Z",
    };
  }
  function assertion(value: string): LaneTwoAssertion {
    return {
      report_id: "housing-swfl",
      label: "Median sale price",
      value,
      freshness_token: "SWFL-7421-v5-20260610",
      origin: "mcp",
    };
  }
  const NOW = "2026-06-15T00:00:00Z";

  test("theirs below ours → negative delta", () => {
    const v = reconcileMetric(metricFact(362000), assertion("360000"), NOW);
    expect(v.status).toBe("needs_review");
    expect(v.delta_pct).toBeCloseTo(-0.55, 2);
  });

  test("theirs above ours → positive delta", () => {
    const v = reconcileMetric(metricFact(360000), assertion("362000"), NOW);
    expect(v.status).toBe("needs_review");
    expect(v.delta_pct).toBeCloseTo(0.56, 2);
  });

  test("format-only difference ($362,000 vs 362000) still verifies", () => {
    const v = reconcileMetric(metricFact(362000), assertion("$362,000"), NOW);
    expect(v.status).toBe("verified");
    expect(v.delta_pct).toBeUndefined();
  });

  test("a rounded value is NOT a match (verbatim-or-fail): 28.4 vs 28.40", () => {
    const v = reconcileMetric(metricFact(28.4), assertion("28.40"), NOW);
    // normalizeNumber preserves decimals exactly: "28.4" !== "28.40" → needs_review.
    expect(v.status).toBe("needs_review");
  });
});

describe("categorical (non-numeric) values compare by exact case/space match", () => {
  function catFact(value: string): LaneOneFact {
    return {
      brain_id: "env-swfl",
      metric_slug: "dominant_land_use",
      label: "Dominant land use",
      value,
      grain: "zip",
      source: { url: "x", fetched_at: "2026-06-10T12:00:00Z", tier: 2, citation: "x" },
      expires: "2026-07-10T12:00:00Z",
    };
  }
  function catAssertion(value: string): LaneTwoAssertion {
    return {
      report_id: "env-swfl",
      label: "Dominant land use",
      value,
      freshness_token: "SWFL-7421-v5-20260610",
      origin: "mcp",
    };
  }
  const NOW = "2026-06-15T00:00:00Z";

  test("same label (case/space-insensitive) → verified, no delta", () => {
    const v = reconcileMetric(catFact("Barrier island"), catAssertion("barrier island "), NOW);
    expect(v.status).toBe("verified");
    expect(v.delta_pct).toBeUndefined();
  });

  test("different categories → needs_review, no delta", () => {
    const v = reconcileMetric(catFact("Barrier island"), catAssertion("mainland"), NOW);
    expect(v.status).toBe("needs_review");
    expect(v.delta_pct).toBeUndefined();
  });

  test("two different categoricals never falsely verify via empty-normalization", () => {
    // Regression: normalizeNumber("Barrier island") === normalizeNumber("mainland") === ""
    // — a numeric-only comparator would call these equal. They must NOT verify.
    const v = reconcileMetric(catFact("Barrier island"), catAssertion("Estuary"), NOW);
    expect(v.status).toBe("needs_review");
  });
});

// ---------------------------------------------------------------------------
// fresher_side + determinism
// ---------------------------------------------------------------------------

describe("fresher_side compares fetched_at day vs the token's YYYYMMDD tail", () => {
  function pair(fetchedAt: string, tokenDay: string) {
    const fact: LaneOneFact = {
      brain_id: "housing-swfl",
      metric_slug: "median_sale_price",
      label: "Median sale price",
      value: 362000,
      grain: "zip-month",
      source: { url: "x", fetched_at: fetchedAt, tier: 2, citation: "x" },
      expires: "2026-07-10T12:00:00Z",
    };
    const assertion: LaneTwoAssertion = {
      report_id: "housing-swfl",
      label: "Median sale price",
      value: "362000",
      freshness_token: `SWFL-7421-v5-${tokenDay}`,
      origin: "mcp",
    };
    return reconcileMetric(fact, assertion, "2026-06-15T00:00:00Z");
  }

  test("lake fetched after the token day → ours", () => {
    expect(pair("2026-06-12T12:00:00Z", "20260601").fresher_side).toBe("ours");
  });
  test("token day after the lake fetch → theirs", () => {
    expect(pair("2026-06-01T12:00:00Z", "20260612").fresher_side).toBe("theirs");
  });
  test("same day → tie", () => {
    expect(pair("2026-06-10T12:00:00Z", "20260610").fresher_side).toBe("tie");
  });
  test("an unparseable token tail → unknown", () => {
    expect(pair("2026-06-10T12:00:00Z", "notaday").fresher_side).toBe("unknown");
  });
});

test("determinism — same inputs + fixed now → byte-identical verdict", () => {
  const fx = needsReview as unknown as Fixture;
  const a = reconcileMetric(fx.fact, fx.assertion, fx.now);
  const b = reconcileMetric(fx.fact, fx.assertion, fx.now);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

describe("malformed numeric tokens fall to string compare, not a truncated-parse delta", () => {
  function fact(value: string): LaneOneFact {
    return {
      brain_id: "housing-swfl",
      metric_slug: "m",
      label: "L",
      value,
      grain: "zip-month",
      source: { url: "x", fetched_at: "2026-06-10T12:00:00Z", tier: 2, citation: "x" },
      expires: "2026-07-10T12:00:00Z",
    };
  }
  function assertion(value: string): LaneTwoAssertion {
    return {
      report_id: "housing-swfl",
      label: "L",
      value,
      freshness_token: "SWFL-7421-v5-20260610",
      origin: "mcp",
    };
  }
  const NOW = "2026-06-15T00:00:00Z";

  test("a version/range token vs another → needs_review with NO delta (parseFloat won't truncate it)", () => {
    // "1.2.3"/"1.2.4" would each parseFloat to 1.2 → a false delta of 0. The
    // strict-numeric gate routes them to the string compare instead.
    const v = reconcileMetric(fact("1.2.3"), assertion("1.2.4"), NOW);
    expect(v.status).toBe("needs_review");
    expect(v.delta_pct).toBeUndefined();
  });

  test("a range token '1-2' vs a clean number → needs_review, no delta", () => {
    const v = reconcileMetric(fact("12"), assertion("1-2"), NOW);
    expect(v.status).toBe("needs_review");
    expect(v.delta_pct).toBeUndefined();
  });
});

describe("default (live-clock) now — the path both production callers use", () => {
  function fact(expires: string): LaneOneFact {
    return {
      brain_id: "housing-swfl",
      metric_slug: "median_sale_price",
      label: "Median sale price",
      value: 362000,
      grain: "zip-month",
      source: { url: "x", fetched_at: "2026-06-10T12:00:00Z", tier: 2, citation: "x" },
      expires,
    };
  }
  const a: LaneTwoAssertion = {
    report_id: "housing-swfl",
    label: "Median sale price",
    value: "362000",
    freshness_token: "SWFL-7421-v5-20260610",
    origin: "mcp",
  };

  // Both bounds are decades from any plausible run time, so the live-clock
  // default lands strictly between them — deterministic, yet it fails loudly if
  // the default ever becomes a frozen / non-ISO value.
  test("far-PAST expires (no now arg) → cannot_assert_stale, value withheld", () => {
    const v = reconcileMetric(fact("1999-01-01T00:00:00Z"), a);
    expect(v.status).toBe("cannot_assert_stale");
    expect(v.ours).toBeUndefined();
  });

  test("far-FUTURE expires (no now arg) → proceeds to value compare → verified", () => {
    const v = reconcileMetric(fact("2999-01-01T00:00:00Z"), a);
    expect(v.status).toBe("verified");
  });
});
