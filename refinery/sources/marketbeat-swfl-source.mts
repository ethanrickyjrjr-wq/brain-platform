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
 * (verified against `docs/sql/20260525_marketbeat_swfl.sql` +
 * `docs/sql/20260605_marketbeat_swfl_mhs_extension.sql`):
 *   id (text PK = source_name||'_'||sector||'_'||submarket||'_'||quarter,
 *       e.g. 'mhs_databook_retail_bonita-springs_2026-Q1'),
 *   source_name ('cw_marketbeat' | 'mhs_databook' — NOT NULL, no default),
 *   sector, submarket, quarter, geographic_type,
 *   vacancy_rate, asking_rent_nnn, absorption_sqft, source_url, verified,
 *   verified_vacancy, verified_rents, verified_absorption.
 *
 * Verification gate differs by source:
 *   cw_marketbeat — legacy `verified = true` gates the whole row.
 *   mhs_databook  — `verified` is always false (staged); per-field flags
 *                   (verified_vacancy / verified_rents / verified_absorption)
 *                   gate each metric individually. Dark fields are nulled at
 *                   the fragment level so the pack never sees them.
 *
 * Collision-winner rule: on identical (sector, submarket, quarter),
 * 'mhs_databook' wins — geometry-confirmed + per-field verified.
 * Applied in selectLatestVerifiedPerSubmarket.
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

/**
 * Sectors this source surfaces. The table holds retail/industrial/office (MHS,
 * source_name='mhs_databook').
 *
 * DECISION HISTORY:
 *   2026-06-05 (Ricky): retail-only — industrial/office stored but dark.
 *   2026-06-08 (Ricky, REVERSED): surface retail + industrial + office as
 *     DISTINCT per-sector slugs. The 2026-06-05 ban was on BLENDING (averaging
 *     vacancy/rent/absorption ACROSS sectors — economically incoherent), NOT on
 *     surfacing them separately. Per-sector surfacing keeps sectors fully
 *     isolated: every join, median, and rollup downstream partitions by sector
 *     first, and each sector emits its own slug family (retail stays bare for
 *     backward compat; industrial/office carry a `_industrial` / `_office`
 *     suffix). ZERO cross-sector blending remains the standing rule.
 */
const SURFACED_SECTORS = ["retail", "industrial", "office"] as const;

/**
 * Default sector for legacy rows/fixtures that predate the `sector` column
 * (DB is NOT NULL today, but pre-migration fixtures and bare test literals may
 * omit it). Retail is the historical single-sector value, so an unlabelled row
 * is treated as retail — keeping its slug bare and its math unchanged.
 */
const LEGACY_SECTOR = "retail";

