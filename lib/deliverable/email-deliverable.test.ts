import { describe, it, expect } from "bun:test";
import { buildEmailDeliverableModel, type EmailDeliverableRow } from "./email-deliverable";
import type { SnapshotItem, Narrative } from "./templates";

// --- fixtures -------------------------------------------------------------

function metricItem(over: Partial<Extract<SnapshotItem, { kind: "metric" }>> = {}): SnapshotItem {
  return {
    id: "housing-swfl-m0",
    added_at: "2026-06-10T00:00:00.000Z",
    origin: "web",
    kind: "metric",
    report_id: "housing-swfl",
    label: "Median sale price",
    value: "$412,000",
    freshness_token: "SWFL-7421-v5-20260610",
    ...over,
  };
}

const NARRATIVE: Narrative = {
  exec_summary: "Fort Myers ZIP 33901 is a seller-leaning market this cycle.",
  sections: [
    { title: "Velocity", intro: "Days on market fell vs. the prior quarter." },
    { title: "Supply", intro: "Inventory remains below the balanced-market line." },
  ],
  inference_notes: [],
};

function row(over: Partial<EmailDeliverableRow> = {}): EmailDeliverableRow {
  return {
    template: "email",
    created_at: "2026-06-12T08:00:00.000Z",
    scope_kind: "zip",
    scope_value: "33901",
    items_snapshot: [metricItem()],
    narrative: NARRATIVE,
    ...over,
  };
}

// --- scope guard ----------------------------------------------------------

describe("buildEmailDeliverableModel — scope guard", () => {
  it("returns null for a non-zip scope_kind", () => {
    expect(buildEmailDeliverableModel(row({ scope_kind: "county" }))).toBeNull();
  });

  it("returns null for an empty scope_value", () => {
    expect(buildEmailDeliverableModel(row({ scope_value: "" }))).toBeNull();
  });

  it("returns null for a null scope_kind (pre-migration row)", () => {
    expect(buildEmailDeliverableModel(row({ scope_kind: null, scope_value: null }))).toBeNull();
  });

  it("normalizes whitespace + case in the scope (shared resolveReportZip guard)", () => {
    const model = buildEmailDeliverableModel(row({ scope_kind: " ZIP ", scope_value: " 33901 " }));
    expect(model).not.toBeNull();
    expect(model!.zip).toBe("33901");
  });

  it("returns a model for a clean zip scope", () => {
    const model = buildEmailDeliverableModel(row());
    expect(model).not.toBeNull();
    expect(model!.zip).toBe("33901");
  });
});

// --- metrics --------------------------------------------------------------

describe("buildEmailDeliverableModel — metrics", () => {
  it("maps every kind:'metric' item to a ReportMetric", () => {
    const model = buildEmailDeliverableModel(
      row({
        items_snapshot: [
          metricItem(),
          metricItem({ id: "m1", label: "Days on market", value: "21 days" }),
        ],
      }),
    );
    expect(model!.metrics).toHaveLength(2);
  });

  it("puts the pre-formatted string in display and leaves value null", () => {
    const model = buildEmailDeliverableModel(row());
    expect(model!.metrics[0].display).toBe("$412,000");
    expect(model!.metrics[0].value).toBeNull();
    expect(model!.metrics[0].label).toBe("Median sale price");
  });

  it("uses metric_slug as the key when present", () => {
    const model = buildEmailDeliverableModel(
      row({ items_snapshot: [metricItem({ metric_slug: "housing.median_sale_price" })] }),
    );
    expect(model!.metrics[0].key).toBe("housing.median_sale_price");
  });

  it("falls back to item.id as the key when metric_slug is absent", () => {
    const model = buildEmailDeliverableModel(row());
    expect(model!.metrics[0].key).toBe("housing-swfl-m0");
  });

  it("yields an empty metrics array when no metric items exist", () => {
    const model = buildEmailDeliverableModel(row({ items_snapshot: [] }));
    expect(model!.metrics).toEqual([]);
  });

  it("ignores non-metric snapshot items", () => {
    const note: SnapshotItem = {
      id: "n1",
      added_at: "2026-06-10T00:00:00.000Z",
      origin: "web",
      kind: "note",
      text: "hi",
    };
    const model = buildEmailDeliverableModel(row({ items_snapshot: [note, metricItem()] }));
    expect(model!.metrics).toHaveLength(1);
  });
});

