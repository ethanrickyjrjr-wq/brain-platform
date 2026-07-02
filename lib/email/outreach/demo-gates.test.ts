// lib/email/outreach/demo-gates.test.ts
import { describe, expect, test } from "bun:test";
import { anchoredNumbersGate, brandHexGate, logoGate, preSendGates, urlGate } from "./demo-gates";
import type { DemoTouchContent } from "./demo-content";

const content = (over: Partial<DemoTouchContent> = {}): DemoTouchContent => ({
  subject: "s",
  preheader: "p",
  kicker: "k",
  title: "t",
  chart: {
    type: "bar",
    title: "Park Shore — key figures",
    data: [
      { label: "Homes sold", value: 58 },
      { label: "Inventory", value: 402 },
    ],
  },
  bodyHtml: "We built this from live data.",
  deltaLine: null,
  stats: [
    { label: "Active listings", value: "214", source: "SWFL Data Gulf" },
    { label: "Median list price", value: "$1,240,000", source: "SWFL Data Gulf" },
  ],
  promptButtons: [
    { label: "Q1", url: "https://www.swfldatagulf.com/welcome?zip=34103&prompt=x&ref=r-t1" },
  ],
  ctaLabel: "See your whole week — already built",
  ctaUrl: "https://www.swfldatagulf.com/welcome?zip=34103&ref=r-t1",
  asOf: "07/02/2026",
  freshnessLine: "Live Southwest Florida data — as of 07/02/2026",
  sources: ["SWFL Data Gulf"],
  snapshot: null,
  anchors: ["214", "$1,240,000", 58, 402, "07/02/2026", "34103"],
  ...over,
});

const BRAND = { primary: "#670038", accent: "#ab8f40", logoUrl: "https://cdn.x.com/l.png" };

const okHtml = `<html><head><style>.x{font-size:15px;color:#123456}</style></head><body>
  <td style="border-bottom:3px solid #670038"><img src="https://cdn.x.com/l.png"></td>
  <div style="color:#ab8f40">Park Shore</div>
  <p>Active listings: 214 · Median list price $1,240,000 · as of 07/02/2026 · ZIP 34103</p>
  <a href="https://www.swfldatagulf.com/welcome?zip=34103&amp;ref=r-t1">See your whole week</a>
  <div>Homes sold 58, Inventory 402</div>
</body></html>`;

const okFetch = (async () =>
  new Response("x", { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;

describe("brandHexGate", () => {
  test("passes when both hexes present (case-insensitive)", () => {
    expect(brandHexGate(okHtml.toUpperCase(), BRAND).ok).toBe(true);
  });
  test("fails on missing accent", () => {
    const r = brandHexGate(okHtml.replaceAll("#ab8f40", "#111111"), BRAND);
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toContain("#ab8f40");
  });
  test("fails when the row has no primary at all", () => {
    const r = brandHexGate(okHtml, { primary: null, accent: "#ab8f40" });
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toContain("no brand primary");
  });
});

describe("logoGate", () => {
  test("200 image passes", async () => {
    expect((await logoGate("https://cdn.x.com/l.png", okFetch)).ok).toBe(true);
  });
  test("404 fails; non-image fails; null fails", async () => {
    const notFound = (async () => new Response("x", { status: 404 })) as typeof fetch;
    const notImage = (async () =>
      new Response("x", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
    expect((await logoGate("https://cdn.x.com/l.png", notFound)).ok).toBe(false);
    expect((await logoGate("https://cdn.x.com/l.png", notImage)).ok).toBe(false);
    expect((await logoGate(null)).ok).toBe(false);
  });
});

describe("urlGate", () => {
  test("platform + content + brand URLs pass", () => {
    expect(urlGate(okHtml, content(), [BRAND]).ok).toBe(true);
  });
  test("a foreign minted link fails", () => {
    const bad = okHtml.replace(
      "https://www.swfldatagulf.com/welcome?zip=34103&amp;ref=r-t1",
      "https://evil.example.com/x",
    );
    const r = urlGate(bad, content(), [BRAND]);
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toContain("evil.example.com");
  });
});

describe("anchoredNumbersGate", () => {
  test("all displayed figures anchored → ok; style-attr numbers ignored", () => {
    expect(anchoredNumbersGate(okHtml, content().anchors).ok).toBe(true);
  });
  test("an unanchored figure fails", () => {
    const r = anchoredNumbersGate(okHtml.replace("214", "999,999"), content().anchors);
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toContain("999999");
  });
});

describe("preSendGates", () => {
  test("aggregates all four", async () => {
    const r = await preSendGates(okHtml, content(), BRAND, { fetchImpl: okFetch });
    expect(r).toEqual({ ok: true, failures: [] });
  });
  test("collects failures from each gate", async () => {
    const bad = okHtml.replaceAll("#ab8f40", "#111111").replace("214", "999,999");
    const notFound = (async () => new Response("x", { status: 404 })) as typeof fetch;
    const r = await preSendGates(bad, content(), BRAND, { fetchImpl: notFound });
    expect(r.ok).toBe(false);
    expect(r.failures.length).toBeGreaterThanOrEqual(3);
  });
});
