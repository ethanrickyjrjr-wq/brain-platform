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
 * swfl-inc source — SWFL Inc. Economic Development Announcements.
 *
 * Table: swfl_inc_announcements (self-ingested via ingest/pipelines/swfl_inc,
 * weekly cron via swfl-inc-weekly.yml).
 *
 * Columns read:
 *   id              text    -- MD5 slug of title + date
 *   title           text    -- announcement headline
 *   announced_date  date    -- date of the announcement
 *   county          text    -- lee | collier | charlotte | swfl
 *   category        text    -- relocation | expansion | grant | infrastructure | partnership | workforce
 *   investment_usd  numeric -- total investment amount in USD (nullable)
 *   jobs            integer -- new job count (nullable)
 *   summary         text    -- brief excerpt from the announcement
 *   source_url      text    -- swflinc.com article URL
 *
 * Window: last 180 days — covers two full quarters for YoY momentum.
 *
 * Trust tier: 2 (SWFL Inc. is the official Lee County EDO; editorial secondary source).
 */

const SOURCE_ID = "swfl_inc_announcements";
const TABLE = "swfl_inc_announcements";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "econ-dev-swfl.sample.json",
);

/** One normalized row from swfl_inc_announcements. */
export interface SwflIncNormalized {
  kind: "swfl-inc-announcement";
  id: string;
  title: string;
  announced_date: string | null;
  county: string;
  category: string | null;
  investment_usd: number | null;
  jobs: number | null;
  summary: string | null;
  source_url: string;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  const n = toNum(v);
  return n !== null ? Math.round(n) : null;
}

function toDateStr(v: unknown): string | null {
  const s = str(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function normalize(row: Record<string, unknown>): SwflIncNormalized | null {
  const title = str(row.title);
  if (!title) return null;
  const id = str(row.id);
  if (!id) return null;
  return {
    kind: "swfl-inc-announcement",
    id,
    title,
    announced_date: toDateStr(row.announced_date),
    county: str(row.county).toLowerCase() || "swfl",
    category: str(row.category) || null,
    investment_usd: toNum(row.investment_usd),
    jobs: toInt(row.jobs),
    summary: str(row.summary) || null,
    source_url: str(row.source_url),
  };
}

async function loadFixtureRows(): Promise<Record<string, unknown>[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const data = JSON.parse(raw) as { rows?: unknown[] } | unknown[];
  const rows: unknown[] = Array.isArray(data)
    ? data
    : ((data as { rows?: unknown[] }).rows ?? []);
  return rows as Record<string, unknown>[];
}

async function fetchRows(): Promise<Record<string, unknown>[]> {
  if (env.source === "fixture") return loadFixtureRows();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 180);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select(
      "id, title, announced_date, county, category, investment_usd, jobs, summary, source_url",
    )
    .gte("announced_date", cutoffDate)
    .order("announced_date", { ascending: false });
  if (error) {
    throw new Error(`swfl-inc-source: ${TABLE} query failed — ${error.message}`);
  }
  return (data ?? []) as Record<string, unknown>[];
}

export const swflIncSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 2,
  async fetch(): Promise<RawFragment[]> {
    const rows = await fetchRows();
    const fetched_at = isoTimestamp();
    const receipt =
      env.source === "fixture"
        ? `fixture://refinery/__fixtures__/econ-dev-swfl.sample.json`
        : buildSourceCitationUrl(TABLE, {
            label:
              "SWFL Inc. Economic Development Announcements — Lee County EDO",
            source: "SWFL Inc.",
            brain: "econ-dev-swfl",
            date_col: "announced_date",
          });
    return rows
      .map((row): RawFragment<SwflIncNormalized> | null => {
        const normalized = normalize(row);
        if (!normalized) return null;
        if (!normalized.source_url) normalized.source_url = receipt;
        return {
          fragment_id: fragmentId(
            SOURCE_ID,
            normalized.id,
          ),
          source_id: SOURCE_ID,
          source_trust_tier: 2,
          fetched_at,
          raw: row,
          normalized,
        };
      })
      .filter((f): f is RawFragment<SwflIncNormalized> => f !== null);
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? "SWFL Inc. Economic Development Announcements — Lee County EDO (fixture; swfl_inc_announcements)"
          : "SWFL Inc. Economic Development Announcements — Lee County EDO (Supabase swfl_inc_announcements: title, announced_date, county, category, investment_usd, jobs; weekly scrape of swflinc.com/news/)",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
