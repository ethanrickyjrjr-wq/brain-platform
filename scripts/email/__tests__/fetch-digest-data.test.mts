// scripts/email/__tests__/fetch-digest-data.test.mts
import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  parseBrainOutputSection,
  extractZipMetrics,
  parseCityVoices,
  isMarketRelevant,
  selectCityVoices,
} from "../fetch-digest-data.mts";
import type { CityVoiceSignal } from "../types.ts";

describe("parseBrainOutputSection", () => {
  test("extracts JSON from --- OUTPUT --- section", () => {
    const md = `---\nbrain_id: housing-swfl\n---\nNarrative.\n--- OUTPUT ---\n{"key_metrics":[],"detail_tables":[]}`;
    assert.deepEqual(parseBrainOutputSection(md), { key_metrics: [], detail_tables: [] });
  });

  test("parses the JSON object even when sections follow it (real brain shape)", () => {
    // Real brain files continue after the OUTPUT object with more sections and
    // a code fence. Parse-to-EOF throws "Extra data"; the parser must stop at
    // the object's matching brace.
    const md =
      `header\n--- OUTPUT ---\n{"key_metrics":[],"detail_tables":[{"rows":[]}]}\n\n` +
      "--- ACTIVE PROJECTS ---\n- housing-swfl: track market.\n" +
      "--- RECENT NOTES ---\n- 2026-06-03: refined.\n```\n";
    const out = parseBrainOutputSection(md) as { detail_tables: unknown[] } | null;
    assert.ok(out);
    assert.equal(out.detail_tables.length, 1);
  });

  test("brace inside a string value does not end the object early", () => {
    const md = `--- OUTPUT ---\n{"conclusion":"a } brace in prose","key_metrics":[]}\nTRAILING`;
    const out = parseBrainOutputSection(md) as { conclusion: string } | null;
    assert.ok(out);
    assert.equal(out.conclusion, "a } brace in prose");
  });

  test("returns null when no OUTPUT section", () => {
    assert.equal(parseBrainOutputSection("no output here"), null);
  });

  test("returns null on malformed JSON", () => {
    assert.equal(parseBrainOutputSection("--- OUTPUT ---\nnot json"), null);
  });
});

describe("extractZipMetrics", () => {
  test("maps Redfin cell fields to ZipMetricSnapshot (sale-to-list 0–100 → 0–1)", () => {
    // Shape is a detail-table row's `cells` object, not a flat row.
    const cells = {
      metro: "Cape Coral, FL",
      median_sale_price: 412000,
      median_dom: 52,
      months_of_supply: 4.1,
      avg_sale_to_list_pct: 97, // brain stores this as a 0–100 percent
      inventory: 143,
      homes_sold: 22,
      low_sample: false,
    };
    const result = extractZipMetrics(cells);
    assert.equal(result.median_sale_price, 412000);
    assert.equal(result.dom, 52);
    assert.equal(result.months_of_supply, 4.1);
    assert.equal(result.avg_sale_to_list, 0.97); // normalized to 0–1
    assert.equal(result.sold_above_list_pct, null); // no such column at ZIP grain
    assert.equal(result.inventory, 143);
    assert.equal(result.sale_count_period, 22);
  });

  test("returns all-null for empty cells", () => {
    const result = extractZipMetrics({});
    assert.equal(result.median_sale_price, null);
    assert.equal(result.dom, null);
    assert.equal(result.sale_count_period, null);
  });
});

describe("parseCityVoices", () => {
  test("parses markdown table rows into priority-ordered signals", () => {
    const text = [
      "| Metric | Value | Direction |",
      "| --- | --- | --- |",
      "| Cape Coral — breaking | Cape Coral: A 6.1 magnitude earthquake near Cuba was felt across SWFL. | stable |",
      "| Bonita Springs — transactions | Bonita Springs: 5100 Seagrass Way listed at $7,675,000. | stable |",
    ].join("\n");
    const sigs = parseCityVoices(text);
    assert.equal(sigs.length, 2);
    assert.equal(sigs[0].topic, "breaking");
    assert.equal(sigs[0].city, "Cape Coral");
    assert.ok(sigs[0].title.startsWith("A 6.1 magnitude"), `got: ${sigs[0].title}`);
    assert.equal(sigs[1].topic, "transactions");
    assert.equal(sigs[1].city, "Bonita Springs");
  });

  test("ignores header, separator, and prose lines", () => {
    const text =
      "**SWFL pulse**\n| Metric | Value | Direction |\n| --- | --- | --- |\nNarrative line.";
    assert.deepEqual(parseCityVoices(text), []);
  });
});

