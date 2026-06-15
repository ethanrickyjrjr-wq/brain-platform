#!/usr/bin/env node
// scripts/worktree.mjs — EXPERIMENTAL (added 2026-06-14; CLAUDE.md RULE 1.5).
//
// Lets a SECOND concurrent Claude session work without colliding on the shared
// `main` checkout, WITHOUT re-importing the auto-branch / auto-PR litter the
// 2026-06-08 decree killed. A worktree branch here is LOCAL and SELF-DELETING:
// it reaches `main` via `git push origin HEAD:main`, then it is removed. It is
// never pushed as a remote branch and never becomes a PR.
//
// Usage:
//   node scripts/worktree.mjs new <label>      create ../bp-<label> off origin/main
//   node scripts/worktree.mjs land <label>     rebase onto origin/main, show what
//                                              will land, print finish commands
//                                              (does NOT push — no-autonomous-push)
//   node scripts/worktree.mjs cleanup <label>  remove the worktree + delete wt/<label>
//
// `git worktree` is intentionally exempt from .claude/hooks/check-no-branch-create.mjs,
// so `new` needs no escape hatch.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const [, , cmd, label] = process.argv;

function run(c, opts = {}) {
  execSync(c, { stdio: "inherit", ...opts });
}
function capture(c, opts = {}) {
  return execSync(c, { stdio: ["ignore", "pipe", "pipe"], ...opts })
    .toString()
    .trim();
}
function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (!cmd || !["new", "land", "cleanup"].includes(cmd)) {
  die("usage: node scripts/worktree.mjs <new|land|cleanup> <label>");
}
if (!label || !/^[a-z0-9][a-z0-9-]*$/.test(label)) {
  die("label must be kebab-case (a-z, 0-9, '-'), e.g. `freshness-bridge`");
}

const dir = resolve(process.cwd(), "..", `bp-${label}`);
const branch = `wt/${label}`;

if (cmd === "new") {
  if (existsSync(dir)) die(`worktree dir already exists: ${dir}`);
  run("git fetch origin");
  run(`git worktree add -b ${branch} "${dir}" origin/main`);
  console.log(`
Worktree ready:
  folder : ${dir}
  branch : ${branch}  (LOCAL — never pushed as a branch)

Point a Claude session at that folder as its working dir. Stage EXPLICIT paths
(never \`git add -A\`). Once the work is committed and has a SESSION_LOG entry:
  node scripts/worktree.mjs land ${label}
`);
}

if (cmd === "land") {
  if (!existsSync(dir)) die(`no worktree dir: ${dir} (run \`new ${label}\` first)`);
  run(`git -C "${dir}" fetch origin`);
  try {
    run(`git -C "${dir}" rebase origin/main`);
  } catch {
    die(
      `\nREBASE CONFLICT in ${dir} — resolve it, \`git -C "${dir}" rebase --continue\`,` +
        ` then re-run: node scripts/worktree.mjs land ${label}`,
    );
  }
  const outgoing = capture(`git -C "${dir}" log --oneline origin/main..HEAD`);
  if (!outgoing) die("Nothing to land (no commits ahead of origin/main).");
  console.log(`
── Commits that will land on origin/main ──────────
${outgoing}
───────────────────────────────────────────────────

Rebased clean. To FINISH (no auto-push — RULE 1 / no-autonomous-push):
  git -C "${dir}" push origin HEAD:main       # fast-forwards main; pre-push hooks fire
  node scripts/worktree.mjs cleanup ${label}  # remove worktree + delete ${branch}
`);
}

if (cmd === "cleanup") {
  run(`git worktree remove "${dir}"`);
  try {
    run(`git branch -D ${branch}`);
  } catch {
    console.log(`(branch ${branch} already gone)`);
  }
  console.log(`Cleaned up ${dir} + ${branch}.`);
}
