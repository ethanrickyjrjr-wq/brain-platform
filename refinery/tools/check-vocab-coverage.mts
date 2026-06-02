/**
 * check-vocab-coverage — pre-push orphan-slug gate (cheap, no rebuild).
 *
 * Parses a brain's `--- OUTPUT ---` block and asserts each `key_metrics[].metric`
 * slug resolves through the REAL Stage-2.5 resolver against
 * `refinery/vocab/brain-vocabulary.json` (literal `slug_index` + path-overload +
 * `raw_slug_patterns`). An unresolvable slug is exactly the
 * "[normalize] Orphan Concept error" that has aborted the daily rebuild — always
 * on pack "master" (2026-05-29, 2026-06-02, plus the corridor-rename variant
 * 2026-05-27). See docs/cron-rebuild-failures.md → "Recurring Patterns".
 *
 * TARGET: by default only `master` — that is the pack the orphan error actually
 * fires on (master ingests every upstream brain's OUTPUT as claims). Leaf brains
 * emit their key_metrics at Stage 4, AFTER the Stage-2.5 orphan gate, so a leaf
 * slug that is missing from the materialized `slug_index` does NOT break the
 * leaf build — only master's. Checking master is therefore the precise,
 * false-positive-free proxy for the nightly failure.
 *
 * SCOPE / LIMITATION: this reads the slugs in the *rendered* brain on disk. It
 * does NOT re-run synthesis, so a brand-new slug a pack will emit only AFTER the
 * next rebuild is not caught here — for that, run `npm run refinery -- master
 * --force` locally. This gate is the cheap 80%, not a CI replica. Its companion
 * is `bun test refinery/lib/corridor-aliases.test.mts`, which catches the
 * dominant corridor-rename class proactively (reads fixtures, no rebuild).
 *
 *   Usage:
 *     bun refinery/tools/check-vocab-coverage.mts            # master only (gate)
 *     bun refinery/tools/check-vocab-coverage.mts --all      # audit every brain
 *     bun refinery/tools/check-vocab-coverage.mts cre-swfl …  # specific brains
 *   Exit 0 = clean, exit 1 = orphan(s) found (prints the offending slugs).
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseOutputFromBrainMd } from "../lib/vocab-coverage.mts";
import { loadVocabulary, resolveSlug } from "../stages/2.5-normalize.mts";

const BRAINS_DIR = path.join(process.cwd(), "brains");

interface Orphan {
  brain: string;
  metric: string;
}

async function resolveTargets(args: string[]): Promise<string[]> {
  if (args.includes("--all")) {
    const entries = await readdir(BRAINS_DIR);
    return (
      entries
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""))
        // Skip test artifacts — not part of the production DAG.
        .filter((id) => !id.startsWith("test-"))
    );
  }
  const explicit = args.filter((a) => !a.startsWith("--"));
  return explicit.length > 0 ? explicit : ["master"];
}

async function main(): Promise<void> {
  // Use the REAL Stage-2.5 resolver, not a literal slug set: it honours the
  // literal slug_index, the path-overload table, AND `raw_slug_patterns` globs
  // (e.g. `swfl_zip_*_flood_aal_*`, `permits_*_corridor_*_z`). A literal-only
  // check would false-flag every templated per-ZIP / per-corridor metric.
  const vocab = await loadVocabulary();
  const targets = await resolveTargets(process.argv.slice(2));

  const orphans: Orphan[] = [];
  let checked = 0;

  for (const brain of targets) {
    let output;
    try {
      output = await parseOutputFromBrainMd(brain);
    } catch {
      // No OUTPUT block (or unparseable / missing file) → nothing to gate; skip.
      continue;
    }
    checked += 1;
    for (const metric of output.key_metrics ?? []) {
      // fieldPath "normalized.metric" mirrors how packs emit a metric slug;
      // it only matters for the path-ambiguous family (e.g. "direction") —
      // literal/pattern resolution is path-independent.
      if (
        metric?.metric &&
        !resolveSlug(metric.metric, "normalized.metric", vocab)
      ) {
        orphans.push({ brain, metric: metric.metric });
      }
    }
  }

  if (orphans.length === 0) {
    console.log(
      `vocab-coverage: OK — ${checked} brain(s) checked [${targets.join(", ")}], ` +
        `every emitted metric resolves.`,
    );
    process.exit(0);
  }

  console.error(
    `vocab-coverage: ${orphans.length} orphan slug claim(s) do not resolve in ` +
      `refinery/vocab/brain-vocabulary.json:`,
  );
  for (const o of orphans) {
    console.error(`  - brains/${o.brain}.md :: "${o.metric}"`);
  }
  console.error(
    `\nFix: register each slug in refinery/vocab/brain-vocabulary.json — add it ` +
      `to a concept's "raw_slugs" AND the materialized "slug_index" (the resolver ` +
      `reads slug_index, not raw_slugs), or add a "raw_slug_patterns" glob. Ship ` +
      `it in the SAME commit as the pack that emits it (CLAUDE.md "Ship contract together").`,
  );
  process.exit(1);
}

main().catch((err) => {
  // A tool crash must not silently pass the gate, but must not masquerade as an
  // orphan finding either. Exit 1 with the real error so the hook surfaces it.
  console.error(`vocab-coverage: check failed to run — ${err?.message ?? err}`);
  process.exit(1);
});
