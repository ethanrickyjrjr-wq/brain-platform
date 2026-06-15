import { test, expect, describe } from "bun:test";
import { lintVerdictFreshness, stripVerdictSentences, extractNumbers } from "./narrative-lint";
import type { Narrative } from "./templates";
import type { ReconciliationVerdict } from "../reconcile/types";

function staleVerdict(value: string): ReconciliationVerdict {
  return {
    status: "cannot_assert_stale",
    theirs: { value, freshness_token: "SWFL-7421-v3-20260401" },
    fresher_side: "unknown",
    reason: "lake fact expired 2026-05-01T12:00:00Z — refuse to assert; offer re-pull",
  };
}

function verifiedVerdict(value: string): ReconciliationVerdict {
  return {
    status: "verified",
    ours: {
      value: Number(value),
      metric_slug: "median_sale_price",
      expires: "2026-07-10T12:00:00Z",
      source: { url: "x", fetched_at: "2026-06-10T12:00:00Z", tier: 2, citation: "x" },
    },
    theirs: { value, freshness_token: "SWFL-7421-v5-20260610" },
    fresher_side: "tie",
    reason: 'value matches at "zip-month" and the lake fact is fresh',
  };
}

const NOW = "2026-06-15T00:00:00Z";

describe("lintVerdictFreshness — the ttl gate", () => {
  test("a stale figure asserted in the exec summary → one ttl violation", () => {
    const narrative: Narrative = {
      exec_summary: "The median sale price is $362,000 in this market.",
      sections: [],
      inference_notes: [],
    };
    const v = lintVerdictFreshness(narrative, [staleVerdict("362000")], NOW);
    expect(v).toHaveLength(1);
    expect(v[0].gate).toBe("ttl");
    expect(v[0].location).toBe("exec_summary");
    expect(v[0].token).toBe("$362,000");
  });

  test("a stale figure in a section intro → ttl violation with the section index", () => {
    const narrative: Narrative = {
      exec_summary: "",
      sections: [{ title: "Prices held firm", intro: "It sits at 362000 today." }],
      inference_notes: [],
    };
    const v = lintVerdictFreshness(narrative, [staleVerdict("$362,000")], NOW);
    expect(v).toHaveLength(1);
    expect(v[0].location).toBe("section_intro");
    expect(v[0].sectionIndex).toBe(0);
  });

  test("a FRESH (verified) verdict's value in prose → zero ttl violations", () => {
    const narrative: Narrative = {
      exec_summary: "The median sale price is $362,000.",
      sections: [],
      inference_notes: [],
    };
    expect(lintVerdictFreshness(narrative, [verifiedVerdict("362000")], NOW)).toHaveLength(0);
  });

  test("no verdicts → zero ttl violations", () => {
    const narrative: Narrative = {
      exec_summary: "The median sale price is $362,000.",
      sections: [],
      inference_notes: [],
    };
    expect(lintVerdictFreshness(narrative, [], NOW)).toHaveLength(0);
  });

  test("a stale verdict whose number is NOT in the prose → zero violations", () => {
    const narrative: Narrative = {
      exec_summary: "Days on market sit at 41.",
      sections: [],
      inference_notes: [],
    };
    expect(lintVerdictFreshness(narrative, [staleVerdict("362000")], NOW)).toHaveLength(0);
  });

  test("inference_notes are NOT scanned (exempt projection surface)", () => {
    const narrative: Narrative = {
      exec_summary: "",
      sections: [],
      inference_notes: ["[INFERENCE] building on $362,000; falsifier: a new print."],
    };
    expect(lintVerdictFreshness(narrative, [staleVerdict("362000")], NOW)).toHaveLength(0);
  });

  test("format-invariant match: $362,000 prose ↔ 362000 verdict (and vice versa)", () => {
    const a: Narrative = { exec_summary: "Price: $362,000.", sections: [], inference_notes: [] };
    expect(lintVerdictFreshness(a, [staleVerdict("362000")], NOW)).toHaveLength(1);
    const b: Narrative = { exec_summary: "Price: 362000.", sections: [], inference_notes: [] };
    expect(lintVerdictFreshness(b, [staleVerdict("$362,000")], NOW)).toHaveLength(1);
  });
});

describe("stripVerdictSentences", () => {
  test("drops the offending fact-prose sentence, keeps the clean one and the notes", () => {
    const narrative: Narrative = {
      exec_summary: "Inventory is steady. The price is $362,000.",
      sections: [{ title: "Clean title", intro: "Held at 362000 here." }],
      inference_notes: ["a note that survives"],
    };
    const violations = lintVerdictFreshness(narrative, [staleVerdict("362000")], NOW);
    const out = stripVerdictSentences(narrative, violations);
    expect(out.exec_summary).toBe("Inventory is steady.");
    expect(out.sections[0].intro).toBe("");
    expect(out.sections[0].title).toBe("Clean title");
    expect(out.inference_notes).toEqual(["a note that survives"]);
  });
});

describe("extractNumbers is exported (Plan C-4 B4 — one tokenizer, no fork)", () => {
  test("tokenizes currency, percent, and bps figures", () => {
    expect(extractNumbers("$30,074 and 4.8% and +60bps")).toEqual(["$30,074", "4.8%", "+60bps"]);
  });
});
