import { describe, it, expect } from "bun:test";
import { briefcaseDigest } from "./briefcase-digest";
import type { ProjectItem } from "@/lib/project/items";

/**
 * briefcaseDigest renders the saved draft items into a short, customer-clean
 * summary the chat receives so it knows what's already filed (and stops
 * re-pitching it). Pure; bounded in count + length (it rides on a paid-LLM call).
 */

const base = { added_at: "2026-06-16T00:00:00Z", origin: "web" as const };

function metric(id: string, label: string, value: string): ProjectItem {
  return {
    ...base,
    id,
    kind: "metric",
    report_id: "housing-swfl",
    label,
    value,
    freshness_token: "SWFL-7421-v9-20260601",
  };
}

describe("briefcaseDigest", () => {
  it("returns an empty string for an empty briefcase", () => {
    expect(briefcaseDigest([])).toBe("");
  });

  it("renders a metric's label, value, and as-of date", () => {
    const d = briefcaseDigest([metric("1", "Median rent 33901", "$1,750")]);
    expect(d).toContain("Median rent 33901");
    expect(d).toContain("$1,750");
    // freshness_token "SWFL-7421-v9-20260601" → "06/01/2026"
    expect(d).toContain("as of");
  });

  it("frames the list as already-saved so the chat builds on it", () => {
    const d = briefcaseDigest([metric("1", "Median rent", "$1,750")]);
    expect(d.toLowerCase()).toMatch(/already saved|in their briefcase|build on/);
  });

  it("renders a Q&A item by its question and includes the answer snippet", () => {
    const items: ProjectItem[] = [
      {
        ...base,
        id: "q",
        kind: "qa",
        report_id: "33901",
        question: "What's driving permits?",
        answer: "Lots.",
      },
      { ...base, id: "n", kind: "note", text: "Call the Lehigh lead Tuesday" },
    ];
    const d = briefcaseDigest(items);
    expect(d).toContain("What's driving permits?");
    expect(d).toContain("Lots.");
    expect(d).toContain("Call the Lehigh lead Tuesday");
  });

  it("truncates qa answer at 120 chars", () => {
    const longAnswer = "A".repeat(200);
    const items: ProjectItem[] = [
      { ...base, id: "q", kind: "qa", report_id: "r", question: "Q?", answer: longAnswer },
    ];
    const d = briefcaseDigest(items);
    expect(d).not.toContain("A".repeat(121));
    expect(d).toContain("…");
  });

  it("caps the item count and notes how many more there are", () => {
    const many: ProjectItem[] = Array.from({ length: 14 }, (_, i) =>
      metric(String(i), `Metric ${i}`, `$${i}`),
    );
    const d = briefcaseDigest(many, { maxItems: 10 });
    expect(d).toMatch(/\+\s*4\s*more/i);
    // only the first 10 are spelled out
    expect(d).toContain("Metric 0");
    expect(d).not.toContain("Metric 13");
  });

  it("stays within the char bound even with long titles", () => {
    const huge: ProjectItem[] = Array.from({ length: 10 }, (_, i) =>
      metric(String(i), "X".repeat(300), "$1"),
    );
    const d = briefcaseDigest(huge, { maxChars: 1000 });
    expect(d.length).toBeLessThanOrEqual(1000);
  });

  it("never leaks an internal item id or report_id", () => {
    const d = briefcaseDigest([metric("internal-uuid-123", "Median rent", "$1,750")]);
    expect(d).not.toContain("internal-uuid-123");
    expect(d).not.toContain("housing-swfl");
  });
});
