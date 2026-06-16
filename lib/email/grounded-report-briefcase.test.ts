import { describe, it, expect } from "bun:test";
import {
  buildEmailDeliverableModel,
  type EmailDeliverableRow,
} from "../deliverable/email-deliverable";
import { renderGroundedReport } from "./grounded-report";
import type { SnapshotItem, Narrative } from "../deliverable/templates";

// End-to-end render lock for the briefcase email/PDF lane: a frozen deliverable row →
// buildEmailDeliverableModel → renderGroundedReport, for BOTH skins. Reads the real
// template files from disk, so it proves the `doc-report` slug + registry entry + the
// renderSkin routing are all wired and that every token fills (the renderer hard-throws
// on any unfilled {{TOKEN}}).

const narrative: Narrative = {
  exec_summary: "Fort Myers ZIP 33901 is a seller-leaning market this cycle.",
  sections: [{ title: "Velocity", intro: "Days on market fell vs. the prior quarter." }],
  inference_notes: [],
};

const metric: SnapshotItem = {
  id: "housing-swfl-m0",
  added_at: "2026-06-10T00:00:00.000Z",
  origin: "web",
  kind: "metric",
  report_id: "housing-swfl",
  label: "Median sale price",
  value: "$412,000",
  freshness_token: "SWFL-7421-v5-20260610",
};

const row: EmailDeliverableRow = {
  template: "email",
  created_at: "2026-06-12T08:00:00.000Z",
  scope_kind: "zip",
  scope_value: "33901",
  items_snapshot: [metric],
  narrative,
};

describe("briefcase grounded render — both skins", () => {
  it("renders the email skin with the ZIP, metric, freshness token, and prose read", async () => {
    const model = buildEmailDeliverableModel(row)!;
    const html = await renderGroundedReport(model, { skin: "email" });
    expect(html).toContain("33901");
    expect(html).toContain("$412,000"); // hero + metrics table (display)
    expect(html).toContain("SWFL-7421-v5-20260610"); // freshness token rendered
    expect(html).toContain("seller-leaning"); // exec_summary prose in the reads
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/); // no unfilled tokens
  });

  it("renders the pdf/doc skin: no CTA, carries the watermark + print CSS", async () => {
    const model = buildEmailDeliverableModel(row)!;
    const html = await renderGroundedReport(model, { skin: "pdf" });
    expect(html).toContain("33901");
    expect(html).toContain("$412,000");
    expect(html).toContain("Built with SWFL Data Gulf"); // free-tier watermark
    expect(html).toContain("@page"); // letter-size print CSS
    expect(html).not.toContain("Get this for your whole book"); // CTA dropped
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("the email skin keeps its CTA (skins genuinely differ)", async () => {
    const model = buildEmailDeliverableModel(row)!;
    const html = await renderGroundedReport(model, { skin: "email" });
    expect(html).toContain("Get this for your whole book");
  });
});
