import { describe, test, expect } from "bun:test";
import {
  buildRenderModel,
  checkSocialGrain,
  type Narrative,
  type SnapshotItem,
  type ExhibitSlot,
  type StatSlot,
  type SectionSlot,
} from "../templates";
import { DELIVERABLE_TEMPLATES, isTemplateId } from "../assemble";

// ---------------------------------------------------------------------------
// Fixtures — mirror templates.test.ts so the regression comparison is honest.
// ---------------------------------------------------------------------------

const NARRATIVE: Narrative = {
  exec_summary: "Lee County vacancy is tightening. New supply is constrained.",
  sections: [
    { title: "Market Conditions", intro: "Vacancy has dropped 80bps YoY." },
    { title: "Value Drivers", intro: "Cap rate compression signals demand." },
  ],
  inference_notes: [
    "[INFERENCE] If vacancy falls below 5%, expect 10–15% rent growth (falsifier: new pipeline > 500k sqft).",
  ],
};

const BRANDING: Record<string, unknown> = { logo: "acme.svg", color: "#002D62" };

// Two exhibit-able items (chart + table_slice) and three metrics — same as the
// canonical fixture — so we can prove social trims to ONE of each.
const ITEMS: SnapshotItem[] = [
  {
    kind: "chart",
    id: "item-chart-1",
    added_at: "2026-06-10T00:00:00Z",
    origin: "web",
    chart_id: "chart-abc",
    title: "Vacancy by Corridor",
    chart_block: {
      title: "Vacancy by Corridor",
      columns: ["Corridor", "Vacancy %"],
      rows: [
        ["Airport-Pulling", 4.2],
        ["Bonita", 5.1],
      ],
    },
  },
  {
    kind: "table_slice",
    id: "item-table-1",
    added_at: "2026-06-10T00:00:00Z",
    origin: "web",
    report_id: "cre-swfl",
    title: "Absorption Summary",
    columns: ["Quarter", "Net SF"],
    rows: [["Q1 2026", 12000]],
    source_url: "https://swfldatagulf.com/r/cre-swfl",
    freshness_token: "SWFL-7421-v5-20260610",
  },
  {
    kind: "metric",
    id: "item-metric-1",
    added_at: "2026-06-10T00:00:00Z",
    origin: "web",
    report_id: "cre-swfl",
    label: "Asking Rent $/sqft",
    value: "$28.40",
    source_url: "https://swfldatagulf.com/r/cre-swfl",
    source_label: "CRE SWFL",
    freshness_token: "SWFL-7421-v5-20260610",
  },
  {
    kind: "metric",
    id: "item-metric-2",
    added_at: "2026-06-10T00:00:00Z",
    origin: "web",
    report_id: "cre-swfl",
    label: "Vacancy Rate",
    value: "4.8%",
    freshness_token: "SWFL-7421-v5-20260610",
  },
  {
    kind: "metric",
    id: "item-metric-3",
    added_at: "2026-06-10T00:00:00Z",
    origin: "mcp",
    report_id: "cre-swfl",
    label: "Cap Rate",
    value: "5.9%",
    freshness_token: "SWFL-7421-v5-20260610",
  },
  {
    kind: "source",
    id: "item-source-1",
    added_at: "2026-06-10T00:00:00Z",
    origin: "web",
    table: "cre_swfl",
    url: "https://swfldatagulf.com/r/cre-swfl",
    label: "CRE SWFL Brain",
  },
];

// ---------------------------------------------------------------------------
// buildRenderModel — "social" is a single-visual, headline-first card
// ---------------------------------------------------------------------------

