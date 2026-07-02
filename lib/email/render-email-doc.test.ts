import { describe, expect, it } from "bun:test";
import { render } from "@react-email/render";
import { EmailDocEmail } from "./blocks/EmailDocRenderer";
import { renderEmailDocHtml } from "./render-email-doc";
import type { EmailDoc } from "./doc/types";

const STYLE: EmailDoc["globalStyle"] = {
  primaryColor: "#0f1d24",
  accentColor: "#3DC9C0",
  fontFamily: "MODERN_SANS",
  textColor: "#242424",
  backdropColor: "#F8F8F8",
};

/** Free-tier doc: no block carries a `layout`. */
const FREE_DOC: EmailDoc = {
  globalStyle: STYLE,
  blocks: [
    { id: "f1", type: "text", props: { body: "Free-tier body copy.", align: "left" } },
    {
      id: "f2",
      type: "button",
      props: { label: "View Report", url: "https://example.com/report", bgColor: "#3DC9C0" },
    },
  ],
};

/** Paid grid doc: two half-width blocks side by side on the same row. */
const GRID_DOC: EmailDoc = {
  globalStyle: STYLE,
  blocks: [
    {
      id: "g1",
      type: "text",
      props: { body: "Left column copy.", align: "left" },
      layout: { x: 0, y: 0, w: 6, h: 4 },
    },
    {
      id: "g2",
      type: "text",
      props: { body: "Right column copy.", align: "left" },
      layout: { x: 6, y: 0, w: 6, h: 4 },
    },
  ],
};

describe("renderEmailDocHtml — the ONE EmailDoc→HTML root", () => {
  it("free doc (no layout) is byte-identical to render(EmailDocEmail(...))", async () => {
    const viaRoot = await renderEmailDocHtml(FREE_DOC);
    const direct = await render(EmailDocEmail({ doc: FREE_DOC }));
    expect(viaRoot).toBe(direct);
  });

  it("grid doc compiles positioned columns (Outlook ghost tables), not the free stacker", async () => {
    const html = await renderEmailDocHtml(GRID_DOC);
    // compile-grid's multi-column row emits the mso ghost-table wrapper the
    // free renderer never produces — the exact divergence the blast route shipped.
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("Left column copy.");
    expect(html).toContain("Right column copy.");
    const freeStacked = await render(EmailDocEmail({ doc: GRID_DOC }));
    expect(html).not.toBe(freeStacked);
  });
});
