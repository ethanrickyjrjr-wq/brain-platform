#!/usr/bin/env node
/**
 * Retroactive plan annotator — adds conflict-group color badges + model
 * recommendation to an existing plan file.
 *
 * Usage:
 *   node scripts/annotate-plan.mjs docs/superpowers/plans/YYYY-MM-DD-foo.md
 *   node scripts/annotate-plan.mjs docs/superpowers/plans/   # annotate all
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const hookPath = fileURLToPath(new URL("../.claude/hooks/annotate-plan.mjs", import.meta.url));
const target = process.argv[2];

if (!target) {
  process.stderr.write("Usage: node scripts/annotate-plan.mjs <plan.md | plans-dir/>\n");
  process.exit(1);
}

const abs = path.resolve(process.cwd(), target);
const stat = fs.statSync(abs, { throwIfNoEntry: false });

if (!stat) {
  process.stderr.write(`Not found: ${target}\n`);
  process.exit(1);
}

const files = stat.isDirectory()
  ? fs
      .readdirSync(abs)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(abs, f))
  : [abs];

for (const f of files) {
  execFileSync(process.execPath, [hookPath, f], { stdio: "inherit" });
}
