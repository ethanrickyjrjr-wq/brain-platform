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
    // The zipsuffix repeat (1 row) renders the ZIP subtitle + report link byte-for-byte
    // as the pre-change flat shell did — the local lock for the golden equivalence.
    expect(html).toContain("&middot; ZIP 33901");
    expect(html).toContain("View the full 33901 report online");
    expect(html).toContain("$412,000"); // hero + metrics table (display)
    expect(html).toContain("Data as of");
    expect(html).toContain("Jun 10"); // freshness token rendered as human-readable date
    expect(html).toContain("seller-leaning"); // exec_summary prose in the reads
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/); // no unfilled tokens
  });

  it("renders the pdf/doc skin: no CTA, carries the watermark + print CSS", async () => {
    const model = buildEmailDeliverableModel(row)!;
    const html = await renderGroundedReport(model, { skin: "pdf" });
    expect(html).toContain("33901");
    expect(html).toContain("&middot; ZIP 33901"); // zipsuffix 1-row, byte-correct in the doc shell too
    expect(html).toContain("$412,000");
    expect(html).toContain("Built with SWFL Data Gulf"); // free-tier watermark
    expect(html).toContain("@page"); // letter-size print CSS
    expect(html).not.toContain("Get this for your whole book"); // CTA dropped
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("the email skin shows CTA when ctaUrl is provided; hides it when empty", async () => {
    const withCta = buildEmailDeliverableModel(row, { ctaUrl: "https://example.com" })!;
    const htmlWith = await renderGroundedReport(withCta, { skin: "email" });
    expect(htmlWith).toContain("Get this for your whole book");

    const noCta = buildEmailDeliverableModel(row, { ctaUrl: "" })!;
    const htmlNo = await renderGroundedReport(noCta, { skin: "email" });
    expect(htmlNo).not.toContain("Get this for your whole book");
  });
});

describe("briefcase grounded render — non-ZIP grains build honestly (no handcuff)", () => {
  it("a PLACE-scoped email renders a place header, county subtitle, no dangling ZIP", async () => {
    const model = buildEmailDeliverableModel({
      ...row,
      scope_kind: "place",
      scope_value: "Cape Coral",
    })!;
    const html = await renderGroundedReport(model, { skin: "email" });
    expect(html).toContain("Cape Coral market read");
    expect(html).toContain("Lee County"); // county resolved from the crosswalk
    expect(html).not.toContain("&middot; ZIP"); // the ZIP suffix is dropped, not left dangling
    expect(html).toContain("View the full report online"); // no ZIP in the link text
    expect(html).toContain("$412,000"); // the frozen number survives regardless of grain
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("a COUNTY-scoped email renders a county header", async () => {
    const model = buildEmailDeliverableModel({ ...row, scope_kind: "county", scope_value: "Lee" })!;
    const html = await renderGroundedReport(model, { skin: "email" });
    expect(html).toContain("Lee market read");
    expect(html).toContain("Lee County");
    expect(html).not.toContain("&middot; ZIP");
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("a REGION (null-scope) email renders a Southwest Florida header with a de-duped subtitle", async () => {
    const model = buildEmailDeliverableModel({ ...row, scope_kind: null, scope_value: null })!;
    const html = await renderGroundedReport(model, { skin: "email" });
    expect(html).toContain("Southwest Florida market read");
    expect(html).toContain("6-county region"); // subtitle does NOT repeat "Southwest Florida"
    expect(html).not.toContain("&middot; ZIP");
    expect(html).toContain("$412,000");
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});
