/**
 * Populate asking_rent_psf for the 4 large-format retail centers that had no
 * corridor-specific data. Uses CW submarket NNN asking rent as the benchmark.
 *
 * SOURCE: Cushman & Wakefield SWFL Retail MarketBeat Q4 2025 (data: CoStar)
 *   https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2025/q4/us-reports/retail/fortmyersnaples_americas_marketbeat_retail_q42025.pdf
 *
 * SUBMARKET NNN ASKING RENTS (Q4 2025):
 *   Estero:      $34.24/sf/yr  (Coconut Point Mall, Gulf Coast Town Center)
 *   N Naples:    $30.91/sf/yr  (Naples Airport-Pulling — north portion; see TODO)
 *   Naples:      $60.84/sf/yr  (Waterside Shops)
 *
 * NOTE — Naples Airport-Pulling split TODO:
 *   Airport-Pulling Rd crosses the Pine Ridge Rd submarket boundary.
 *   South of Pine Ridge = Naples submarket ($60.84 NNN, more commercial).
 *   North of Pine Ridge = N Naples submarket ($30.91 NNN, more residential).
 *   This corridor is assigned N Naples for now (matches existing cap/vacancy).
 *   Split into two corridor rows when center-specific leasing data is available.
 *
 * Absorption stays null — submarket totals can't be attributed to a single center.
 *
 * Usage:
 *   bun refinery/__scratch__/populate-large-format-rent.mts --dry-run
 *   bun refinery/__scratch__/populate-large-format-rent.mts
 */
import { createClient } from "@supabase/supabase-js";

const PERIOD = "2026-Q1";
const VERIFIED_DATE = "2026-05-21";

const PLAN: Record<
  string,
  { asking_rent_psf: number; asking_rent_psf_direction: string; _note: string }
> = {
  "Coconut Point Mall": {
    asking_rent_psf: 34.24,
    asking_rent_psf_direction: "stable",
    _note: "Estero submarket NNN avg — CW SWFL Retail Q4 2025",
  },
  "Gulf Coast Town Center": {
    asking_rent_psf: 34.24,
    asking_rent_psf_direction: "stable",
    _note: "Estero submarket NNN avg — CW SWFL Retail Q4 2025",
  },
  "Naples Airport-Pulling": {
    asking_rent_psf: 30.91,
    asking_rent_psf_direction: "stable",
    _note:
      "N Naples submarket NNN avg — CW SWFL Retail Q4 2025 (south portion = Naples submarket at $60.84; split corridor deferred)",
  },
  "Waterside Shops": {
    asking_rent_psf: 60.84,
    asking_rent_psf_direction: "rising",
    _note:
      "Naples submarket NNN avg — CW SWFL Retail Q4 2025; ultra-tight 1.8% vacancy supports rising direction",
  },
};

const dryRun = process.argv.includes("--dry-run");
console.log(`Corridors: ${Object.keys(PLAN).length}`);
if (dryRun) {
  for (const [name, row] of Object.entries(PLAN)) {
    console.log(
      `  ${name}: rent=$${row.asking_rent_psf}/sf (${row.asking_rent_psf_direction}) | ${row._note}`,
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
  const { _note, ...metrics } = row;
  const { error, count } = await sb
    .from("corridor_profiles")
    .update(
      {
        ...metrics,
        metrics_period: PERIOD,
        metrics_verified_date: VERIFIED_DATE,
      },
      { count: "exact" },
    )
    .eq("corridor_name", name)
    .is("deleted_at", null)
    .eq("verification_status", "verified");
  if (error) {
    console.log(`FAIL  ${name} — ${error.message}`);
    fail += 1;
  } else {
    console.log(`OK    ${name}  (rows=${count ?? "?"}) | ${_note}`);
    ok += 1;
  }
}
console.log(`\nDone: ${ok} ok, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