describe("city voice relevance filter", () => {
  const sig = (topic: CityVoiceSignal["topic"], title: string, city = "X"): CityVoiceSignal => ({
    topic,
    title,
    city,
    source_url: "",
  });

  test("transaction/development/business topics are market-relevant", () => {
    assert.equal(isMarketRelevant(sig("transactions", "anything")), true);
    assert.equal(isMarketRelevant(sig("development", "anything")), true);
    assert.equal(isMarketRelevant(sig("business", "anything")), true);
  });

  test("human-interest breaking is NOT market-relevant", () => {
    assert.equal(
      isMarketRelevant(
        sig("breaking", "A 6.1 magnitude earthquake near Cuba was felt across SWFL."),
      ),
      false,
    );
  });

  test("market breaking (rezone / $ / project) IS market-relevant", () => {
    assert.equal(
      isMarketRelevant(
        sig("breaking", "Cape Coral council approves rezoning for a 200-unit apartment project"),
      ),
      true,
    );
    assert.equal(isMarketRelevant(sig("breaking", "Bayfront home sold for $15,900,000")), true);
  });

  test("subject never leads with human-interest; market leads body; near-dupes collapse", () => {
    const signals: CityVoiceSignal[] = [
      sig(
        "breaking",
        "A 6.1 magnitude earthquake near Cuba was felt across Southwest Florida.",
        "Fort Myers",
      ),
      sig(
        "breaking",
        "A 6.1 magnitude earthquake near Cuba was felt across Southwest Florida including Naples, as covered in a second report.",
        "North Naples",
      ),
      sig(
        "transactions",
        "3580 Gin Lane sold for $15,900,000 — most expensive in Collier for May.",
        "Naples",
      ),
      sig("development", "Bonita Springs approves a 150-unit mixed-use project.", "Bonita Springs"),
    ];
    const { cityVoices, topStory } = selectCityVoices(signals, 4);
    assert.ok(topStory);
    assert.equal(isMarketRelevant(topStory), true); // subject source is always market-relevant
    assert.ok(isMarketRelevant(cityVoices[0])); // body leads with a market item
    const quakeCount = cityVoices.filter((s) => /earthquake/i.test(s.title)).length;
    assert.ok(quakeCount <= 1, `expected ≤1 quake item after dedup, got ${quakeCount}`);
  });

  test("all-human-interest day → no market top_story (subject falls back to ZIP metric)", () => {
    const signals: CityVoiceSignal[] = [
      sig("breaking", "Local restaurant owner worried about family abroad after a quake."),
      sig("breaking", "Heavy rain caused minor street flooding downtown."),
    ];
    const { topStory } = selectCityVoices(signals, 4);
    assert.equal(topStory, null);
  });

  test("Cuba-style: a breaking item never becomes the subject — even with market keywords (allowlist gate)", () => {
    const signals: CityVoiceSignal[] = [
      sig("breaking", "A 6.1 magnitude earthquake near Cuba was felt across SWFL.", "Cape Coral"),
      // Topic is still `breaking`, so even this market-keyword sale is gated out
      // of the SUBJECT (it may still lead the BODY via the keyword relevance).
      sig("breaking", "A waterfront home sold for $5,000,000 in Naples.", "Naples"),
    ];
    const { topStory, cityVoices } = selectCityVoices(signals, 4);
    assert.equal(topStory, null); // SUBJECT_TOPICS excludes breaking → no promotion
    assert.ok(
      /sold for/i.test(cityVoices[0].title),
      `body should rank the sale first: ${cityVoices[0].title}`,
    );
  });
});
