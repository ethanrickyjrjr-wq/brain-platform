/**
 * Corridor character generator — Step 4 driver.
 *
 * Plan of record:
 *   docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md
 *   — Step 4 ("All 26 corridors, --preview first, operator 5-spot-check").
 *
 * Wires Stage A (build-corridor-fact-pack) → Stage B grounded NDJSON
 * (downloaded from lake-tier1 Supabase Storage to a local cache dir) →
 * Stage C synthesizer (synthesize-corridor-character). Dumps per-corridor
 * preview JSON to /tmp/cc-step4-preview/{slug}.json and prints a one-liner
 * per corridor so the operator can scan offline.
 *
 * --- Scope ---
 * Preview-only. Never writes to corridor_profiles (the synthesizer's
 * --write-db is intentionally unimplemented in v1). DB promotion happens
 * after the operator's 5-spot-check sign-off, in a follow-up PR.
 *
 * --- What this driver wires vs. what it leaves to gap_reason ---
 * Stage A inputs the driver hydrates from Supabase:
 *   - corridor          : corridor_profiles row → normalizeCorridor()
 *   - marketbeat_rows   : data_lake.marketbeat_swfl filtered by
 *                         submarketFor(corridor.name)
 *   - bls_laus          : data_lake.bls_laus → buildLausSwflSummary()
 * Stage A inputs left empty in v1 (fact pack fires gap_reason per metric):
 *   - zori_rows         : no corridor→ZIP map ships yet
 *   - nfip_year_rows    : no corridor→ZIP map ships yet
 *   - lee_permits       : no corridor→ZIP/geom map ships yet
 *   - fdot_aadt_rows    : no corridor→roadway map ships yet
 *   - prior_quarter_ctx : first run for all 26 — always null
 *
 * Per the plan's design (non-negotiable rule 3 + Stage A docstring), gap
 * fields are not "data unavailable" hedges — they're inference prompts
 * for the speculative block. The facts block stays silent on nulls. v2 of
 * this driver can wire the missing maps; v1 ships the generator and lets
 * operator judge the output quality.
 *
 * --- Grounded NDJSON cache ---
 * The synthesizer reads a local NDJSON path; the production grounded data
 * lives in lake-tier1 Supabase Storage. This driver lists every corridor's
 * latest inventory row, downloads the blob, writes it to
 * {grounded-dir}/corridor_grounded/{slug}/year=YYYY/month=MM/run-{ts}.ndjson,
 * and points the synthesizer at {grounded-dir}. The synthesizer's existing
 * resolveGroundedPath() walks the nested layout natively.
 *
 * CLI:
 *   bun refinery/tools/run-corridor-character-preview.mts                    # all 26
 *   bun refinery/tools/run-corridor-character-preview.mts --corridor="Pine Ridge Rd Naples"
 *   bun refinery/tools/run-corridor-character-preview.mts --output-dir=/tmp/foo
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeCorridor,
  type CorridorNormalized,
} from "../sources/cre-source.mts";
import { type MarketbeatSwflNormalized } from "../sources/marketbeat-swfl-source.mts";
import {
  buildLausSwflSummary,
  COLLIER_FIPS,
  FL_FIPS,
  LEE_FIPS,
  type DbRow as LausDbRow,
  type LausSwflSummary,
} from "../sources/bls-laus-source.mts";
import { submarketFor } from "../lib/marketbeat-submarket-aliases.mts";
import { getSupabase } from "../sources/supabase.mts";
import {
  buildCorridorFactPack,
  type BuildFactPackInput,
} from "./build-corridor-fact-pack.mts";
import {
  synthesizeCorridorCharacter,
  slug,
} from "./synthesize-corridor-character.mts";

const TIER1_BUCKET = "lake-tier1";
const GROUNDED_KEY_PREFIX = "corridor_grounded/";

const DEFAULT_GROUNDED_DIR = "/tmp/cc-step4-grounded";
const DEFAULT_OUTPUT_DIR = "/tmp/cc-step4-preview";

// ── CLI ─────────────────────────────────────────────────────────────────────

interface CliArgs {
  /** null = all 26; string[] of length 1+ = filter to these exact names. */
  corridorFilter: string[] | null;
  groundedDir: string;
  outputDir: string;
}

