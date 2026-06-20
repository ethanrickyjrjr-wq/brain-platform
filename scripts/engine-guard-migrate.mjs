#!/usr/bin/env node
/**
 * One-shot migrator: add the ENGINE_ENABLED job guard to every scheduled
 * ("engine") workflow. Pure line-insertion so YAML comments — including the
 * freeze-commented `# - cron:` lines — are preserved exactly. Idempotent:
 * skips any job that already has an `if:`.
 *
 *   node scripts/engine-guard-migrate.mjs            # dry run (prints plan)
 *   node scripts/engine-guard-migrate.mjs --apply    # write the guards
 *
 * Gate set = every workflow whose file contains `cron:` (active or commented).
 * Guard: scheduled runs skip when ENGINE_ENABLED=false; manual dispatch always runs.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const WF = path.join(process.cwd(), ".github", "workflows");
const GUARD =
  "    if: ${{ vars.ENGINE_ENABLED != 'false' || github.event_name == 'workflow_dispatch' }}";
const apply = process.argv.includes("--apply");

const files = readdirSync(WF)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .filter((f) => readFileSync(path.join(WF, f), "utf8").includes("cron:"))
  .sort();

let totalJobs = 0,
  totalFiles = 0;
for (const f of files) {
  const p = path.join(WF, f);
  const lines = readFileSync(p, "utf8").split("\n");
  const out = [];
  let inJobs = false;
  let inserted = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    // a job declaration = exactly 2-space indent, name, colon, nothing after
    if (!/^  [A-Za-z0-9_-]+:\s*$/.test(line)) continue;
    // peek next non-empty line — a real job body is indented 4+ spaces
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    const next = lines[j] || "";
    if (/^    if:/.test(next)) continue; // already guarded — idempotent
    if (!/^    \S/.test(next)) continue; // not a job body
    out.push(GUARD);
    inserted++;
  }
  if (inserted > 0) {
    totalFiles++;
    totalJobs += inserted;
    console.log(`${apply ? "APPLIED" : "DRY   "} ${f}: +${inserted} guard(s)`);
    if (apply) writeFileSync(p, out.join("\n"));
  } else {
    console.log(`SKIP   ${f}: no eligible job (already guarded?)`);
  }
}
console.log(
  `\n${apply ? "APPLIED" : "DRY-RUN — would apply"}: ${totalJobs} guard(s) across ${totalFiles}/${files.length} file(s)`,
);
