#!/usr/bin/env node
// PreToolUse hook (matcher: Bash). Blocks `git push` if no commit ahead of
// upstream touched SESSION_LOG.md. This is the lock that forces every Claude
// session to leave a breadcrumb before pushing.

import { execSync } from "node:child_process";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    process.exit(0); // not our shape, don't interfere
  }
  const cmd = String(payload?.tool_input?.command ?? "");
  if (!isGitPush(cmd)) {
    process.exit(0);
  }

  // Determine the comparison base: upstream if it exists, else origin/main.
  let base = "";
  try {
    base = sh("git rev-parse --abbrev-ref --symbolic-full-name @{u}");
  } catch {
    // No upstream set — fall back to origin/main as the comparison point.
    try {
      sh("git rev-parse --verify origin/main");
      base = "origin/main";
    } catch {
      // No upstream and no origin/main — we can't enforce. Allow.
      process.exit(0);
    }
  }

  // Commits ahead of base.
  let ahead = "";
  try {
    ahead = sh(`git rev-list --count ${base}..HEAD`);
  } catch {
    process.exit(0);
  }
  if (ahead === "0") {
    // Nothing being pushed (push --tags, push --force on identical, etc.). Allow.
    process.exit(0);
  }

  // Did any commit ahead of base touch SESSION_LOG.md?
  let touched = "";
  try {
    touched = sh(`git diff --name-only ${base}..HEAD -- SESSION_LOG.md`);
  } catch {
    process.exit(0);
  }
  if (touched.trim().length > 0) {
    process.exit(0); // good — log was updated
  }

  // Block.
  const banner = "=".repeat(72);
  const msg =
    `\n${banner}\n` +
    `PUSH BLOCKED — SESSION_LOG.md not updated\n` +
    `${banner}\n` +
    `You're pushing ${ahead} commit(s) past ${base}, but none of them\n` +
    `touched SESSION_LOG.md.\n\n` +
    `Append a new entry at the top of SESSION_LOG.md describing:\n` +
    `  • what changed (1–3 lines)\n` +
    `  • what's next / what's blocked\n` +
    `  • PR or plan link if any\n\n` +
    `Then commit it (\`git add SESSION_LOG.md && git commit -m "log: ..."\`)\n` +
    `and retry the push.\n` +
    `${banner}\n`;
  process.stdout.write(msg);
  process.stderr.write(msg);
  process.exit(2);
});

function isGitPush(cmd) {
  // Strip leading whitespace, handle `&& git push`, `;git push`, `git  push`.
  // Match the token boundary so we don't trip on `git push-something-else`.
  return /(^|\s|&&|;|\|\|)\s*git\s+push(\s|$)/.test(cmd);
}

function sh(c) {
  return execSync(c, { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}
