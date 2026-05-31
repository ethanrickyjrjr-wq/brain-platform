import { test } from "bun:test";
import assert from "node:assert/strict";

process.env["REFINERY_SOURCE"] = "fixture";

const { econDevSwfl, isQualifying, QUALIFYING_CATEGORIES } =
  await import("./econ-dev-swfl.mts");
const { swflIncSource } = await import("../sources/swfl-inc-source.mts");

import type { RawFragment } from "../types/fragment.mts";
import type { SwflIncNormalized } from "../sources/swfl-inc-source.mts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

let _seq = 0;
function frag(over: Partial<SwflIncNormalized> = {}): RawFragment {
  _seq += 1;
  return {
    fragment_id: `swfl_inc_announcements:test:${_seq}`,
    source_id: "swfl_inc_announcements",
    source_trust_tier: 2,
    fetched_at: "2026-05-30T00:00:00Z",
    raw: {},
    normalized: {
      kind: "swfl-inc-announcement",
      id: `test-${_seq}`,
      title: `Test announcement ${_seq}`,
      announced_date: daysAgo(30),
      county: "lee",
      category: "relocation",
      investment_usd: null,
      jobs: null,
      summary: null,
      source_url: "https://www.swflinc.com/blog/test-announcement",
      ...over,
    } as unknown,
  } as RawFragment;
}

function metricValue(
  out: { key_metrics: { metric: string; value: unknown }[] },
  name: string,
) {
  return out.key_metrics.find((m) => m.metric === name)?.value;
}

// ── Test 1: deterministic flags ───────────────────────────────────────────────

test("econ-dev-swfl: deterministic flags", () => {
  assert.equal(econDevSwfl.skipSynthesisAgent, true);
  assert.equal(econDevSwfl.skipTriageAgent, true);
  assert.equal(econDevSwfl.input_brains.length, 0);
});

// ── Test 2: isQualifying classifies categories correctly ──────────────────────

test("econ-dev-swfl: isQualifying includes project categories, excludes the rest", () => {
  for (const cat of QUALIFYING_CATEGORIES) {
    assert.equal(
      isQualifying({ category: cat }),
      true,
      `${cat} should qualify`,
    );
  }
  for (const cat of ["partnership", "workforce", null, "", "event"]) {
    assert.equal(
      isQualifying({ category: cat }),
      false,
      `${cat} should NOT qualify`,
    );
  }
});

// ── Test 3: momentum count excludes partnership + null-category rows ───────────

test("econ-dev-swfl: announcement count counts only qualifying rows in the window", () => {
  const fragments = [
    frag({ category: "relocation", announced_date: daysAgo(20) }),
    frag({ category: "grant", announced_date: daysAgo(40) }),
    frag({ category: "partnership", announced_date: daysAgo(25) }), // excluded
    frag({ category: null, announced_date: daysAgo(15) }), // excluded
  ];

  econDevSwfl.corpusSummary!(fragments);
  const out = econDevSwfl.outputProducer!({} as never);

  // 2 qualifying (relocation + grant) out of 4 dated rows in the 90-day window.
  assert.equal(
    metricValue(out, "econ_dev_announcements_90d"),
    2,
    "only relocation + grant should count; partnership + null excluded",
  );

  const caveat = out.caveats.find((c) => c.includes("qualifying categories"));
  assert.ok(
    caveat,
    "expected the qualifying-categories signal-to-noise caveat",
  );
  assert.ok(
    caveat!.startsWith("2 of 4"),
    `caveat should report 2 of 4; got: ${caveat}`,
  );
});

// ── Test 4: prior-window momentum also restricted to qualifying ───────────────

test("econ-dev-swfl: prior-window count is qualifying-only (drives momentum)", () => {
  const fragments = [
    frag({ category: "relocation", announced_date: daysAgo(20) }), // recent qualifying
    frag({ category: "infrastructure", announced_date: daysAgo(30) }), // recent qualifying
    frag({ category: "expansion", announced_date: daysAgo(120) }), // prior qualifying
    frag({ category: "partnership", announced_date: daysAgo(130) }), // prior, excluded
  ];

  econDevSwfl.corpusSummary!(fragments);
  const out = econDevSwfl.outputProducer!({} as never);

  assert.equal(metricValue(out, "econ_dev_announcements_90d"), 2);
  assert.equal(metricValue(out, "econ_dev_announcements_prior_90d"), 1);
  // recent (2) > prior (1) → bullish momentum.
  assert.equal(out.direction, "bullish");
});

// ── Test 5: empty data → valid neutral output, no throw ───────────────────────

test("econ-dev-swfl: empty data yields a valid neutral output", () => {
  econDevSwfl.corpusSummary!([]);
  const out = econDevSwfl.outputProducer!({} as never);

  assert.equal(out.key_metrics.length, 0);
  assert.equal(out.direction, "neutral");
  assert.ok(out.caveats.length >= 1);
});

// ── Test 6: fixture source round-trip — metrics present, no dead /news/ url ────

test("econ-dev-swfl: fixture round-trip emits the count metric with a live /blog/ source", async () => {
  const fragments = await swflIncSource.fetch();
  assert.ok(fragments.length >= 1, "fixture must return ≥1 fragment");

  econDevSwfl.corpusSummary!(fragments);
  const out = econDevSwfl.outputProducer!({} as never);

  assert.ok(
    out.key_metrics.some((m) => m.metric === "econ_dev_announcements_90d"),
    "expected econ_dev_announcements_90d metric",
  );
  for (const m of out.key_metrics) {
    assert.ok(
      typeof m.source?.url === "string" && m.source.url.length > 0,
      `metric ${m.metric} missing source.url`,
    );
    assert.ok(
      !m.source.url.includes("/news/"),
      `metric ${m.metric} still points at the dead /news/ URL: ${m.source.url}`,
    );
  }
});
