import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";
import { buildSourceCitationUrl } from "../lib/citation-url.mts";

/**
 * fl-dbpr-licenses source connector — SWFL contractor licensing health from
 * the Florida Department of Business & Professional Regulation (DBPR) bulk
 * extract CSVs (Construction Board 06 + Electrical Board 08).
 *
 * Tables read:
 *   data_lake.fl_dbpr_licenses   — one row per license (merge on license_number)
 *                                   Lee + Collier only (county_code 46 + 21)
 *   data_lake.fl_dbpr_applicants — Lee + Collier applicants, filtered at ingest
 *                                   (county_code 46 + 21; replace monthly)
 *
 * Returns ONE RawFragment containing a pre-aggregated DbprLicenseSummary.
 * The pack (licenses-swfl) has skipSynthesisAgent + skipTriageAgent = true,
 * so one summary fragment is sufficient — no per-row triage needed.
 *
 * Trust tier: 1 (FL DBPR is the primary state government licensing authority).
 */

const SOURCE_ID = "fl_dbpr_licenses";
const SCHEMA = "data_lake";
const LICENSES_TABLE = "fl_dbpr_licenses";
const APPLICANTS_TABLE = "fl_dbpr_applicants";
const CITATION_URL = "https://www2.myfloridalicense.com/instant-public-records/";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "fl-dbpr-licenses.sample.json",
);

// ── Types ──────────────────────────────────────────────────────────────────────

/** Pre-aggregated summary built from fl_dbpr_licenses + fl_dbpr_applicants. */
export interface DbprLicenseSummary {
  kind: "dbpr-license-summary";
  /** Active Lee County licenses (primary_status='C', secondary_status='A') */
  licenses_active_lee: number;
  /** Active Collier County licenses (primary_status='C', secondary_status='A') */
  licenses_active_collier: number;
  /** Active licenses issued in last 12 months (Lee + Collier combined) */
  licenses_new_12m_swfl: number;
  /** Lapsed licenses in Lee + Collier (primary_status != 'C') */
  licenses_lapsed_swfl: number;
  /** All license rows in Lee + Collier (active + lapsed + other) */
  licenses_total_swfl: number;
  /** Active licenses in Lee + Collier (primary_status='C', secondary_status='A') */
  licenses_total_active_swfl: number;
  /** Active CBC (occupation_code='CBC') in Lee + Collier */
  licenses_cbc_count_swfl: number;
  /** Applicant rows from fl_dbpr_applicants (Lee + Collier county_code) */
  applicants_swfl: number;
  fetched_at: string;
}

// ── Live fetch ─────────────────────────────────────────────────────────────────

async function fetchLiveSummary(): Promise<DbprLicenseSummary> {
  const fetched_at = isoTimestamp();
  const sb = getSupabase().schema(SCHEMA);

  const since12m = new Date();
  since12m.setFullYear(since12m.getFullYear() - 1);
  const since12mStr = since12m.toISOString().slice(0, 10);

  function throwOnError(label: string, error: { message: string } | null): void {
    if (error) {
      throw new Error(`fl-dbpr-licenses-source: ${label} count failed — ${error.message}`);
    }
  }

  const [r1, r2, r3, r4, r5, r6] = await Promise.all([
    // Active Lee
    sb
      .from(LICENSES_TABLE)
      .select("*", { count: "exact", head: true })
      .eq("county_code", "46")
      .eq("primary_status", "C")
      .eq("secondary_status", "A"),

    // Active Collier
    sb
      .from(LICENSES_TABLE)
      .select("*", { count: "exact", head: true })
      .eq("county_code", "21")
      .eq("primary_status", "C")
      .eq("secondary_status", "A"),

    // New in last 12 months (active, Lee+Collier)
    sb
      .from(LICENSES_TABLE)
      .select("*", { count: "exact", head: true })
      .in("county_code", ["46", "21"])
      .eq("primary_status", "C")
      .eq("secondary_status", "A")
      .gte("original_licensure_date", since12mStr),

    // Lapsed (primary_status != 'C', Lee+Collier)
    sb
      .from(LICENSES_TABLE)
      .select("*", { count: "exact", head: true })
      .in("county_code", ["46", "21"])
      .neq("primary_status", "C"),

    // Total all statuses (Lee+Collier)
    sb
      .from(LICENSES_TABLE)
      .select("*", { count: "exact", head: true })
      .in("county_code", ["46", "21"]),

    // Active CBC
    sb
      .from(LICENSES_TABLE)
      .select("*", { count: "exact", head: true })
      .in("county_code", ["46", "21"])
      .eq("occupation_code", "CBC")
      .eq("primary_status", "C")
      .eq("secondary_status", "A"),
  ]);

  throwOnError("activeLee", r1.error);
  throwOnError("activeCollier", r2.error);
  throwOnError("new12m", r3.error);
  throwOnError("lapsed", r4.error);
  throwOnError("totalSwfl", r5.error);
  throwOnError("cbcActive", r6.error);

  const [activeLee, activeCollier, new12m, lapsed, totalSwfl, cbcActive] = [
    r1.count ?? 0,
    r2.count ?? 0,
    r3.count ?? 0,
    r4.count ?? 0,
    r5.count ?? 0,
    r6.count ?? 0,
  ];

  // Applicants in SWFL (county_code 46 or 21)
  const { count: applicantsSwfl, error: appErr } = await getSupabase()
    .schema(SCHEMA)
    .from(APPLICANTS_TABLE)
    .select("*", { count: "exact", head: true })
    .in("county_code", ["46", "21"]);
  if (appErr) {
    // Non-fatal — applicants table may be empty on first run
    console.warn(`fl-dbpr-licenses-source: applicants count failed — ${appErr.message}`);
  }

  return {
    kind: "dbpr-license-summary",
    licenses_active_lee: activeLee,
    licenses_active_collier: activeCollier,
    licenses_new_12m_swfl: new12m,
    licenses_lapsed_swfl: lapsed,
    licenses_total_swfl: totalSwfl,
    licenses_total_active_swfl: activeLee + activeCollier,
    licenses_cbc_count_swfl: cbcActive,
    applicants_swfl: applicantsSwfl ?? 0,
    fetched_at,
  };
}

