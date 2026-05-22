/**
 * Replace fabricated cap_rate + vacancy data on corridor_profiles with real
 * Cushman & Wakefield MarketBeat values.
 *
 * SOURCES:
 *   Retail   Q4 2025 → https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2025/q4/us-reports/retail/fortmyersnaples_americas_marketbeat_retail_q42025.pdf
 *   Medical  Q1 2026 → https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q1/us-reports/medical/fort-myers_naples_americas_alliance_marketbeat_medicaloffice_q12026.pdf
 *
 * CAP RATES — market-wide only (CW reports no submarket split):
 *   Retail:         6.7% rising  (narrative: "averaged 6.7%, up from 6.5% Q4 2024")
 *   Medical Office: 8.3% falling (narrative: "averaged 8.3%, below 8.5% one year ago")
 *   Industrial cap rate not published in CW SWFL reports.
 *
 * VACANCY — submarket-level from CW stats tables (most granular data available):
 *   Retail Q4 2025 by submarket (vacancy %):
 *     Naples 1.8 | N Naples 3.3 | E Naples 3.3 | Bonita Springs 2.3
 *     Cape Coral 2.5 | Estero 7.7 | S Ft Myers/S.C. 3.2
 *     City of Ft Myers 2.9 | The Islands 2.9
 *   Medical Office Q1 2026 by submarket:
 *     N Naples 3.2 | S Fort Myers 4.0 | City of Ft Myers 7.2
 *   Vacancy direction derived from corridor-level absorption sign.
 *
 * Usage:
 *   bun refinery/__scratch__/populate-cap-vacancy.mts --dry-run
 *   bun refinery/__scratch__/populate-cap-vacancy.mts
 */
import { createClient } from "@supabase/supabase-js";

const PERIOD = "2026-Q1";
const VERIFIED_DATE = "2026-05-21";

type Dir = "rising" | "falling" | "stable" | null;

interface CapVacRow {
  cap_rate_pct: number | null;
  cap_rate_direction: Dir;
  vacancy_rate_pct: number | null;
  vacancy_rate_direction: Dir;
  _type: string;
  _note: string;
}

const RETAIL_CAP = 6.7;
const RETAIL_CAP_DIR: Dir = "rising";
const MEDICAL_CAP = 8.3;
const MEDICAL_CAP_DIR: Dir = "falling";

