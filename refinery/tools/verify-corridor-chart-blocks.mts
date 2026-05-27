/**
 * Chart-block provenance verifier — read-only audit tool (Step 4.5).
 *
 * Pulls every corridor_profiles row that carries a character_chart JSONB
 * block (generated during Step 4) and checks each numeric cell against the
 * corridor's current fact-pack numbers using the same ±5% tolerance that
 * lintChartBlock enforces at synthesis time.
 *
 * Purpose: confirm that the PR #42 chart-block lint hardening covers the
 * existing 25 in-DB rows (generated before the hardening). A cell that
 * fails means an external peer value (Tampa vacancy, national average, etc.)
 * slipped through, and that corridor must be regenerated under the hardened
 * lint.
 *
 * Usage:
 *   bun refinery/tools/verify-corridor-chart-blocks.mts
 *   bun refinery/tools/verify-corridor-chart-blocks.mts --corridor="Six Mile Cypress Pkwy"
 *
 * Exit code 0 = all charts pass (or no charts present).
 * Exit code 1 = one or more charts fail provenance.
 */

import path from "node:path";

import { getSupabase } from "../sources/supabase.mts";
import { normalizeCorridor } from "../sources/cre-source.mts";
import {
  buildLausSwflSummary,
  COLLIER_FIPS,
  FL_FIPS,
  LEE_FIPS,
  type DbRow as LausDbRow,
  type LausSwflSummary,
} from "../sources/bls-laus-source.mts";
import { buildCorridorFactPack } from "./build-corridor-fact-pack.mts";
import { submarketFor } from "../lib/marketbeat-submarket-aliases.mts";
import { lintChartBlock } from "../validate/chart-block-lint.mts";
import { collectFactPackNumbers } from "../validate/speculative-block-lint.mts";
import type { MarketbeatSwflNormalized } from "../sources/marketbeat-swfl-source.mts";

// ── DB pulls ─────────────────────────────────────────────────────────────────

interface CorridorRow {
  corridor_name: string;
  [k: string]: unknown;
}

async function fetchCorridorRows(
  filter: string | null,
): Promise<CorridorRow[]> {
  const supa = getSupabase();
  let q = supa
    .from("corridor_profiles")
    .select("*")
    .is("deleted_at", null)
    .eq("verification_status", "verified")
    .not("character_chart", "is", null);
  if (filter) q = q.eq("corridor_name", filter);
  const { data, error } = await q;
  if (error)
    throw new Error(`corridor_profiles fetch failed — ${error.message}`);
  return (data ?? []) as CorridorRow[];
}

interface MarketbeatRow {
  submarket: string;
  quarter: string;
  vacancy_rate: number | null;
  asking_rent_nnn: number | null;
  absorption_sqft: number | null;
  source_url: string | null;
  verified: boolean | null;
}

async function fetchAllMarketbeatRows(): Promise<MarketbeatRow[]> {
  const { data, error } = await getSupabase()
    .schema("data_lake")
    .from("marketbeat_swfl")
    .select(
      "submarket, quarter, vacancy_rate, asking_rent_nnn, absorption_sqft, source_url, verified",
    )
    .eq("verified", true)
    .order("quarter", { ascending: false });
  if (error) throw new Error(`marketbeat_swfl fetch failed — ${error.message}`);
  return (data ?? []) as MarketbeatRow[];
}

async function fetchLausRows(): Promise<LausDbRow[]> {
  const COLS =
    "series_id, area_fips, measure_code, measure_label, year, period, period_name, value, footnote_codes, _ingested_at";
  const sb = getSupabase().schema("data_lake");
  const [flResp, leeResp, collierResp] = await Promise.all([
    sb
      .from("bls_laus")
      .select(COLS)
      .eq("area_fips", FL_FIPS)
      .in("measure_code", ["03", "04", "05", "06"])
      .order("year")
      .order("period"),
    sb
      .from("bls_laus")
      .select(COLS)
      .eq("area_fips", LEE_FIPS)
      .in("measure_code", ["03", "04", "05", "06"])
      .order("year")
      .order("period"),
    sb
      .from("bls_laus")
      .select(COLS)
      .eq("area_fips", COLLIER_FIPS)
      .in("measure_code", ["03", "04", "05", "06"])
      .order("year")
      .order("period"),
  ]);
  for (const [name, resp] of [
    ["FL", flResp],
    ["Lee", leeResp],
    ["Collier", collierResp],
  ] as const) {
    if (resp.error)
      throw new Error(`bls_laus ${name} fetch failed — ${resp.error.message}`);
  }
  return [
    ...((flResp.data ?? []) as LausDbRow[]),
    ...((leeResp.data ?? []) as LausDbRow[]),
    ...((collierResp.data ?? []) as LausDbRow[]),
  ];
}

// ── Verification ─────────────────────────────────────────────────────────────

