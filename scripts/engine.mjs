#!/usr/bin/env node
/**
 * engine.mjs — single on/off switch for the automated SWFL Data Gulf engine.
 *
 * SOURCE OF TRUTH: the GitHub repo variable `ENGINE_ENABLED` ("true" | "false").
 *   unset  → treated as ON (fail-safe default; the guard only stops on the
 *            literal string "false").
 *
 * ENFORCEMENT: every scheduled ("engine") workflow carries a job-level guard
 *   if: ${{ vars.ENGINE_ENABLED != 'false' || github.event_name == 'workflow_dispatch' }}
 *   → when the variable is "false", scheduled (cron) runs SKIP cleanly (no
 *     compute, no credit spend, shown as skipped not failed); a manual
 *     `workflow_dispatch` ALWAYS runs so you can still fire one pipeline by hand
 *     while the engine is parked.
 *
 * This script is the friendly front-end: it flips the variable and reports
 * state. It DISCOVERS the guarded set by scanning the workflow files for the
 * guard marker, so the list never goes stale.
 *
 *   node scripts/engine.mjs on       # resume scheduled runs
 *   node scripts/engine.mjs off      # park the engine (scheduled runs skip)
 *   node scripts/engine.mjs status   # show the variable + guarded workflows
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO = "ethanrickyjrjr-wq/brain-platform";
const WF_DIR = path.join(process.cwd(), ".github", "workflows");
const GUARD_MARK = "vars.ENGINE_ENABLED";

function gh(args) {
  return execSync(`gh ${args}`, { encoding: "utf8" }).trim();
}

function getVar() {
  try {
    return gh(`variable get ENGINE_ENABLED -R ${REPO}`);
  } catch {
    return null; // unset
  }
}

function setVar(value) {
  gh(`variable set ENGINE_ENABLED -R ${REPO} --body ${value}`);
}

function guardedWorkflows() {
  return readdirSync(WF_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .filter((f) => readFileSync(path.join(WF_DIR, f), "utf8").includes(GUARD_MARK))
    .sort();
}

const cmd = (process.argv[2] || "").toLowerCase();

if (cmd === "on" || cmd === "off") {
  const value = cmd === "on" ? "true" : "false";
  setVar(value);
  const n = guardedWorkflows().length;
  if (cmd === "on") {
    console.log(
      `engine ON  — ENGINE_ENABLED=true. ${n} guarded workflows will run on schedule again.`,
    );
  } else {
    console.log(
      `engine OFF — ENGINE_ENABLED=false. ${n} guarded workflows skip scheduled runs (manual dispatch still works).`,
    );
  }
} else if (cmd === "status") {
  const v = getVar();
  const wfs = guardedWorkflows();
  const state = v === "false" ? "OFF" : "ON";
  console.log(`ENGINE_ENABLED = ${v === null ? "(unset → ON by default)" : v}`);
  console.log(`engine = ${state}`);
  console.log(`guarded workflows (${wfs.length}):`);
  for (const w of wfs) console.log(`  - ${w}`);
} else {
  console.log("usage: node scripts/engine.mjs <on|off|status>");
  process.exit(1);
}
