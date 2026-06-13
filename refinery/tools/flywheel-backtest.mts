// refinery/tools/flywheel-backtest.mts
//
// The Glass §2 — flywheel backtest engine (as-of grid → backtest_grades corpus).
//
// Takes the deterministic decision function from the Ian demo's N≈1 to N=hundreds,
// over the ONLY series we can reconstruct point-in-time without look-ahead: the
// ALFRED LAUS vintaged unemployment rates (Lee FLLEEC7URN, Collier FLCOLL0URN). For
// a regular monthly as-of grid it makes the call the system WOULD have made then and
// grades it against what actually happened a window later — all from data already in
// the lake (the future is the past now).
//
// REUSE, not rebuild: the call (computeBacktestCall), the realized direction
// (computeDirection), the grade-config (resolveGradeConfig), the skill metric
// (computeSkillScore) all already exist + are tested. The genuinely new code is the
// as-of loop here + the pure PIT/grade math in refinery/lib/backtest/grid.mts.
//
// HONESTY (flywheel guardrails — break one and the corpus is fiction):
//   • Only point-in-time-honest series. ALFRED LAUS only. Everything else is in the
//     EXCLUDED log below — printed, never silently dropped.
//   • grade_method='retrodicted', written to backtest_grades ONLY — never
//     predictions/outcomes. A retrodicted % is never a public accuracy claim.
//   • Report N with every number.
//
// EXCLUDED (logged, see printExclusions): LeePA sale-velocity (leepa_parcels keeps
// only the most-recent qualified sale per parcel → a multi-year yearly grid
// systematically undercounts older years; the Ian demo used it at N=1 as an accepted
// caveat, but it is NOT honest as a grid); Lee building permits (issue-date is
// immutable so it COULD qualify, but the vocab slug carries no grade block →
// ungradeable, and the live window is thin); ZORI / Census ACS / BLS QCEW / TDT
// (revised or fixture-only, no retained vintages).
//
// Usage:
//   bun refinery/tools/flywheel-backtest.mts --dry-run     # compute + report, no write
//   bun refinery/tools/flywheel-backtest.mts               # write/upsert backtest_grades
//   bun refinery/tools/flywheel-backtest.mts --snapshot 2026-06   # pin a parquet vintage
// Requires in .env.local (Bun auto-loads): SUPABASE_S3_ENDPOINT / _ACCESS_KEY_ID /
// _SECRET_ACCESS_KEY (ALFRED parquet via DuckDB httpfs) and, for writes,
// SUPABASE_URL + SUPABASE_SERVICE_KEY.

import { DuckDBInstance } from "@duckdb/node-api";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import {
  initialVintages,
  monthlyGrid,
  buildGradedCall,
  type Vintage,
  type GradedBacktestCall,
} from "../lib/backtest/grid.mts";
import { computeSkillScore, type ScoredCall } from "../lib/backtest/skill-baseline.mts";
import { resolveGradeConfig } from "../vocab/loader.mts";

// ── Backtestable universe (honest, point-in-time) ───────────────────────────────
interface BacktestSeries {
  slug: string;
  series_id: string;
  family: string;
}
const BACKTESTABLE: BacktestSeries[] = [
  {
    slug: "laus_lee_unemployment_rate_initial_vintage",
    series_id: "FLLEEC7URN",
    family: "laus_lee",
  },
  {
    slug: "laus_collier_unemployment_rate_initial_vintage",
    series_id: "FLCOLL0URN",
    family: "laus_collier",
  },
];

