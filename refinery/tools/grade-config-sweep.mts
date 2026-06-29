/**
 * grade-config-sweep — one mechanical pass over the whole vocabulary that
 * partitions every metric slug into EXACTLY ONE bucket (sweep-spec.md §2), the
 * three-column ledger the row tier and the flywheel both stand on:
 *
 *   1. row vs brain        — `row-candidate` (non-numeric → never a prediction
 *                            target) vs `gradeable` (prediction target). R1: the
 *                            final row-vs-brain call is an Opus semantic decision;
 *                            this emits CANDIDATES only.
 *   2. moat-fuel backlog   — `moat-fuel`: slugs ungradeable ONLY for a missing
 *                            polarity (the cheapest predictions to unlock).
 *   3. backtestable inventory — gradeable ∩ vintage-clean (`backtest_clean`,
 *                            joined from docs/littlebird-notes/2026-06-04.md).
 *
 * The sweep does NOT decide row-vs-brain, does NOT rewrite any polarity, does
 * NOT widen the corpus, and does NOT define Track B's predictor.
 *
 * Output (OUTPUT-SINK GUARDRAIL, §5): a regenerable JSON artifact, committed for
 * diffability, NEVER hand-edited. Adjudications are `checks` rows, not markdown.
 *
 *   Usage:
 *     bun refinery/tools/grade-config-sweep.mts            # write + summary
 *     bun refinery/tools/grade-config-sweep.mts --check    # assert §3 pin only, no write
 *   Exit 0 = clean; exit 1 = §3 drift pin failed (a slug where gateVector
 *   all-green ≠ resolveGradeConfig.gradeable — a regression in either function).
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadVocabularySync } from "../vocab/loader.mts";
import { gateVector, resolveGradeConfig, type GateVector } from "../vocab/loader.mts";

const OUTPUT_PATH = path.join(process.cwd(), "_AUDIT_AND_ROADMAP", "grade-coverage.json");

/**
 * Vintage-clean gradeable slugs from the vintage-policy audit
 * (docs/littlebird-notes/2026-06-04.md → "CLEAN GRADEABLE COUNT: 11 slugs").
 * All sourced from immutable individual-record tables (SBA loan outcomes, TDT
 * remittances, LeePA deeds). Join is by concept id; `backtest_clean` is `true`
 * for a gradeable slug in this set, `false` for gradeable-but-dirty, `null` for
 * any non-gradeable slug. Single source of truth = the audit doc; edit there.
 */
const BACKTEST_CLEAN_SLUGS: ReadonlySet<string> = new Set([
  "sba_overall_survival_rate",
  "sba_best_sector_survival",
  "sba_worst_sector_chargeoff",
  "hosp_tdt_latest_monthly_collections",
  "hosp_tdt_trailing_12mo_collections",
  "hosp_tdt_post_ian_recovery_ratio",
  "hosp_tdt_lee_latest_monthly_collections",
  "hosp_tdt_lee_trailing_12mo_collections",
  "hosp_tdt_collier_latest_monthly_collections",
  "hosp_tdt_collier_trailing_12mo_collections",
  "properties_lee_sales_velocity_zscore",
]);

export type Bucket =
  | "unregistered"
  | "invalid-polarity"
  | "row-candidate"
  | "gradeable"
  | "moat-fuel"
  | "needs-window";

/**
 * Total, disjoint bucket assignment by STRICT precedence (first match wins),
 * sweep-spec.md §2. Precedence makes the function total and disjoint by
 * construction:
 *   unregistered ▸ invalid-polarity ▸ row-candidate (!numeric) ▸ gradeable
 *     ▸ moat-fuel ▸ needs-window
 * The `!numeric → row-candidate` step (before gradeable/moat-fuel/needs-window)
 * is what kills the first-failing-gate double-count: a non-numeric metric can
 * never be a prediction target regardless of polarity/window.
 */
export function assignBucket(gv: GateVector): Bucket {
  if (!gv.registered) return "unregistered"; // no concept → everything else uncomputable
  if (gv.polarity_state === "invalid") return "invalid-polarity"; // intent-to-grade, garbage token
  if (!gv.numeric_ok) return "row-candidate"; // non-numeric → never a prediction target
  // numeric_ok === true beyond here:
  if (gv.polarity_state === "valid_directional" && gv.window_ok) {
    return "gradeable"; // passes all gates
  }
  if (gv.polarity_state === "none" && gv.window_ok) {
    return "moat-fuel"; // polarity is the SOLE blocker — cheapest unlock
  }
  return "needs-window"; // numeric, !window_ok (valid or none polarity)
}

interface SweepRecord {
  slug: string;
  concept_id: string | null;
  bucket: Bucket;
  gateVector: GateVector;
  gradeable: boolean;
  reason: string | null;
  /** gradeable ∩ vintage-clean; null for non-gradeable slugs. */
  backtest_clean: boolean | null;
}

