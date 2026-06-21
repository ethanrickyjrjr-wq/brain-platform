import { describe, expect, it, spyOn } from "bun:test";
import {
  verifyMetricItem,
  parseGroundedResponse,
  type LookupFn,
  type LookupOpts,
  type GroundedResult,
} from "./data-readiness";
import { splitDomains } from "./verification-sources";
import type { ProjectItem } from "@/lib/project/items";

type MetricItem = Extract<ProjectItem, { kind: "metric" }>;

function metricItem(over: Partial<MetricItem> = {}): MetricItem {
  return {
    kind: "metric",
    report_id: "r1",
    label: "30-year mortgage rate",
    value: "6.75%",
    freshness_token: "SWFL-7421-v5-20260610",
    metric_slug: "mortgage_rate_30yr_swfl",
    ...over,
  } as MetricItem;
}

/** Build a LookupFn from a synchronous impl over the opts. */
function fakeLookup(impl: (o: LookupOpts) => GroundedResult): LookupFn {
  return async (o) => impl(o);
}

/** Wrap a LookupFn to count grounded vs ungrounded invocations. */
function countingLookup(impl: (o: LookupOpts) => GroundedResult): {
  fn: LookupFn;
  grounded: () => number;
  ungrounded: () => number;
} {
  let g = 0;
  let u = 0;
  const fn: LookupFn = async (o) => {
    if (o.grounded) g++;
    else u++;
    return impl(o);
  };
  return { fn, grounded: () => g, ungrounded: () => u };
}

const ASOF = new Date("2026-06-20T14:00:00.000Z");
const NONE: GroundedResult = { value: null, sourceUrls: [], error: null };

// ── splitDomains ──────────────────────────────────────────────────────────────

describe("splitDomains", () => {
  it("alternates by index into two disjoint groups", () => {
    expect(splitDomains(["a", "b", "c", "d"])).toEqual([
      ["a", "c"],
      ["b", "d"],
    ]);
  });

  it("returns an empty second group for a single-domain metric", () => {
    expect(splitDomains(["bls.gov"])).toEqual([["bls.gov"], []]);
  });

  it("handles an empty list", () => {
    expect(splitDomains([])).toEqual([[], []]);
  });
});

// ── parseGroundedResponse ─────────────────────────────────────────────────────

describe("parseGroundedResponse", () => {
  it("extracts the last ANSWER line and unions+dedupes cited URLs", () => {
    const content = [
      { type: "text", text: "Let me search." },
      {
        type: "server_tool_use",
        id: "srv1",
        name: "web_search",
        input: { query: "mortgage rate" },
      },
      {
        type: "web_search_tool_result",
        tool_use_id: "srv1",
        content: [
          { type: "web_search_result", url: "https://freddiemac.com/pmms", title: "PMMS" },
          { type: "web_search_result", url: "https://bankrate.com/x", title: "Bankrate" },
        ],
      },
      {
        type: "text",
        text: "The current rate is 6.75%.\nANSWER: 6.75%",
        citations: [
          { type: "web_search_result_location", url: "https://freddiemac.com/pmms", title: "PMMS" },
        ],
      },
    ];
    const out = parseGroundedResponse(content);
    expect(out.answer).toBe("6.75%");
    expect(out.searchError).toBeNull();
    // freddiemac appears in both a result and a citation → deduped to one
    expect(out.sourceUrls.sort()).toEqual([
      "https://bankrate.com/x",
      "https://freddiemac.com/pmms",
    ]);
  });

  it("takes the LAST ANSWER across accumulated text blocks (pause_turn supersession)", () => {
    const content = [
      { type: "text", text: "Initial estimate.\nANSWER: 6.50%" },
      {
        type: "web_search_tool_result",
        content: [{ type: "web_search_result", url: "https://freddiemac.com/pmms" }],
      },
      { type: "text", text: "After a refined search.\nANSWER: 6.75%" },
    ];
    const out = parseGroundedResponse(content);
    expect(out.answer).toBe("6.75%"); // later block wins
    expect(out.sourceUrls).toEqual(["https://freddiemac.com/pmms"]);
  });

  it("collects URLs from citations alone when no web_search_result block is present", () => {
    const content = [
      {
        type: "text",
        text: "ANSWER: 6.75%",
        citations: [
          { type: "web_search_result_location", url: "https://freddiemac.com/pmms", title: "PMMS" },
        ],
      },
    ];
    const out = parseGroundedResponse(content);
    expect(out.answer).toBe("6.75%");
    expect(out.sourceUrls).toEqual(["https://freddiemac.com/pmms"]);
  });

  it("detects a web_search_tool_result_error block", () => {
    const content = [
      {
        type: "web_search_tool_result",
        tool_use_id: "srv1",
        content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
      },
      { type: "text", text: "ANSWER: UNKNOWN" },
    ];
    const out = parseGroundedResponse(content);
    expect(out.searchError).toBe("max_uses_exceeded");
    expect(out.answer).toBeNull(); // UNKNOWN → null
  });

  it("returns null answer when no ANSWER line is present", () => {
    const out = parseGroundedResponse([{ type: "text", text: "The rate is around 6.75%." }]);
    expect(out.answer).toBeNull();
  });
});