function parseCli(argv: readonly string[]): CliArgs {
  const out: CliArgs = {
    corridorFilter: null,
    groundedDir: DEFAULT_GROUNDED_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
  };
  for (const a of argv) {
    if (a.startsWith("--corridor=")) {
      // Single corridor — keep the verbatim shape for backwards compat.
      const v = a.slice("--corridor=".length).replace(/^"|"$/g, "");
      out.corridorFilter = [v];
    } else if (a.startsWith("--corridors=")) {
      // Comma-separated list for cheap iteration loops (5 spot-checks etc).
      // Names containing commas aren't supported — none of the 26 SWFL
      // corridor names contain a comma, so this is safe.
      const raw = a.slice("--corridors=".length).replace(/^"|"$/g, "");
      const names = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (names.length === 0) {
        throw new Error(
          `run-corridor-character-preview: --corridors= must include at least one name.`,
        );
      }
      out.corridorFilter = names;
    } else if (a.startsWith("--grounded-dir=")) {
      out.groundedDir = a.slice("--grounded-dir=".length);
    } else if (a.startsWith("--output-dir=")) {
      out.outputDir = a.slice("--output-dir=".length);
    } else if (a === "--help" || a === "-h") {
      // handled in main()
    } else {
      throw new Error(
        `run-corridor-character-preview: unknown argument "${a}". ` +
          `Use --corridor="NAME" or --corridors="A,B,C" --grounded-dir=DIR --output-dir=DIR.`,
      );
    }
  }
  return out;
}

const USAGE = `Usage:
  bun refinery/tools/run-corridor-character-preview.mts [flags]

Flags:
  --corridor=NAME      Run for one corridor by exact corridor_name. Default: all 26.
  --corridors=A,B,C    Run for a comma-separated subset (cheap iteration loops).
  --grounded-dir=DIR   Local cache dir for grounded NDJSON downloads.
                       Default: ${DEFAULT_GROUNDED_DIR}
  --output-dir=DIR     Where per-corridor preview JSON gets written.
                       Default: ${DEFAULT_OUTPUT_DIR}

Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY in .env.local.
Preview-only — no DB writes.`;

// ── Supabase pulls ──────────────────────────────────────────────────────────

interface CorridorRow {
  corridor_name: string;
  [k: string]: unknown;
}

async function fetchCorridorRows(
  filter: string[] | null,
): Promise<CorridorRow[]> {
  const supa = getSupabase();
  let q = supa
    .from("corridor_profiles")
    .select("*")
    .is("deleted_at", null)
    .eq("verification_status", "verified");
  if (filter) q = q.in("corridor_name", filter);
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

/**
 * Live BLS LAUS pull for the three FIPS scopes the LAUS summary needs.
 * Returns raw DbRow[] across FL + Lee + Collier × measure codes 03/04/05/06.
 * Caller hands the rows to `buildLausSwflSummary` (the source-of-truth pure
 * function exported from bls-laus-source.mts) — no local FIPS or summary
 * logic copies live here, intentionally. The source's COLS string lists
 * every column the DbRow interface requires.
 */
async function fetchLausRowsLive(): Promise<LausDbRow[]> {
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

// ── Grounded NDJSON download ────────────────────────────────────────────────

interface InventoryRow {
  id: string;
  path: string;
  updated_at: string;
  byte_size: number;
}

/**
 * Find the latest grounded NDJSON inventory row for a corridor slug.
 * Returns null when none exists — caller decides whether to skip or throw.
 */
async function findLatestGroundedInventory(
  corridorSlug: string,
): Promise<InventoryRow | null> {
  const prefix = `${TIER1_BUCKET}/${GROUNDED_KEY_PREFIX}${corridorSlug}/`;
  const { data, error } = await getSupabase()
    .schema("data_lake")
    .from("_tier1_inventory")
    .select("id, path, updated_at, byte_size")
    .like("id", `${prefix}%`)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error)
    throw new Error(
      `_tier1_inventory lookup failed for ${corridorSlug} — ${error.message}`,
    );
  return ((data ?? []) as InventoryRow[])[0] ?? null;
}

/**
 * Download a grounded NDJSON blob from lake-tier1 to {groundedDir}/{path}.
 * Mirrors Supabase Storage's nested layout so the synthesizer's
 * resolveGroundedPath() reads it natively.
 */
async function downloadGroundedNdjson(
  inv: InventoryRow,
  groundedDir: string,
): Promise<string> {
  const supa = getSupabase();
  const { data, error } = await supa.storage
    .from(TIER1_BUCKET)
    .download(inv.path);
  if (error)
    throw new Error(
      `storage download failed for ${inv.path} — ${error.message}`,
    );
  const bytes = Buffer.from(await data.arrayBuffer());
  const localPath = path.join(groundedDir, inv.path);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, bytes);
  return localPath;
}

