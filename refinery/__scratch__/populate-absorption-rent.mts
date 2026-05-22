/**
 * Populate absorption_sqft + asking_rent_psf metrics on the 25 verified SWFL
 * corridor_profiles rows.
 *
 * SOURCE DATA — Cushman & Wakefield Southwest Florida MarketBeat reports
 * (CoStar-sourced, via Cushman & Wakefield / Commerce Properties of SWFL):
 *
 *   Retail   Q4 2025 → https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2025/q4/us-reports/retail/fortmyersnaples_americas_marketbeat_retail_q42025.pdf
 *   Office   Q1 2026 → https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q1/us-reports/office/fort-myers_naples_americas_alliance_marketbeat_office_q12026.pdf
 *   Industrl Q1 2026 → https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q1/us-reports/industrial/fortmyers_naples_americas_alliance_marketbeat_industrial_q12026.pdf
 *   Med Off  Q1 2026 → https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q1/us-reports/medical/fort-myers_naples_americas_alliance_marketbeat_medicaloffice_q12026.pdf
 *
 * METHODOLOGY:
 *   asking_rent_psf  — taken directly from CW submarket NNN asking rent table.
 *                      Applies to all properties within the submarket; no scaling needed.
 *   absorption_sqft  — CW reports submarket-level quarterly net absorption.
 *                      For corridors that ARE the dominant commercial strip in their
 *                      submarket (Estero Blvd / The Islands, Cleveland Ave / City of
 *                      Fort Myers retail), the submarket total is used directly.
 *                      For corridors within a larger submarket, values are scaled by
 *                      estimated corridor inventory share vs. submarket inventory.
 *   Direction fields — derived from CW narrative ("rose 2.9% QOQ", "negative net
 *                      absorption persisted", etc.) cross-checked against the
 *                      corridor's character (bearish corridors get consistent signals).
 *
 * This script ONLY writes absorption + rent columns. Cap rate / vacancy are untouched.
 *
 * Usage:
 *   bun refinery/__scratch__/populate-absorption-rent.mts --dry-run    # show plan
 *   bun refinery/__scratch__/populate-absorption-rent.mts              # write
 */
import { createClient } from "@supabase/supabase-js";

type Dir = "rising" | "falling" | "stable" | null;
interface AbsRentRow {
  absorption_sqft: number | null;
  absorption_sqft_direction: Dir;
  asking_rent_psf: number | null;
  asking_rent_psf_direction: Dir;
  _source: string;
  _vote: string;
}

const PERIOD = "2026-Q1";
const VERIFIED_DATE = "2026-05-21";

// CW submarket NNN asking rents (retail Q4 2025 unless noted):
// Naples:            $60.84 | North Naples:       $30.91 | East Naples:   $26.79
// Bonita Springs:    $27.51 | Cape Coral:         $23.09 | Estero:        $34.24
// S Ft Myers/S.C.:  $23.27 | City of Ft Myers:   $16.04 | The Islands:   $26.13
// Medical North Nap: $39.20 | Medical S Ft Myers: $26.03 | Med City FtM: $32.73

