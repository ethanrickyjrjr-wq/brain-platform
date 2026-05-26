import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Pure helpers — no env-dependent module state. Import directly so the test
// file doesn't have to set REFINERY_SOURCE just to exercise these.
const {
  normalizeBrokerNarrative,
  formatQuarterForDisplay,
  composeCharacterRender,
  normalizeCorridor,
  groupCorridorsBySubmarket,
} = await import("./cre-source.mts");
import type {
  CorridorNormalized,
  JoinedSubmarketGroup,
} from "./cre-source.mts";
import type { MarketbeatSwflNormalized } from "./marketbeat-swfl-source.mts";

// Minimal CorridorNormalized factory — only the fields the join touches.
function mkCorridor(name: string): CorridorNormalized {
  return {
    kind: "corridor",
    name,
    city: "",
    county: "Unknown",
    corridor_type: "unknown",
    seasonal_index: null,
    character: null,
    evolution_direction: null,
    tenant_mix: null,
    flags: [],
    source_url: null,
    cap_rate_source_url: null,
    vacancy_rate_source_url: null,
    absorption_sqft_source_url: null,
    asking_rent_psf_source_url: null,
    cap_rate_pct: null,
    cap_rate_direction: null,
    vacancy_rate_pct: null,
    vacancy_rate_direction: null,
    absorption_sqft: null,
    absorption_sqft_direction: null,
    asking_rent_psf: null,
    asking_rent_psf_direction: null,
    metrics_period: null,
    metrics_verified_date: null,
    character_broker_narrative: null,
    character_render: null,
  };
}

function mkMbRow(submarket: string): MarketbeatSwflNormalized {
  return {
    kind: "marketbeat-swfl",
    submarket,
    quarter: "2026-Q3",
    vacancy_rate: 5.0,
    asking_rent_nnn: 30.0,
    absorption_sqft: 10_000,
    source_url: "https://example.invalid/mb",
  };
}

const BROKER_FIXTURE = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "corridor-profiles.broker-narrative.sample.json",
);

async function loadBrokerFixtureRows(): Promise<Record<string, unknown>[]> {
  const data = JSON.parse(await readFile(BROKER_FIXTURE, "utf-8")) as {
    rows: Record<string, unknown>[];
  };
  return data.rows;
}

// --- formatQuarterForDisplay -------------------------------------------

test("formatQuarterForDisplay: YYYY-Qn → Qn YYYY", () => {
  assert.equal(formatQuarterForDisplay("2026-Q3"), "Q3 2026");
  assert.equal(formatQuarterForDisplay("2025-Q1"), "Q1 2025");
});

test("formatQuarterForDisplay: unknown shape returns input verbatim", () => {
  assert.equal(formatQuarterForDisplay("2026-H1"), "2026-H1");
  assert.equal(formatQuarterForDisplay("Q3 2026"), "Q3 2026");
  assert.equal(formatQuarterForDisplay(""), "");
});

// --- normalizeBrokerNarrative ------------------------------------------

test("normalizeBrokerNarrative: null / undefined → null", () => {
  assert.equal(normalizeBrokerNarrative(null), null);
  assert.equal(normalizeBrokerNarrative(undefined), null);
});

test("normalizeBrokerNarrative: object → typed narrative", () => {
  const out = normalizeBrokerNarrative({
    quarter: "2026-Q3",
    market_positioning: "x",
    dominant_tenant_types: "y",
    development_pipeline_notes: "z",
  });
  assert.deepEqual(out, {
    quarter: "2026-Q3",
    market_positioning: "x",
    dominant_tenant_types: "y",
    development_pipeline_notes: "z",
  });
});

test("normalizeBrokerNarrative: JSON string round-trips into a typed narrative", () => {
  const raw = JSON.stringify({
    quarter: "2026-Q3",
    market_positioning: "x",
    dominant_tenant_types: null,
    development_pipeline_notes: null,
  });
  const out = normalizeBrokerNarrative(raw);
  assert.ok(out);
  assert.equal(out!.quarter, "2026-Q3");
  assert.equal(out!.market_positioning, "x");
});

test("normalizeBrokerNarrative: missing quarter → null (unanchored narrative)", () => {
  const out = normalizeBrokerNarrative({
    market_positioning: "x",
  });
  assert.equal(out, null);
});

