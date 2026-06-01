#!/usr/bin/env node
// Use this instead of `git push`. Gets you in line behind whoever pushed
// while you were working, then sends only your commits.

import { execSync } from "node:child_process";

const ROOT = process.cwd();

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

// 1. Get the latest from origin.
console.log("Fetching origin...");
execSync("git fetch origin", { cwd: ROOT, stdio: "inherit" });

// 2. Rebase your commits on top of what just landed.
console.log("Rebasing onto origin/main...");
try {
  execSync("git rebase origin/main", { cwd: ROOT, stdio: "inherit" });
} catch {
  console.error("\nREBASE CONFLICT — fix the conflicts above, then:");
  console.error("  git rebase --continue");
  console.error("  node scripts/safe-push.mjs");
  process.exit(1);
}

// 3. Show exactly what's going.
const outgoing = sh("git log --oneline origin/main..HEAD");
const files = sh("git diff --name-only origin/main..HEAD");
console.log("\n── Commits going to origin/main ──────────────────");
console.log(outgoing || "(none)");
console.log("\n── Files changed ──────────────────────────────────");
console.log(files || "(none)");
console.log("───────────────────────────────────────────────────\n");

if (!outgoing) {
  console.log("Nothing to push.");
  process.exit(0);
}

// 4. Push — retry up to 3 times if another Claude beat us to origin.
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    execSync("git push", { cwd: ROOT, stdio: "inherit" });
    console.log("Done.");
    process.exit(0);
  } catch {
    if (attempt === 3) {
      console.error(
        "Push failed after 3 attempts. Run `node scripts/safe-push.mjs` again.",
      );
      process.exit(1);
    }
    console.log(
      `Push rejected (someone else landed first) — re-fetching and rebasing (attempt ${attempt}/3)...`,
    );
    execSync("git fetch origin", { cwd: ROOT, stdio: "inherit" });
    try {
      execSync("git rebase origin/main", { cwd: ROOT, stdio: "inherit" });
    } catch {
      console.error(
        "\nREBASE CONFLICT on retry — fix the conflicts above, then:",
      );
      console.error("  git rebase --continue");
      console.error("  node scripts/safe-push.mjs");
      process.exit(1);
    }
  }
}