interface VerifyResult {
  corridor: string;
  corridor_type: string | null;
  chart_present: boolean;
  /** true = all numeric cells trace to fact pack; false = one or more provenance failures */
  ok: boolean;
  fact_pack_numbers: number[];
  lint_errors: string[];
  error?: string;
}

async function verifyOneCorridor(
  raw: CorridorRow,
  allMarketbeat: MarketbeatRow[],
  blsLausSummary: LausSwflSummary,
  generatedAt: string,
): Promise<VerifyResult> {
  const name = raw.corridor_name;
  const corridorType = (raw.corridor_type as string | null) ?? null;
  const result: VerifyResult = {
    corridor: name,
    corridor_type: corridorType,
    chart_present: raw.character_chart != null,
    ok: false,
    fact_pack_numbers: [],
    lint_errors: [],
  };

  if (!result.chart_present) {
    result.ok = true;
    return result;
  }

  try {
    const corridor = normalizeCorridor(
      raw as Parameters<typeof normalizeCorridor>[0],
    );

    const submarket = submarketFor(corridor.name as never);
    const mbRows: MarketbeatSwflNormalized[] = submarket
      ? allMarketbeat
          .filter((r) => r.submarket === submarket)
          .sort((a, b) => a.quarter.localeCompare(b.quarter))
          .map((r) => ({
            kind: "marketbeat-swfl" as const,
            submarket: r.submarket,
            quarter: r.quarter,
            vacancy_rate: r.vacancy_rate,
            asking_rent_nnn: r.asking_rent_nnn,
            absorption_sqft: r.absorption_sqft,
            source_url: r.source_url,
          }))
      : [];

    const factPack = buildCorridorFactPack({
      corridor,
      marketbeat_submarket_rows: mbRows,
      bls_laus: blsLausSummary,
      zori_rows: [],
      nfip_year_rows: [],
      lee_permits: [],
      fdot_aadt_rows: [],
      prior_quarter_context: null,
      generated_at: generatedAt,
    });

    const factPackNumbers = collectFactPackNumbers(factPack);
    result.fact_pack_numbers = [...factPackNumbers].sort((a, b) => a - b);

    const chartBlock = raw.character_chart;
    const lint = lintChartBlock(chartBlock, factPackNumbers);
    result.ok = lint.ok;
    result.lint_errors = lint.errors;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const corridorFilter = (() => {
    const arg = argv.find((a) => a.startsWith("--corridor="));
    return arg ? arg.slice("--corridor=".length).replace(/^"|"$/g, "") : null;
  })();

  console.log("=== Chart-block provenance audit ===");
  console.log(
    `Scope: ${corridorFilter ?? "all corridors with character_chart"}`,
  );
  console.log("Fetching DB rows...\n");

  const [corridorRows, allMarketbeat, lausRows] = await Promise.all([
    fetchCorridorRows(corridorFilter),
    fetchAllMarketbeatRows(),
    fetchLausRows(),
  ]);

  if (corridorRows.length === 0) {
    console.log(
      "No corridor_profiles rows found with character_chart populated.",
    );
    return 0;
  }

  const blsLausSummary = buildLausSwflSummary(lausRows);
  const generatedAt = new Date().toISOString();

  console.log(`Verifying ${corridorRows.length} corridors...\n`);

  const results: VerifyResult[] = [];
  for (const row of corridorRows) {
    const r = await verifyOneCorridor(
      row,
      allMarketbeat,
      blsLausSummary,
      generatedAt,
    );
    results.push(r);
    const icon = r.error ? "✗ ERROR" : r.ok ? "✓ PASS" : "✗ FAIL";
    console.log(`  ${icon}  ${r.corridor} (${r.corridor_type ?? "?"})`);
    if (r.error) console.log(`         Error: ${r.error}`);
    if (!r.ok && r.lint_errors.length > 0) {
      for (const e of r.lint_errors) console.log(`         ${e}`);
    }
  }

  const passed = results.filter((r) => !r.error && r.ok);
  const failed = results.filter((r) => !r.error && !r.ok);
  const errors = results.filter((r) => !!r.error);

  console.log(`\n=== Summary ===`);
  console.log(`  ✓ Pass:  ${passed.length}`);
  console.log(`  ✗ Fail:  ${failed.length}`);
  if (errors.length > 0) console.log(`  ! Error: ${errors.length}`);

  if (failed.length > 0) {
    console.log(`\nCorridors needing regeneration (chart fails provenance):`);
    for (const r of failed) {
      console.log(`  • ${r.corridor}`);
    }
    console.log(
      `\nFact-pack numbers used for verification are only corridor_profiles`,
    );
    console.log(
      `metrics + BLS unemployment. External peer values (Tampa, Orlando,`,
    );
    console.log(
      `national averages) are not in any fact pack — those cells always fail.`,
    );
  }

  return failed.length > 0 || errors.length > 0 ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