test("normalizeBrokerNarrative: quarter present but all text fields empty → null", () => {
  const out = normalizeBrokerNarrative({
    quarter: "2026-Q3",
    market_positioning: null,
    dominant_tenant_types: null,
    development_pipeline_notes: null,
  });
  assert.equal(out, null);
});

test("normalizeBrokerNarrative: invalid JSON string → null", () => {
  assert.equal(normalizeBrokerNarrative("not-json"), null);
});

// --- composeCharacterRender (the three Part-6b cases) ------------------

test("case 1: both character + broker positioning present → character verbatim + freshness-prefixed broker line appended", () => {
  const out = composeCharacterRender("Hand-authored character text.", {
    quarter: "2026-Q3",
    market_positioning: "Broker says X.",
    dominant_tenant_types: null,
    development_pipeline_notes: null,
  });
  // Character verbatim, blank line, then "Broker positioning (Q3 2026): ..."
  assert.equal(
    out,
    "Hand-authored character text.\n\nBroker positioning (Q3 2026): Broker says X.",
  );
  // Append order: character first.
  assert.ok(out!.startsWith("Hand-authored character text."));
  // Freshness prefix: "Q3 2026" (display format), not "2026-Q3".
  assert.ok(out!.includes("Broker positioning (Q3 2026):"));
});

test("case 2: only broker narrative present → broker line used as character fallback", () => {
  const out = composeCharacterRender(null, {
    quarter: "2026-Q2",
    market_positioning: "Broker only.",
    dominant_tenant_types: null,
    development_pipeline_notes: null,
  });
  assert.equal(out, "Broker positioning (Q2 2026): Broker only.");
});

test("case 3: only character present → character verbatim (no broker append)", () => {
  const out = composeCharacterRender("Just character.", null);
  assert.equal(out, "Just character.");
});

test("case 4: neither present → null", () => {
  assert.equal(composeCharacterRender(null, null), null);
});

test("composeCharacterRender: broker narrative with null market_positioning is treated as no broker signal", () => {
  // A narrative that only carries pipeline_notes / tenant_types — but no
  // primary `market_positioning` — must not produce a broker line. The pack
  // only surfaces market_positioning as the headline; the other two fields
  // are reserved for future render passes.
  const out = composeCharacterRender("Character only.", {
    quarter: "2026-Q3",
    market_positioning: null,
    dominant_tenant_types: "QSR",
    development_pipeline_notes: "Note",
  });
  assert.equal(out, "Character only.");
});

// --- normalizeCorridor end-to-end against the fixture rows -------------

test("fixture row A (both): normalizeCorridor populates broker + character_render with append order", async () => {
  const rows = await loadBrokerFixtureRows();
  const rowA = rows.find((r) => r.corridor_name === "Test Corridor A — Both");
  assert.ok(rowA);
  const c = normalizeCorridor(rowA!);
  assert.equal(
    c.character,
    "Hand-authored character text — the verbatim editorial intel.",
  );
  assert.ok(c.character_broker_narrative);
  assert.equal(c.character_broker_narrative!.quarter, "2026-Q3");
  assert.ok(c.character_render);
  assert.ok(c.character_render!.startsWith("Hand-authored character text"));
  assert.ok(c.character_render!.includes("Broker positioning (Q3 2026):"));
});

test("fixture row B (broker only): normalizeCorridor uses broker as character fallback", async () => {
  const rows = await loadBrokerFixtureRows();
  const rowB = rows.find(
    (r) => r.corridor_name === "Test Corridor B — Broker Only",
  );
  assert.ok(rowB);
  const c = normalizeCorridor(rowB!);
  assert.equal(c.character, null);
  assert.ok(c.character_broker_narrative);
  assert.equal(
    c.character_render,
    "Broker positioning (Q2 2026): Broker-only narrative — no hand-authored character to quote.",
  );
});

test("fixture row C (neither): normalizeCorridor leaves broker + character_render null", async () => {
  const rows = await loadBrokerFixtureRows();
  const rowC = rows.find(
    (r) => r.corridor_name === "Test Corridor C — Neither",
  );
  assert.ok(rowC);
  const c = normalizeCorridor(rowC!);
  assert.equal(c.character, null);
  assert.equal(c.character_broker_narrative, null);
  assert.equal(c.character_render, null);
});

test("normalizeCorridor: hand-authored character is NEVER mutated when broker narrative is present", async () => {
  const rows = await loadBrokerFixtureRows();
  const rowA = rows.find((r) => r.corridor_name === "Test Corridor A — Both");
  const c = normalizeCorridor(rowA!);
  // Same string identity as the raw fixture value — proves we layered, not replaced.
  assert.equal(c.character, rowA!.character);
});