interface SweepOutput {
  generated_at: string;
  spec: string;
  note: string;
  summary: Record<Bucket, number> & { backtest_clean: number };
  records: SweepRecord[];
}

function runSweep(): { output: SweepOutput; pinFailures: string[] } {
  const vocab = loadVocabularySync();
  const records: SweepRecord[] = [];
  const pinFailures: string[] = [];
  const summary = {
    unregistered: 0,
    "invalid-polarity": 0,
    "row-candidate": 0,
    gradeable: 0,
    "moat-fuel": 0,
    "needs-window": 0,
    backtest_clean: 0,
  } as SweepOutput["summary"];

  for (const conceptId of Object.keys(vocab.concepts)) {
    const gv = gateVector(conceptId);
    const cfg = resolveGradeConfig(conceptId);
    const bucket = assignBucket(gv);

    // §3 drift pin: gateVector all-green ⇔ resolveGradeConfig.gradeable.
    const allGreen =
      gv.registered && gv.polarity_state === "valid_directional" && gv.window_ok && gv.numeric_ok;
    if (allGreen !== cfg.gradeable) {
      pinFailures.push(
        `${conceptId} (gateVector all-green=${allGreen}, resolveGradeConfig.gradeable=${cfg.gradeable})`,
      );
    }

    const backtest_clean = cfg.gradeable ? BACKTEST_CLEAN_SLUGS.has(conceptId) : null;

    records.push({
      slug: conceptId,
      concept_id: gv.concept_id,
      bucket,
      gateVector: gv,
      gradeable: cfg.gradeable,
      reason: cfg.reason ?? null,
      backtest_clean,
    });

    summary[bucket] += 1;
    if (backtest_clean === true) summary.backtest_clean += 1;
  }

  records.sort((a, b) => a.slug.localeCompare(b.slug));

  return {
    output: {
      generated_at: new Date().toISOString().slice(0, 10),
      spec: "docs/superpowers/plans/2026-06-03-row-tier/sweep-spec.md",
      note: "Regenerable artifact — never hand-edit. Regenerate: bun refinery/tools/grade-config-sweep.mts. Adjudications live in the `checks` ledger, not here.",
      summary,
      records,
    },
    pinFailures,
  };
}

function main(): void {
  const checkOnly = process.argv.includes("--check");
  const { output, pinFailures } = runSweep();

  if (pinFailures.length > 0) {
    console.error(
      `✗ §3 drift pin FAILED — gateVector all-green ≠ resolveGradeConfig.gradeable:\n  ${pinFailures.join("\n  ")}`,
    );
    process.exit(1);
  }

  const { summary } = output;
  console.log("grade-config sweep — bucket tallies:");
  for (const bucket of [
    "unregistered",
    "invalid-polarity",
    "row-candidate",
    "gradeable",
    "moat-fuel",
    "needs-window",
  ] as const) {
    console.log(`  ${bucket.padEnd(18)} ${summary[bucket]}`);
  }
  console.log(
    `  ${"backtest_clean".padEnd(18)} ${summary.backtest_clean} (gradeable ∩ vintage-clean)`,
  );

  const invalid = output.records.filter((r) => r.bucket === "invalid-polarity");
  if (invalid.length > 0) {
    console.log(
      `\n⚠ ${invalid.length} invalid-polarity slug(s) — each owes a "checks" row for an Opus per-slug directional audit (FIX-OR-REMOVE, never string-normalize):`,
    );
    for (const r of invalid) {
      console.log(`  ${r.slug}  (raw="${r.gateVector.raw_polarity}")`);
    }
  }

  if (checkOnly) {
    // Drift guard: the committed artifact's `summary` must equal a fresh sweep.
    // Compares summary ONLY — `generated_at` changes daily, so a full-file
    // compare false-fails. Blind to a count-neutral same-push swap (acceptable
    // for a tracking artifact; see the plan's Phase 0 notes).
    let committedSummary: string | null = null;
    try {
      const committed = JSON.parse(readFileSync(OUTPUT_PATH, "utf-8")) as SweepOutput;
      committedSummary = JSON.stringify(committed.summary);
    } catch {
      committedSummary = null; // missing/unparseable → treat as drift
    }
    const freshSummary = JSON.stringify(output.summary);
    if (committedSummary !== freshSummary) {
      console.error(
        `✗ committed ${path.relative(process.cwd(), OUTPUT_PATH)} is stale or missing ` +
          `— its bucket summary differs from a fresh sweep.\n` +
          `  committed: ${committedSummary ?? "(file missing/unparseable)"}\n` +
          `  fresh:     ${freshSummary}\n` +
          `Fix: bun refinery/tools/grade-config-sweep.mts && ` +
          `git add _AUDIT_AND_ROADMAP/grade-coverage.json`,
      );
      process.exit(1);
    }
    console.log("\n--check: §3 pin green; committed artifact matches fresh sweep; no write.");
    return;
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(
    `\n✓ wrote ${path.relative(process.cwd(), OUTPUT_PATH)} (${output.records.length} slugs)`,
  );
}

main();
