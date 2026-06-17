import { describe, it, expect } from "bun:test";
import { identityKeyForItem, titleForItem } from "./identity-key";
import type { ProjectItem } from "./items";

const base = { id: "x", added_at: "2026-06-10T08:00:00Z", origin: "web" as const };

/**
 * identityKeyForItem is the cross-project-reuse spine — a field-swap typo here would
 * silently merge or split identities with a green suite. Pin the exact key for EVERY
 * kind plus the documented optional-field edges.
 */
describe("identityKeyForItem — one assertion per kind", () => {
  it("metric (with and without a metric_slug)", () => {
    expect(
      identityKeyForItem({
        ...base,
        kind: "metric",
        report_id: "33931",
        label: "Flood loss",
        value: "$1",
        freshness_token: "t",
      }),
    ).toBe("metric:Flood loss@33931");
    expect(
      identityKeyForItem({
        ...base,
        kind: "metric",
        report_id: "rentals-swfl",
        label: "ZORI",
        value: "$1",
        freshness_token: "t",
        metric_slug: "rent_zori",
      }),
    ).toBe("metric:rent_zori@rentals-swfl");
  });
  it("report", () => {
    expect(identityKeyForItem({ ...base, kind: "report", slug: "permits-swfl" })).toBe(
      "report:permits-swfl",
    );
  });
  it("table_slice", () => {
    expect(
      identityKeyForItem({
        ...base,
        kind: "table_slice",
        report_id: "cre-swfl",
        title: "Vacancy",
        columns: ["a"],
        rows: [],
        freshness_token: "t",
      }),
    ).toBe("table_slice:cre-swfl::Vacancy");
  });
  it("source", () => {
    expect(
      identityKeyForItem({
        ...base,
        kind: "source",
        table: "leepa_parcels",
        url: "https://x",
        label: "LeePA",
      }),
    ).toBe("source:leepa_parcels::https://x");
  });
  it("qa", () => {
    expect(
      identityKeyForItem({
        ...base,
        kind: "qa",
        report_id: "33931",
        question: "How bad is flood?",
        answer: "bad",
      }),
    ).toBe("qa:33931::How bad is flood?");
  });
  it("chart keys on chart_id (NOT the title)", () => {
    expect(
      identityKeyForItem({ ...base, kind: "chart", chart_id: "c123", title: "Rent trend" }),
    ).toBe("chart:c123");
  });
  it("file keys on storage_path (NOT mime/caption)", () => {
    expect(
      identityKeyForItem({
        ...base,
        kind: "file",
        storage_path: "u/1/a.pdf",
        mime: "application/pdf",
        size: 9,
        caption: "Deck",
      }),
    ).toBe("file:u/1/a.pdf");
  });
  it("note", () => {
    expect(identityKeyForItem({ ...base, kind: "note", text: "watch 33913" })).toBe(
      "note:watch 33913",
    );
  });
});

describe("titleForItem — deterministic one-liner per kind", () => {
  it("metric uses label", () => {
    expect(
      titleForItem({
        ...base,
        kind: "metric",
        report_id: "r",
        label: "Flood loss",
        value: "$1",
        freshness_token: "t",
      }),
    ).toBe("Metric: Flood loss");
  });
  it("report uses title when present, falls back to slug", () => {
    expect(titleForItem({ ...base, kind: "report", slug: "permits-swfl", title: "Permits" })).toBe(
      "Report: Permits",
    );
    expect(titleForItem({ ...base, kind: "report", slug: "permits-swfl" })).toBe(
      "Report: permits-swfl",
    );
  });
  it("table_slice uses title", () => {
    expect(
      titleForItem({
        ...base,
        kind: "table_slice",
        report_id: "cre-swfl",
        title: "Vacancy",
        columns: ["a"],
        rows: [],
        freshness_token: "t",
      }),
    ).toBe("Table: Vacancy");
  });
  it("frame uses title", () => {
    expect(
      titleForItem({ ...base, kind: "frame", brain_id: "env-swfl", title: "Flood by ZIP" }),
    ).toBe("Frame: Flood by ZIP");
  });
  it("source uses label", () => {
    expect(
      titleForItem({
        ...base,
        kind: "source",
        table: "leepa_parcels",
        url: "https://x",
        label: "LeePA",
      }),
    ).toBe("Source: LeePA");
  });
  it("qa uses question (capped at 120)", () => {
    const longQ = "A".repeat(200);
    const result = titleForItem({
      ...base,
      kind: "qa",
      report_id: "r",
      question: longQ,
      answer: "yes",
    });
    expect(result).toBe("Q: " + "A".repeat(120));
    expect(result.length).toBeLessThanOrEqual(123); // "Q: " + 120
  });
  it("chart uses title", () => {
    expect(titleForItem({ ...base, kind: "chart", chart_id: "c1", title: "Rent trend" })).toBe(
      "Chart: Rent trend",
    );
  });
  it("file uses caption when present", () => {
    expect(
      titleForItem({
        ...base,
        kind: "file",
        storage_path: "u/1/a.pdf",
        mime: "application/pdf",
        size: 9,
        caption: "Deck",
      }),
    ).toBe("File: Deck");
  });
  it("file falls back to filename from storage_path when no caption", () => {
    expect(
      titleForItem({
        ...base,
        kind: "file",
        storage_path: "u/1/a.pdf",
        mime: "application/pdf",
        size: 9,
      }),
    ).toBe("File: a.pdf");
  });
  it("note uses text (capped at 120)", () => {
    const longNote = "B".repeat(200);
    const result = titleForItem({ ...base, kind: "note", text: longNote });
    expect(result).toBe("Note: " + "B".repeat(120));
  });
  it("note uses full text when short", () => {
    expect(titleForItem({ ...base, kind: "note", text: "watch 33913" })).toBe("Note: watch 33913");
  });
});

describe("identityKeyForItem — frame optional-field edges", () => {
  it("uses frame_id + sorted metric_keys when present", () => {
    const a: ProjectItem = {
      ...base,
      kind: "frame",
      brain_id: "b",
      frame_id: "f",
      metric_keys: ["y", "x"],
      title: "t",
    };
    expect(identityKeyForItem(a)).toBe("frame:b::f::x,y");
  });
  it("falls back to the title when neither frame_id nor metric_keys is present (no auto-frame collision)", () => {
    const f1: ProjectItem = { ...base, kind: "frame", brain_id: "env-swfl", title: "Flood by ZIP" };
    const f2: ProjectItem = { ...base, kind: "frame", brain_id: "env-swfl", title: "Surge risk" };
    expect(identityKeyForItem(f1)).toBe("frame:env-swfl::auto::Flood by ZIP");
    expect(identityKeyForItem(f1)).not.toBe(identityKeyForItem(f2));
  });
});
