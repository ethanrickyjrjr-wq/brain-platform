import { test, expect, describe } from "bun:test";
import { gateNarrative } from "./build";
import type { Narrative } from "./templates";
import type { ReconciliationVerdict } from "../reconcile/types";

/**
 * C-6 — the build-time ttl-gate orchestration, made unit-testable as a pure
 * function (no LLM, no module mock). Covers the seam that `buildDeliverableNarrative`
 * could not reach in mock mode (agentsAreMocked short-circuits before the gate).
 */

function stale(value: string): ReconciliationVerdict {
  return {
    status: "cannot_assert_stale",
    theirs: { value, freshness_token: "SWFL-7421-v3-20260401" },
    fresher_side: "unknown",
    expires_at: "2026-05-01T12:00:00Z",
    reason: "lake fact expired 2026-05-01T12:00:00Z — refuse to assert; offer re-pull",
  };
}

describe("gateNarrative", () => {
  test("flag OFF → returns the standard lint result unchanged (byte-identical path)", () => {
    const narrative: Narrative = {
      exec_summary: "The price is $362,000.",
      sections: [],
      inference_notes: [],
    };
    // $362,000 anchors, so the standard gate passes; with the flag OFF no ttl runs.
    const g = gateNarrative(narrative, ["$362,000"], [stale("362000")], false);
    expect(g.ok).toBe(true);
    expect(g.violations).toHaveLength(0);
  });

  test("flag ON + a stale figure in prose → not ok, and the stale sentence is hard-stripped", () => {
    const narrative: Narrative = {
      exec_summary: "Inventory is steady. The price is $362,000.",
      sections: [],
      inference_notes: [],
    };
    const g = gateNarrative(narrative, ["$362,000"], [stale("362000")], true);
    expect(g.ok).toBe(false);
    expect(g.violations.some((v) => v.gate === "ttl")).toBe(true);
    expect(g.stripped.exec_summary).toBe("Inventory is steady.");
    expect(g.stripped.exec_summary).not.toContain("362000");
  });

  test("flag ON but the stale figure is absent from prose → ok, nothing stripped", () => {
    const narrative: Narrative = {
      exec_summary: "Filed research compiled for review.",
      sections: [],
      inference_notes: [],
    };
    const g = gateNarrative(narrative, [], [stale("362000")], true);
    expect(g.ok).toBe(true);
  });

  test("seam: a sentence with BOTH an invented number and a stale figure is removed once, stale figure gone", () => {
    // The invented 99 trips the standard number gate (not in anchors) AND 362000 is stale.
    const narrative: Narrative = {
      exec_summary: "Margins rose 99% while the price held at $362,000.",
      sections: [],
      inference_notes: [],
    };
    const g = gateNarrative(narrative, ["$362,000"], [stale("362000")], true);
    expect(g.ok).toBe(false);
    expect(g.stripped.exec_summary).not.toContain("362000");
    expect(g.stripped.exec_summary).not.toContain("99");
  });
});

// ── recorded anchors through gateNarrative (invention-surface-guards §B) ──────
import { collectRecordedNumbers } from "./build";

describe("recorded anchors through gateNarrative", () => {
  const metric = (label: string, value: string) =>
    ({ kind: "metric", id: "m1", added_at: "", origin: "user", label, value }) as never;

  test("collectRecordedNumbers picks only recorded-labeled items", () => {
    const items = [
      metric("Median list price", "$15,000,000"),
      metric("Recorded sold price", "$415,000"),
    ];
    const out = collectRecordedNumbers(items as never[]);
    expect(out).toContain("$415,000");
    expect(out).not.toContain("$15,000,000");
  });

  test("gateNarrative flags a list price dressed as a sale", () => {
    const narrative: Narrative = {
      exec_summary: "It sold for $15,000,000.",
      sections: [],
      inference_notes: [],
    };
    const gate = gateNarrative(narrative, ["$15,000,000"], [], false, []);
    expect(gate.ok).toBe(false);
    expect(gate.violations.some((v) => v.gate === "recorded")).toBe(true);
  });

  test("four-arg calls keep working (backward compat)", () => {
    const narrative: Narrative = {
      exec_summary: "Rents hit $2,150.",
      sections: [],
      inference_notes: [],
    };
    expect(gateNarrative(narrative, ["$2,150"], [], false).ok).toBe(true);
  });
});
