// lib/email/market-context.ts
//
// The data feed the Email Lab builder pulls from. Given a scope ({zip} or
// {county}), reads the live lake market views via the service-role PostgREST
// client (same pattern as lib/zip-summary/load.ts) and returns cited figures —
// real value + source + as-of for every number. This is what makes the AI
// "create this" box able to create: it pulls the information itself instead of
// being spoon-fed.
//
// Empty-tolerant by contract (four-lane / ODD): no creds, no rows, any query
// error → fewer/zero figures, NEVER a thrown error and NEVER an invented number.
// data_lake views carry `service_role` SELECT (verified 2026-06-25).

import { createServiceRoleClient } from "@/utils/supabase/service-role";

export interface MarketFigure {
  key: string;
  label: string;
  value: string;
  source: string;
  as_of?: string;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;
const mdY = (iso: string | null | undefined): string | undefined => {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
};
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** "Lee County" → "Lee"; maps to the redfin_<county>_market table when one exists. */
const REDFIN_TABLE: Record<string, string> = {
  lee: "redfin_lee_market",
  collier: "redfin_collier_market",
};

type Db = ReturnType<typeof createServiceRoleClient>;

async function zipFigures(db: Db, zip: string, figs: MarketFigure[]): Promise<string | null> {
  let county: string | null = null;

  try {
    const { data } = await db
      .schema("data_lake")
      .from("zhvi_zip_latest")
      .select("home_value_latest, value_yoy_pct, latest_period, city, county_name")
      .eq("zip_code", zip)
      .maybeSingle();
    if (data) {
      county = (data.county_name ?? "").replace(/\s*County$/i, "").trim() || null;
      const hv = num(data.home_value_latest);
      const yoy = num(data.value_yoy_pct);
      const asOf = mdY(data.latest_period);
      if (hv != null)
        figs.push({
          key: "home_value",
          label: `Median home value — ${data.city ?? zip} (${zip})`,
          value: usd(hv),
          source: "Zillow ZHVI",
          as_of: asOf,
        });
      if (yoy != null)
        figs.push({
          key: "home_value_yoy",
          label: "Home value, year over year",
          value: pct(yoy),
          source: "Zillow ZHVI",
          as_of: asOf,
        });
    }
  } catch {
    /* degrade */
  }

  try {
    const { data } = await db
      .schema("data_lake")
      .from("zori_zip_latest")
      .select("rent_index_latest, rent_yoy_pct, latest_period")
      .eq("zip_code", zip)
      .maybeSingle();
    if (data) {
      const r = num(data.rent_index_latest);
      const yoy = num(data.rent_yoy_pct);
      const asOf = mdY(data.latest_period);
      if (r != null)
        figs.push({
          key: "rent",
          label: "Typical asking rent",
          value: `${usd(r)}/mo`,
          source: "Zillow ZORI",
          as_of: asOf,
        });
      if (yoy != null)
        figs.push({
          key: "rent_yoy",
          label: "Rent, year over year",
          value: pct(yoy),
          source: "Zillow ZORI",
          as_of: asOf,
        });
    }
  } catch {
    /* degrade */
  }

  try {
    const { data } = await db
      .schema("data_lake")
      .from("active_listings_residential_zip_stats")
      .select("listing_count, median_list_price, avg_days_on_market, latest_scraped_at, county")
      .eq("zip_code", zip)
      .maybeSingle();
    if (data) {
      county = county ?? ((data.county ?? "").replace(/\s*County$/i, "").trim() || null);
      const cnt = num(data.listing_count);
      const ml = num(data.median_list_price);
      const dom = num(data.avg_days_on_market);
      const asOf = mdY(data.latest_scraped_at);
      if (cnt != null)
        figs.push({
          key: "active",
          label: `Active listings in ${zip}`,
          value: String(cnt),
          source: "MLS active-listings",
          as_of: asOf,
        });
      if (ml != null)
        figs.push({
          key: "median_list",
          label: "Median list price",
          value: usd(ml),
          source: "MLS active-listings",
          as_of: asOf,
        });
      if (dom != null)
        figs.push({
          key: "dom",
          label: "Average days on market",
          value: String(dom),
          source: "MLS active-listings",
          as_of: asOf,
        });
    }
  } catch {
    /* degrade */
  }

  try {
    const { data } = await db
      .schema("data_lake")
      .from("census_acs_zcta")
      .select("total_population, median_household_income, owner_occupied_pct, acs_year")
      .eq("geo_id", zip)
      .maybeSingle();
    if (data) {
      const asOf = data.acs_year ? `12/31/${data.acs_year}` : undefined;
      const pop = num(data.total_population);
      const inc = num(data.median_household_income);
      const own = num(data.owner_occupied_pct);
      if (pop != null)
        figs.push({
          key: "population",
          label: `Population (${zip})`,
          value: pop.toLocaleString("en-US"),
          source: "U.S. Census ACS",
          as_of: asOf,
        });
      if (inc != null)
        figs.push({
          key: "income",
          label: "Median household income",
          value: usd(inc),
          source: "U.S. Census ACS",
          as_of: asOf,
        });
      if (own != null)
        figs.push({
          key: "owner_occupied",
          label: "Owner-occupied homes",
          value: `${own}%`,
          source: "U.S. Census ACS",
          as_of: asOf,
        });
    }
  } catch {
    /* degrade */
  }

  return county;
}

async function countyFigures(db: Db, county: string, figs: MarketFigure[]): Promise<void> {
  const tbl = REDFIN_TABLE[county.toLowerCase()];
  if (!tbl) return; // only Lee/Collier have a redfin market table — degrade quietly
  try {
    const { data } = await db
      .schema("data_lake")
      .from(tbl)
      .select(
        "median_sale_price, median_sale_price_yoy, homes_sold, months_of_supply, median_dom, period_end",
      )
      .eq("property_type", "All Residential")
      .order("period_end", { ascending: false })
      .limit(1);
    const row = data?.[0];
    if (row) {
      const asOf = mdY(row.period_end);
      const ms = num(row.median_sale_price);
      const yoy = num(row.median_sale_price_yoy);
      const sold = num(row.homes_sold);
      const sup = num(row.months_of_supply);
      const dom = num(row.median_dom);
      if (ms != null)
        figs.push({
          key: "county_sale",
          label: `${county} County median sale price`,
          value: usd(ms),
          source: "Redfin",
          as_of: asOf,
        });
      if (yoy != null)
        figs.push({
          key: "county_sale_yoy",
          label: `${county} County sale price, year over year`,
          value: pct(yoy * (Math.abs(yoy) < 1 ? 100 : 1)),
          source: "Redfin",
          as_of: asOf,
        });
      if (sold != null)
        figs.push({
          key: "county_sold",
          label: `${county} County homes sold (month)`,
          value: sold.toLocaleString("en-US"),
          source: "Redfin",
          as_of: asOf,
        });
      if (sup != null)
        figs.push({
          key: "county_supply",
          label: `${county} County months of supply`,
          value: `${sup} mo`,
          source: "Redfin",
          as_of: asOf,
        });
      if (dom != null)
        figs.push({
          key: "county_dom",
          label: `${county} County median days on market`,
          value: String(dom),
          source: "Redfin",
          as_of: asOf,
        });
    }
  } catch {
    /* degrade */
  }
}

/**
 * Pull cited market figures for a scope. zip scope → per-ZIP value/rent/listings/
 * demographics + that ZIP's county sale figures; county scope → county sale figures.
 * Always returns an array (possibly empty); never throws.
 */
export async function loadMarketFigures(scope?: {
  kind?: string;
  value?: string;
}): Promise<MarketFigure[]> {
  if (!scope?.value) return [];
  let db: Db;
  try {
    db = createServiceRoleClient();
  } catch {
    return []; // no lake creds in this env — degrade, never throw
  }
  const figs: MarketFigure[] = [];
  try {
    if (scope.kind === "zip") {
      const county = await zipFigures(db, scope.value, figs);
      if (county) await countyFigures(db, county, figs);
    } else if (scope.kind === "county") {
      await countyFigures(db, scope.value.replace(/\s*County$/i, "").trim(), figs);
    }
  } catch {
    /* degrade — return whatever we gathered */
  }
  return figs;
}

/** Render figures as the labeled "REAL LAKE DATA" block the fill AI reads. */
export function figuresToPromptBlock(figs: MarketFigure[]): string {
  if (!figs.length) return "";
  return figs
    .map(
      (f) => `- ${f.label}: ${f.value}${f.as_of ? ` (${f.source}, ${f.as_of})` : ` (${f.source})`}`,
    )
    .join("\n");
}
