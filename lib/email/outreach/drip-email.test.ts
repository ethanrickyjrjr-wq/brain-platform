import { describe, expect, it } from "bun:test";
import { renderDripEmail, type DripEmailInput } from "./drip-email";

function input(over: Partial<DripEmailInput> = {}): DripEmailInput {
  return {
    brand: {
      primary: "#0a3d62",
      accent: "#e74c3c",
      logoUrl: "https://cdn.acme.com/logo.png",
      companyName: "Acme Realty",
    },
    kicker: "FORT MYERS BEACH · MARKET PULSE",
    title: "Typical home value is up 4% this quarter",
    chart: {
      type: "sparkline",
      title: "Typical home value",
      subtitle: "as of Jun 2026",
      data: [
        { x: "Mar", y: 410 },
        { x: "Apr", y: 415 },
        { x: "May", y: 420 },
        { x: "Jun", y: 426 },
      ],
    },
    explanation: "Prices firmed for the third straight month as inventory stayed tight.",
    ctaUrl: "https://www.swfldatagulf.com/welcome?primary=%230a3d62&zip=33931",
    freshness: "Live data token: SWFL-7421-v5-20260620",
    subject: "Fort Myers Beach market: home values up 4%",
    ...over,
  };
}

describe("renderDripEmail", () => {
  it("renders branded HTML with no unfilled {{TOKEN}} left", async () => {
    const { html, subject } = await renderDripEmail(input());
    expect(subject).toBe("Fort Myers Beach market: home values up 4%");
    // renderEmailTemplate throws on a leftover {{TOKEN}}; reaching here proves none.
    // Belt-and-suspenders: no double-brace uppercase token survives.
    // The only legit remaining brace-token is the post-render unsubscribe token.
    const stripped = html.replaceAll("{{{RESEND_UNSUBSCRIBE_URL}}}", "");
    expect(stripped.match(/\{\{[A-Z_]+\}\}/)).toBeNull();
  });

  it("injects the recipient brand: logo, accent, company name, and the CTA url", async () => {
    const { html } = await renderDripEmail(input());
    expect(html).toContain("https://cdn.acme.com/logo.png");
    expect(html).toContain("Acme Realty");
    expect(html).toContain("#e74c3c"); // accent on kicker/CTA
    expect(html).toContain("https://www.swfldatagulf.com/welcome?primary=%230a3d62&zip=33931");
    expect(html).toContain("Create your own report");
  });

  it("includes the chart, the explanation, and the freshness token", async () => {
    const { html } = await renderDripEmail(input());
    expect(html).toContain("Typical home value"); // chart title
    expect(html).toContain("inventory stayed tight"); // explanation
    expect(html).toContain("SWFL-7421-v5-20260620"); // freshness
  });

  it("injects an unsubscribe footer (CAN-SPAM) via the resend token", async () => {
    const { html } = await renderDripEmail(input());
    expect(html).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
    expect(html.toLowerCase()).toContain("unsubscribe");
  });

  it("falls back to shell defaults when brand fields are absent (house brand)", async () => {
    const { html } = await renderDripEmail(
      input({ brand: { primary: null, accent: null, logoUrl: null, companyName: null } }),
    );
    // The only legit remaining brace-token is the post-render unsubscribe token.
    const stripped = html.replaceAll("{{{RESEND_UNSUBSCRIBE_URL}}}", "");
    expect(stripped.match(/\{\{[A-Z_]+\}\}/)).toBeNull();
    // No company override → the shell's SWFL default company name is used.
    expect(html).toContain("SWFL Data Gulf");
  });
});
