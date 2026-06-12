// scripts/email/__tests__/build-digest.test.mts
import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { computeDelta, buildSubjectLine } from "../build-digest.mts";
import { selectCityVoices } from "../fetch-digest-data.mts";
import type { ZipMetricSnapshot, DigestPayload, CityVoiceSignal } from "../types.ts";

function snap(o: Partial<ZipMetricSnapshot> = {}): ZipMetricSnapshot {
  return {
    median_sale_price: 400000,
    dom: 50,
    months_of_supply: 4.0,
    avg_sale_to_list: 0.97,
    sold_above_list_pct: 0.18,
    inventory: 100,
    sale_count_period: 20,
    ...o,
  };
}

describe("computeDelta — transaction floor", () => {
  test("no flag when sale_count below floor (3 sales, >5% move)", () => {
    const prev = snap({ median_sale_price: 300000, sale_count_period: 3 });
    const curr = snap({ median_sale_price: 400000, sale_count_period: 4 });
    const deltas = computeDelta(curr, prev, "zip");
    assert.equal(
      deltas.find((d) => d.metric === "median_sale_price" && d.is_escalation),
      undefined,
    );
  });

  test("flags price move when floor met (15 sales, >5%)", () => {
    const prev = snap({ median_sale_price: 380000, sale_count_period: 15 });
    const curr = snap({ median_sale_price: 412000, sale_count_period: 15 });
    const deltas = computeDelta(curr, prev, "zip");
    const esc = deltas.find((d) => d.metric === "median_sale_price" && d.is_escalation);
    assert.ok(esc);
    assert.equal(esc.direction_framing, "bullish");
  });

  test("DOM +20 days → bearish escalation", () => {
    const prev = snap({ dom: 50 });
    const curr = snap({ dom: 70 });
    const deltas = computeDelta(curr, prev, "zip");
    const esc = deltas.find((d) => d.metric === "dom" && d.is_escalation);
    assert.ok(esc);
    assert.equal(esc.direction_framing, "bearish");
  });

  test("returns empty array when previous is null", () => {
    assert.deepEqual(computeDelta(snap(), null, "zip"), []);
  });
});

describe("buildSubjectLine", () => {
  function fakePayload(overrides: Partial<DigestPayload> = {}): DigestPayload {
    return {
      date: "2026-06-11",
      freshness_manifest: {} as DigestPayload["freshness_manifest"],
      top_line: "Market steady.",
      zip_metrics: { "33908": snap({ dom: 52 }) },
      county_metrics: snap(),
      city_voices: [],
      top_story: null,
      ...overrides,
    };
  }

  test("eligible top_story → branded, truncated ≤50", () => {
    const p = fakePayload({
      top_story: {
        title: "5100 Seagrass Way #706, Bonita Springs listed at $7.6M",
        slug: "city-pulse-swfl",
        topic: "transactions",
      },
    });
    const s = buildSubjectLine(p, []);
    assert.ok(s.length <= 50, `too long: "${s}" (${s.length})`);
  });

  test("no top_story → data lede + brand fallback", () => {
    const s = buildSubjectLine(fakePayload({ zip_metrics: { "33908": snap({ dom: 87 }) } }), []);
    assert.ok(s.includes("33908 DOM hits 87"), `got: "${s}"`);
    assert.ok(s.includes("SWFL Data Gulf"), `got: "${s}"`);
    assert.ok(s.length <= 50, `too long: "${s}" (${s.length})`);
  });

  test("Cuba-style breaking item never becomes the subject (end-to-end)", () => {
    // Run a human-interest breaking signal through the real gate, then build the
    // subject exactly as the orchestrator does.
    const cuba: CityVoiceSignal = {
      topic: "breaking",
      title: "A 6.1 magnitude earthquake near Cuba was felt across SWFL.",
      city: "Cape Coral",
      source_url: "",
    };
    const { topStory } = selectCityVoices([cuba], 4);
    const p = fakePayload({
      zip_metrics: { "33908": snap({ dom: 87 }) },
      top_story: topStory
        ? { title: topStory.title, slug: "city-pulse-swfl", topic: topStory.topic }
        : null,
    });
    const s = buildSubjectLine(p, []);
    assert.ok(!/earthquake|cuba/i.test(s), `human-interest leaked into subject: "${s}"`);
    assert.ok(s.includes("33908 DOM hits 87"), `expected data lede, got: "${s}"`);
  });

  test("no unexpected ALL-CAPS shouting (brand acronym SWFL allowed)", () => {
    const s = buildSubjectLine(fakePayload(), []).replace(/\bSWFL\b/g, "");
    assert.ok(!/\b[A-Z]{4,}\b/.test(s), `ALL-CAPS found: "${s}"`);
  });
});