/** Normalized MarketBeat row — what Stage 2 / Stage 3 see. */
export interface MarketbeatSwflNormalized {
  kind: "marketbeat-swfl";
  /** Source provenance ('cw_marketbeat' | 'mhs_databook'). */
  source_name: string;
  /** Reporting submarket (e.g. "Naples", "Fort Myers"). */
  submarket: string;
  /**
   * Sector — retail | industrial | office (per-sector surfacing live 2026-06-08;
   * the live source filters to SURFACED_SECTORS). Downstream consumers MUST key
   * on this to keep sectors distinct — never blend across it. Optional so the
   * many fixture/tool literals that predate the field still type-check; an
   * absent value defaults to LEGACY_SECTOR ('retail').
   */
  sector?: string;
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
  /** NOT NULL, no default — must be 'cw_marketbeat' or 'mhs_databook'. */
  source_name: string;
  /**
   * Sector (retail/industrial/office). Live rows always carry it (DB NOT NULL,
   * and fetchLive filters to SURFACED_SECTORS). Optional here so legacy fixtures
   * that predate the column still type-check; consumers default to LEGACY_SECTOR.
   */
  sector?: string;
  submarket: string;
  quarter: string;
  /** 'submarket' | 'county'. Null for rows predating the 20260605 migration. */
  geographic_type?: string | null;
  vacancy_rate: number | null;
  asking_rent_nnn: number | null;
  absorption_sqft: number | null;
  source_url: string | null;
  /** Legacy whole-row gate (cw_marketbeat). Always false for mhs_databook rows. */
  verified: boolean;
  /** Per-field verification flags (mhs_databook rows only). */
  verified_vacancy?: boolean | null;
  verified_rents?: boolean | null;
  verified_absorption?: boolean | null;
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
 * Filter and deduplicate: pick the latest verified row per (sector, submarket).
 * Empty input → empty output. Exported for direct unit testing.
 *
 * Inclusion rule differs by source_name:
 *   cw_marketbeat — row included only when `verified = true` (legacy gate).
 *   mhs_databook  — `verified` is always false (staged); row included when any
 *                   per-field flag is true (verified_vacancy | verified_rents |
 *                   verified_absorption). This surfaces MHS vacancy/rent while
 *                   keeping absorption dark when verified_absorption is false.
 *
 * Collision-winner rule (20260605 migration): when cw_marketbeat and
 * mhs_databook share the same (sector, submarket, quarter) and both pass
 * inclusion, mhs_databook replaces cw_marketbeat.
 */
export function selectLatestVerifiedPerSubmarket(rows: MarketbeatRow[]): MarketbeatRow[] {
  const latest = new Map<string, MarketbeatRow>();
  for (const r of rows) {
    const isIncluded =
      r.source_name === "mhs_databook"
        ? r.verified_vacancy === true || r.verified_rents === true || r.verified_absorption === true
        : r.verified === true;
    if (!isIncluded) continue;
    // Key on sector + submarket so multi-sector rows never collide on submarket
    // alone. With per-sector surfacing live (2026-06-08) a submarket can hold a
    // retail AND an industrial AND an office row — each is its own latest-per
    // bucket here, never deduped against another sector.
    const key = `${r.sector ?? LEGACY_SECTOR}_${r.submarket}`;
    const prev = latest.get(key);
    if (prev == null || compareQuarter(r.quarter, prev.quarter) > 0) {
      latest.set(key, r);
    } else if (
      compareQuarter(r.quarter, prev.quarter) === 0 &&
      r.source_name === "mhs_databook" &&
      prev.source_name !== "mhs_databook"
    ) {
      latest.set(key, r);
    }
  }
  // Stable order: submarket name asc so fragment_id sequences are deterministic.
  return Array.from(latest.values()).sort((a, b) => a.submarket.localeCompare(b.submarket));
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
      "id, source_name, sector, submarket, quarter, geographic_type, vacancy_rate, asking_rent_nnn, absorption_sqft, source_url, verified, verified_vacancy, verified_rents, verified_absorption",
    )
    // No .eq("verified", true) — mhs_databook rows are always verified=false; per-field
    // gating happens in selectLatestVerifiedPerSubmarket and the normalization step.
    .in("sector", SURFACED_SECTORS as unknown as string[]) // per-sector (2026-06-08): retail + industrial + office, kept distinct downstream
    .order("quarter", { ascending: false });
  if (error) {
    throw new Error(`marketbeat-swfl: ${TABLE} fetch failed — ${error.message}`);
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
    const allRows = env.source === "fixture" ? await loadFixture() : await fetchLive();
    const rows = selectLatestVerifiedPerSubmarket(allRows);
    const fetched_at = isoTimestamp();
    return rows.map((row): RawFragment<MarketbeatSwflNormalized> => {
      const isMhs = row.source_name === "mhs_databook";
      const normalized: MarketbeatSwflNormalized = {
        kind: "marketbeat-swfl",
        source_name: row.source_name,
        submarket: row.submarket,
        sector: row.sector ?? LEGACY_SECTOR,
        quarter: row.quarter,
        // Per-field gating: MHS fields are nulled unless the matching per-field
        // flag is true. C&W fields pass through as-is (the row was already
        // inclusion-filtered on verified=true in selectLatestVerifiedPerSubmarket).
        vacancy_rate: isMhs ? (row.verified_vacancy ? row.vacancy_rate : null) : row.vacancy_rate,
        asking_rent_nnn: isMhs
          ? row.verified_rents
            ? row.asking_rent_nnn
            : null
          : row.asking_rent_nnn,
        absorption_sqft: isMhs
          ? row.verified_absorption
            ? row.absorption_sqft
            : null
          : row.absorption_sqft,
        source_url: row.source_url ?? marketbeatReceiptUrl(),
      };
      const idKey =
        row.id ??
        `${row.source_name}_${row.sector ?? LEGACY_SECTOR}_${row.submarket}_${row.quarter}`;
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
