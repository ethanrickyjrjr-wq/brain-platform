/**
 * SWFL place + topic taxonomy for the search-demand digest.
 *
 * Refinery-owned and same-package on purpose (FLAG 2): the digest classifier
 * must never reach across into `app/r/cre-swfl/corridors.ts` (a sibling package
 * that bun resolves in dev but CI may not — a silent resolution failure would
 * make classification fall back to nothing and the digest misfire quietly).
 * Corridor slugs come from the canonical `corridor-aliases.mts` in this same
 * `refinery/lib` dir, already drift-guarded by `corridor-slug-parity.test.mts`.
 *
 * Scope of v1 classification: free-text search queries map to PLACE + TOPIC +
 * BRAIN. They do NOT map to a corridor — keyword volume for "naples cap rate"
 * can't tell you which corridor; that precise attribution comes from the
 * Phase-2 GSC page-join (the /r/cre-swfl/[corridor] landing URL). CORRIDOR_SLUGS
 * is exported for that future join, not for fuzzy keyword matching.
 */
import { CORRIDOR_ALIASES } from "./corridor-aliases.mts";

/** The 25 live corridor slugs (Lee + Collier). For the Phase-2 page-join. */
export const CORRIDOR_SLUGS: string[] = Object.keys(CORRIDOR_ALIASES);

/** SWFL town/place tokens a searcher would type, lowercased. */
export const SWFL_PLACES: string[] = [
  "fort myers beach", // before "fort myers" so the longer match wins
  "fort myers",
  "cape coral",
  "north fort myers",
  "naples",
  "marco island",
  "bonita springs",
  "estero",
  "lehigh acres",
  "sanibel",
  "captiva",
  "punta gorda",
  "immokalee",
  "golden gate",
  "ave maria",
];

/** Region-level terms that make a query SWFL-relevant without naming a town. */
export const REGION_TERMS: string[] = [
  "southwest florida",
  "south west florida",
  "swfl",
  "lee county",
  "collier county",
];

/**
 * Topic → candidate brain slug(s). A query is "covered" if any listed brain has
 * shipped (brains/{slug}.md exists — checked by the digest, not here). Slugs are
 * validated against the shipped set by swfl_taxonomy.test.mts (typo guard).
 */
export interface TopicRule {
  topic: string;
  match: RegExp;
  brains: string[];
}

export const TOPIC_BRAIN_RULES: TopicRule[] = [
  {
    topic: "flood",
    match: /\bflood(s|ing|ed)?\b|flood zone|flood insurance/,
    brains: ["env-swfl", "housing-swfl"],
  },
  {
    topic: "hurricane",
    match: /\bhurricane|storm surge|evacuation zone|wind mitigation/,
    brains: ["storm-history-swfl", "env-swfl"],
  },
  {
    topic: "new-construction",
    match: /new construction|new homes|new build|under construction/,
    brains: ["permits-swfl", "housing-swfl"],
  },
  { topic: "permits", match: /\bpermit(s|ting)?\b/, brains: ["permits-swfl"] },
  {
    topic: "home-prices",
    match:
      /home price|house price|home value|median price|homes for sale|housing market|real estate market/,
    brains: ["housing-swfl", "properties-lee-value"],
  },
  {
    topic: "rent",
    match: /\brent(al|als|ing)?\b|apartment(s)? for rent|for rent/,
    brains: ["rentals-swfl"],
  },
  {
    topic: "commercial-re",
    match:
      /commercial real estate|cap rate|office space|retail space|industrial space|for lease|\bcre\b|triple net|\bnnn\b/,
    brains: ["cre-swfl"],
  },
  {
    topic: "tourism",
    match: /\btourism|tourist|visitors?\b|hotel occupancy|tourist tax/,
    brains: ["tourism-tdt"],
  },
  {
    topic: "jobs",
    match:
      /\bjob(s)?\b|job market|wage(s)?|salary|salaries|employment|unemployment|hiring/,
    brains: ["labor-demand-swfl"],
  },
  {
    topic: "traffic",
    match: /\btraffic|commute|aadt|road congestion/,
    brains: ["traffic-swfl"],
  },
  {
    topic: "airport",
    match: /\bairport|\brsw\b|flights?|enplanements/,
    brains: ["rsw-airport"],
  },
  {
    topic: "economy",
    match: /cost of living|property tax(es)?|economy|economic|gdp/,
    brains: ["macro-swfl", "econ-dev-swfl"],
  },
  {
    topic: "safety",
    match: /\bcrime|safety|safest|crime rate/,
    brains: ["safety-swfl"],
  },
  {
    topic: "condo",
    match:
      /\bcondo|sirs|milestone inspection|condo reserves|structural integrity reserve/,
    brains: ["condo-sirs-swfl"],
  },
];

export interface Classification {
  keyword: string;
  isSwfl: boolean;
  places: string[];
  topic: string | null;
  brains: string[];
}

/**
 * Classify a free-text search query → place(s), topic, candidate brain(s).
 * Heuristic and flagged-confidence — fit for a passive operator read, not a
 * customer claim.
 */
export function classify(keyword: string): Classification {
  const k = keyword.toLowerCase();

  const places: string[] = [];
  for (const place of SWFL_PLACES) {
    if (k.includes(place) && !places.some((p) => p.includes(place))) {
      places.push(place);
    }
  }
  const isSwfl = places.length > 0 || REGION_TERMS.some((t) => k.includes(t));

  let topic: string | null = null;
  const brains: string[] = [];
  for (const rule of TOPIC_BRAIN_RULES) {
    if (rule.match.test(k)) {
      if (topic === null) topic = rule.topic;
      for (const b of rule.brains) if (!brains.includes(b)) brains.push(b);
    }
  }

  return { keyword, isSwfl, places, topic, brains };
}