const EXCLUDED: Array<{ signal: string; reason: string }> = [
  {
    signal: "LeePA sale-velocity",
    reason:
      "leepa_parcels keeps only the latest qualified sale per parcel → a yearly grid undercounts older years (not PIT-honest as a grid)",
  },
  {
    signal: "Lee building permits",
    reason:
      "issue-date is immutable but the vocab slug has no grade block (ungradeable) + thin live window",
  },
  {
    signal: "ZHVI home values / ZORI rents",
    reason:
      "Zillow re-writes history & publishes no vintages. As of 2026-06 we self-capture " +
      "point-in-time monthly into data_lake.view_vintages (ingest/scripts/capture_view_vintages.py, " +
      "cron view-vintages-monthly). STILL EXCLUDED until ~9mo of real captures accrue — the " +
      "EXCLUDED→BACKTESTABLE flip is §08c (gated; flipping on near-zero N = phantom grades). " +
      "Reader refinery/lib/backtest/view-vintage-reader.mts is built but UNWIRED.",
  },
  {
    signal: "Census ACS / BLS QCEW",
    reason: "benchmark-revised aggregates; no point-in-time archive held",
  },
  { signal: "TDT collections", reason: "fixture-only; self-ingest still pending" },
];

// ── Two coupled knobs, set for an HONEST skill test (see grid.monthlyGrid doc) ───
//
//   GRID_MONTH_STEP — quarterly (3 months ≈ 90d). MUST be >= the grade window (90d
//   for macro) so consecutive target windows do NOT overlap. With a smaller step the
//   persistence-null baseline peeks past the as-of date (look-ahead) and is
//   unbeatable for the wrong reason — that exact bug turned a monthly grid's lift
//   negative on the first pass. Quarterly over ~18 yr ≈ 73 calls/series.
//
//   LOOKBACK_DAYS — the call's delta-basis trend window. MUST differ from the grade
//   window (90d): if it equalled 90, the system call (dir of [T-90,T]) would be
//   identical to the prior quarter's realized move (the persistence null) and lift
//   would be 0 by construction. 180 = "does the 6-month trend beat last-quarter
//   carry-forward" — a pre-registered hypothesis, NOT tuned to win. We report the
//   lift that results, positive or negative (the plan anticipates ≤0 as a real
//   finding: the call logic needs work before weighting does).
//
// Both overridable: --step-months N  /  --lookback DAYS.
const DEFAULT_GRID_MONTH_STEP = 3;
const DEFAULT_LOOKBACK_DAYS = 180;

// Pinned ALFRED snapshot (reproducible, like the Ian demo). Override with --snapshot.
const DEFAULT_SNAPSHOT = "2026-06";

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

