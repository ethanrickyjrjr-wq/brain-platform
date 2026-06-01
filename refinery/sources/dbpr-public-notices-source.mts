import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * dbpr-public-notices source — FL DBPR individual enforcement notices,
 * weekly scrape of www2.myfloridalicense.com/public-notices/.
 *
 * Table: public.dbpr_public_notices
 * (ingest/pipelines/dbpr_public_notices, weekly cron via dbpr-public-notices-weekly.yml)
 *
 * All rows are SWFL by construction (Lee, Collier, Charlotte, Sarasota, Manatee, Hendry, Monroe).
 * Fields are hard-parsed from PDF text — not Sonnet-inferred.
 *
 * Columns read:
 *   pdf_url           text        — PDF URL (unique key)
 *   respondent_name   text        — named party
 *   county            text        — SWFL county (exact, from PDF header)
 *   case_number       text        — first case number from CASE NO.: line
 *   violation_type    text        — 'unlicensed_activity' | 'disciplinary' | null
 *   industry          text        — derived from BEFORE THE [BOARD] line
 *   pdf_summary       text        — 2-3 sentence Claude summary (nullable)
 *   response_deadline date        — deadline parsed from PDF body
 *   last_seen_at      timestamptz — updated every scrape; gap = notice expired/removed
 *   scraped_at        timestamptz — first ingestion timestamp
 *
 * Window: notices with response_deadline in last 365 days.
 */

const SOURCE_ID = "dbpr_public_notices";
const TABLE = "dbpr_public_notices";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "news-swfl-notices.sample.json",
);

export interface DbprPublicNoticeNormalized {
  kind: "dbpr-public-notice";
  pdf_url: string;
  respondent_name: string | null;
  county: string;
  case_number: string | null;
  violation_type: "unlicensed_activity" | "disciplinary" | null;
  industry: string | null;
  pdf_summary: string | null;
  response_deadline: string | null;
  last_seen_at: string | null;
  scraped_at: string | null;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function toDateStr(v: unknown): string | null {
  const s = str(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function normalize(
  row: Record<string, unknown>,
): DbprPublicNoticeNormalized | null {
  const pdf_url = str(row.pdf_url);
  const county = str(row.county);
  if (!pdf_url || !county) return null;
  const vt = str(row.violation_type);
  return {
    kind: "dbpr-public-notice",
    pdf_url,
    respondent_name: str(row.respondent_name) || null,
    county,
    case_number: str(row.case_number) || null,
    violation_type:
      vt === "unlicensed_activity"
        ? "unlicensed_activity"
        : vt === "disciplinary"
          ? "disciplinary"
          : null,
    industry: str(row.industry) || null,
    pdf_summary: str(row.pdf_summary) || null,
    response_deadline: toDateStr(row.response_deadline),
    last_seen_at: str(row.last_seen_at) || null,
    scraped_at: str(row.scraped_at) || null,
  };
}

async function loadFixtureRows(): Promise<Record<string, unknown>[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const data = JSON.parse(raw) as { rows?: unknown[] } | unknown[];
  const rows = Array.isArray(data)
    ? data
    : ((data as { rows?: unknown[] }).rows ?? []);
  return rows as Record<string, unknown>[];
}

async function fetchRows(): Promise<Record<string, unknown>[]> {
  if (env.source === "fixture") return loadFixtureRows();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select(
      "pdf_url, respondent_name, county, case_number, violation_type, industry, pdf_summary, response_deadline, last_seen_at, scraped_at",
    )
    .gte("response_deadline", cutoffDate)
    .order("response_deadline", { ascending: false });
  if (error)
    throw new Error(
      `dbpr-public-notices-source: ${TABLE} query failed — ${error.message}`,
    );
  return (data ?? []) as Record<string, unknown>[];
}

export const dbprPublicNoticesSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 2,
  async fetch(): Promise<RawFragment[]> {
    const rows = await fetchRows();
    const fetched_at = isoTimestamp();
    return rows
      .map((row): RawFragment<DbprPublicNoticeNormalized> | null => {
        const normalized = normalize(row);
        if (!normalized) return null;
        return {
          fragment_id: fragmentId(SOURCE_ID, normalized.pdf_url),
          source_id: SOURCE_ID,
          source_trust_tier: 2,
          fetched_at,
          raw: row,
          normalized,
        };
      })
      .filter((f): f is RawFragment<DbprPublicNoticeNormalized> => f !== null);
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? "FL DBPR Public Notices — myfloridalicense.com (fixture; dbpr_public_notices)"
          : "FL DBPR Public Notices — Florida Department of Business and Professional Regulation (Supabase public.dbpr_public_notices: county, violation_type, industry, response_deadline; weekly scrape of www2.myfloridalicense.com/public-notices/)",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
