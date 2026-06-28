import { describe, expect, it } from "bun:test";
import {
  looksLikeFigureAsk,
  parseMissingFigures,
  renderWebFallbackBlock,
  staleFiguresToRequests,
  webFallback,
  type WebFallbackResult,
} from "./web-fallback";
import type { ExternalPoint, ExternalRequest } from "./gap-fill";

describe("looksLikeFigureAsk — cheap cost gate before the web-fallback probe fires", () => {
  it("fires on a specific-figure SWFL ask", () => {
    expect(looksLikeFigureAsk("How many active listings are in Fort Myers right now?")).toBe(true);
    expect(looksLikeFigureAsk("median days on market in Cape Coral")).toBe(true);
    expect(looksLikeFigureAsk("what's the current 30-year mortgage rate?")).toBe(true);
    expect(looksLikeFigureAsk("how much inventory is there?")).toBe(true);
  });
  it("stays quiet on small talk that needs no live figure", () => {
    expect(looksLikeFigureAsk("hey, what's up?")).toBe(false);
    expect(looksLikeFigureAsk("thanks, that helps")).toBe(false);
  });
});

describe("parseMissingFigures — read the probe tool output into clean ExternalRequests", () => {
  it("extracts {label, search_query} pairs", () => {
    const raw = {
      missing: [
        { label: "Cape Coral active listings", search_query: "Cape Coral FL active listings 2026" },
        { label: "Cape Coral median DOM", search_query: "Cape Coral median days on market 2026" },
      ],
    };
    expect(parseMissingFigures(raw)).toEqual([
      { label: "Cape Coral active listings", search_query: "Cape Coral FL active listings 2026" },
      { label: "Cape Coral median DOM", search_query: "Cape Coral median days on market 2026" },
    ]);
  });
  it("drops malformed entries and caps the list at 3", () => {
    const raw = {
      missing: [
        { label: "a", search_query: "qa" },
        { label: "b" }, // no query → dropped
        { search_query: "qc" }, // no label → dropped
        { label: "d", search_query: "qd" },
        { label: "e", search_query: "qe" },
        { label: "f", search_query: "qf" },
      ],
    };
    const out = parseMissingFigures(raw);
    expect(out.map((r) => r.label)).toEqual(["a", "d", "e"]);
  });
  it("returns [] for empty / non-array / undefined", () => {
    expect(parseMissingFigures(undefined)).toEqual([]);
    expect(parseMissingFigures({ missing: [] })).toEqual([]);
    expect(parseMissingFigures({})).toEqual([]);
    expect(parseMissingFigures("nope")).toEqual([]);
  });
});

describe("webFallback — partition probed gaps into web-verified vs ask-the-user", () => {
  const probeReturns = (reqs: ExternalRequest[]) => async (): Promise<ExternalRequest[]> => reqs;

  it("verifies the figures the web could source and lists the rest as unfound", async () => {
    const reqs: ExternalRequest[] = [
      { label: "Cape Coral active listings", search_query: "q1" },
      { label: "Cape Coral median DOM", search_query: "q2" },
    ];
    const fill = async (r: ExternalRequest): Promise<ExternalPoint | null> =>
      r.label.includes("active listings")
        ? { label: r.label, value: 3128, url: "https://redfin.com/x", cited_text: "3,128 homes" }
        : null; // DOM not verifiable → unfound

    const out = await webFallback(
      "how many active listings and DOM in Cape Coral?",
      "HELD: prices only",
      {
        probe: probeReturns(reqs),
        fill,
      },
    );
    expect(out.verified).toEqual([
      {
        label: "Cape Coral active listings",
        value: 3128,
        url: "https://redfin.com/x",
        cited_text: "3,128 homes",
      },
    ]);
    expect(out.unfound).toEqual(["Cape Coral median DOM"]);
  });

  it("returns empty when the probe finds nothing missing (held data answers it)", async () => {
    let filled = 0;
    const out = await webFallback("what's driving prices?", "HELD: everything", {
      probe: probeReturns([]),
      fill: async () => {
        filled++;
        return null;
      },
    });
    expect(out).toEqual({ verified: [], unfound: [] });
    expect(filled).toBe(0); // never paid for a web search
  });

  it("never throws — a probe failure degrades to empty", async () => {
    const out = await webFallback("q", "held", {
      probe: async () => {
        throw new Error("probe boom");
      },
    });
    expect(out).toEqual({ verified: [], unfound: [] });
  });
});

