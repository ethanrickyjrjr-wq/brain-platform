// lib/email/outreach/demo-content.test.ts
import { describe, expect, test } from "bun:test";
import { buildDemoTouch, type DemoRecipientRow } from "./demo-content";
import type { AssembledReport } from "@/lib/email/activation/snapshot";
import type { ActivationSnapshot } from "@/lib/email/activation/types";
import type { MarketFigure } from "@/lib/email/market-context";

const RID = "3f6c2a1e-9b4d-4e6f-8a2b-1c5d7e9f0a1b";
const ORIGIN = "https://www.swfldatagulf.com";
const TOKEN = "SWFL-7421-v5-20260702";

const snapshotAt = (medianSale: number, capturedAt: string): ActivationSnapshot => ({
  zip: "34103",
  freshness_token: TOKEN,
  captured_at: capturedAt,
  metrics: [
    {
      key: "housing.median_sale_price",
      label: "Median sale price",
      value: medianSale,
      unit: "$",
      direction: "neutral",
    },
    {
      key: "housing.median_dom",
      label: "Median days on market",
      value: 41,
      unit: " days",
      direction: "lower_is_better",
    },
  ],
  lines: [],
});

const report = (medianSale: number): AssembledReport =>
  ({
    in_scope: true,
    zip: "34103",
    primaryPlace: "Park Shore",
    countyName: "Collier",
    freshness_token: TOKEN,
    metrics: [
      {
        key: "housing.median_sale_price",
        label: "Median sale price",
        value: medianSale,
        unit: "$",
      },
      { key: "housing.median_dom", label: "Median days on market", value: 41, unit: " days" },
      { key: "housing.homes_sold", label: "Homes sold", value: 58, unit: "" },
      { key: "housing.inventory", label: "Inventory", value: 402, unit: "" },
    ],
    lines: [],
    coverage_caveats: [],
    snapshot: snapshotAt(medianSale, "2026-07-03T14:00:00.000Z"),
  }) as unknown as AssembledReport;

const figures: MarketFigure[] = [
  { key: "active", label: "Active listings in 34103", value: "214", source: "SWFL Data Gulf" },
  { key: "median_list", label: "Median list price", value: "$1,240,000", source: "SWFL Data Gulf" },
  { key: "dom", label: "Average days on market", value: "63", source: "SWFL Data Gulf" },
  { key: "noise", label: "Unrelated", value: "999", source: "Elsewhere" },
];

const rec = (over: Partial<DemoRecipientRow> = {}): DemoRecipientRow => ({
  id: RID,
  email: "dana@example.com",
  name: "Dana",
  zip: "34103",
  track: "agent",
  subject_variant: "a",
  brand: {
    primary: "#670038",
    accent: "#ab8f40",
    logoUrl: "https://cdn.example.com/logo.png",
    companyName: "BHHS Florida Realty",
  },
  snapshot: null,
  ...over,
});

const deps = (medianSale = 912000) => ({
  assembleReport: async () => report(medianSale),
  loadFigures: async () => figures,
});

describe("gates", () => {
  test("missing zip → null", async () => {
    expect(await buildDemoTouch(rec({ zip: null }), "t1", ORIGIN, deps())).toBeNull();
  });
  test("out-of-scope report → null", async () => {
    const d = {
      ...deps(),
      assembleReport: async () => ({ ...report(1), in_scope: false }) as AssembledReport,
    };
    expect(await buildDemoTouch(rec(), "t1", ORIGIN, d)).toBeNull();
  });
});

