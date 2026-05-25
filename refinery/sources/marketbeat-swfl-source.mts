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
 * marketbeat-swfl source connector — Cushman & Wakefield MarketBeat / LSI
 * Companies / CPSWFL quarterly broker reports, extracted by the n8n Firecrawl
 * flow ("MarketBeat quarterly", Part 2 of the 2026-05-25 firecrawl-pipeline
 * plan) and landed into `data_lake.marketbeat_swfl`.
 *
 * THIS IS THE ONLY FILE THAT KNOWS THE marketbeat_swfl SCHEMA. Columns read
 * (verified against `docs/sql/20260525_marketbeat_swfl.sql`):
 *   id (text PK = submarket || '_' || quarter), submarket, quarter,
 *   vacancy_rate, asking_rent_nnn, absorption_sqft, source_url, verified.
 *
 * Manual spot-check gate: rows land with `verified = false` from the n8n
 * flow. This source filters `verified = true`, so a freshly landed quarter
 * is a no-op until a human flips the flag. That's intentional — broker
 * extracts are LLM-mediated and the gate is the only place a wrong number
 * gets caught before it shows up in cre-swfl.
 *
 * Trust tier: 2 (editorial/broker intelligence; same tier as corridor
 * profiles — neither is a primary government source).
 *
 * Fixture mode mirrors live: applies the verified filter and picks the
 * latest quarter per submarket, so pack tests see the same row shape they
 * would in production.
 */

const SOURCE_ID = "marketbeat_swfl";
const SCHEMA = "data_lake";
const TABLE = "marketbeat_swfl";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "marketbeat-swfl.sample.json",
);

/** Normalized MarketBeat row — what Stage 2 / Stage 3 see. */
export interface MarketbeatSwflNormalized {
  kind: "marketbeat-swfl";
  /** Reporting submarket (e.g. "Naples", "Fort Myers"). */
  submarket: string;
  /** Reporting quarter, e.g. "2026-Q3". Carried through as SynthesisFact.period. */
  quarter: string;
  /** Vacancy rate %, 0-100. Nullable when the broker report omits it. */
  vacancy_rate: number | null;
  /** Average asking rent PSF NNN. Nullable. Negative is invalid; n8n's range check rejects out-of-band values upstream. */
  asking_rent_nnn: number | null;
  /** Net absorption sqft — can be negative (give-back). Nullable. */
  absorption_sqft: number | null;
  /** Per-row source URL the broker report came from (Firecrawl scrape origin). */
  source_url: string | null;
}

/** Raw row shape as it arrives from PostgREST / the fixture. */
export interface MarketbeatRow {
  id?: string;
  submarket: string;
  quarter: string;
  vacancy_rate: number | null;
  asking_rent_nnn: number | null;
  absorption_sqft: number | null;
  source_url: string | null;
  verified: boolean;
}

interface FixtureShape {
  __meta?: unknown;
  rows: MarketbeatRow[];
}

/**
 * Compare two `YYYY-Qn` strings. Returns 1 if `a > b`, -1 if `a < b`, else 0.
 * String sort works for the canonical four-char-year + dash + Q + digit shape
 * because the lexicographic order matches the chronological order — but we
 * keep this helper explicit so a future "2026-H1" or "FY2026" variant doesn't
 * silently misorder.
 */
function compareQuarter(a: string, b: string): number {
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

/**
 * Pure filter: keep only `verified = true` rows, then pick the latest
 * `quarter` per `submarket`. Empty input → empty output; all-unverified →
 * empty output. Exported for direct unit testing.
 */
export function selectLatestVerifiedPerSubmarket(
  rows: MarketbeatRow[],
): MarketbeatRow[] {
  const latest = new Map<string, MarketbeatRow>();
  for (const r of rows) {
    if (!r.verified) continue;
    const prev = latest.get(r.submarket);
    if (prev == null || compareQuarter(r.quarter, prev.quarter) > 0) {
      latest.set(r.submarket, r);
    }
  }
  // Stable order: submarket name asc so fragment_id sequences are
  // deterministic across runs.
  return Array.from(latest.values()).sort((a, b) =>
    a.submarket.localeCompare(b.submarket),
  );
}

async function loadFixture(): Promise<MarketbeatRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const parsed = JSON.parse(raw) as FixtureShape;
  return parsed.rows ?? [];
}

async function fetchLive(): Promise<MarketbeatRow[]> {
  const { data, error } = await getSupabase()
    .schema(SCHEMA)
    .from(TABLE)
    .select(
      "submarket, quarter, vacancy_rate, asking_rent_nnn, absorption_sqft, source_url, verified",
    )
    .eq("verified", true)
    .order("quarter", { ascending: false });
  if (error) {
    throw new Error(
      `marketbeat-swfl: ${TABLE} fetch failed — ${error.message}`,
    );
  }
  return (data ?? []) as MarketbeatRow[];
}

/** Receipt URL for a single row — uniform across rows since the source pulls the full filtered table. */
function marketbeatReceiptUrl(): string {
  if (env.source === "fixture") {
    return `fixture://refinery/__fixtures__/marketbeat-swfl.sample.json`;
  }
  return buildSourceCitationUrl(TABLE, {
    label: "MarketBeat — SWFL CRE quarterly",
    source: "Cushman & Wakefield / LSI / CPSWFL (n8n + Firecrawl)",
    brain: "cre-swfl",
    date_col: "quarter",
  });
}

export const marketbeatSwflSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 2, // editorial/broker intelligence — same weight as corridor profiles
  async fetch(): Promise<RawFragment[]> {
    const allRows =
      env.source === "fixture" ? await loadFixture() : await fetchLive();
    const rows = selectLatestVerifiedPerSubmarket(allRows);
    const fetched_at = isoTimestamp();
    return rows.map((row): RawFragment<MarketbeatSwflNormalized> => {
      const normalized: MarketbeatSwflNormalized = {
        kind: "marketbeat-swfl",
        submarket: row.submarket,
        quarter: row.quarter,
        vacancy_rate: row.vacancy_rate,
        asking_rent_nnn: row.asking_rent_nnn,
        absorption_sqft: row.absorption_sqft,
        source_url: row.source_url ?? marketbeatReceiptUrl(),
      };
      const idKey = row.id ?? `${row.submarket}_${row.quarter}`;
      return {
        fragment_id: fragmentId(SOURCE_ID, idKey),
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
          ? `MarketBeat SWFL CRE quarterly (fixture; ${SCHEMA}.${TABLE}) — fixture://refinery/__fixtures__/marketbeat-swfl.sample.json`
          : `MarketBeat SWFL CRE quarterly via ${SCHEMA}.${TABLE} (n8n + Firecrawl quarterly extract; manual spot-check gate on verified=true)`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
