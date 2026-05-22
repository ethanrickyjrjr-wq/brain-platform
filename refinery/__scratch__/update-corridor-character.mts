/**
 * Write character narratives + absorption sourced notes to 5 corridor rows.
 *
 * absorption_sqft stays null on all rows — center-level net absorption is
 * proprietary (CoStar / direct broker). The character field carries the
 * sourced context so the brain can reason about direction without a number.
 *
 * Usage:
 *   bun refinery/__scratch__/update-corridor-character.mts --dry-run
 *   bun refinery/__scratch__/update-corridor-character.mts
 */
import { createClient } from "@supabase/supabase-js";

const dryRun = process.argv.includes("--dry-run");

const sb = createClient(
  process.env.BRAINS_SUPABASE_URL!,
  process.env.BRAINS_SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const UPDATES: Record<string, string> = {
  "Waterside Shops": `\
$100M repositioning play; luxury uptiering underway. 280,000 SF GLA (Forbes Co. / Simon managed), \
open-air, Pelican Bay / N Naples. Saks Fifth Avenue is the sole remaining anchor after Nordstrom \
(80,000 SF, 2-level) closed May 2020 and was demolished Sept–Dec 2024. RH (Restoration Hardware) \
is under construction on the former Nordstrom site — 29,382 SF one-story gallery with courtyards, \
skylights, wine bar, and rooftop restaurant — targeted late 2026 opening. Named 2024-2025 inflows: \
RH 29,382 SF + Christian Dior 5,888 SF flagship (merged former Williams Sonoma + 3 adjacent \
storefronts) + Brunello Cucinelli ~4,000 SF + Lafayette 148 3,020 SF = ~42,310 SF sized gross \
inflow. Hermès (returning after 9-year hiatus), Panerai, and Eddie V's also signed; SF not public. \
Williams Sonoma and Pottery Barn relocated from inline to the former Barnes & Noble outparcel \
(B&N closed July 2024); their vacated inline space was absorbed by Dior and Cucinelli. Rough net \
absorption bracket: named outflows (Nordstrom 80K + B&N est. 15–25K SF) vs named inflows (~42K \
sized + unsized Hermès/Panerai/Eddie V's) = approximately -50K to -60K SF net before unsized \
inflows land — floor estimate, not a publishable figure, but frames the magnitude of the \
repositioning gap. Net absorption null: center-level figure not publicly available; CoStar or \
direct broker contact required. Sources: Gulf Shore Business Sep 2025, naplesjamie.com Jul 2025, \
NaplesPress Oct 2025, Wikipedia.`,

  "Coconut Point Mall": `\
Active churn, net-positive direction. 1.2M SF GLA (Simon Property Group), open-air, Estero / Lee \
County. 110+ stores, 24 restaurants. Simon "2024 Best of the Best" award (regional + national). \
Two-year refresh plan underway as of Oct 2025. Nordstrom Rack signed for fall 2025 opening in \
former Christmas Tree Shops / Bed Bath & Beyond junior anchor space (~25–30K SF estimate). \
Named new tenants (past ~12 months, all backfilling prior departures): Real Seafood Co. (former \
Bokamper's — "enormous space"); Bonita Smoke Shop & Cigar Lounge 6,600 SF (former Joann Fabrics); \
Fresh Catch Inland (former TGI Fridays); PJK Neighborhood Chinese (former The Saloon); Cold Stone \
Creamery (former Stone Mountain); SB Bar (new). New specialty retail: Park Shores, Evereve, \
Sunglass World, UNTUCKit, BH2.0. Inline churn is net-positive — named replacements for most \
departures — but unnamed departures are unknown, so "likely positive" is the honest read rather \
than confirmed. Net absorption null: center-level net SF not publicly available; Nordstrom Rack \
anchor backfill is the strongest single signal. Sources: Estero Life Magazine Aug 2025, \
Gulf Shore Business Oct 2025, Business Observer May 2025.`,

  "Gulf Coast Town Center": `\
Super-regional open-air power center, 1.3M SF retail GLA on 158 acres, Alico Rd / I-75, Fort \
Myers / Lee County. Owned and managed by NADG (North American Development Group, private Canadian \
developer; acquired ~2017). Anchors: Target, Costco, Bass Pro Shops, Regal Cinemas, Dick's \
Sporting Goods, HomeGoods, HomeSense, Marshalls, Ross, Burlington. Added 277 luxury apartments \
(Ilumina GCTC) — mixed-use conversion underway. 50+ mile trade area draw, FGCU proximity. \
Net absorption null: NADG is privately held with no public filings; no SEC disclosures, no \
broker deal announcements surfaced via public search. Center-level leasing data requires direct \
NADG contact or CoStar subscription. Source: NADG property page Jan 2026, Wikipedia.`,

  "Naples Airport-Pulling (North)": `\
Strip / neighborhood retail corridor, N Naples submarket, north of Pine Ridge Rd. Primarily \
residential-serving: grocery-anchored centers, services, neighborhood retail. Green Tree Center \
(Immokalee Rd + Airport-Pulling) reported nearly full with tenant waiting list as of Nov 2023. \
Airport-Pulling Rd widening project active (design completion targeted end 2025); may affect \
deal velocity near term. Net absorption null: corridor-level metric — Airport-Pulling is a \
multi-owner strip corridor, not a single-asset center; no aggregate leasing SF tracked at \
corridor level. Individual lease comps available via CoStar / CompStak. \
Source: Naples Daily News Nov 2023, Naples Daily News Mar 2025.`,

  "Naples Airport-Pulling (South)": `\
Commercial / business-node corridor, Naples submarket, south of Pine Ridge Rd to Davis Blvd \
area. More intensely commercial than the north segment — professional services, medical, \
mixed-use retail. Promenade Plaza (1175-1269 Airport Pulling Rd) had 1,769 SF available as \
of Feb 2025. Road widening project active on the full corridor. Net absorption null: \
corridor-level metric — Airport-Pulling is a multi-owner strip corridor with no single owner \
or single-asset tracking; CoStar / CompStak required for deal-level data. \
Source: LoopNet Feb 2025, Naples Daily News Mar 2025.`,
};

if (dryRun) {
  for (const [name, character] of Object.entries(UPDATES)) {
    console.log(`\n=== DRY-RUN: ${name} ===`);
    console.log(character.slice(0, 120) + "…");
  }
  console.log("\n--dry-run: no DB writes performed.");
  process.exit(0);
}

let ok = 0;
let fail = 0;
for (const [name, character] of Object.entries(UPDATES)) {
  const { error, count } = await sb
    .from("corridor_profiles")
    .update({ character }, { count: "exact" })
    .eq("corridor_name", name)
    .is("deleted_at", null);
  if (error) {
    console.log(`FAIL  ${name} — ${error.message}`);
    fail++;
  } else {
    console.log(`OK    ${name}  (rows=${count ?? "?"})`);
    ok++;
  }
}
console.log(`\nDone: ${ok} ok, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
