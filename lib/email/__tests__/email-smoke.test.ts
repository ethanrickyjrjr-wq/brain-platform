import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { renderEmailTemplate, brandThemeToTokens } from "../templates/render-template.ts";
import { renderChart } from "../templates/charts/chart-renderer.ts";
import { renderMetricCard } from "../templates/components/metric-card.ts";
import { renderStatRow } from "../templates/components/stat-row.ts";
import { renderCallout } from "../templates/components/callout-box.ts";
import { renderBadge } from "../templates/components/badge.ts";
import { renderMapPlaceholder } from "../templates/components/map-placeholder.ts";

// Section 3 Task 3D — integration smoke test (LOCAL, assertion-only per operator).
//
// Composes all five S3 components + an S2 chart into one email body, and renders
// a real committed shell through the S1 adapter with a non-SWFL brand. Asserts the
// whole composition is email-safe and carries no raw {{TOKEN}}.
//
// The 5 committed shells (templates/html/email/*.html) carry NO [ CHART ]/[ BODY
// TEXT ] slot and NO {{{RESEND_UNSUBSCRIBE_URL}}} — the scheduler (Unit F) injects
// the unsubscribe link AFTER render, so it is deliberately not asserted here.
//
// Manual follow-up (NOT automated, does not block this commit): POST the rendered
// HTML to /api/email/broadcast with send:false and confirm the draft + Gmail render.

function assertEmailSafe(out: string, ctx: string): void {
  assert.ok(out.length > 0, `${ctx}: output is empty`);
  assert.ok(!/<script/i.test(out), `${ctx}: contains <script>`);
  assert.ok(!/<canvas/i.test(out), `${ctx}: contains <canvas>`);
  assert.ok(!/<style[\s>]/i.test(out), `${ctx}: contains a <style> block`);
  assert.ok(!/\son[a-z]+=/i.test(out), `${ctx}: contains an inline JS event handler`);
}

const TEST_BRAND = {
  primary: "#7C3AED",
  accent: "#F97316",
  logoUrl: "https://cdn.example.com/acme-logo.png",
};

describe("S3 3D — integration smoke test", () => {
  test("all components + a chart compose into one email-safe body", () => {
    const cards = [
      renderMetricCard("Median AAL", "$30,074", { value: 60, direction: "up", label: "bps YoY" }),
      renderMetricCard("Sales velocity", "12 days", {
        value: 3,
        direction: "down",
        label: "vs Q1",
      }),
      renderMetricCard("SOH gap", "5%", { value: 0, direction: "flat", label: "flat" }),
    ].join("");
    const cardRow = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>${cards}</tr></table>`;

    const statRow = renderStatRow([
      { label: "Active ZIPs", value: "847" },
      { label: "Occupancy", value: "94.3%", sub: "+1.2 pts" },
      { label: "Avg Unit", value: "$5,210" },
    ]);
    const callout = renderCallout(
      "highlight",
      "Fort Myers Beach (33931) shows the strongest single-period gain.",
    );
    const badge = renderBadge("LIVE");
    const map = renderMapPlaceholder();
    const chart = renderChart({
      type: "bar",
      title: "ZIP vs county",
      data: [
        { label: "33931", value: 60 },
        { label: "Lee County", value: 42 },
      ],
      unit: "%",
    });

    const body = [cardRow, statRow, callout, badge, map, chart].join("\n");

    assertEmailSafe(body, "composed body");
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(body), "raw {{TOKEN}} left in composed body");
    assert.ok(body.includes('style="'), "expected inline styles in the body");

    // Every piece survived composition.
    for (const needle of ["$30,074", "847", "Fort Myers Beach", "LIVE", "Map", "ZIP vs county"]) {
      assert.ok(body.includes(needle), `composed body missing: ${needle}`);
    }
  });

  test("a real shell renders clean through the S1 adapter with a non-SWFL brand", async () => {
    const tokens = brandThemeToTokens(TEST_BRAND);
    const html = await renderEmailTemplate("hbar", tokens, {});

    assertEmailSafe(html, "hbar shell");
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), "raw {{TOKEN}} survived the render");
    assert.ok(/<html/i.test(html), "not a full HTML document");
    // The brand primary replaced the SWFL default — proves tokens flow through.
    assert.ok(html.includes("#7C3AED"), "brand primary not applied");
    assert.ok(!html.includes("#0F2035"), "SWFL default primary leaked into a branded render");
  });
});