// --- groupCorridorsBySubmarket -----------------------------------------

test("groupCorridorsBySubmarket: empty mbRows → empty matched + all corridors unmatched", () => {
  const corridors = [
    mkCorridor("Pine Ridge Rd Naples"),
    mkCorridor("Cape Coral Pkwy E"),
  ];
  const { matched, unmatched } = groupCorridorsBySubmarket(corridors, []);
  assert.equal(matched.size, 0);
  assert.equal(unmatched.length, 2);
  assert.deepEqual(
    unmatched.map((c) => c.name),
    ["Pine Ridge Rd Naples", "Cape Coral Pkwy E"],
  );
});

test("groupCorridorsBySubmarket: happy path — intersects mapped corridors with corpus", () => {
  const corridors = [
    mkCorridor("Pine Ridge Rd Naples"),
    mkCorridor("Immokalee Rd North Naples"),
    mkCorridor("Cape Coral Pkwy E"),
  ];
  const mbRows = [mkMbRow("Naples"), mkMbRow("Cape Coral")];
  const { matched, unmatched } = groupCorridorsBySubmarket(corridors, mbRows);
  assert.equal(matched.size, 2);
  const naples = matched.get("Naples") as JoinedSubmarketGroup;
  assert.ok(naples);
  assert.equal(naples.submarket, "Naples");
  assert.deepEqual(naples.corridors.map((c) => c.name).sort(), [
    "Immokalee Rd North Naples",
    "Pine Ridge Rd Naples",
  ]);
  // Full alias denominator captured at join time.
  assert.equal(naples.mappedCorridorNames.length, 10);
  const cape = matched.get("Cape Coral") as JoinedSubmarketGroup;
  assert.ok(cape);
  assert.deepEqual(
    cape.corridors.map((c) => c.name),
    ["Cape Coral Pkwy E"],
  );
  assert.equal(cape.mappedCorridorNames.length, 3);
  assert.equal(unmatched.length, 0);
});

test("groupCorridorsBySubmarket: corridor with no alias entry → unmatched", () => {
  const corridors = [
    mkCorridor("Pine Ridge Rd Naples"),
    mkCorridor("Nonexistent Corridor"),
  ];
  const { matched, unmatched } = groupCorridorsBySubmarket(corridors, [
    mkMbRow("Naples"),
  ]);
  assert.equal(matched.size, 1);
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0]!.name, "Nonexistent Corridor");
});

test("groupCorridorsBySubmarket: corridor resolves to submarket with no mbRow → unmatched", () => {
  const corridors = [
    mkCorridor("Pine Ridge Rd Naples"),
    mkCorridor("Cape Coral Pkwy E"),
  ];
  // Only Naples has an mbRow this run.
  const { matched, unmatched } = groupCorridorsBySubmarket(corridors, [
    mkMbRow("Naples"),
  ]);
  assert.equal(matched.size, 1);
  assert.ok(matched.has("Naples"));
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0]!.name, "Cape Coral Pkwy E");
});

test("groupCorridorsBySubmarket: submarket with mbRow but zero matched corridors → group with corridors: [] and full mappedCorridorNames", () => {
  const corridors = [mkCorridor("Pine Ridge Rd Naples")];
  // Bonita Springs has a row but no corridors in the corpus.
  const { matched, unmatched } = groupCorridorsBySubmarket(corridors, [
    mkMbRow("Naples"),
    mkMbRow("Bonita Springs"),
  ]);
  const bonita = matched.get("Bonita Springs") as JoinedSubmarketGroup;
  assert.ok(bonita);
  assert.equal(bonita.corridors.length, 0);
  // Denominator still populated so the producer can disclose `0 of 2 mapped`.
  assert.equal(bonita.mappedCorridorNames.length, 2);
  assert.equal(unmatched.length, 0);
});

test("groupCorridorsBySubmarket: matched Map keys are raw submarket strings, not slugs", () => {
  const { matched } = groupCorridorsBySubmarket(
    [mkCorridor("US-41 / Cleveland Ave Fort Myers")],
    [mkMbRow("Fort Myers")],
  );
  assert.ok(matched.has("Fort Myers"));
  assert.ok(!matched.has("fort_myers"));
});