// ── ALFRED parquet read (DuckDB httpfs) ─────────────────────────────────────────
async function connectDuckDB() {
  const required = [
    "SUPABASE_S3_ENDPOINT",
    "SUPABASE_S3_ACCESS_KEY_ID",
    "SUPABASE_S3_SECRET_ACCESS_KEY",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `flywheel-backtest: missing S3 env var(s): ${missing.join(", ")}. Set them in .env.local.`,
    );
  }
  const endpoint = process.env.SUPABASE_S3_ENDPOINT!.replace(/^https?:\/\//, "");
  const esc = (s: string): string => s.replace(/'/g, "''");
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await connection.run("INSTALL httpfs; LOAD httpfs;");
  await connection.run(`
    SET s3_endpoint='${esc(endpoint)}';
    SET s3_access_key_id='${esc(process.env.SUPABASE_S3_ACCESS_KEY_ID!)}';
    SET s3_secret_access_key='${esc(process.env.SUPABASE_S3_SECRET_ACCESS_KEY!)}';
    SET s3_region='us-east-1';
    SET s3_url_style='path';
    SET s3_use_ssl=true;
  `);
  return connection;
}

async function readVintages(
  connection: Awaited<ReturnType<typeof connectDuckDB>>,
  parquetUrl: string,
  seriesId: string,
): Promise<Vintage[]> {
  const esc = (s: string): string => s.replace(/'/g, "''");
  const reader = await connection.runAndReadAll(`
    SELECT
      CAST(observation_date AS DATE) AS observation_date,
      value,
      CAST(realtime_start AS DATE) AS realtime_start
    FROM read_parquet('${esc(parquetUrl)}')
    WHERE series_id = '${esc(seriesId)}'
      AND value IS NOT NULL
    ORDER BY observation_date, realtime_start
  `);
  return reader.getRowObjects().map((r) => ({
    observation_date: String(r["observation_date"]).slice(0, 10),
    value: Number(r["value"]),
    realtime_start: String(r["realtime_start"]).slice(0, 10),
  }));
}

// ── reporting helpers ───────────────────────────────────────────────────────────
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

interface CalibrationBand {
  band: string;
  n: number;
  hits: number;
  misses: number;
  hit_rate: number | null; // null when no directional outcome in the band
}

/** 5 confidence bands over [0.5, 1.0]; hit-rate over directional-observed calls only. */
function calibration(rows: GradedBacktestCall[]): CalibrationBand[] {
  const edges = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
  const bands: CalibrationBand[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const inBand = rows.filter((r) => r.confidence >= lo && r.confidence < hi);
    const hits = inBand.filter((r) => r.grade === "hit").length;
    const misses = inBand.filter((r) => r.grade === "miss").length;
    const decided = hits + misses;
    bands.push({
      band: `${lo.toFixed(1)}–${(i === edges.length - 2 ? 1.0 : hi).toFixed(1)}`,
      n: inBand.length,
      hits,
      misses,
      hit_rate: decided > 0 ? hits / decided : null,
    });
  }
  return bands;
}

// ── write ───────────────────────────────────────────────────────────────────────
async function upsertGrades(rows: GradedBacktestCall[]): Promise<number> {
  const url = process.env.SUPABASE_URL ?? process.env.BRAINS_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.BRAINS_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "flywheel-backtest: SUPABASE_URL / SUPABASE_SERVICE_KEY not set — cannot write (use --dry-run).",
    );
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const dbRows = rows.map((r) => ({
    slug: r.slug,
    family: r.family,
    as_of_date: r.as_of_date,
    predicted_direction: r.predicted_direction,
    baseline_value: r.baseline_value,
    prior_value: r.prior_value,
    window_days: r.window_days,
    window_end_date: r.window_end_date,
    observed_value: r.observed_value,
    observed_direction: r.observed_direction,
    grade: r.grade,
    magnitude_error: r.magnitude_error,
    confidence: Number(r.confidence.toFixed(3)),
    source_tag: r.source_tag,
    grade_method: "retrodicted" as const,
  }));
  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < dbRows.length; i += CHUNK) {
    const chunk = dbRows.slice(i, i + CHUNK);
    const { error } = await sb
      .from("backtest_grades")
      .upsert(chunk, { onConflict: "slug,as_of_date,grade_method" });
    if (error) throw new Error(`backtest_grades upsert failed: ${error.message}`);
    written += chunk.length;
  }
  return written;
}

