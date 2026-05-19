/**
 * swfl-geo — Southwest Florida ZIP-level barrier-island classification.
 *
 * Why this exists: env-swfl's pre-2026-05-19 flood logic applied one SWFL-wide
 * threshold to a metro that contains both Fort Myers Beach (Ian 14-16 ft surge,
 * ~90% structural destruction) AND downtown Fort Myers (Ian 2-4 ft surge, structures
 * intact). The flood-veto fired on every Lee County refine because Lee's aggregate
 * VE coverage is 5.75% — but that 5.75% lives almost entirely on 6.5 sq mi of
 * barrier-island ZIP 33931. Cape Coral, Fort Myers downtown, and inland Naples
 * share none of that risk and shouldn't share the veto.
 *
 * This module owns:
 *   1. The static `BARRIER_ISLAND_ZIPS` classification table (manual curation).
 *   2. `barrierClassFor(zip)` — lookup helper.
 *   3. `capRateBpsFor` / `capRateBpsRangeFor` — barrier_score → CRE cap-rate
 *      basis-point adjustment. Calibrated against ULI/LaSalle 2024 ("+25-50 bps
 *      for elevated physical risk") split into a coastal-mainland band (+20-35)
 *      and a barrier-island band (+50-70).
 *   4. `validateClassification(zipAALs)` — a build-time stale-table sentinel.
 *      If a ZIP not in the table ranks >80th percentile AAL across SWFL, the
 *      static table is probably out of date.
 *
 * Rejected alternatives (see docs/superpowers/plans/2026-05-19-env-swfl-flood-restructure.md §B):
 *   - NOAA/USACE coastal shapefile ingest — trips the data-tier-policy brain-first
 *     gate for a 12-row problem.
 *   - Pure data-driven barrier classifier (claim-density threshold) — circular,
 *     because the very metric we're computing is the AAL we'd classify on.
 *
 * LAST_REVIEWED: 2026-05-19. Re-review when SWFL_STORM_YEARS is bumped.
 */

export type BarrierClassification = "barrier" | "coastal-mainland" | "inland";
export type BarrierScore = 0.0 | 0.5 | 1.0;

export interface BarrierIslandRecord {
  zip: string;
  name: string;
  county_fips: string;
  classification: BarrierClassification;
  barrier_score: BarrierScore;
  /** 2020 ACS estimate rounded to the nearest 1000. Used as the v1
   *  insured-property denominator base: insured = population × 0.30 NSI proxy.
   *  Replaced by OpenFEMA Policies in v2. */
  population_estimate: number;
  notes: string;
}

const SEED: ReadonlyArray<BarrierIslandRecord> = [
  // ---- Barrier islands (score 1.0) ----
  {
    zip: "33931",
    name: "Fort Myers Beach",
    county_fips: "12071",
    classification: "barrier",
    barrier_score: 1.0,
    population_estimate: 7000,
    notes: "Ian 14-16 ft surge, ~90% destruction; Estero Island barrier.",
  },
  {
    zip: "33957",
    name: "Sanibel",
    county_fips: "12071",
    classification: "barrier",
    barrier_score: 1.0,
    population_estimate: 7000,
    notes: "Causeway-only access barrier island; Ian severed causeway.",
  },
  {
    zip: "33924",
    name: "Captiva",
    county_fips: "12071",
    classification: "barrier",
    barrier_score: 1.0,
    population_estimate: 1000,
    notes: "Barrier island north of Sanibel; same Ian surge footprint.",
  },
  {
    zip: "34145",
    name: "Marco Island",
    county_fips: "12021",
    classification: "barrier",
    barrier_score: 1.0,
    population_estimate: 18000,
    notes: "Largest of the Ten Thousand Islands barrier chain.",
  },
  {
    zip: "33921",
    name: "Boca Grande",
    county_fips: "12015",
    classification: "barrier",
    barrier_score: 1.0,
    population_estimate: 1000,
    notes: "Gasparilla Island barrier; Charlotte County.",
  },

  // ---- Coastal-mainland (score 0.5) ----
  {
    zip: "34134",
    name: "Bonita Beach",
    county_fips: "12071",
    classification: "coastal-mainland",
    barrier_score: 0.5,
    population_estimate: 23000,
    notes: "Beach-fronting mainland Bonita Springs; partial barrier exposure.",
  },
  {
    zip: "34102",
    name: "Naples coastal",
    county_fips: "12021",
    classification: "coastal-mainland",
    barrier_score: 0.5,
    population_estimate: 17000,
    notes: "City of Naples coastal grid; mainland but Gulf-fronting.",
  },
  {
    zip: "33914",
    name: "Cape Coral SW",
    county_fips: "12071",
    classification: "coastal-mainland",
    barrier_score: 0.5,
    population_estimate: 36000,
    notes:
      "SW Cape Coral canal grid; mainland with Caloosahatchee/Gulf access.",
  },
  {
    zip: "33901",
    name: "Fort Myers downtown",
    county_fips: "12071",
    classification: "coastal-mainland",
    barrier_score: 0.5,
    population_estimate: 24000,
    notes:
      "Ian 2-4 ft surge; mainland Caloosahatchee-fronting; structures intact.",
  },

  // ---- Inland (score 0.0) ----
  {
    zip: "33990",
    name: "Cape Coral E",
    county_fips: "12071",
    classification: "inland",
    barrier_score: 0.0,
    population_estimate: 24000,
    notes: "Inland Cape Coral; canal-fed but no Gulf exposure.",
  },
  {
    zip: "34109",
    name: "North Naples",
    county_fips: "12021",
    classification: "inland",
    barrier_score: 0.0,
    population_estimate: 25000,
    notes: "Inland North Naples; no coastal exposure.",
  },
  {
    zip: "34112",
    name: "East Naples",
    county_fips: "12021",
    classification: "inland",
    barrier_score: 0.0,
    population_estimate: 33000,
    notes: "Inland East Naples; no coastal exposure.",
  },
];

