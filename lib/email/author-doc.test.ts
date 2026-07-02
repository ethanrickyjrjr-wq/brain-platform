/**
 * Build 03 proof gate — the AUTHOR engine's structural moat + layout guarantees,
 * demonstrated in code (the LIVE forced-tool author is the post-deploy verify; the
 * `next build` only proves compilation, never runs authorDoc). Mirrors the pattern
 * of lib/assistant/compose-chart.test.ts: the assembler is exported BECAUSE this is
 * where the moat lives, so it is tested directly. PURE — no LLM, no I/O.
 */
import { test, expect, describe } from "bun:test";
import {
  buildFigureMenu,
  figureMenuById,
  assembleAuthoredDoc,
  collectAnchorNumbers,
  lintAuthoredProse,
  AUTHOR_TOOL,
  type AssembleArgs,
} from "./author-doc";
import { DEFAULT_GLOBAL_STYLE } from "./doc/default-docs";
import { AuthorDocSchema, type AuthoredDoc } from "./doc/schema";
import type { EmailDoc } from "./doc/types";
import type { MarketFigure } from "./market-context";

const FIGURES: MarketFigure[] = [
  {
    key: "home_value",
    label: "Median home value — Naples (34102)",
    value: "$1,250,000",
    source: "Zillow ZHVI",
    as_of: "06/01/2026",
  },
  {
    key: "dom",
    label: "Average days on market",
    value: "47",
    source: "MLS active-listings",
    as_of: "06/01/2026",
  },
];
// menu ids: f0 = $1,250,000 · f1 = 47

function args(authored: AuthoredDoc, extra: Partial<AssembleArgs> = {}): AssembleArgs {
  const menu = buildFigureMenu(FIGURES);
  return {
    authored,
    figuresById: figureMenuById(menu),
    globalStyle: DEFAULT_GLOBAL_STYLE,
    anchorNumbers: collectAnchorNumbers(FIGURES),
    ...extra,
  };
}

function propsOf(block: EmailDoc["blocks"][number]): Record<string, unknown> {
  return block.props as Record<string, unknown>;
}

describe("id-selection (numeric fields are never typed by the model)", () => {
  test("value_figure → the figure's verbatim value fills the headline", () => {
    const doc = assembleAuthoredDoc(
      args({ blocks: [{ type: "hero", value_figure: "f0", kicker: "Spotlight" }] }),
    );
    const hero = doc.blocks.find((b) => b.type === "hero");
    expect(hero).toBeDefined();
    expect(propsOf(hero!).value).toBe("$1,250,000");
  });

  test("an unresolved value_figure blanks the field — never the placeholder default", () => {
    const doc = assembleAuthoredDoc(args({ blocks: [{ type: "hero", value_figure: "f99" }] }));
    const hero = doc.blocks.find((b) => b.type === "hero");
    expect(propsOf(hero!).value).toBe(""); // NOT the default "$485K"
    expect(JSON.stringify(doc)).not.toContain("485K");
  });
});

describe("stat-value moat (the prose lint never sees stats — assembly must guard)", () => {
  test("a literal stat number not in the menu is blanked; figure + qualitative cells survive", () => {
    const doc = assembleAuthoredDoc(
      args({
        blocks: [
          {
            type: "stats",
            stats: [
              { value: "$999,999", label: "Invented" }, // unanchored literal → blanked
              { value_figure: "f1", label: "DOM" }, // id-selected → verbatim "47"
              { value: "Buyer's market", label: "Climate" }, // qualitative → kept
            ],
          },
        ],
      }),
    );
    const stats = doc.blocks.find((b) => b.type === "stats");
    const cells = propsOf(stats!).stats as Array<{ value: string; label: string }>;
    expect(cells.find((c) => c.label === "Invented")?.value).toBe("");
    expect(cells.find((c) => c.label === "DOM")?.value).toBe("47");
    expect(cells.find((c) => c.label === "Climate")?.value).toBe("Buyer's market");
    // The invented number never appears ANYWHERE in the doc.
    expect(JSON.stringify(doc)).not.toContain("999,999");
  });

  test("a stats block with no resolvable cells is dropped (never ships placeholders)", () => {
    const doc = assembleAuthoredDoc(
      args({ blocks: [{ type: "stats", stats: [{ value: "", label: "" }] }] }),
    );
    expect(doc.blocks.some((b) => b.type === "stats")).toBe(false);
  });
});