// ── main ─────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const snapshot = arg("--snapshot") ?? DEFAULT_SNAPSHOT;
  const lookbackDays = Number(arg("--lookback") ?? DEFAULT_LOOKBACK_DAYS);
  const monthStep = Number(arg("--step-months") ?? DEFAULT_GRID_MONTH_STEP);
  const parquetUrl = `s3://lake-tier1/macro/fred_laus_alfred/${snapshot}.parquet`;

  console.log("================================================================");
  console.log("  FLYWHEEL BACKTEST — retrodicted grade corpus (The Glass §2)");
  console.log(
    `  snapshot=${snapshot}  lookback=${lookbackDays}d  grid-step=${monthStep}mo  ${dryRun ? "[DRY-RUN]" : "[WRITE]"}`,
  );
  console.log("================================================================");

  const connection = await connectDuckDB();
  const allRows: GradedBacktestCall[] = [];
  const perSlug: Record<string, number> = {};

  for (const series of BACKTESTABLE) {
    const cfg = resolveGradeConfig(series.slug);
    if (!cfg.gradeable || cfg.window_days == null) {
      console.log(`\n[SKIP] ${series.slug} — not gradeable (${cfg.reason ?? "no window"})`);
      continue;
    }
    const raw = await readVintages(connection, parquetUrl, series.series_id);
    const initials = initialVintages(raw);
    if (initials.length === 0) {
      console.log(`\n[SKIP] ${series.slug} — no vintages in ${parquetUrl}`);
      continue;
    }
    // Grid bounds from the realtime span: start a window after the first publication
    // (so a prior + as-of are resolvable), end at the last publication.
    const realtimes = initials.map((v) => v.realtime_start).sort();
    const startYM = realtimes[0].slice(0, 7);
    const endYM = realtimes[realtimes.length - 1].slice(0, 7);
    const grid = monthlyGrid(startYM, endYM, 15, monthStep);

    let n = 0;
    for (const asOf of grid) {
      const row = buildGradedCall(series.slug, asOf, initials, cfg, {
        family: series.family,
        source_tag: "lake_tier1",
        lookbackDays,
      });
      if (row) {
        allRows.push(row);
        n++;
      }
    }
    perSlug[series.slug] = n;
    console.log(
      `\n[${series.slug}]  series=${series.series_id}  vintages=${raw.length}  ` +
        `obs=${initials.length}  grid=${grid.length} months  →  ${n} graded calls`,
    );
  }
  connection.closeSync();

  if (allRows.length === 0) {
    console.error("\nNo graded calls produced — aborting (nothing to write).");
    process.exit(1);
  }

  // ── skill (lift over persistence null) ─────────────────────────────────────────
  const scored: ScoredCall[] = allRows.map((r) => ({
    slug: r.slug,
    family: r.family,
    as_of_date: r.as_of_date,
    predicted: r.predicted_direction,
    observed: r.observed_direction,
    correct: r.predicted_direction === r.observed_direction,
    source_tag: r.source_tag,
  }));
  const skill = computeSkillScore(scored);

  // ── grade tally ────────────────────────────────────────────────────────────────
  const tally = { hit: 0, miss: 0, neutral: 0, partial: 0 } as Record<string, number>;
  for (const r of allRows) tally[r.grade]++;

  console.log("\n----------------------------------------------------------------");
  console.log(`CORPUS: ${allRows.length} graded calls across ${Object.keys(perSlug).length} slugs`);
  for (const [slug, n] of Object.entries(perSlug)) console.log(`   ${slug}: N=${n}`);
  console.log(
    `GRADES: hit=${tally.hit} miss=${tally.miss} neutral=${tally.neutral} partial=${tally.partial}`,
  );

  console.log("\nSKILL (directional, persistence-null baseline):");
  console.log(
    `   scored N (non-first, non-neutral target) = ${skill.n_calls}  | families = ${skill.n_families}`,
  );
  console.log(`   system accuracy      = ${pct(skill.system_accuracy)} (N=${skill.n_calls})`);
  console.log(`   persistence accuracy = ${pct(skill.persistence_accuracy)} (N=${skill.n_calls})`);
  console.log(`   LIFT (system − naive)= ${(skill.lift * 100).toFixed(1)} pp`);
  console.log(
    `   BEATS NAIVE? ${skill.lift > 0 ? "YES" : skill.lift === 0 ? "TIE" : "NO — the call logic needs work before weighting does"}`,
  );

  console.log("\nCALIBRATION (confidence band → hit-rate over decided calls; N stamped):");
  for (const b of calibration(allRows)) {
    const hr = b.hit_rate == null ? "—" : pct(b.hit_rate);
    console.log(`   ${b.band}: hit-rate ${hr} (decided=${b.hits + b.misses}, total N=${b.n})`);
  }

  console.log("\nEXCLUDED (look-ahead / ungradeable — logged, not silently dropped):");
  for (const e of EXCLUDED) console.log(`   ⛔ ${e.signal} — ${e.reason}`);

  if (dryRun) {
    console.log("\n[DRY-RUN] computed only — no rows written.");
  } else {
    const written = await upsertGrades(allRows);
    console.log(
      `\n[WRITE] upserted ${written} rows into public.backtest_grades (idempotent on slug,as_of_date,grade_method).`,
    );
  }
  console.log("================================================================");
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err: unknown) => {
    console.error(`flywheel-backtest FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
