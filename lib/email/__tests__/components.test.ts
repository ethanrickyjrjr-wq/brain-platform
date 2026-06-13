import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { renderMetricCard } from "../templates/components/metric-card.ts";
import { renderStatRow } from "../templates/components/stat-row.ts";
import { renderCallout } from "../templates/components/callout-box.ts";
import { renderBadge } from "../templates/components/badge.ts";
import { renderMapPlaceholder } from "../templates/components/map-placeholder.ts";

// Section 3 (S3) — visual components. These assert the HARD email constraints
// (no <script>/<canvas>/<style>, inline-only, width-bounded, data escaped) plus
// each component's contracted behavior. Same rigor as the S2 chart-renderer tests.

const SWFL_PRIMARY = "#0F2035";
const SWFL_ACCENT = "#1BB8C9";
const GREEN = "#16A34A";
const RED = "#DC2626";
const WARN = "#F59E0B";

/** Assert an HTML fragment is email-safe (the rules that silently break a send). */
function assertEmailSafe(out: string, ctx: string): void {
  assert.ok(out.length > 0, `${ctx}: output is empty`);
  assert.ok(!/<script/i.test(out), `${ctx}: contains <script>`);
  assert.ok(!/<canvas/i.test(out), `${ctx}: contains <canvas>`);
  assert.ok(!/<style[\s>]/i.test(out), `${ctx}: contains a <style> block`);
  assert.ok(!/\son[a-z]+=/i.test(out), `${ctx}: contains an inline JS event handler`);
}

