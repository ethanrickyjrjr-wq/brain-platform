import { describe, it, expect } from "bun:test";
import { summarizeItem } from "./summarize-item";
import type { ProjectItem } from "./items";

const base = { id: "x", added_at: "2026-06-17T00:00:00Z", origin: "web" as const };

describe("summarizeItem", () => {
  it("qa → the question", () => {
    const it_: ProjectItem = {
      ...base,
      kind: "qa",
      report_id: "env-swfl",
      question: "What is the annual flood loss for 33931?",
      answer: "About $30,074/yr.",
    };
    expect(summarizeItem(it_)).toBe("What is the annual flood loss for 33931?");
  });

  it("qa → a long question is clipped to ≤80 chars with an ellipsis", () => {
    const long = "Why ".repeat(40).trim(); // > 80 chars
    const it_: ProjectItem = {
      ...base,
      kind: "qa",
      report_id: "env-swfl",
      question: long,
      answer: "…",
    };
    const out = summarizeItem(it_);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith("…")).toBe(true);
  });

  it("metric → 'label: value'", () => {
    const it_: ProjectItem = {
      ...base,
      kind: "metric",
      report_id: "env-swfl",
      label: "Annual flood loss",
      value: "$30,074/yr",
      freshness_token: "SWFL-7421-v5-20260610",
    };
    expect(summarizeItem(it_)).toBe("Annual flood loss: $30,074/yr");
  });

  it("chart → the title", () => {
    const it_: ProjectItem = { ...base, kind: "chart", chart_id: "c1", title: "Rent vs. value" };
    expect(summarizeItem(it_)).toBe("Rent vs. value");
  });

  it("frame → the title", () => {
    const it_: ProjectItem = {
      ...base,
      kind: "frame",
      brain_id: "env-swfl",
      title: "Flood gauge",
    };
    expect(summarizeItem(it_)).toBe("Flood gauge");
  });

  it("report → title when present, else slug", () => {
    const withTitle: ProjectItem = {
      ...base,
      kind: "report",
      slug: "env-swfl",
      title: "Environmental risk",
    };
    const noTitle: ProjectItem = { ...base, kind: "report", slug: "env-swfl" };
    expect(summarizeItem(withTitle)).toBe("Environmental risk");
    expect(summarizeItem(noTitle)).toBe("env-swfl");
  });

  it("source → the label", () => {
    const it_: ProjectItem = {
      ...base,
      kind: "source",
      table: "fema_nfip",
      url: "https://example.com",
      label: "FEMA NFIP",
    };
    expect(summarizeItem(it_)).toBe("FEMA NFIP");
  });

  it("note → only the first line, clipped to ≤80", () => {
    const it_: ProjectItem = {
      ...base,
      kind: "note",
      text: "First line of the note\nsecond line should be dropped",
    };
    expect(summarizeItem(it_)).toBe("First line of the note");
  });

  it("table_slice → 'title — C×R'", () => {
    const it_: ProjectItem = {
      ...base,
      kind: "table_slice",
      report_id: "rentals-swfl",
      title: "ZIP rents",
      columns: ["ZIP", "Rent", "YoY"],
      rows: [
        ["33931", "$2,400", "+3%"],
        ["33908", "$2,100", "+1%"],
      ],
      freshness_token: "SWFL-7421-v5-20260610",
    };
    expect(summarizeItem(it_)).toBe("ZIP rents — 3×2");
  });

  it("file → caption when present", () => {
    const it_: ProjectItem = {
      ...base,
      kind: "file",
      storage_path: "u/abc/floodmap.pdf",
      mime: "application/pdf",
      size: 1234,
      caption: "Flood map",
    };
    expect(summarizeItem(it_)).toBe("Flood map");
  });

  it("file → 'basename (mimeShort)' when no caption", () => {
    const it_: ProjectItem = {
      ...base,
      kind: "file",
      storage_path: "u/abc/floodmap.pdf",
      mime: "application/pdf",
      size: 1234,
    };
    expect(summarizeItem(it_)).toBe("floodmap.pdf (pdf)");
  });
});