describe('buildRenderModel — "social" single-visual model', () => {
  test("template id is registered as a deliverable template", () => {
    expect(DELIVERABLE_TEMPLATES.has("social")).toBe(true);
    expect(isTemplateId("social")).toBe(true);
  });

  test("first slot is the exec_summary (headline-first)", () => {
    const model = buildRenderModel("social", NARRATIVE, ITEMS, BRANDING);
    expect(model.slots[0].kind).toBe("exec_summary");
    expect((model.slots[0] as { text: string }).text).toBe(NARRATIVE.exec_summary);
  });

  test("yields AT MOST ONE exhibit slot (the single visual) even with 2 exhibits filed", () => {
    const model = buildRenderModel("social", NARRATIVE, ITEMS, BRANDING);
    const exhibitSlots = model.slots.filter((s) => s.kind === "exhibit") as ExhibitSlot[];
    expect(exhibitSlots.length).toBe(1);
    // It is the FIRST filed exhibit (deterministic first-N), not a re-ranked pick.
    expect(exhibitSlots[0].exhibit_kind).toBe("chart");
    expect(exhibitSlots[0].chart_block?.title).toBe("Vacancy by Corridor");
  });

  test("yields AT MOST ONE lead stat even with 3 metrics filed", () => {
    const model = buildRenderModel("social", NARRATIVE, ITEMS, BRANDING);
    const statSlots = model.slots.filter((s) => s.kind === "stat") as StatSlot[];
    expect(statSlots.length).toBe(1);
    expect(statSlots[0].label).toBe("Asking Rent $/sqft");
    expect(statSlots[0].value).toBe("$28.40");
  });

  test("emits NO section slots — a card is one idea, not a long-form body", () => {
    const model = buildRenderModel("social", NARRATIVE, ITEMS, BRANDING);
    const sectionSlots = model.slots.filter((s) => s.kind === "section") as SectionSlot[];
    expect(sectionSlots.length).toBe(0);
  });

  test("carries a sources slot — provenance survives onto the card", () => {
    const model = buildRenderModel("social", NARRATIVE, ITEMS, BRANDING);
    const sourcesSlot = model.slots.find((s) => s.kind === "sources");
    expect(sourcesSlot).toBeDefined();
    if (!sourcesSlot || sourcesSlot.kind !== "sources") throw new Error("no sources slot");
    expect(sourcesSlot.sources.map((s) => s.url)).toContain("https://swfldatagulf.com/r/cre-swfl");
  });

  test("passes inference_notes through to the model", () => {
    const model = buildRenderModel("social", NARRATIVE, ITEMS, BRANDING);
    expect(model.inference_notes).toEqual(NARRATIVE.inference_notes);
  });

  test("carries branding through for the renderer", () => {
    const model = buildRenderModel("social", NARRATIVE, ITEMS, BRANDING);
    expect(model.branding).toEqual(BRANDING);
  });

  test("no-invention: stat/exhibit values are verbatim from the filed items only", () => {
    const model = buildRenderModel("social", NARRATIVE, ITEMS, BRANDING);
    const stat = model.slots.find((s) => s.kind === "stat") as StatSlot | undefined;
    // The single value on the card MUST be one of the filed metric values — never synthesized.
    const filedValues = ITEMS.filter((i) => i.kind === "metric").map(
      (m) => (m as { value: string }).value,
    );
    expect(filedValues).toContain(stat?.value);
  });

  test("never fabricates a stat/exhibit when none was filed (omits the slot)", () => {
    const headlineOnly: SnapshotItem[] = [
      {
        kind: "source",
        id: "s1",
        added_at: "2026-06-10T00:00:00Z",
        origin: "web",
        table: "macro_swfl",
        url: "https://swfldatagulf.com/r/macro-swfl",
        label: "Macro SWFL Brain",
      },
    ];
    const model = buildRenderModel("social", NARRATIVE, headlineOnly, BRANDING);
    expect(model.slots.filter((s) => s.kind === "stat").length).toBe(0);
    expect(model.slots.filter((s) => s.kind === "exhibit").length).toBe(0);
    // Headline + sources (+ inference) still render — the card simply has no number.
    expect(model.slots[0].kind).toBe("exec_summary");
    expect(model.slots.find((s) => s.kind === "sources")).toBeDefined();
  });

  test("deterministic — identical inputs produce deeply-equal output", () => {
    const a = buildRenderModel("social", NARRATIVE, ITEMS, BRANDING);
    const b = buildRenderModel("social", NARRATIVE, ITEMS, BRANDING);
    expect(a).toEqual(b);
  });

  test("filed qa + note are never dropped (spliced before sources)", () => {
    const withFiled: SnapshotItem[] = [
      ...ITEMS,
      {
        kind: "qa",
        id: "qa-1",
        added_at: "2026-06-10T00:00:00Z",
        origin: "mcp",
        report_id: "cre-swfl",
        question: "Is Lee County a good buy?",
        answer: "Absorption is outpacing new supply.",
        freshness_token: "SWFL-7421-v5-20260610",
      },
      {
        kind: "note",
        id: "note-1",
        added_at: "2026-06-10T00:00:00Z",
        origin: "web",
        text: "Client focus: office sector only.",
      },
    ];
    const model = buildRenderModel("social", NARRATIVE, withFiled, BRANDING);
    const qaIdx = model.slots.findIndex((s) => s.kind === "qa");
    const noteIdx = model.slots.findIndex((s) => s.kind === "note");
    const srcIdx = model.slots.findIndex((s) => s.kind === "sources");
    expect(qaIdx).toBeGreaterThanOrEqual(0);
    expect(noteIdx).toBeGreaterThanOrEqual(0);
    expect(qaIdx).toBeLessThan(srcIdx);
    expect(noteIdx).toBeLessThan(srcIdx);
  });
});