export const BARRIER_ISLAND_ZIPS: ReadonlyMap<string, BarrierIslandRecord> =
  new Map(SEED.map((r) => [r.zip, r]));

/** SWFL counties this table covers. Used by `validateClassification` to scope
 *  staleness warnings. */
export const SWFL_COUNTY_FIPS = new Set([
  "12015", // Charlotte
  "12021", // Collier
  "12043", // Glades
  "12051", // Hendry
  "12071", // Lee
  "12115", // Sarasota
]);

/**
 * Lookup the barrier classification for a ZIP. Unknown ZIPs default to "inland"
 * with score 0.0 — the conservative choice that does NOT trigger the flood-veto.
 * The data-driven validator (`validateClassification`) catches stale-table cases
 * where an unknown ZIP is in fact high-risk.
 */
export function barrierClassFor(zip: string): {
  classification: BarrierClassification;
  score: BarrierScore;
  record: BarrierIslandRecord | null;
} {
  const record = BARRIER_ISLAND_ZIPS.get(zip);
  if (!record) {
    return { classification: "inland", score: 0.0, record: null };
  }
  return {
    classification: record.classification,
    score: record.barrier_score,
    record,
  };
}

/**
 * CRE cap-rate basis-point adjustment by barrier score. Midpoints chosen to
 * preserve the published range while emitting a single deterministic number
 * per BrainOutputMetric (value: number constraint).
 *
 *   0.0 → 0 bps (no flood adjustment indicated)
 *   0.5 → 27.5 bps (midpoint of the +20-35 bps coastal-mainland band)
 *   1.0 → 60 bps (midpoint of the +50-70 bps barrier-island band)
 *
 * Calibrated against ULI/LaSalle 2024 ("+25-50 bps for elevated physical risk")
 * stratified by exposure intensity.
 */
export function capRateBpsFor(barrierScore: BarrierScore): number {
  if (barrierScore === 1.0) return 60;
  if (barrierScore === 0.5) return 27.5;
  return 0;
}

/**
 * Human-readable cap-rate range string for the same scores. Embedded in the
 * citation field of the cap-rate metric and inline in env-swfl's conclusion
 * template so the reader sees the band, not the midpoint.
 */
export function capRateBpsRangeFor(barrierScore: BarrierScore): string {
  if (barrierScore === 1.0) return "+50-70 bps";
  if (barrierScore === 0.5) return "+20-35 bps";
  return "no flood cap-rate adjustment";
}

/**
 * Build-time stale-table sentinel. Given the per-ZIP AAL values computed for
 * this refine, returns a warning for any ZIP that:
 *   - is NOT in BARRIER_ISLAND_ZIPS, AND
 *   - ranks in the top 20% of SWFL ZIPs by per-property AAL.
 *
 * A warning means the static table likely missed a high-risk ZIP. Surfaced in
 * the corpus summary; never used at runtime to flip behavior. The point is to
 * catch silent drift between the manual table and observed claim reality.
 */
export function validateClassification(
  zipAALs: ReadonlyMap<string, number>,
): string[] {
  if (zipAALs.size === 0) return [];
  const sorted = [...zipAALs.entries()].sort((a, b) => b[1] - a[1]);
  const topCount = Math.max(1, Math.floor(sorted.length * 0.2));
  const top = sorted.slice(0, topCount);
  const warnings: string[] = [];
  for (const [zip, aal] of top) {
    if (!BARRIER_ISLAND_ZIPS.has(zip)) {
      warnings.push(
        `ZIP ${zip} ranks in top ${(0.2 * 100).toFixed(0)}% SWFL flood AAL ($${aal.toFixed(0)}/yr per insured property) but is not classified in BARRIER_ISLAND_ZIPS — review the table.`,
      );
    }
  }
  return warnings;
}