/** All width:/width= numbers in the fragment must stay within `max`. */
function assertWidthWithin(out: string, max: number, ctx: string): void {
  const widths = [...out.matchAll(/(?:max-width|width)[:=]"?\s*(\d+)/g)].map((m) => Number(m[1]));
  for (const w of widths) assert.ok(w <= max, `${ctx}: width ${w} exceeds ${max}`);
}

describe("renderMetricCard", () => {
  test("emits a self-contained <td> with the value and label", () => {
    const out = renderMetricCard("Median AAL", "$30,074");
    assert.ok(out.trimStart().startsWith("<td"), "does not start with <td>");
    assert.ok(out.includes("$30,074"), "value missing");
    assert.ok(out.includes("Median AAL"), "label missing");
  });

  test("stays within the 180px three-up column", () => {
    assertWidthWithin(
      renderMetricCard("L", "V", { value: 5, direction: "up", label: "YoY" }),
      180,
      "metric-card",
    );
  });

  test("delta up renders a green inline-SVG arrow", () => {
    const out = renderMetricCard("L", "V", { value: 5, direction: "up", label: "YoY" });
    assert.ok(out.includes("<svg"), "no inline SVG arrow");
    assert.ok(out.includes(GREEN), "up delta is not green");
  });

  test("delta down renders a red inline-SVG arrow", () => {
    const out = renderMetricCard("L", "V", { value: 5, direction: "down", label: "YoY" });
    assert.ok(out.includes("<svg"), "no inline SVG arrow");
    assert.ok(out.includes(RED), "down delta is not red");
  });

  test("delta flat renders an SVG mark and no up/down color", () => {
    const out = renderMetricCard("L", "V", { value: 0, direction: "flat", label: "flat" });
    assert.ok(out.includes("<svg"), "no inline SVG mark");
    assert.ok(!out.includes(GREEN) && !out.includes(RED), "flat should not use up/down color");
  });

  test("no delta means no arrow", () => {
    const out = renderMetricCard("L", "V");
    assert.ok(!out.includes("<svg"), "arrow rendered without a delta");
  });

  test("theme.primary overrides the value color", () => {
    const out = renderMetricCard("L", "V", undefined, { primary: "#FF00FF" });
    assert.ok(out.includes("#FF00FF"), "theme primary not applied");
  });

  test("escapes a malicious label", () => {
    const out = renderMetricCard('<img src=x onerror="alert(1)">', "V");
    assert.ok(!out.includes("<img src=x"), "raw tag leaked");
    assert.ok(out.includes("&lt;img src=x"), "label not escaped");
  });

  test("is email-safe", () => {
    assertEmailSafe(
      renderMetricCard("L", "V", { value: 5, direction: "up", label: "YoY" }),
      "metric-card",
    );
  });
});

describe("renderStatRow", () => {
  const stats = [
    { label: "Active ZIPs", value: "847" },
    { label: "Occupancy", value: "94.3%", sub: "+1.2 pts" },
    { label: "Avg Unit", value: "$5,210" },
  ];

  test("renders a single-row table with every stat", () => {
    const out = renderStatRow(stats);
    assert.ok(out.includes("<table"), "not a table");
    for (const s of stats) {
      assert.ok(out.includes(s.value), `value ${s.value} missing`);
      assert.ok(out.includes(s.label), `label ${s.label} missing`);
    }
    assert.ok(out.includes("+1.2 pts"), "sub line missing");
  });

  test("spans the full 600px column and no wider", () => {
    const out = renderStatRow(stats);
    assert.ok(out.includes("600"), "no 600px width");
    assertWidthWithin(out, 600, "stat-row");
  });

  test("uses the SURFACE token color as background", () => {
    assert.ok(renderStatRow(stats).includes("#ffffff"), "SURFACE background missing");
  });

  test("escapes stat content", () => {
    const out = renderStatRow([{ label: "<b>x</b>", value: "1" }]);
    assert.ok(!out.includes("<b>x</b>"), "raw tag leaked");
    assert.ok(out.includes("&lt;b&gt;x&lt;/b&gt;"), "label not escaped");
  });

  test("empty input does not throw", () => {
    assert.doesNotThrow(() => renderStatRow([]));
  });

  test("is email-safe", () => {
    assertEmailSafe(renderStatRow(stats), "stat-row");
  });
});

describe("renderCallout", () => {
  test("info uses the accent border", () => {
    const out = renderCallout("info", "hello");
    assert.ok(/border-left:\s*\d+px\s+solid/i.test(out), "no border-left");
    assert.ok(out.includes(SWFL_ACCENT), "info border is not accent");
  });

  test("warn uses the amber border", () => {
    assert.ok(renderCallout("warn", "x").includes(WARN), "warn border is not amber");
  });

  test("highlight uses the primary border", () => {
    assert.ok(
      renderCallout("highlight", "x").includes(SWFL_PRIMARY),
      "highlight border is not primary",
    );
  });

  test("uses no gradients or background images", () => {
    const out = renderCallout("info", "x");
    assert.ok(!/gradient/i.test(out), "contains a gradient");
    assert.ok(!/url\s*\(/i.test(out), "contains a background image url()");
  });

  test("escapes the callout text", () => {
    const out = renderCallout("info", "<script>alert(1)</script>");
    assert.ok(!out.includes("<script>alert"), "raw tag leaked");
    assert.ok(out.includes("&lt;script&gt;"), "text not escaped");
  });

  test("is email-safe", () => {
    assertEmailSafe(renderCallout("highlight", "x"), "callout");
  });
});

describe("renderBadge", () => {
  test("defaults to the accent color", () => {
    assert.ok(renderBadge("LIVE").includes(SWFL_ACCENT), "default is not accent");
  });

  test("honors a custom color", () => {
    assert.ok(renderBadge("NEW", "#FF0000").includes("#FF0000"), "custom color not applied");
  });

  test("is an inline-block span with a pill radius", () => {
    const out = renderBadge("LIVE");
    assert.ok(out.includes("<span"), "not a span");
    assert.ok(/border-radius:/i.test(out), "no pill radius");
    assert.ok(/display:\s*inline-block/i.test(out), "not inline-block");
  });

  test("escapes the badge text", () => {
    const out = renderBadge("<b>x</b>");
    assert.ok(!out.includes("<b>x</b>"), "raw tag leaked");
    assert.ok(out.includes("&lt;b&gt;x&lt;/b&gt;"), "text not escaped");
  });

  test("is email-safe", () => {
    assertEmailSafe(renderBadge("LIVE"), "badge");
  });
});

describe("renderMapPlaceholder", () => {
  test("renders an <img> when a url is provided", () => {
    const out = renderMapPlaceholder("https://maps.example.com/a.png");
    assert.ok(out.includes("<img"), "no img tag");
    assert.ok(out.includes("https://maps.example.com/a.png"), "url missing");
    assert.ok(out.includes("560"), "not 560px wide");
  });

  test("renders a gray placeholder box when empty", () => {
    const out = renderMapPlaceholder();
    assert.ok(!out.includes("<img"), "img rendered without a url");
    assert.ok(out.includes("Map"), "no 'Map' label");
    assert.ok(out.includes("200"), "placeholder is not 200px tall");
  });

  test("treats a blank string as empty", () => {
    assert.ok(!renderMapPlaceholder("   ").includes("<img"), "blank url rendered an img");
  });

  test("escapes a malicious url so it can't break the attribute", () => {
    const out = renderMapPlaceholder('"><script>alert(1)</script>');
    assert.ok(!out.includes('"><script>'), "attribute breakout leaked");
  });

  test("stays within the 600px column (both states)", () => {
    assertWidthWithin(renderMapPlaceholder(), 600, "map-empty");
    assertWidthWithin(renderMapPlaceholder("https://x/a.png"), 600, "map-img");
  });

  test("is email-safe (both states)", () => {
    assertEmailSafe(renderMapPlaceholder(), "map-empty");
    assertEmailSafe(renderMapPlaceholder("https://x/a.png"), "map-img");
  });
});