// --- lines come from the narrative prose, NOT a second copy of the metrics ---

describe("buildEmailDeliverableModel — lines (prose, not metric echo)", () => {
  it("derives one line from exec_summary plus one per narrative section", () => {
    const model = buildEmailDeliverableModel(row());
    // 1 exec_summary + 2 sections
    expect(model!.lines).toHaveLength(3);
    expect(model!.lines[0].text).toBe(NARRATIVE.exec_summary);
    expect(model!.lines[1].text).toContain("Velocity");
    expect(model!.lines[1].text).toContain("Days on market");
  });

  it("does NOT echo metric values into the reads", () => {
    const model = buildEmailDeliverableModel(row());
    expect(model!.lines.some((l) => l.text.includes("$412,000"))).toBe(false);
  });

  it("satisfies the full ReportLine shape (type-required fields present)", () => {
    const model = buildEmailDeliverableModel(row());
    const line = model!.lines[1];
    expect(line.brain_id).toBeDefined();
    expect(line.grain).toBe("zip");
    expect(typeof line.is_true_zip).toBe("boolean");
    expect(line.source_url).toBe("");
    expect(line.source_citation).toBe("");
  });

  it("skips an empty exec_summary", () => {
    const model = buildEmailDeliverableModel(
      row({ narrative: { ...NARRATIVE, exec_summary: "" } }),
    );
    expect(model!.lines).toHaveLength(2); // sections only
  });
});

// --- provenance: freshness token is the one rendered citation ---------------

describe("buildEmailDeliverableModel — freshness token", () => {
  it("lifts the freshness_token from the first item that carries one", () => {
    const model = buildEmailDeliverableModel(row());
    expect(model!.freshness_token).toBe("SWFL-7421-v5-20260610");
  });

  it("lifts from a non-metric item when no metric carries one", () => {
    const qa: SnapshotItem = {
      id: "q1",
      added_at: "2026-06-10T00:00:00.000Z",
      origin: "web",
      kind: "qa",
      report_id: "housing-swfl",
      question: "q",
      answer: "a",
      freshness_token: "SWFL-7421-v9-20260615",
    };
    const model = buildEmailDeliverableModel(row({ items_snapshot: [qa] }));
    expect(model!.freshness_token).toBe("SWFL-7421-v9-20260615");
  });

  it("is null when no item carries a token", () => {
    const note: SnapshotItem = {
      id: "n1",
      added_at: "2026-06-10T00:00:00.000Z",
      origin: "web",
      kind: "note",
      text: "hi",
    };
    const model = buildEmailDeliverableModel(row({ items_snapshot: [note] }));
    expect(model!.freshness_token).toBeNull();
  });
});

// --- determinism + structural invariants -----------------------------------

describe("buildEmailDeliverableModel — invariants", () => {
  it("is deterministic: captured_at derives from row.created_at, never new Date()", () => {
    const r = row();
    const a = buildEmailDeliverableModel(r);
    const b = buildEmailDeliverableModel(r);
    expect(a!.snapshot.captured_at).toBe("2026-06-12T08:00:00.000Z");
    expect(a).toEqual(b);
  });

  it("emptyActivationSnapshot has all five required fields", () => {
    const snap = buildEmailDeliverableModel(row())!.snapshot;
    expect(snap.zip).toBe("33901");
    expect(snap.freshness_token).toBeNull();
    expect(snap.captured_at).toBe("2026-06-12T08:00:00.000Z");
    expect(snap.metrics).toEqual([]);
    expect(snap.lines).toEqual([]);
  });

  it("sets the scope, delta, and place fields per the briefcase contract", () => {
    const model = buildEmailDeliverableModel(row())!;
    expect(model.scope).toEqual({ kind: "zip", value: "33901", grain: "zip" });
    expect(model.delta).toBeNull();
    expect(model.in_scope).toBe(true);
    expect(model.primaryPlace).toBeNull();
    expect(model.countyName).toBeNull();
    expect(model.coverage_caveats).toEqual([]);
  });
});