// ---------------------------------------------------------------------------
// checkSocialGrain — the MOAT: at-grain or refuse, never a representative ZIP
// ---------------------------------------------------------------------------

describe("checkSocialGrain — grain guard (the MOAT)", () => {
  test("no scope → whole-region post is allowed", () => {
    expect(checkSocialGrain(undefined, undefined)).toEqual({ ok: true });
  });

  test("county scope resolves AT-grain (not downcast to a ZIP)", () => {
    const guard = checkSocialGrain("county", "lee county");
    expect(guard.ok).toBe(true);
  });

  test("place scope resolves AT-grain (not downcast to a ZIP)", () => {
    const guard = checkSocialGrain("place", "naples");
    expect(guard.ok).toBe(true);
  });

  test("an in-footprint ZIP is allowed", () => {
    // 33901 (Fort Myers, Lee) is in fixtures/swfl-zip-county.json.
    expect(checkSocialGrain("zip", "33901").ok).toBe(true);
  });

  test("out-of-footprint ZIP REFUSES and never substitutes a representative ZIP", () => {
    // 90210 (Beverly Hills) is outside the 6-county footprint.
    const guard = checkSocialGrain("zip", "90210");
    expect(guard.ok).toBe(false);
    if (guard.ok) throw new Error("expected refusal");
    expect(guard.reason).toContain("outside the 6-county");
    // The refusal must NOT contain another ZIP-looking substitute.
    expect(guard.reason).not.toMatch(/\b3\d{4}\b/);
    expect(guard.held_grain).toBe("county");
  });

  test("unrecognized scope_kind REFUSES (corridor is not a deliverable grain yet)", () => {
    const guard = checkSocialGrain("corridor", "us-41");
    expect(guard.ok).toBe(false);
    if (guard.ok) throw new Error("expected refusal");
    expect(guard.reason).toContain("not a grain we hold");
  });
});

// ---------------------------------------------------------------------------
// REGRESSION — every OTHER template behaves EXACTLY as before this build.
// (These mirror the pre-existing assertions in templates.test.ts so a social
//  edit that disturbed a shared code path would fail here too.)
// ---------------------------------------------------------------------------

describe("regression — other templates unchanged after the social edit", () => {
  test("market-overview surfaces ALL exhibits (social's 1-cap does not leak)", () => {
    const model = buildRenderModel("market-overview", NARRATIVE, ITEMS, BRANDING);
    const exhibitSlots = model.slots.filter((s) => s.kind === "exhibit");
    expect(exhibitSlots.length).toBe(2); // chart + table_slice, uncapped
    expect(model.slots[0].kind).toBe("exec_summary");
  });

  test("one-pager still caps at ≤2 exhibits / ≤3 stats", () => {
    const model = buildRenderModel("one-pager", NARRATIVE, ITEMS, BRANDING);
    expect(model.slots.filter((s) => s.kind === "exhibit").length).toBeLessThanOrEqual(2);
    expect(model.slots.filter((s) => s.kind === "stat").length).toBeLessThanOrEqual(3);
  });

  test("bov-lite still puts the branding slot first", () => {
    const model = buildRenderModel("bov-lite", NARRATIVE, ITEMS, BRANDING);
    expect(model.slots[0].kind).toBe("branding");
  });

  test("client-email still leads with a subject-line section", () => {
    const model = buildRenderModel("client-email", NARRATIVE, ITEMS, BRANDING);
    expect(model.slots[0].kind).toBe("section");
    expect(model.slots[1].kind).toBe("exec_summary");
  });

  test('"email" still throws (renders via the grounded spine, not the slot model)', () => {
    expect(() => buildRenderModel("email", NARRATIVE, ITEMS, BRANDING)).toThrow(
      "email template renders via the grounded spine",
    );
  });
});
