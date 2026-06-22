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
 * dbpr-sirs-source — SWFL SIRS confirmation counts from the Florida DBPR
 * SIRS Reporting Database (two Qlik Sense apps: pre-July 2025 and July 2025+).
 *
 * Tables read:
 *   data_lake.dbpr_sirs_submissions — county_normalized IN ('LEE','COLLIER')
 *
 * Returns ONE RawFragment containing a pre-aggregated DbprSirsSummary.
 * The pack (condo-sirs-swfl) has skipSynthesisAgent + skipTriageAgent = true.
 *
 * Trust tier: 1 (FL DBPR is the primary state government compliance authority).
 */

const SOURCE_ID = "dbpr_sirs_submissions";
const SCHEMA = "data_lake";
const TABLE = "dbpr_sirs_submissions";
const CITATION_URL = "https://dbpr-publicrecords.myfloridalicense.com/qpr/single/";

const FIXTURE_PATH = path.join(process.cwd(), "refinery", "__fixtures__", "dbpr-sirs.sample.json");

// ── Types ──────────────────────────────────────────────────────────────────────

/** Pre-aggregated summary built from data_lake.dbpr_sirs_submissions. */
export interface DbprSirsSummary {
  kind: "dbpr-sirs-summary";
  /** Lee + Collier combined confirmed SIRS filings */
  sirs_confirmed_swfl: number;
  /** Lee County only */
  sirs_lee_count: number;
  /** Collier County only */
  sirs_collier_count: number;
  /** July 2025+ schema (post-HB 913) rows in Lee + Collier */
  sirs_july2025_plus_count: number;
  /** true when any row has result_truncated=true — counts are floor estimates */
  result_truncated_any: boolean;
  /** ISO timestamp of most recent scrape in the table */
  latest_scraped_at: string | null;
  fetched_at: string;
}

// ── Live fetch ─────────────────────────────────────────────────────────────────

async function fetchLiveSummary(): Promise<DbprSirsSummary> {
  const fetched_at = isoTimestamp();
  const sb = getSupabase().schema(SCHEMA);

  function throwOnError(label: string, error: { message: string } | null): void {
    if (error) throw new Error(`dbpr-sirs-source: ${label} — ${error.message}`);
  }

  const [r1, r2, r3, r4] = await Promise.all([
    sb
      .from(TABLE)
      .select("*", { count: "exact", head: true })
      .in("county_normalized", ["LEE", "COLLIER"]),
    sb.from(TABLE).select("*", { count: "exact", head: true }).eq("county_normalized", "LEE"),
    sb.from(TABLE).select("*", { count: "exact", head: true }).eq("county_normalized", "COLLIER"),
    sb
      .from(TABLE)
      .select("*", { count: "exact", head: true })
      .in("county_normalized", ["LEE", "COLLIER"])
      .eq("database_period", "july_2025_plus"),
  ]);

  throwOnError("swflTotal", r1.error);
  throwOnError("lee", r2.error);
  throwOnError("collier", r3.error);
  throwOnError("july2025plus", r4.error);

  // Separate query for scraped_at and the truncation flag (not expressible as HEAD)
  const { data: latestRows, error: latestErr } = await getSupabase()
    .schema(SCHEMA)
    .from(TABLE)
    .select("scraped_at, result_truncated")
    .in("county_normalized", ["LEE", "COLLIER"])
    .order("scraped_at", { ascending: false })
    .limit(20);
  if (latestErr) throw new Error(`dbpr-sirs-source: latestRows — ${latestErr.message}`);

  const resultTruncatedAny = (latestRows ?? []).some((row) => row.result_truncated === true);
  const latestScrapedAt = (latestRows ?? [])[0]?.scraped_at ?? null;

  return {
    kind: "dbpr-sirs-summary",
    sirs_confirmed_swfl: r1.count ?? 0,
    sirs_lee_count: r2.count ?? 0,
    sirs_collier_count: r3.count ?? 0,
    sirs_july2025_plus_count: r4.count ?? 0,
    result_truncated_any: resultTruncatedAny,
    latest_scraped_at: latestScrapedAt,
    fetched_at,
  };
}

// ── Fixture fetch ──────────────────────────────────────────────────────────────

interface FixtureShape {
  summary?: Partial<DbprSirsSummary>;
}

async function fetchFixtureSummary(): Promise<DbprSirsSummary> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const data = JSON.parse(raw) as FixtureShape;
  const s = data.summary ?? {};
  return {
    kind: "dbpr-sirs-summary",
    sirs_confirmed_swfl: s.sirs_confirmed_swfl ?? 239,
    sirs_lee_count: s.sirs_lee_count ?? 80,
    sirs_collier_count: s.sirs_collier_count ?? 159,
    sirs_july2025_plus_count: s.sirs_july2025_plus_count ?? 230,
    result_truncated_any: s.result_truncated_any ?? true,
    latest_scraped_at: s.latest_scraped_at ?? new Date().toISOString(),
    fetched_at: isoTimestamp(),
  };
}

// ── Connector ──────────────────────────────────────────────────────────────────

export const dbprSirsSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,

  async fetch(): Promise<RawFragment[]> {
    const summary =
      env.source === "fixture" ? await fetchFixtureSummary() : await fetchLiveSummary();

    const receipt =
      env.source === "fixture"
        ? `fixture://refinery/__fixtures__/dbpr-sirs.sample.json`
        : buildSourceCitationUrl(TABLE, {
            label: "Florida DBPR SIRS Submissions — Lee + Collier",
            source: "FL DBPR",
            brain: "condo-sirs-swfl",
            date_col: "scraped_at",
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
          sirs_confirmed_swfl: summary.sirs_confirmed_swfl,
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
        ? `Florida DBPR SIRS Reporting Database — Lee + Collier; pre-July 2025 (app 14f1ed21) + July 2025+ (app d217126f); monthly Qlik QIX-engine pull via ${CITATION_URL}; data_lake.dbpr_sirs_submissions`
        : `Florida DBPR SIRS Submissions (fixture; dbpr-sirs.sample.json)`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