// ── verifyMetricItem ladder ───────────────────────────────────────────────────

describe("verifyMetricItem", () => {
  it("TIER 1: two grounded sources agree within tolerance → web_consensus", async () => {
    const counter = countingLookup((o) =>
      o.grounded
        ? { value: "6.80%", sourceUrls: [`https://${o.allowedDomains?.[0]}/x`], error: null }
        : NONE,
    );
    const res = await verifyMetricItem(metricItem(), ASOF, { lookup: counter.fn });
    expect(res.tier_used).toBe("web_consensus");
    expect(res.value_used).toBe("6.80%");
    expect(res.source_urls.length).toBe(2); // one per disjoint group, deduped
    expect(res.within_tolerance).toBe(true); // 6.80 vs snapshot 6.75, abs tol 0.15
    expect(res.grounding_error).toBeNull();
    expect(counter.grounded()).toBe(2); // exactly two grounded calls
    expect(counter.ungrounded()).toBe(0); // no ungrounded fallback
  });

  it("a present-but-set error on both grounded calls does NOT suppress a usable consensus value", async () => {
    const res = await verifyMetricItem(metricItem(), ASOF, {
      lookup: fakeLookup((o) =>
        o.grounded
          ? { value: "6.80%", sourceUrls: ["https://x/y"], error: "max_uses_exceeded" }
          : NONE,
      ),
    });
    expect(res.tier_used).toBe("web_consensus"); // .error is advisory, not a tier gate
    expect(res.value_used).toBe("6.80%");
  });

  it("TIER 2: two grounded sources DISAGREE → web_single, flagged out-of-tolerance, both sources kept", async () => {
    const res = await verifyMetricItem(metricItem(), ASOF, {
      lookup: fakeLookup((o) => {
        if (!o.grounded) return NONE;
        const isGroupA = o.allowedDomains?.includes("freddiemac.com");
        return isGroupA
          ? { value: "6.75%", sourceUrls: ["https://freddiemac.com/x"], error: null }
          : { value: "9.00%", sourceUrls: ["https://bankrate.com/x"], error: null };
      }),
    });
    expect(res.tier_used).toBe("web_single");
    expect(res.value_used).toBe("6.75%"); // group A's value is reported
    expect(res.within_tolerance).toBe(false); // a contradicted reading is NOT clean
    expect(res.source_urls.sort()).toEqual(["https://bankrate.com/x", "https://freddiemac.com/x"]);
  });

  it("one grounded side non-numeric → web_single picks the numeric side (its sources only)", async () => {
    const res = await verifyMetricItem(metricItem(), ASOF, {
      lookup: fakeLookup((o) => {
        if (!o.grounded) return NONE;
        const isGroupA = o.allowedDomains?.includes("freddiemac.com");
        return isGroupA
          ? { value: "varies", sourceUrls: ["https://freddiemac.com/x"], error: null } // non-numeric
          : { value: "6.80%", sourceUrls: ["https://bankrate.com/x"], error: null };
      }),
    });
    expect(res.tier_used).toBe("web_single");
    expect(res.value_used).toBe("6.80%");
    expect(res.source_urls).toEqual(["https://bankrate.com/x"]); // numeric side only, not a union
  });

  it("single-domain metric (no disjoint second source) → one grounded call → web_single", async () => {
    const counter = countingLookup((o) => {
      expect(o.allowedDomains).toEqual(["bls.gov"]); // restricted to the single domain
      return o.grounded
        ? { value: "3.6%", sourceUrls: ["https://bls.gov/lau"], error: null }
        : NONE;
    });
    const res = await verifyMetricItem(
      metricItem({
        metric_slug: "unemployment_rate_lee",
        label: "unemployment rate",
        value: "3.5%",
      }),
      ASOF,
      { lookup: counter.fn },
    );
    expect(res.tier_used).toBe("web_single");
    expect(res.value_used).toBe("3.6%");
    expect(counter.grounded()).toBe(1); // exactly one grounded call
    expect(counter.ungrounded()).toBe(0);
  });

  it("non-numeric snapshot → within_tolerance defaults true (snapshotNum short-circuit)", async () => {
    const res = await verifyMetricItem(
      metricItem({ value: "Strong demand", metric_slug: "some_qual_metric" }),
      ASOF,
      {
        lookup: fakeLookup((o) =>
          o.grounded ? { value: "6.80%", sourceUrls: ["https://x/y"], error: null } : NONE,
        ),
      },
    );
    expect(res.tier_used).toBe("web_consensus");
    expect(res.within_tolerance).toBe(true); // can't compare → not flagged
  });

  it("TIER 3: no grounded value but model knows → model_only with NO sources (web sources dropped)", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const res = await verifyMetricItem(metricItem(), ASOF, {
      lookup: fakeLookup((o) =>
        o.grounded
          ? NONE
          : // ungrounded returns sources to prove model_only discards them
            { value: "6.90%", sourceUrls: ["https://example.com/should-be-dropped"], error: null },
      ),
    });
    expect(res.tier_used).toBe("model_only");
    expect(res.value_used).toBe("6.90%");
    expect(res.source_urls).toEqual([]); // ungrounded answer carries no sources
    expect(warn).toHaveBeenCalled(); // LOUD: fall-through is logged, not silent
    warn.mockRestore();
  });

  it("TIER 4: everything fails but token is fresh → last_known", async () => {
    const res = await verifyMetricItem(
      metricItem({ freshness_token: "SWFL-7421-v5-20260610" }), // 10 days before ASOF, max_stale 14
      ASOF,
      { lookup: fakeLookup(() => NONE) },
    );
    expect(res.tier_used).toBe("last_known");
    expect(res.value_used).toBe("6.75%");
  });

  it("staleness boundary is inclusive: ageDays == max_stale_days → last_known, +1 → omitted", async () => {
    const onBoundary = await verifyMetricItem(
      metricItem({ freshness_token: "SWFL-7421-v5-20260606" }), // exactly 14 days
      ASOF,
      { lookup: fakeLookup(() => NONE) },
    );
    expect(onBoundary.tier_used).toBe("last_known");

    const justOver = await verifyMetricItem(
      metricItem({ freshness_token: "SWFL-7421-v5-20260605" }), // 15 days
      ASOF,
      { lookup: fakeLookup(() => NONE) },
    );
    expect(justOver.tier_used).toBe("omitted");
  });

  it("freshness_token with no trailing 8-digit date → omitted (the $ anchor is load-bearing)", async () => {
    const res = await verifyMetricItem(metricItem({ freshness_token: "SWFL-7421-v5" }), ASOF, {
      lookup: fakeLookup(() => NONE),
    });
    expect(res.tier_used).toBe("omitted");
  });

  it("TIER 5: everything fails and token is stale → omitted", async () => {
    const res = await verifyMetricItem(
      metricItem({ freshness_token: "SWFL-7421-v5-20260501" }), // ~50 days before ASOF, > max_stale 14
      ASOF,
      { lookup: fakeLookup(() => NONE) },
    );
    expect(res.tier_used).toBe("omitted");
    expect(res.value_used).toBeNull();
  });

  it("surfaces a grounded web_search error on grounding_error when it falls back", async () => {
    const res = await verifyMetricItem(metricItem(), ASOF, {
      lookup: fakeLookup((o) =>
        o.grounded ? { value: null, sourceUrls: [], error: "unavailable" } : NONE,
      ),
    });
    // grounded errored, model knows nothing → falls to fresh last_known, error preserved
    expect(res.tier_used).toBe("last_known");
    expect(res.grounding_error).toBe("unavailable"); // "grounding broke" is recorded, not lost
  });
});
