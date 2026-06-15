import { test, expect, describe } from "bun:test";
import { toAssertion } from "./lane2";
import { factFromParsedBrain } from "./lane1";
import { reconcileMetric } from "./reconcile";
import { renderVerdictLine } from "./render-verdict";
import type { ProjectItem } from "../project/items";
import type { LaneTwoAssertion } from "./types";
import type { ParsedBrain } from "../../refinery/render/speaker.mts";
import type {
  BrainOutput,
  BrainOutputMetric,
  BrainOutputDetailTable,
} from "../../refinery/types/brain-output.mts";

/**
 * C-6 — the full lane-3 path end-to-end against fixtures (no B, no live brain):
 * a filed ProjectItem → toAssertion → factFromParsedBrain → reconcileMetric →
 * renderVerdictLine. The load-bearing assertion across every status: a stale or
 * out-of-grain figure NEVER surfaces in the rendered line.
 */

const SRC_CITATION = "SWFL Data Gulf — housing (fixture window)";

function metric(slug: string, label: string, value: number): BrainOutputMetric {
  return {
    metric: slug,
    value,
    direction: "stable",
    label,
    variable_type: "intensive",
    units: "USD",
    source: {
      url: "https://www.swfldatagulf.com/r/housing-swfl",
      fetched_at: "2026-06-10T12:00:00Z",
      tier: 2,
      citation: SRC_CITATION,
    },
  };
}

function zipTable(slug: string, label: string, zip: string, value: number): BrainOutputDetailTable {
  return {
    id: "by_zip",
    title: "By ZIP",
    grain: "zip",
    columns: [{ id: slug, label, display_format: "currency", units: "USD" }],
    rows: [{ key: zip, label: zip, cells: { [slug]: value } }],
    source: {
      url: "https://www.swfldatagulf.com/r/housing-swfl#zip",
      fetched_at: "2026-06-10T12:00:00Z",
      tier: 2,
      citation: SRC_CITATION,
    },
  };
}

function makeBrain(
  refined_at: string,
  key_metrics: BrainOutputMetric[],
  extra: Partial<BrainOutput> = {},
): ParsedBrain {
  const output: BrainOutput = {
    brain_id: "housing-swfl",
    version: 1,
    refined_at,
    direction: "neutral",
    magnitude: 0.5,
    drivers: [],
    overrides: [],
    conclusion: "test",
    key_metrics,
    caveats: [],
    contradicts: [],
    confidence: 0.8,
    joint_integrity: 1,
    confidence_dispersion: 0,
    chain_depth: 0,
    trust_tier: 2,
    upstream_count: 0,
    relevance: { decay_curve: "days", half_life_hours: 720, computed_at: refined_at },
    ...extra,
  };
  return {
    brain_id: "housing-swfl",
    version: 1,
    freshness_token: "SWFL-7421-v1-20260610",
    scope: "test",
    refined_at,
    output,
    raw_md: "",
  };
}

function metricItem(value: string, label = "Median sale price"): ProjectItem {
  return {
    id: "i1",
    added_at: "2026-06-10T00:00:00Z",
    origin: "mcp",
    kind: "metric",
    report_id: "housing-swfl",
    label,
    value,
    freshness_token: "SWFL-7421-v5-20260610",
  };
}

const NOW = "2026-06-15T00:00:00Z";
const FRESH = "2026-09-01T00:00:00Z"; // > NOW → fresh stamped expires
const PAST = "2026-05-01T00:00:00Z"; // < NOW → stale stamped expires

