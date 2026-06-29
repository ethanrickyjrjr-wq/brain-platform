import { test, expect } from "bun:test";
import {
  suggestionsForMetric,
  suggestionsForSpan,
  suggestionsForSelection,
  isFreshnessToken,
  isLikelyDate,
  isDirectionLabel,
  deriveSelectionType,
} from "./suggestions";
import { resolveMethod } from "../../refinery/lib/methodology-registry.mts";
import { routeChart } from "../route-chart";

test("returns at least two suggestions", () => {
  const out = suggestionsForMetric({ metric: "median_sale_price", value: "$525,000" }, "cre-swfl");
  expect(out.length).toBeGreaterThanOrEqual(2);
});

test("one suggestion invites a comparison", () => {
  const out = suggestionsForMetric({ metric: "median_sale_price", value: "$525,000" }, "cre-swfl");
  expect(out.some((s) => /compare|other|vs\./i.test(s))).toBe(true);
});

test("humanizes the metric name (underscores → spaces)", () => {
  const out = suggestionsForMetric({ metric: "cap_rate", value: "6.2%" }, "cre-swfl");
  expect(out[0]).toContain("cap rate");
});

test("housing-swfl gets a third flood-risk suggestion", () => {
  const out = suggestionsForMetric(
    { metric: "median_sale_price", value: "$525,000" },
    "housing-swfl",
  );
  expect(out.length).toBe(3);
  expect(out.some((s) => /flood/i.test(s))).toBe(true);
});

test("value span => break down the figure, no definitional chip", () => {
  const c = suggestionsForSpan({ entry: resolveMethod("asking_rent_psf_median"), value: "$27.51" });
  expect(c[0]).toBe("Break down the $27.51");
  expect(c.some((s) => /^what is/i.test(s))).toBe(false);
});

