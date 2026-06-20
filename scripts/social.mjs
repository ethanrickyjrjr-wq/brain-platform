#!/usr/bin/env node
/**
 * social.mjs — go-live switch for the social auto-posting pipeline.
 *
 * SOURCE OF TRUTH: the GitHub repo variable `SOCIAL_PUBLISH_ENABLED` ("true" | "false").
 *   unset  → treated as OFF / dry-run (safe default — no live posts without explicit flip).
 *   "false" → DRY MODE: the pipeline runs end-to-end (compose + render + claim +
 *             record), but postToChannel is short-circuited. Zero platform API calls.
 *   "true"  → LIVE: postToChannel calls the real connectors; posts go out.
 *
 * ENFORCEMENT: the cron worker (build 04) reads this variable before every publish call.
 *   The worker also carries the ENGINE_ENABLED job-guard, so the global engine off-switch
 *   parks social posting too.
 *
 *   node scripts/social.mjs go-live   # flip to live (payments must be in first)
 *   node scripts/social.mjs dry       # revert to dry mode
 *   node scripts/social.mjs status    # show the variable + guarded workflows
 *
 * Mirrors: scripts/engine.mjs (same pattern, same gh variable API).
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO = "ethanrickyjrjr-wq/brain-platform";
const WF_DIR = path.join(process.cwd(), ".github", "workflows");
const VAR_NAME = "SOCIAL_PUBLISH_ENABLED";
const GUARD_MARK = "SOCIAL_PUBLISH_ENABLED";

function gh(args) {
  return execSync(`gh ${args}`, { encoding: "utf8" }).trim();
}

function getVar() {
  try {
    return gh(`variable get ${VAR_NAME} -R ${REPO}`);
  } catch {
    return null; // unset = DRY by default
  }
}

function setVar(value) {
  gh(`variable set ${VAR_NAME} -R ${REPO} --body ${value}`);
}

function guardedWorkflows() {
  try {
    return readdirSync(WF_DIR)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .filter((f) => readFileSync(path.join(WF_DIR, f), "utf8").includes(GUARD_MARK))
      .sort();
  } catch {
    return []; // .github/workflows may not exist in all environments
  }
}

const cmd = (process.argv[2] || "").toLowerCase();

if (cmd === "go-live") {
  setVar("true");
  const n = guardedWorkflows().length;
  console.log(
    `SOCIAL LIVE — ${VAR_NAME}=true. ${n} guarded workflow(s) will post to real platform APIs.\n` +
      `WARNING: real posts will go out on the next cron fire. Flip back with: node scripts/social.mjs dry`,
  );
} else if (cmd === "dry") {
  setVar("false");
  const n = guardedWorkflows().length;
  console.log(
    `SOCIAL DRY — ${VAR_NAME}=false. ${n} guarded workflow(s) will run in dry-run mode (no live posts).`,
  );
} else if (cmd === "status") {
  const v = getVar();
  const wfs = guardedWorkflows();
  const isLive = v === "true";
  const state = isLive ? "LIVE" : "DRY (safe default)";
  console.log(`${VAR_NAME} = ${v === null ? "(unset → DRY by default)" : v}`);
  console.log(`social publish = ${state}`);
  if (isLive) {
    console.log(`⚠  LIVE MODE: posts will go out on the next scheduled fire.`);
  } else {
    console.log(`   DRY MODE: pipeline runs end-to-end, postToChannel is short-circuited.`);
  }
  console.log(`guarded workflows (${wfs.length}):`);
  for (const w of wfs) console.log(`  - ${w}`);
} else {
  console.log("usage: node scripts/social.mjs <go-live|dry|status>");
  process.exit(1);
}