// ── Fixture fetch ──────────────────────────────────────────────────────────────

interface FixtureShape {
  licenses?: Record<string, unknown>[];
  applicants?: Record<string, unknown>[];
}

async function fetchFixtureSummary(): Promise<DbprLicenseSummary> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const data = JSON.parse(raw) as FixtureShape;
  const licenses = data.licenses ?? [];
  const applicants = data.applicants ?? [];
  const fetched_at = isoTimestamp();

  const str = (v: unknown): string => String(v ?? "").trim();
  const isLee = (r: Record<string, unknown>) => str(r.county_code) === "46";
  const isCollier = (r: Record<string, unknown>) => str(r.county_code) === "21";
  const isSwfl = (r: Record<string, unknown>) => isLee(r) || isCollier(r);
  const isActive = (r: Record<string, unknown>) =>
    str(r.primary_status) === "C" && str(r.secondary_status) === "A";
  const isLapsed = (r: Record<string, unknown>) => isSwfl(r) && str(r.primary_status) !== "C";

  const since12m = new Date();
  since12m.setFullYear(since12m.getFullYear() - 1);
  const since12mStr = since12m.toISOString().slice(0, 10);

  const activeLee = licenses.filter((r) => isActive(r) && isLee(r)).length;
  const activeCollier = licenses.filter((r) => isActive(r) && isCollier(r)).length;
  const new12m = licenses.filter(
    (r) => isActive(r) && isSwfl(r) && str(r.original_licensure_date) >= since12mStr,
  ).length;
  const lapsed = licenses.filter(isLapsed).length;
  const totalSwfl = licenses.filter(isSwfl).length;
  const cbcActive = licenses.filter(
    (r) => isActive(r) && isSwfl(r) && str(r.occupation_code) === "CBC",
  ).length;
  const applicantsSwfl = applicants.filter((r) => isSwfl(r as Record<string, unknown>)).length;

  return {
    kind: "dbpr-license-summary",
    licenses_active_lee: activeLee,
    licenses_active_collier: activeCollier,
    licenses_new_12m_swfl: new12m,
    licenses_lapsed_swfl: lapsed,
    licenses_total_swfl: totalSwfl,
    licenses_total_active_swfl: activeLee + activeCollier,
    licenses_cbc_count_swfl: cbcActive,
    applicants_swfl: applicantsSwfl,
    fetched_at,
  };
}

// ── Connector ──────────────────────────────────────────────────────────────────

export const flDbprLicensesSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,

  async fetch(): Promise<RawFragment[]> {
    const summary =
      env.source === "fixture" ? await fetchFixtureSummary() : await fetchLiveSummary();

    const receipt =
      env.source === "fixture"
        ? `fixture://refinery/__fixtures__/fl-dbpr-licenses.sample.json`
        : buildSourceCitationUrl(LICENSES_TABLE, {
            label: "Florida DBPR Contractor Licenses — Lee + Collier (boards 06 + 08)",
            source: "FL DBPR",
            brain: "licenses-swfl",
            date_col: "original_licensure_date",
            doc: CITATION_URL,
          });

    return [
      {
        fragment_id: fragmentId(SOURCE_ID, "summary"),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at: summary.fetched_at,
        raw: {
          kind: summary.kind,
          licenses_total_swfl: summary.licenses_total_swfl,
          source_url: receipt,
        },
        normalized: summary,
      },
    ];
  },

  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    const isLive = env.source !== "fixture";
    return {
      source: isLive
        ? `Florida DBPR Contractor Licenses — Lee (county_code=46) + Collier (county_code=21); Construction Board (06) + Electrical Board (08); monthly bulk extract via ${CITATION_URL}; data_lake.fl_dbpr_licenses + fl_dbpr_applicants`
        : `Florida DBPR Contractor Licenses (fixture; fl-dbpr-licenses.sample.json)`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
