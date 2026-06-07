import { test, expect } from "bun:test";
import { buildGroundingContext, type GroundingBlock } from "./grounding";
import type { Dossier } from "../fetch-brain";

function fakeDossier(token: string, withZips = false): Dossier {
  return {
    freshness_token: token,
    conclusion: "Housing is cooling.",
    direction: "bearish",
    magnitude: 0.4,
    confidence: 0.7,
    confidence_dispersion: 0.1,
    joint_integrity: 0.9,
    upstream_count: 3,
    drivers: [],
    key_metrics: [
      {
        metric: "median_price",
        value: "$525,000",
        source: {
          url: "https://x",
          fetched_at: "2026-06-01",
          tier: 2,
          citation: "Redfin",
        },
      } as any,
    ],
    detail_tables: withZips
      ? [
          {
            id: "housing_by_zip",
            title: "By ZIP",
            grain: "zip",
            columns: [
              {
                id: "median",
                label: "Median",
                display_format: "currency",
              } as any,
            ],
            rows: [
              { key: "34102", label: "Naples", cells: { median: 1850000 } },
              { key: "33904", label: "Cape Coral", cells: { median: 410000 } },
            ],
            source: {
              url: "https://x",
              fetched_at: "2026-06-01",
              tier: 2,
              citation: "Redfin",
            } as any,
          },
        ]
      : [],
    conditional_claims: [],
    grain_boundary: undefined,
    contradicts: [],
    caveats: [],
  };
}

test("primary freshness token is quoted exactly once", () => {
  const blocks: GroundingBlock[] = [
    { label: "Naples housing", dossier: fakeDossier("SWFL-7421-v5-20260607") },
  ];
  const ctx = buildGroundingContext({
    rules: "RULES",
    gazetteer: "GEO",
    blocks,
  });
  const matches = ctx.match(/SWFL-7421-v5-20260607/g) ?? [];
  expect(matches.length).toBe(1);
});

test("detail_tables rows are inlined so cross-area compare is in-context (R0)", () => {
  const blocks: GroundingBlock[] = [
    {
      label: "Naples housing",
      dossier: fakeDossier("SWFL-7421-v5-20260607", true),
    },
  ];
  const ctx = buildGroundingContext({
    rules: "RULES",
    gazetteer: "GEO",
    blocks,
  });
  expect(ctx).toContain("33904"); // Cape Coral row present even though page is Naples
  expect(ctx).toContain("1850000");
});

test("multiple blocks are labeled and ordered (reach blocks after primary)", () => {
  const blocks: GroundingBlock[] = [
    { label: "Naples housing", dossier: fakeDossier("SWFL-7421-v5-20260607") },
    {
      label: "Naples flood (env-swfl)",
      dossier: fakeDossier("SWFL-3000-v2-20260607"),
    },
  ];
  const ctx = buildGroundingContext({
    rules: "RULES",
    gazetteer: "GEO",
    blocks,
  });
  expect(ctx.indexOf("Naples housing")).toBeLessThan(
    ctx.indexOf("Naples flood"),
  );
});

test("cite-or-decline instruction is present", () => {
  const ctx = buildGroundingContext({
    rules: "RULES",
    gazetteer: "GEO",
    blocks: [{ label: "x", dossier: fakeDossier("t") }],
  });
  expect(ctx.toLowerCase()).toContain("decline");
});