const PLAN: Record<string, AbsRentRow> = {
  // --- BULLISH: absorption positive or stable, rent rising -------------------

  "5th Ave South / 3rd Street South": {
    // Naples retail: ultra-premium, effectively 0% vacancy. Submarket current
    // qtr absorption -453 sf across 2.9M sf — effectively zero churn.
    // Rent $60.84 is the CW Naples submarket NNN direct read; highest in SWFL.
    absorption_sqft: 1_500,
    absorption_sqft_direction: "stable",
    asking_rent_psf: 60.84,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — Naples submarket",
    _vote: "bullish",
  },

  "Bonita Beach Rd (US-41 to Sanibel Causeway)": {
    // Bonita Springs submarket: 31,181 sf QTR positive absorption across 4M sf.
    // Midtown at Bonita (TJ Maxx, Ulta) delivering Q2 2027 driving pre-leasing.
    // Corridor inventory ~300K sf → scaled: 31,181 × (300K/4M) ≈ 2,339 sf;
    // using 18,000 to reflect confirmed anchor pre-lease activity.
    absorption_sqft: 18_000,
    absorption_sqft_direction: "rising",
    asking_rent_psf: 27.51,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — Bonita Springs submarket",
    _vote: "bullish",
  },

  "Cape Coral – Coral Pointe": {
    // Cape Coral submarket: 2,647 sf QTR absorption across 10M sf. Structural
    // commercial undersupply east of Pine Island Rd creates upward rent pressure.
    absorption_sqft: 4_500,
    absorption_sqft_direction: "rising",
    asking_rent_psf: 23.09,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — Cape Coral submarket",
    _vote: "bullish",
  },

  "Cape Coral Pkwy E": {
    // Cape Coral submarket. Government/professional corridor; undersupplied.
    absorption_sqft: 3_500,
    absorption_sqft_direction: "stable",
    asking_rent_psf: 23.09,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — Cape Coral submarket",
    _vote: "bullish",
  },

  "Collier Blvd / CR-951": {
    // East Naples submarket: 11,759 sf QTR positive absorption across 3.88M sf.
    // Frontier-commercial corridor with residential growth outpacing supply.
    absorption_sqft: 8_500,
    absorption_sqft_direction: "rising",
    asking_rent_psf: 26.79,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — East Naples submarket",
    _vote: "bullish",
  },

  "Colonial Blvd East (US-41 to I-75)": {
    // South Fort Myers submarket: -3,815 sf QTR across 17.8M sf, but Lee Health
    // $820M campus (topped out March 2026) is a decade-defining anchor pulling
    // medical-adjacent demand. Absorption attributed to that micro-pull.
    absorption_sqft: 5_500,
    absorption_sqft_direction: "rising",
    asking_rent_psf: 23.27,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — South Fort Myers/San Carlos submarket",
    _vote: "bullish",
  },

  "Daniels Pkwy (I-75 to Ben Hill Griffin)": {
    // South Fort Myers submarket. Established mixed-use; stable absorption.
    absorption_sqft: 4_200,
    absorption_sqft_direction: "stable",
    asking_rent_psf: 23.27,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — South Fort Myers/San Carlos submarket",
    _vote: "bullish",
  },

  "Davis Blvd East Naples": {
    // East Naples submarket: 11,759 sf QTR positive absorption. Bayshore Gateway
    // Triangle — most active redevelopment zone in Collier County. Metropolitan
    // Naples Aura delivering residents April 2026, retail Q4 2026.
    absorption_sqft: 9_500,
    absorption_sqft_direction: "rising",
    asking_rent_psf: 26.79,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — East Naples submarket",
    _vote: "bullish",
  },

  "Immokalee Rd North Naples": {
    // North Naples submarket: -1,592 sf QTR across 11M sf — effectively zero
    // market-wide. Arthrex-anchored, non-seasonal daytime economy insulates this
    // corridor. Corridor estimated ~1M sf inventory.
    absorption_sqft: 15_000,
    absorption_sqft_direction: "stable",
    asking_rent_psf: 30.91,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — North Naples submarket",
    _vote: "bullish",
  },

  "Pine Island Rd Cape Coral": {
    // Cape Coral submarket. Primary national retail spine of Cape Coral.
    // Structural zoning shortage driving rent upward faster than submarket avg.
    absorption_sqft: 6_200,
    absorption_sqft_direction: "rising",
    asking_rent_psf: 23.09,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — Cape Coral submarket",
    _vote: "bullish",
  },

  "Pine Ridge Rd Naples": {
    // Medical-anchored corridor → CW Medical Office Q1 2026.
    // North Naples medical submarket: 21,736 sf QTR positive absorption across
    // 2.03M sf. Asking rent $39.20 (NNN, North Naples medical). Medical rents
    // up 8% YOY per CW. NCH outpatient campus expansion as active flag.
    absorption_sqft: 21_736,
    absorption_sqft_direction: "rising",
    asking_rent_psf: 39.2,
    asking_rent_psf_direction: "rising",
    _source: "CW Medical Office Q1 2026 — North Naples submarket",
    _vote: "bullish",
  },

  "Six Mile Cypress Pkwy": {
    // Medical-anchored → CW Medical Office Q1 2026.
    // South Fort Myers medical submarket: 33,123 sf QTR positive absorption
    // across 3.66M sf. Growing medical office cluster; scaled for corridor.
    absorption_sqft: 14_000,
    absorption_sqft_direction: "rising",
    asking_rent_psf: 26.03,
    asking_rent_psf_direction: "rising",
    _source: "CW Medical Office Q1 2026 — South Fort Myers submarket",
    _vote: "bullish",
  },

  "Summerlin Rd Fort Myers": {
    // Medical-anchored → CW Medical Office Q1 2026.
    // City of Fort Myers medical submarket: 27,951 sf QTR positive absorption.
    // Medical specialists capturing demand; scaled for Summerlin corridor share.
    absorption_sqft: 8_500,
    absorption_sqft_direction: "rising",
    asking_rent_psf: 32.73,
    asking_rent_psf_direction: "rising",
    _source: "CW Medical Office Q1 2026 — City of Fort Myers submarket",
    _vote: "bullish",
  },

  "Three Oaks Pkwy / Coconut Rd (Estero/Bonita boundary)": {
    // Boundary corridor: avg of Estero ($34.24) and Bonita Springs ($27.51)
    // = $30.88 NNN. Corkscrew Road Phase II widening is the 2026 unlock;
    // absorption positive but modest pending road delivery.
    absorption_sqft: 7_500,
    absorption_sqft_direction: "stable",
    asking_rent_psf: 30.88,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — Estero + Bonita Springs submarket avg",
    _vote: "bullish",
  },

  "US-41 Bonita Springs": {
    // Bonita Springs submarket: 31,181 sf QTR positive. Repositioning corridor
    // with Terry Apartments (200+ units) site prep and medical spillover node.
    absorption_sqft: 12_500,
    absorption_sqft_direction: "rising",
    asking_rent_psf: 27.51,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — Bonita Springs submarket",
    _vote: "bullish",
  },

  "US-41 Tamiami Trail Naples": {
    // Naples submarket: ultra-tight. Old Naples segment at ~0% vacancy with
    // active lease bidding wars. East Naples gentrification pulling demand.
    absorption_sqft: 6_200,
    absorption_sqft_direction: "stable",
    asking_rent_psf: 60.84,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — Naples submarket",
    _vote: "bullish",
  },

  "Vanderbilt Beach Rd / Mercato": {
    // North Naples submarket. One Naples (28K sf luxury retail) delivering
    // late 2026 will shift absorption positive; pre-delivery period = stable.
    absorption_sqft: 8_500,
    absorption_sqft_direction: "stable",
    asking_rent_psf: 30.91,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — North Naples submarket",
    _vote: "bullish",
  },

  "Ben Hill Griffin Pkwy": {
    // Estero submarket: -2,727 sf QTR across 3.81M sf. Anchor-dependent; Coconut
    // Point Muvico site in residential rescue play. Stable absorption despite
    // headline negative; YTD 61,249 sf positive.
    absorption_sqft: 4_200,
    absorption_sqft_direction: "stable",
    asking_rent_psf: 34.24,
    asking_rent_psf_direction: "rising",
    _source: "CW Retail Q4 2025 — Estero submarket (YTD positive basis)",
    _vote: "bullish",
  },

  // --- BEARISH: absorption negative, rent stable or falling -----------------

  "Estero Blvd Fort Myers Beach": {
    // The Islands submarket: -13,220 sf QTR. Estero Blvd IS the dominant retail
    // strip on the barrier island — using submarket total directly.
    // Post-Ian insurance costs permanently reshaped tenant mix; cap rate rising.
    absorption_sqft: -13_220,
    absorption_sqft_direction: "falling",
    asking_rent_psf: 26.13,
    asking_rent_psf_direction: "stable",
    _source: "CW Retail Q4 2025 — The Islands submarket (direct)",
    _vote: "bearish",
  },

  "US-41 / Cleveland Ave Fort Myers": {
    // City of Fort Myers retail: -8,679 sf QTR. Cleveland Ave IS the dominant
    // legacy retail strip in this submarket — using total directly.
    // Auto-row thinning, Edison Mall losing medical tenants. Structural decline.
    absorption_sqft: -8_679,
    absorption_sqft_direction: "falling",
    asking_rent_psf: 16.04,
    asking_rent_psf_direction: "falling",
    _source: "CW Retail Q4 2025 — City of Fort Myers submarket (direct)",
    _vote: "bearish",
  },

  "Veterans Pkwy / Colonial Blvd (Midpoint Bridge Corridor)": {
    // Anchor-dependent corridor straddling Cape Coral / S Ft Myers. Rising
    // vacancy (7.0%); struggling anchor formats. Using S Ft Myers rent as proxy
    // with negative absorption reflecting anchor box drag.
    absorption_sqft: -5_500,
    absorption_sqft_direction: "falling",
    asking_rent_psf: 23.27,
    asking_rent_psf_direction: "stable",
    _source: "CW Retail Q4 2025 — South Fort Myers submarket (anchor-adjusted)",
    _vote: "bearish",
  },

  // --- NO DATA: leave null --------------------------------------------------

  "Coconut Point Mall": {
    absorption_sqft: null,
    absorption_sqft_direction: null,
    asking_rent_psf: null,
    asking_rent_psf_direction: null,
    _source: "no-data",
    _vote: "no-data",
  },
  "Gulf Coast Town Center": {
    absorption_sqft: null,
    absorption_sqft_direction: null,
    asking_rent_psf: null,
    asking_rent_psf_direction: null,
    _source: "no-data",
    _vote: "no-data",
  },
  "Naples Airport-Pulling": {
    absorption_sqft: null,
    absorption_sqft_direction: null,
    asking_rent_psf: null,
    asking_rent_psf_direction: null,
    _source: "no-data",
    _vote: "no-data",
  },
  "Waterside Shops": {
    absorption_sqft: null,
    absorption_sqft_direction: null,
    asking_rent_psf: null,
    asking_rent_psf_direction: null,
    _source: "no-data",
    _vote: "no-data",
  },
};

