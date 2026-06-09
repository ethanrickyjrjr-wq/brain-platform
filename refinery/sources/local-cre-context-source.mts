import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * Local CRE context source — government/EDC narrative context for Estero + FMB.
 * Sources: Village of Estero EDC, Town of FMB planning, Lee County recovery.
 *
 * Emits one fragment per row from data_lake.local_cre_context.
 * Fragments inject into cre-swfl via caveats[] — no new BrainOutput field needed.
 */

const SOURCE_ID = "local_cre_context";
const SCHEMA = "data_lake";
const TABLE = "local_cre_context";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "local-cre-context.sample.json",
);

export interface LocalCreContextNormalized {
  kind: "local-cre-context";
  source_name: string;
  city: string;
  topic: string | null;
  headline: string | null;
  detail: string | null;
  source_url: string | null;
  report_date: string | null;
}

interface FixtureShape {
  __meta?: unknown;
  rows: Array<{
    id: string;
    source_name: string;
    city: string;
    topic: string | null;
    headline: string | null;
    detail: string | null;
    source_url: string | null;
    report_date: string | null;
  }>;
}

async function loadFixture(): Promise<FixtureShape["rows"]> {
  try {
    const raw = await readFile(FIXTURE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as FixtureShape;
    return parsed.rows ?? [];
  } catch {
    return [];
  }
}

async function fetchLive(): Promise<FixtureShape["rows"]> {
  const { data, error } = await getSupabase()
    .schema(SCHEMA)
    .from(TABLE)
    .select("id, source_name, city, topic, headline, detail, source_url, report_date")
    .in("city", ["Estero", "Fort Myers Beach"])
    .order("report_date", { ascending: false });

  if (error) {
    throw new Error(`local-cre-context-source: ${TABLE} fetch failed — ${error.message}`);
  }
  return (data ?? []) as FixtureShape["rows"];
}

export const localCreContextSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 2,
  async fetch(): Promise<RawFragment[]> {
    const rows = env.source === "fixture" ? await loadFixture() : await fetchLive();
    if (rows.length === 0) return [];
    const fetched_at = isoTimestamp();
    return rows.map((row): RawFragment<LocalCreContextNormalized> => {
      const normalized: LocalCreContextNormalized = {
        kind: "local-cre-context",
        source_name: row.source_name,
        city: row.city,
        topic: row.topic,
        headline: row.headline,
        detail: row.detail,
        source_url: row.source_url,
        report_date: row.report_date,
      };
      return {
        fragment_id: fragmentId(SOURCE_ID, row.id),
        source_id: SOURCE_ID,
        source_trust_tier: 2,
        fetched_at,
        raw: row as unknown as Record<string, unknown>,
        normalized,
      };
    });
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? `Local CRE context — Estero EDC + FMB planning (fixture; ${SCHEMA}.${TABLE})`
          : `Local CRE context via ${SCHEMA}.${TABLE} (Village of Estero EDC + Town of FMB planning; Firecrawl monthly scrape)`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