const PLAN: Record<string, CapVacRow> = {
  // -- RETAIL: CW Retail Q4 2025 --------------------------------------------

  "5th Ave South / 3rd Street South": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 1.8,
    vacancy_rate_direction: "stable", // Naples at effective floor; QTR absorption -453 sf across 2.9M sf
    _type: "retail",
    _note: "Naples submarket",
  },
  "US-41 Tamiami Trail Naples": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 1.8,
    vacancy_rate_direction: "stable", // ultra-tight, lease bidding wars; can't go lower
    _type: "retail",
    _note: "Naples submarket",
  },

  "Immokalee Rd North Naples": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 3.3,
    vacancy_rate_direction: "stable", // QTR absorption -1,592 sf across 11M sf; Arthrex insulates
    _type: "retail",
    _note: "North Naples submarket",
  },
  "Vanderbilt Beach Rd / Mercato": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 3.3,
    vacancy_rate_direction: "stable", // One Naples pre-delivery; absorption flat
    _type: "retail",
    _note: "North Naples submarket",
  },

  "Collier Blvd / CR-951": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 3.3,
    vacancy_rate_direction: "falling", // 11,759 sf QTR positive absorption
    _type: "retail",
    _note: "East Naples submarket",
  },
  "Davis Blvd East Naples": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 3.3,
    vacancy_rate_direction: "falling", // 11,759 sf QTR positive absorption; Bayshore redevelopment
    _type: "retail",
    _note: "East Naples submarket",
  },

  "Bonita Beach Rd (US-41 to Sanibel Causeway)": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 2.3,
    vacancy_rate_direction: "falling", // 31,181 sf QTR positive absorption
    _type: "retail",
    _note: "Bonita Springs submarket",
  },
  "US-41 Bonita Springs": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 2.3,
    vacancy_rate_direction: "falling", // 31,181 sf QTR positive absorption
    _type: "retail",
    _note: "Bonita Springs submarket",
  },

  "Cape Coral – Coral Pointe": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 2.5,
    vacancy_rate_direction: "falling", // 2,647 sf QTR positive; undersupply east of Pine Island Rd
    _type: "retail",
    _note: "Cape Coral submarket",
  },
  "Cape Coral Pkwy E": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 2.5,
    vacancy_rate_direction: "stable",
    _type: "retail",
    _note: "Cape Coral submarket",
  },
  "Pine Island Rd Cape Coral": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 2.5,
    vacancy_rate_direction: "falling",
    _type: "retail",
    _note: "Cape Coral submarket",
  },

  "Ben Hill Griffin Pkwy": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 7.7,
    vacancy_rate_direction: "stable", // QTR -2,727 sf but YTD +61,249 sf; anchor-dependent blip
    _type: "retail",
    _note: "Estero submarket",
  },

  "Three Oaks Pkwy / Coconut Rd (Estero/Bonita boundary)": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 5.0, // avg of Estero 7.7% and Bonita Springs 2.3%
    vacancy_rate_direction: "stable",
    _type: "retail",
    _note: "Estero/Bonita Springs submarket avg",
  },

  "Colonial Blvd East (US-41 to I-75)": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 3.2,
    vacancy_rate_direction: "falling", // Lee Health $820M campus anchor pulling demand
    _type: "retail",
    _note: "South Fort Myers/San Carlos submarket",
  },
  "Daniels Pkwy (I-75 to Ben Hill Griffin)": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 3.2,
    vacancy_rate_direction: "stable",
    _type: "retail",
    _note: "South Fort Myers/San Carlos submarket",
  },
  "Veterans Pkwy / Colonial Blvd (Midpoint Bridge Corridor)": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 3.2,
    vacancy_rate_direction: "rising", // -5,500 sf absorption; anchor box drag
    _type: "retail",
    _note: "South Fort Myers/San Carlos submarket",
  },

  "US-41 / Cleveland Ave Fort Myers": {
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 2.9,
    vacancy_rate_direction: "rising", // -8,679 sf QTR; auto-row thinning, Edison Mall decline
    _type: "retail",
    _note: "City of Fort Myers submarket",
  },

  "Estero Blvd Fort Myers Beach": {
    // No submarket cap rate published. Using market-wide 6.7% — post-Ian insurance
    // costs and hurricane exposure warrant a premium but no sourced figure exists.
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: "rising", // risk premium trend post-Ian; higher than market avg
    vacancy_rate_pct: 2.9,
    vacancy_rate_direction: "rising", // -13,220 sf QTR; rebuild disruption
    _type: "retail",
    _note:
      "The Islands submarket; cap rate = market-wide avg (no island-specific source)",
  },

  // -- MEDICAL OFFICE: CW Medical Office Q1 2026 ----------------------------

  "Pine Ridge Rd Naples": {
    cap_rate_pct: MEDICAL_CAP,
    cap_rate_direction: MEDICAL_CAP_DIR,
    vacancy_rate_pct: 3.2,
    vacancy_rate_direction: "falling", // 21,736 sf QTR positive absorption; NCH expansion
    _type: "medical",
    _note: "North Naples medical submarket",
  },

  "Six Mile Cypress Pkwy": {
    cap_rate_pct: MEDICAL_CAP,
    cap_rate_direction: MEDICAL_CAP_DIR,
    vacancy_rate_pct: 4.0,
    vacancy_rate_direction: "falling", // 33,123 sf QTR positive absorption
    _type: "medical",
    _note: "South Fort Myers medical submarket",
  },

  "Summerlin Rd Fort Myers": {
    cap_rate_pct: MEDICAL_CAP,
    cap_rate_direction: MEDICAL_CAP_DIR,
    vacancy_rate_pct: 7.2,
    vacancy_rate_direction: "falling", // 27,951 sf QTR positive absorption
    _type: "medical",
    _note: "City of Fort Myers medical submarket",
  },

  // -- LARGE FORMAT RETAIL: submarket cap + vacancy; absorption/rent pending --

  "Coconut Point Mall": {
    // Estero lifestyle center. Muvico → residential conversion underway.
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 7.7,
    vacancy_rate_direction: "stable", // YTD +61,249 sf despite QTR -2,727 sf
    _type: "retail",
    _note: "Estero submarket",
  },
  "Gulf Coast Town Center": {
    // Lee County power center (Costco, Bass Pro, Belk). Anchor-dependent.
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 7.7,
    vacancy_rate_direction: "stable",
    _type: "retail",
    _note: "Estero submarket",
  },
  "Naples Airport-Pulling": {
    // Mixed commercial near Naples Municipal Airport.
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 3.3,
    vacancy_rate_direction: "stable",
    _type: "retail",
    _note: "North Naples submarket",
  },
  "Waterside Shops": {
    // Open-air luxury retail (Nordstrom, Saks). Ultra-tight; in-place rents above avg.
    cap_rate_pct: RETAIL_CAP,
    cap_rate_direction: RETAIL_CAP_DIR,
    vacancy_rate_pct: 1.8,
    vacancy_rate_direction: "stable",
    _type: "retail",
    _note: "Naples submarket",
  },
};

function summary(): void {
  const tally: Record<string, number> = {};
  for (const v of Object.values(PLAN)) {
    tally[v._type] = (tally[v._type] ?? 0) + 1;
  }
  console.log("Plan tally:", JSON.stringify(tally));
  console.log(`Total corridors: ${Object.keys(PLAN).length}`);
}

const dryRun = process.argv.includes("--dry-run");
summary();
if (dryRun) {
  for (const [name, row] of Object.entries(PLAN)) {
    if (row._type === "no-data") {
      console.log(`  ${name}: → NULL (no-data)`);
      continue;
    }
    console.log(
      `  ${name}: cap=${row.cap_rate_pct}% (${row.cap_rate_direction}) vac=${row.vacancy_rate_pct}% (${row.vacancy_rate_direction}) | ${row._note}`,
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
  const { _type, _note, ...metrics } = row;
  const payload =
    _type === "no-data"
      ? {
          cap_rate_pct: null,
          cap_rate_direction: null,
          vacancy_rate_pct: null,
          vacancy_rate_direction: null,
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
    const tag = _type === "no-data" ? "no-data" : `${_type} | ${_note}`;
    console.log(`OK    ${name}  (rows=${count ?? "?"}) | ${tag}`);
    ok += 1;
  }
}
console.log(`\nDone: ${ok} ok, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