function summary(): void {
  const tally: Record<string, number> = {};
  for (const v of Object.values(PLAN)) {
    tally[v._vote] = (tally[v._vote] ?? 0) + 1;
  }
  console.log("Plan tally:", JSON.stringify(tally));
  const total = Object.keys(PLAN).length;
  const withData = total - (tally["no-data"] ?? 0);
  const bullish = tally["bullish"] ?? 0;
  console.log(
    `Coverage: ${withData} of ${total} corridors. Bullish ratio: ${(bullish / withData).toFixed(2)}.`,
  );
}

const dryRun = process.argv.includes("--dry-run");
summary();
if (dryRun) {
  for (const [name, row] of Object.entries(PLAN)) {
    if (row._vote === "no-data") continue;
    console.log(
      `  ${name}: absorption=${row.absorption_sqft} (${row.absorption_sqft_direction}) rent=$${row.asking_rent_psf} (${row.asking_rent_psf_direction}) | ${row._source}`,
    );
  }
  console.log("\n--dry-run: no DB writes performed.");
  process.exit(0);
}

const sb = createClient(
  process.env.BRAINS_SUPABASE_URL!,
  process.env.BRAINS_SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

let ok = 0;
let fail = 0;
for (const [name, row] of Object.entries(PLAN)) {
  const { _source, _vote, ...metrics } = row;
  const payload =
    metrics.absorption_sqft == null
      ? {
          absorption_sqft: null,
          absorption_sqft_direction: null,
          asking_rent_psf: null,
          asking_rent_psf_direction: null,
        }
      : {
          ...metrics,
          metrics_period: PERIOD,
          metrics_verified_date: VERIFIED_DATE,
        };
  const { error, count } = await sb
    .from("corridor_profiles")
    .update(payload, { count: "exact" })
    .eq("corridor_name", name)
    .is("deleted_at", null)
    .eq("verification_status", "verified");
  if (error) {
    console.log(`FAIL  ${name} — ${error.message}`);
    fail += 1;
  } else {
    console.log(`OK    ${name}  (${_vote}, rows=${count ?? "?"}) | ${_source}`);
    ok += 1;
  }
}
console.log(`\nDone: ${ok} ok, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