describe("t1", () => {
  test("assembles subject, 3 cited stats, buttons, snapshot — and never the raw token", async () => {
    const c = await buildDemoTouch(rec(), "t1", ORIGIN, deps());
    expect(c).not.toBeNull();
    expect(c!.subject).toBe("Dana, the Park Shore email your clients didn't get this morning");
    expect(c!.stats).toEqual([
      { label: "Active listings in 34103", value: "214", source: "SWFL Data Gulf" },
      { label: "Median list price", value: "$1,240,000", source: "SWFL Data Gulf" },
      { label: "Average days on market", value: "63", source: "SWFL Data Gulf" },
    ]);
    expect(c!.asOf).toBe("07/02/2026");
    expect(c!.freshnessLine).toBe("Live Southwest Florida data — as of 07/02/2026");
    expect(c!.chart?.subtitle).toBe("as of 07/02/2026");
    expect(c!.snapshot).not.toBeNull();
    expect(c!.promptButtons).toHaveLength(3);
    for (const b of c!.promptButtons) {
      expect(b.url).toContain("prompt=");
      expect(b.url).toContain(`ref=${RID}-t1`);
      expect(b.url.startsWith(`${ORIGIN}/welcome?`)).toBe(true);
    }
    expect(c!.ctaUrl).toContain(`ref=${RID}-t1`);
    expect(c!.ctaUrl).not.toContain("prompt=");
    expect(c!.sources).toEqual(["SWFL Data Gulf"]);
    expect(JSON.stringify({ ...c, snapshot: null })).not.toMatch(/SWFL-\d+-v\d+-\d{8}/);
  });
  test("variant b subject carries the real active-listings figure", async () => {
    const c = await buildDemoTouch(rec({ subject_variant: "b" }), "t1", ORIGIN, deps());
    expect(c!.subject).toBe(
      "Park Shore: 214 active listings — your clients could've had this by 9 AM",
    );
  });
});

describe("t2 delta", () => {
  test("moved median → delta line + $K subject with T1 weekday", async () => {
    // frozen at $899,000 on Tuesday 06/30; fresh report says $912,000 → +$13K
    const r = rec({ snapshot: snapshotAt(899000, "2026-06-30T14:00:00.000Z") });
    const c = await buildDemoTouch(r, "t2", ORIGIN, deps(912000));
    expect(c!.subject).toBe("Park Shore's median moved $13K since Tuesday");
    expect(c!.deltaLine).toBe("Median sale price: $899,000 → $912,000");
  });
  test("nothing moved → honest re-verified framing", async () => {
    const r = rec({ snapshot: snapshotAt(912000, "2026-06-30T14:00:00.000Z") });
    const c = await buildDemoTouch(r, "t2", ORIGIN, deps(912000));
    expect(c!.subject).toBe("Park Shore re-checked Tuesday — your numbers held");
    expect(c!.deltaLine).toBe("We re-checked every number we showed you — where it stands today:");
  });
});

describe("track copy", () => {
  test("t3 broker names the three CRMs + plug-in offer; no competitor pricing", async () => {
    const c = await buildDemoTouch(rec({ track: "broker" }), "t3", ORIGIN, deps());
    expect(c!.bodyHtml).toContain("MoxiWorks");
    expect(c!.bodyHtml).toContain("BoldTrail");
    expect(c!.bodyHtml).toContain("Follow Up Boss");
    expect(c!.bodyHtml).toContain("Send us any export of your data");
    expect(c!.bodyHtml).not.toMatch(/\$\d+.*\/(user|mo)/);
  });
  test("t4 has no prompt buttons and the one-link CTA", async () => {
    const c = await buildDemoTouch(rec(), "t4", ORIGIN, deps());
    expect(c!.promptButtons).toEqual([]);
    expect(c!.ctaLabel).toBe("Everything we built for you, one link");
    expect(c!.snapshot).toBeNull();
  });
});

describe("anchors", () => {
  test("every displayed figure is anchored", async () => {
    const c = await buildDemoTouch(rec(), "t1", ORIGIN, deps());
    const anchors = c!.anchors.map(String);
    for (const v of ["214", "$1,240,000", "63", "07/02/2026", "34103"])
      expect(anchors).toContain(v);
    for (const d of c!.chart!.data) expect(c!.anchors).toContain(d.value);
  });
});