// ── Stage A driver ──────────────────────────────────────────────────────────

interface PreviewResult {
  corridor: string;
  slug: string;
  county: "Lee" | "Collier" | "Unknown";
  /** True when the run completed AND the lint passed. */
  ok: boolean;
  /** True when the run completed but the lint rejected the model output.
   *  Distinguished from `error` (which is fatal — e.g. missing grounded NDJSON). */
  lintRejected?: boolean;
  factsChars?: number;
  specChars?: number;
  internalCites?: number;
  webCites?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  vintage?: string;
  outputPath?: string;
  lintErrors?: string[];
  error?: string;
}

async function runOneCorridor(
  corridor: CorridorNormalized,
  rawRow: CorridorRow,
  allMarketbeat: MarketbeatRow[],
  blsLausSummary: LausSwflSummary,
  groundedDir: string,
  outputDir: string,
  generatedAt: string,
): Promise<PreviewResult> {
  const corridorSlug = slug(corridor.name);
  const result: PreviewResult = {
    corridor: corridor.name,
    slug: corridorSlug,
    county: corridor.county,
    ok: false,
  };

  try {
    // Stage A: assemble inputs for the fact pack.
    // Pass the FULL verified history (oldest→newest) for the submarket — the
    // fact pack's buildMarketbeatYoy needs both the latest quarter and the
    // prior-year same quarter to compute YoY deltas. Do NOT use
    // selectLatestVerifiedPerSubmarket here (it'd kill the prior-year row).
    const submarket = submarketFor(corridor.name as never);
    const mbRows: MarketbeatSwflNormalized[] = submarket
      ? allMarketbeat
          .filter((r) => r.submarket === submarket)
          .sort((a, b) => a.quarter.localeCompare(b.quarter))
          .map((r) => ({
            kind: "marketbeat-swfl",
            submarket: r.submarket,
            quarter: r.quarter,
            vacancy_rate: r.vacancy_rate,
            asking_rent_nnn: r.asking_rent_nnn,
            absorption_sqft: r.absorption_sqft,
            source_url: r.source_url,
          }))
      : [];

    // Stage B: ensure the grounded NDJSON is on disk for the synthesizer.
    const inv = await findLatestGroundedInventory(corridorSlug);
    if (!inv) {
      throw new Error(
        `no _tier1_inventory row for slug "${corridorSlug}" — ` +
          `run python -m ingest.pipelines.corridor_grounded.pipeline --corridor "${corridor.name}" first.`,
      );
    }
    await downloadGroundedNdjson(inv, groundedDir);

    // Prior-quarter context: first run, always null. character_facts and
    // character_speculative columns were added by the Step 2 migration but
    // never populated; reading them would return null anyway.
    const priorQuarterContext = null;

    const factPack = buildCorridorFactPack({
      corridor,
      marketbeat_submarket_rows: mbRows,
      bls_laus: blsLausSummary,
      zori_rows: [],
      nfip_year_rows: [],
      lee_permits: [],
      fdot_aadt_rows: [],
      prior_quarter_context: priorQuarterContext,
      generated_at: generatedAt,
    });

    // Stage C: synthesize. Preview mode — capture lint rejections to disk
    // instead of throwing them, so the operator can scan offline and judge
    // whether the prompt + lint pair are converging on each corridor.
    const synth = await synthesizeCorridorCharacter({
      factPack,
      groundedNdjsonPath: path.join(groundedDir, inv.path),
      priorQuarter: priorQuarterContext,
      acceptLintFailure: true,
    });

    // Persist the preview JSON regardless of lint outcome. Lint failures
    // get a `.rejected.json` suffix so the operator can distinguish at a
    // glance which corridors need prompt iteration vs. spot-check review.
    const passed = synth.lint.ok;
    const outName = passed
      ? `${corridorSlug}.json`
      : `${corridorSlug}.rejected.json`;
    const outPath = path.join(outputDir, outName);
    await writeFile(
      outPath,
      JSON.stringify(
        {
          corridor_name: corridor.name,
          slug: corridorSlug,
          county: corridor.county,
          generated_at: generatedAt,
          fact_pack_vintage: factPack.fact_pack_vintage,
          lint_ok: passed,
          lint_errors: passed ? null : synth.lint.flat_errors,
          output: synth.output,
          usage: synth.usage,
          // The full fact pack is bundled too — operator can scan what
          // sourced data underwrote the synthesis.
          fact_pack: factPack,
        },
        null,
        2,
      ),
      "utf-8",
    );

    result.ok = passed;
    result.lintRejected = !passed;
    result.factsChars = synth.output.facts_block.length;
    result.specChars = synth.output.speculative_block.length;
    result.internalCites = synth.output.citations.internal.length;
    result.webCites = synth.output.citations.web.length;
    result.inputTokens = synth.usage.input_tokens;
    result.outputTokens = synth.usage.output_tokens;
    result.vintage = factPack.fact_pack_vintage;
    result.outputPath = outPath;
    if (!passed) result.lintErrors = synth.lint.flat_errors;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}

function formatOneLiner(r: PreviewResult): string {
  if (r.error) {
    return `  ✗ ${r.corridor} | ERROR: ${r.error}`;
  }
  const status = r.ok ? "✓" : "⚠ lint-rejected";
  const errs =
    r.lintRejected && r.lintErrors ? ` | ${r.lintErrors.length} lint err` : "";
  const tokens =
    r.inputTokens != null
      ? ` | ${r.inputTokens}in/${r.outputTokens}out tok`
      : "";
  return `  ${status} ${r.corridor} | facts:${r.factsChars}chars | spec:${r.specChars}chars | citations: ${r.internalCites}/${r.webCites} | vintage: ${r.vintage}${tokens}${errs}`;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }

  let args: CliArgs;
  try {
    args = parseCli(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    console.error("\n" + USAGE);
    return 2;
  }

  // Make sure the output dir exists once; per-file mkdir would race.
  await mkdir(args.outputDir, { recursive: true });
  await mkdir(args.groundedDir, { recursive: true });

  console.log(`run-corridor-character-preview:`);
  console.log(
    `  corridor filter   : ${args.corridorFilter ? args.corridorFilter.join(", ") : "(all 26)"}`,
  );
  console.log(`  grounded cache    : ${args.groundedDir}`);
  console.log(`  preview output    : ${args.outputDir}`);

  // Fetch global data once.
  console.log(`  fetching corridor_profiles + marketbeat_swfl + bls_laus...`);
  const [corridorRows, allMarketbeat, lausRows] = await Promise.all([
    fetchCorridorRows(args.corridorFilter),
    fetchAllMarketbeatRows(),
    fetchLausRowsLive(),
  ]);
  const blsLausSummary = buildLausSwflSummary(lausRows);

  if (corridorRows.length === 0) {
    const hint = args.corridorFilter
      ? ` — filter [${args.corridorFilter.join(", ")}] matched no verified rows.`
      : "";
    console.error(
      `run-corridor-character-preview: 0 corridors to process${hint}.`,
    );
    return 2;
  }

  console.log(
    `  corridors: ${corridorRows.length} | marketbeat rows: ${allMarketbeat.length} | bls_laus reference: ${blsLausSummary.reference_month ?? "(none)"}`,
  );
  console.log("");

  const generatedAt = new Date().toISOString();
  const results: PreviewResult[] = [];
  let i = 0;
  for (const row of corridorRows) {
    i += 1;
    const corridor = normalizeCorridor(row);
    process.stdout.write(`[${i}/${corridorRows.length}] ${corridor.name}... `);
    const r = await runOneCorridor(
      corridor,
      row,
      allMarketbeat,
      blsLausSummary,
      args.groundedDir,
      args.outputDir,
      generatedAt,
    );
    results.push(r);
    console.log(r.ok ? "ok" : `ERROR (${r.error})`);
  }

  console.log("\n── Per-corridor summary ─────────────────────────────────");
  for (const r of results) {
    console.log(formatOneLiner(r));
  }

  const okCount = results.filter((r) => r.ok).length;
  const errCount = results.length - okCount;
  console.log(
    `\nrun-corridor-character-preview: ${okCount} ok / ${errCount} errored (of ${results.length} total).`,
  );
  console.log(`Preview JSON dumped under: ${args.outputDir}`);

  return errCount > 0 ? 1 : 0;
}

// CLI-detect idiom matching refinery/tools/render-roles.mts (works under
// both `bun script.mts` and `node script.mts`; `import.meta.main` is
// Bun-only and tsc rejects it).
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