describe("staleFiguresToRequests — turn stale held figures into forced web lookups", () => {
  it("builds a label + a source-guided search query per stale figure (default place)", () => {
    const reqs = staleFiguresToRequests([
      { label: "Median home value — Cape Coral (33904)", source: "Zillow ZHVI" },
      { label: "Average days on market", source: "MLS active-listings" },
    ]);
    expect(reqs).toHaveLength(2);
    expect(reqs[0].label).toBe("Median home value — Cape Coral (33904)");
    expect(reqs[0].search_query).toContain("Cape Coral");
    expect(reqs[0].search_query).toContain("Zillow"); // names the source for a focused search
    expect(reqs[1].search_query).toContain("Average days on market");
    // No place hint → fall back to the region anchor. The query carries only label + source
    // + place as guidance; it never injects a figure VALUE (gap-fill's verbatim-citation
    // check enforces the returned number is real).
    expect(reqs[0].search_query).toBe(
      "Median home value — Cape Coral (33904) Zillow ZHVI Southwest Florida current latest",
    );
  });

  it("anchors every query to the SCOPE place — so a place-less label can't drift to the metro", () => {
    // The bug a live run caught: "Home value, year over year" (no place in the label) pulled
    // the Cape Coral-Fort Myers METRO YoY instead of the 33904 ZIP. The scope hint pins it.
    const reqs = staleFiguresToRequests(
      [{ label: "Home value, year over year", source: "Zillow ZHVI" }],
      "33904 Florida",
    );
    expect(reqs[0].search_query).toBe(
      "Home value, year over year Zillow ZHVI 33904 Florida current latest",
    );
    expect(reqs[0].search_query).toContain("33904"); // pinned to the ZIP, not the metro
  });
});

describe("webFallback forced lane — refresh a STALE held figure the probe won't flag", () => {
  it("fills forced requests even when the probe returns nothing missing", async () => {
    // The operator case: we HOLD home value (April), so the probe sees it and returns [].
    // The forced lane refetches it anyway → the current cited value supersedes the stale one.
    let probeCalls = 0;
    const out = await webFallback(
      "build me an email about home values in Cape Coral",
      "HELD: home value (April)",
      {
        probe: async () => {
          probeCalls++;
          return [];
        },
        fill: async (r: ExternalRequest): Promise<ExternalPoint | null> => ({
          label: r.label,
          value: 412000,
          url: "https://www.zillow.com/cape-coral-fl/home-values/",
          cited_text: "$412,000",
        }),
        forced: [
          {
            label: "Median home value — Cape Coral",
            search_query: "Cape Coral FL Zillow home value latest",
          },
        ],
      },
    );
    expect(probeCalls).toBe(1);
    expect(out.verified).toEqual([
      {
        label: "Median home value — Cape Coral",
        value: 412000,
        url: "https://www.zillow.com/cape-coral-fl/home-values/",
        cited_text: "$412,000",
      },
    ]);
  });

  it("does not fetch the same label twice when probe and forced overlap", async () => {
    const fills: string[] = [];
    const out = await webFallback("home values", "HELD", {
      probe: async () => [{ label: "Home value", search_query: "from probe" }],
      fill: async (r: ExternalRequest): Promise<ExternalPoint | null> => {
        fills.push(r.search_query);
        return { label: r.label, value: 5, url: "https://zillow.com/x", cited_text: "5 units" };
      },
      forced: [{ label: "Home value", search_query: "from forced" }],
    });
    expect(out.verified).toHaveLength(1); // one figure, not two
    expect(fills).toEqual(["from forced"]); // forced wins; the probe duplicate is dropped
  });
});

describe("renderWebFallbackBlock — grounding text the answer model reads", () => {
  it("renders verified figures as a state-ONLY-these, cite-the-source block", () => {
    const r: WebFallbackResult = {
      verified: [
        {
          label: "Cape Coral active listings",
          value: 3128,
          url: "https://www.redfin.com/city/x",
          cited_text: "3,128",
        },
      ],
      unfound: [],
    };
    const block = renderWebFallbackBlock(r);
    expect(block).toContain("WEB-VERIFIED FIGURES");
    expect(block).toContain("Cape Coral active listings: 3128");
    expect(block).toContain("redfin.com"); // host of the citation, www-stripped
    expect(block).not.toContain("https://"); // the model gets the host, not a raw URL to echo
  });

  it("renders an unfound figure as an ask-the-user, never-invent block with the recurring-email caveat", () => {
    const r: WebFallbackResult = { verified: [], unfound: ["Cape Coral median DOM"] };
    const block = renderWebFallbackBlock(r);
    expect(block).toContain("Cape Coral median DOM");
    expect(block.toLowerCase()).toContain("ask the user");
    expect(block.toLowerCase()).toContain("recurring");
    expect(block.toLowerCase()).not.toContain("offer to pull"); // not a banned deflection phrase
  });

  it("renders nothing when there is no gap", () => {
    expect(renderWebFallbackBlock({ verified: [], unfound: [] })).toBe("");
  });
});