test("need-component surfaces a find action", () => {
  const c = suggestionsForSpan({
    entry: resolveMethod("asking_rent_nnn_marketbeat_marco_island"),
    value: "$27.9",
    place: "Marco Island",
  });
  expect(c.some((s) => /^Find Marco Island's/.test(s))).toBe(true);
});

test("freshness token is detected", () => {
  expect(isFreshnessToken("SWFL-7421-v5-20260607")).toBe(true);
  expect(isFreshnessToken("$525,000")).toBe(false);
  expect(isFreshnessToken("Lee County")).toBe(false);
});

test("freshness-token selection never gets a 'what's driving' chip", () => {
  const c = suggestionsForSelection("SWFL-7421-v5-20260607", "place");
  expect(c.some((s) => /driving/i.test(s))).toBe(false);
  expect(c.some((s) => /fresh|current/i.test(s))).toBe(true);
});

test("place selection asks about the place, not 'what's driving' it", () => {
  const c = suggestionsForSelection("Lee County", "place");
  expect(c.some((s) => /driving/i.test(s))).toBe(false);
  expect(c.some((s) => /Lee County/.test(s))).toBe(true);
});

test("a direction/sentiment badge is NOT treated as a place", () => {
  // The master report's overall read renders as a selectable badge ("Mixed",
  // "Bullish", "→ Mixed"). classifyFact buckets non-numeric text as "place", so
  // without a guard the popup asks "What's the read on Mixed?" — nonsense about
  // a place named "Mixed". The badge must get sentiment-appropriate chips.
  for (const badge of ["Mixed", "Bullish", "→ Mixed", "bearish"]) {
    expect(isDirectionLabel(badge)).toBe(true);
    const c = suggestionsForSelection(badge, "place");
    expect(c.some((s) => /What's the read on/i.test(s))).toBe(false);
    expect(c.some((s) => /How does .+ compare/i.test(s))).toBe(false);
    expect(c.some((s) => /^Chart home values/i.test(s))).toBe(false);
    expect(c.some((s) => /driving|would change|signal|behind/i.test(s))).toBe(true);
  }
});

test("a real place is still treated as a place (the direction guard doesn't over-fire)", () => {
  expect(isDirectionLabel("Naples")).toBe(false);
  expect(isDirectionLabel("Fort Myers Beach")).toBe(false);
  const c = suggestionsForSelection("Naples", "place");
  expect(c.some((s) => /Naples/.test(s))).toBe(true);
});

test("a date/year is detected and never gets a 'what's driving' chip", () => {
  expect(isLikelyDate("2026-06-09")).toBe(true);
  expect(isLikelyDate("06/09/2026")).toBe(true);
  expect(isLikelyDate("2026")).toBe(true);
  expect(isLikelyDate("$525,000")).toBe(false);
  expect(isLikelyDate("22.29")).toBe(false);
  // classifyFact treats a date as "metric" (digits); the date guard must win.
  const c = suggestionsForSelection("2026-06-09", "metric");
  expect(c.some((s) => /driving/i.test(s))).toBe(false);
  expect(c.some((s) => /current|updated/i.test(s))).toBe(true);
});

test("deriveSelectionType maps section/token/date/metric/place", () => {
  // A large selection is a section regardless of its text classification.
  expect(
    deriveSelectionType({ text: "lots of words here", factType: "place", mode: "section" }),
  ).toBe("section");
  // The freshness token wins over classifyFact's "metric" (it has digits).
  expect(
    deriveSelectionType({ text: "SWFL-7421-v5-20260607", factType: "metric", mode: "fact" }),
  ).toBe("token");
  // A date wins over "metric" too.
  expect(deriveSelectionType({ text: "2026-06-09", factType: "metric", mode: "fact" })).toBe(
    "date",
  );
  // A plain figure stays metric; a place stays place.
  expect(deriveSelectionType({ text: "6.2%", factType: "metric", mode: "fact" })).toBe("metric");
  expect(deriveSelectionType({ text: "Fort Myers Beach", factType: "place", mode: "fact" })).toBe(
    "place",
  );
});

// --- Chart chip routing alignment ---
// Every "Chart …" chip generated by suggestions MUST resolve via routeChart so
// the chip never dead-ends (task-05 gate: no chip offered when no scope resolves).

test("rent metric chip routes to asking-rent", () => {
  const chips = suggestionsForMetric(
    { metric: "nnn_asking_rent_per_sqft", value: "$27.51" },
    "cre-swfl",
  );
  const chartChip = chips.find((c) => /^Chart/i.test(c));
  expect(chartChip).toBeDefined();
  expect(routeChart(chartChip!)).not.toBeNull();
  expect(routeChart(chartChip!)?.scope).toBe("asking-rent");
});

test("vacancy metric chip routes to vacancy", () => {
  const chips = suggestionsForMetric({ metric: "vacancy_pct", value: "8.2%" }, "cre-swfl");
  const chartChip = chips.find((c) => /^Chart/i.test(c));
  expect(chartChip).toBeDefined();
  expect(routeChart(chartChip!)).not.toBeNull();
  expect(routeChart(chartChip!)?.scope).toBe("vacancy");
});

test("zhvi metric chip routes to zhvi", () => {
  const chips = suggestionsForMetric(
    { metric: "zhvi_cape_coral", value: "$425,000" },
    "housing-swfl",
  );
  const chartChip = chips.find((c) => /^Chart/i.test(c));
  expect(chartChip).toBeDefined();
  expect(routeChart(chartChip!)).not.toBeNull();
  expect(routeChart(chartChip!)?.scope).toBe("zhvi");
});

test("unrelated metric produces no chart chip", () => {
  const chips = suggestionsForMetric({ metric: "permit_count_90d", value: "42" }, "notices-swfl");
  expect(chips.some((c) => /^Chart/i.test(c))).toBe(false);
});

test("place selection does not hardcode a chart chip — contextual chips only", () => {
  const chips = suggestionsForSelection("Fort Myers Beach", "place");
  // Chart chips are metric-specific (chartChipForMetric); place selections use
  // contextual questions about the place instead of a hardcoded chart offer.
  expect(chips.some((c) => /^Chart/i.test(c))).toBe(false);
  expect(chips.some((c) => /Fort Myers Beach/.test(c))).toBe(true);
});