describe("end-to-end lane-3 path (ProjectItem → assertion → fact → verdict → line)", () => {
  test("verified: a matching, fresh assertion renders a clean cited line", () => {
    const assertion = toAssertion(metricItem("362000"))!;
    const brain = makeBrain(
      "2026-06-10T12:00:00Z",
      [metric("median_sale_price", "Median sale price", 362000)],
      { expires: FRESH },
    );
    const fact = factFromParsedBrain(
      "housing-swfl",
      brain,
      assertion.metric_slug ?? assertion.label,
    );
    const verdict = reconcileMetric(fact, assertion, NOW);
    expect(verdict.status).toBe("verified");
    const line = renderVerdictLine(verdict, assertion.label);
    expect(line.toLowerCase()).toContain("verified");
    expect(line).toContain("362000");
    // Phantom-data guard: the line cites the FIXTURE's real source, not a hardcoded live one.
    expect(line).toContain(SRC_CITATION);
  });

  test("needs_review: a fresh but differing assertion shows both numbers + delta", () => {
    const assertion = toAssertion(metricItem("360000"))!;
    const brain = makeBrain(
      "2026-06-10T12:00:00Z",
      [metric("median_sale_price", "Median sale price", 362000)],
      { expires: FRESH },
    );
    const fact = factFromParsedBrain("housing-swfl", brain, assertion.label);
    const verdict = reconcileMetric(fact, assertion, NOW);
    expect(verdict.status).toBe("needs_review");
    const line = renderVerdictLine(verdict, assertion.label);
    expect(line).toContain("360000");
    expect(line).toContain("362000");
  });

  test("cannot_assert_stale: a past-TTL lake fact refuses — the number NEVER surfaces", () => {
    const assertion = toAssertion(metricItem("362000"))!;
    const brain = makeBrain(
      "2026-04-01T12:00:00Z",
      [metric("median_sale_price", "Median sale price", 362000)],
      { expires: PAST },
    );
    const fact = factFromParsedBrain("housing-swfl", brain, assertion.label);
    const verdict = reconcileMetric(fact, assertion, NOW);
    expect(verdict.status).toBe("cannot_assert_stale");
    const line = renderVerdictLine(verdict, assertion.label);
    expect(line.toLowerCase()).toContain("expired");
    expect(line).not.toContain("362000"); // the load-bearing invariant
  });

  test("out_of_grain: a parcel assertion never fabricates below the ZIP grain we hold", () => {
    // ProjectItem carries no grain, so the parcel claim is built explicitly here.
    const assertion: LaneTwoAssertion = {
      report_id: "housing-swfl",
      label: "Median sale price",
      value: "489000",
      freshness_token: "SWFL-7421-v5-20260610",
      asserted_grain: "parcel",
      origin: "mcp",
    };
    const brain = makeBrain(
      "2026-06-10T12:00:00Z",
      [metric("median_sale_price", "Median sale price", 362000)],
      {
        expires: FRESH,
        detail_tables: [zipTable("median_sale_price", "Median sale price", "33908", 471000)],
      },
    );
    const fact = factFromParsedBrain("housing-swfl", brain, "median_sale_price", "33908");
    const verdict = reconcileMetric(fact, assertion, NOW);
    expect(verdict.status).toBe("out_of_grain");
    const line = renderVerdictLine(verdict, assertion.label);
    expect(line).toContain("zip"); // offers the grain we hold
    expect(line).not.toContain("489000"); // never echo their parcel claim as ours
  });

  test("not_found: an unresolvable label refuses cleanly, never claims 'expired'", () => {
    const assertion = toAssertion(metricItem("0.97", "List-to-sale ratio"))!;
    const brain = makeBrain(
      "2026-06-10T12:00:00Z",
      [metric("median_sale_price", "Median sale price", 362000)],
      { expires: FRESH },
    );
    const fact = factFromParsedBrain("housing-swfl", brain, assertion.label);
    expect(fact).toBeNull();
    const verdict = reconcileMetric(fact, assertion, NOW);
    expect(verdict.status).toBe("not_found");
    const line = renderVerdictLine(verdict, assertion.label);
    expect(line.toLowerCase()).not.toContain("expired");
    expect(line.toLowerCase()).toMatch(/pull|don't hold/);
  });

  test("uncataloged + unstamped brain → not_found, NOT stale (no false 'expired')", () => {
    const assertion: LaneTwoAssertion = {
      report_id: "home-values-swfl", // absent from BRAIN_CATALOG
      label: "Median sale price",
      value: "362000",
      freshness_token: "SWFL-7421-v5-20260610",
      origin: "mcp",
    };
    const brain = makeBrain("2026-06-10T12:00:00Z", [
      metric("median_sale_price", "Median sale price", 362000),
    ]); // no stamped expires
    const fact = factFromParsedBrain("home-values-swfl", brain, "median_sale_price");
    expect(fact!.expires).toBeUndefined();
    const verdict = reconcileMetric(fact, assertion, NOW);
    expect(verdict.status).toBe("not_found");
    expect(renderVerdictLine(verdict, assertion.label).toLowerCase()).not.toContain("expired");
  });
});