describe("no-invention prose lint (gateNarrative philosophy)", () => {
  test("strips a sentence with an unanchored number, keeps anchored, exempts a bare year", () => {
    const doc: EmailDoc = {
      globalStyle: DEFAULT_GLOBAL_STYLE,
      blocks: [
        {
          id: "b1",
          type: "hero",
          props: {
            prose:
              "The median is $1,250,000 today. Prices jumped 73% overnight. Outlook for 2026 holds.",
          },
          layout: { x: 0, y: 0, w: 12, h: 1 },
        },
      ],
    };
    const r = lintAuthoredProse(doc, collectAnchorNumbers(FIGURES));
    const prose = propsOf(r.stripped.blocks[0]).prose as string;
    expect(prose).toContain("$1,250,000"); // anchored → survives
    expect(prose).not.toContain("73%"); // unanchored → stripped
    expect(prose).toContain("2026"); // bare year → exempt
    expect(r.ok).toBe(false);
  });

  test("a clean doc (only anchored numbers) passes untouched", () => {
    const doc: EmailDoc = {
      globalStyle: DEFAULT_GLOBAL_STYLE,
      blocks: [
        {
          id: "b1",
          type: "hero",
          props: { prose: "Homes sit 47 days on market." },
          layout: { x: 0, y: 0, w: 12, h: 1 },
        },
      ],
    };
    const r = lintAuthoredProse(doc, collectAnchorNumbers(FIGURES));
    expect(r.ok).toBe(true);
    expect(propsOf(r.stripped.blocks[0]).prose).toBe("Homes sit 47 days on market.");
  });
});

describe("structural guarantees", () => {
  test("a footer is always present and static, even when the model omits one", () => {
    const doc = assembleAuthoredDoc(args({ blocks: [{ type: "text", body: "Hi" }] }));
    const footer = doc.blocks.find((b) => b.type === "footer");
    expect(footer).toBeDefined();
    expect(footer!.layout?.static).toBe(true);
  });

  test("an unknown block type is dropped (vocabulary is the ONE root)", () => {
    const doc = assembleAuthoredDoc(
      args({ blocks: [{ type: "text", body: "ok" }, { type: "totally-made-up" }] }),
    );
    expect(doc.blocks.some((b) => b.type === "totally-made-up")).toBe(false);
    expect(doc.blocks.some((b) => b.type === "text")).toBe(true);
  });

  test("an offered-but-unplaced chart & photo are reserved in real rows — never bottom-dumped", () => {
    const doc = assembleAuthoredDoc(
      args(
        { blocks: [{ type: "hero", kicker: "Hi" }] },
        {
          chart: { url: "https://x/chart.png", alt: "chart" },
          photo: { url: "https://x/photo.jpg", alt: "photo" },
        },
      ),
    );
    const images = doc.blocks.filter((b) => b.type === "image");
    expect(images.length).toBe(2); // both reserved
    // every block has a real, small y — none parked at the huge fallbackY.
    for (const b of doc.blocks) {
      expect(b.layout).toBeDefined();
      expect(b.layout!.y).toBeLessThan(1000);
    }
    const photo = images.find((b) => propsOf(b).kind === "photo");
    const footer = doc.blocks.find((b) => b.type === "footer");
    expect(photo!.layout!.y).toBeLessThan(footer!.layout!.y); // photo leads, footer trails
  });
});

describe("semantic layout → bounds-correct coordinates", () => {
  test("new_row:false places blocks side-by-side; the row fills 12 columns", () => {
    const doc = assembleAuthoredDoc(
      args({
        blocks: [
          { type: "stats", new_row: true, span: 6, stats: [{ value_figure: "f1", label: "DOM" }] },
          {
            type: "stats",
            new_row: false,
            span: 6,
            stats: [{ value_figure: "f0", label: "Value" }],
          },
        ],
      }),
    );
    const stats = doc.blocks.filter((b) => b.type === "stats");
    expect(stats.length).toBe(2);
    expect(stats[0].layout!.y).toBe(stats[1].layout!.y); // same row
    expect(stats[0].layout!.x).toBe(0);
    expect(stats[1].layout!.x).toBe(6);
    expect(stats[0].layout!.w + stats[1].layout!.w).toBe(12); // fills the row edge-to-edge
  });

  test("a single block is full-bleed (span forced to 12)", () => {
    const doc = assembleAuthoredDoc(args({ blocks: [{ type: "text", span: 4, body: "Solo" }] }));
    const text = doc.blocks.find((b) => b.type === "text");
    expect(text!.layout!.w).toBe(12);
    expect(text!.layout!.x).toBe(0);
  });
});

describe("schedule_suggestion", () => {
  test("AuthorDocSchema accepts an optional schedule_suggestion", () => {
    const parsed = AuthorDocSchema.safeParse({
      blocks: [{ type: "footer" }],
      schedule_suggestion: { cadence: "weekly", reason: "Reads like a recurring market update." },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.schedule_suggestion?.cadence).toBe("weekly");
  });

  test("AuthorDocSchema is still valid with schedule_suggestion omitted", () => {
    const parsed = AuthorDocSchema.safeParse({ blocks: [{ type: "footer" }] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.schedule_suggestion).toBeUndefined();
  });

  test("AUTHOR_TOOL.input_schema declares schedule_suggestion as optional (not in required)", () => {
    expect(AUTHOR_TOOL.input_schema.required).toEqual(["blocks"]);
    expect(AUTHOR_TOOL.input_schema.properties).toHaveProperty("schedule_suggestion");
  });
});
