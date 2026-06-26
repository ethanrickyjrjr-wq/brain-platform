import path from "node:path";
import { resolvePlace } from "../refinery/lib/place-resolver.mts";

/**
 * Intent to render a chart given a user question.
 * Dispatched by question-to-chart routing; consumed by the embed/charts layer.
 *
 * Chart types:
 *  - "bar": discrete categorical data (asking-rent, vacancy, or per-corridor vitals)
 *  - "area": time-series data (zhvi / home values)
 *
 * Scope narrows the breadth:
 *  - "asking-rent": market rents across corridors
 *  - "vacancy": vacancy rates across corridors
 *  - "zhvi": Zillow Home Value Index time-series
 *  - "vitals": per-corridor metrics (occupancy, absorption, etc.)
 */
export type ChartIntent =
  | { chart_type: "bar"; scope: "asking-rent" }
  | { chart_type: "bar"; scope: "vacancy" }
  | { chart_type: "area"; scope: "zhvi" }
  | { chart_type: "scatter"; scope: "corridor-scatter" }
  | { chart_type: "bar"; scope: "vitals"; corridor_slug: string }
  | { chart_type: "bar"; scope: "flood-aal" };

/**
 * Route a plain-English question to a chart intent.
 *
 * Heuristic keyword matching (case-insensitive):
 *
 * 1. **Market rents** — "rent" or "asking rent"
 *    → { chart_type: "bar", scope: "asking-rent" }
 *
 * 2. **Vacancy** — "vacanc" (matches vacancy/vacancies)
 *    → { chart_type: "bar", scope: "vacancy" }
 *
 * 3. **Home values / ZHVI** — "zhvi" or "home value" or "valuation" or "home price"
 *    → { chart_type: "area", scope: "zhvi" }
 *
 * 4. **Per-corridor vitals** — "how" + ("is" or "are" or "'s") OR "vital"
 *    → resolve the place name, if matched return
 *    { chart_type: "bar", scope: "vitals", corridor_slug: corridor_id }
 *    → otherwise continue
 *
 * 5. **No match** → return null
 *
 * Rules are applied in order; first match wins.
 */
export function routeChart(question: string): ChartIntent | null {
  if (!question || typeof question !== "string") return null;

  const q = question.toLowerCase();

  // 1. Flood / AAL
  if (q.includes("flood") || q.includes("aal") || q.includes("nfip")) {
    return { chart_type: "bar", scope: "flood-aal" };
  }

  // 2. Market rents
  if (q.includes("rent") || q.includes("asking rent")) {
    return { chart_type: "bar", scope: "asking-rent" };
  }

  // 3. Vacancy
  if (q.includes("vacanc")) {
    return { chart_type: "bar", scope: "vacancy" };
  }

  // 4. Home values / ZHVI
  if (
    q.includes("zhvi") ||
    q.includes("home value") ||
    q.includes("valuation") ||
    q.includes("price") // bare "price"/"prices" → home-value trend (was missed; "SWFL prices" charted nothing)
  ) {
    return { chart_type: "area", scope: "zhvi" };
  }

  // 4b. Corridor positioning scatter (cap rate × vacancy)
  if (
    q.includes("scatter") ||
    q.includes("position") ||
    (q.includes("corridor") && (q.includes("compar") || q.includes("vs") || q.includes("map")))
  ) {
    return { chart_type: "scatter", scope: "corridor-scatter" };
  }

  // 5. Per-corridor vitals
  // Match "how is/are/‛s" OR "vital"
  const hasHowPattern =
    q.includes("how") && (q.includes(" is ") || q.includes(" are ") || q.includes("'s"));
  const hasVitalKeyword = q.includes("vital");

  if (hasHowPattern || hasVitalKeyword) {
    const resolution = resolvePlace(question);
    if (resolution.matched && resolution.corridor_id) {
      return {
        chart_type: "bar",
        scope: "vitals",
        corridor_slug: resolution.corridor_id,
      };
    }
  }

  // 6. No match
  return null;
}

// ---------------------------------------------------------------------------
// routeRankedDelta — the cross-sectional "rank places by a value + its change"
// intent. The canned routeChart above sends "home value"/"price" to the zhvi
// TREND (a good default for "how are values trending"); this routes the OTHER
// shape — "which ZIPs are highest, and which way are they moving" — to the brains
// that carry a value column paired with its YoY/MoM delta (ranked-delta's data),
// which resolveReachTargets never reaches. Fires ONLY when BOTH a value+delta
// topic AND an explicit ranking intent are present, so trend questions keep the
// zhvi area chart. Returns the brain slug to bind ranked-delta from, or null.
// ---------------------------------------------------------------------------

const RANKED_DELTA_TOPICS: Array<{ topic: RegExp; slug: string }> = [
  {
    topic: /\b(home ?values?|zhvi|home ?prices?|house ?prices?|property ?values?)\b/i,
    slug: "home-values-swfl",
  },
  {
    topic: /\b(investor|cap ?rate|rent ?yield|gross ?yield|rental ?yield|cash ?flow)\b/i,
    slug: "investor-zip-swfl",
  },
  {
    topic:
      /\b(market ?heat|hottest|sellers'? ?market|buyer ?demand|pending ?ratio|market ?temperature)\b/i,
    slug: "market-heat-swfl",
  },
];

const RANKED_INTENT =
  /\b(by ?zip|by ?area|by ?neighborhood|which ?zips?|which ?areas?|rank(?:ed|ing)?|highest|lowest|top ?\d|priciest|most ?expensive|cheapest|across ?(?:zips?|areas?)|compare ?(?:zips?|areas?)|leaderboard)\b/i;

export function routeRankedDelta(question: string): string | null {
  if (!question || typeof question !== "string") return null;
  if (!RANKED_INTENT.test(question)) return null;
  for (const { topic, slug } of RANKED_DELTA_TOPICS) {
    if (topic.test(question)) return slug;
  }
  return null;
}

/**
 * Test runner. Run with: bun lib/route-chart.ts
 */
// CLI-detect idiom matching refinery/tools (works under both `bun script.ts`
// and `node script.ts`; `import.meta.main` is Bun-only and tsc rejects it).
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  console.log("Testing routeChart...\n");

  // Test 1: asking-rent match
  const test1 = routeChart("what are rents doing");
  const test1Pass = test1?.chart_type === "bar" && test1?.scope === "asking-rent";
  console.log(`✓ Test 1 (rents): ${test1Pass ? "PASS" : "FAIL"}`, JSON.stringify(test1));

  // Test 2: place resolution (may or may not match depending on place-resolver state)
  const test2 = routeChart("how is Vanderbilt Beach looking");
  const test2Pass = test2 === null || (test2?.chart_type === "bar" && test2?.scope === "vitals");
  console.log(`✓ Test 2 (place): ${test2Pass ? "PASS" : "FAIL"}`, JSON.stringify(test2));

  // Test 3: no match
  const test3 = routeChart("what's the weather");
  const test3Pass = test3 === null;
  console.log(`✓ Test 3 (weather): ${test3Pass ? "PASS" : "FAIL"}`, JSON.stringify(test3));

  const allPass = test1Pass && test2Pass && test3Pass;
  console.log(`\n${allPass ? "All tests passed!" : "Some tests failed."}`);
  process.exit(allPass ? 0 : 1);
}
