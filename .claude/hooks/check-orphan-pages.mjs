#!/usr/bin/env node
// PreToolUse hook (matcher: Bash). Blocks `git push` / `safe-push` when a
// commit ahead of upstream has touched any app/**/page.tsx AND the orphan
// check finds a new non-allowlisted orphan route.
//
// Intent: make it impossible to accidentally ship an unreachable page.
// Any new page.tsx that has no inbound nav link (and is not explicitly
// allowlisted) is caught before it lands on main.
//
// ESCAPE HATCH — set ALLOW_ORPHAN_PAGE=1 to push anyway when you
// intentionally add an orphaned page (B6 keep/kill, staged work, etc.).
// This is logged to stdout so the choice is visible in the push record.
//
// Mirrors the fail-open + exit-2 style of check-no-branch-create.mjs and
// check-prepush-gate.mjs.

import { execSync } from "node:child_process";
import { resolve } from "node:path";

const BANNER = "=".repeat(72);

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    process.exit(0); // not our shape — allow
  }
  const cmd = String(payload?.tool_input?.command ?? "");
  if (!isGitPush(cmd)) process.exit(0);

  // Deliberate operator opt-in → allow (and log it).
  if (/\bALLOW_ORPHAN_PAGE=1\b/.test(cmd)) {
    process.stdout.write(
      "\n[orphan-page guard] OVERRIDE: ALLOW_ORPHAN_PAGE=1 — skipping orphan check.\n",
    );
    process.exit(0);
  }

  // Find the upstream base ref.
  let base = "";
  try {
    base = sh("git rev-parse --abbrev-ref --symbolic-full-name @{u}");
  } catch {
    try {
      sh("git rev-parse --verify origin/main");
      base = "origin/main";
    } catch {
      process.exit(0); // can't determine upstream — fail open
    }
  }

  // Only trigger when commits ahead of upstream touched app/**/page.tsx.
  let ahead = "0";
  let changed = [];
  try {
    ahead = sh(`git rev-list --count ${base}..HEAD`);
    if (ahead === "0") process.exit(0);
    changed = sh(`git diff --name-only ${base}..HEAD`)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    process.exit(0); // git quirk — fail open
  }

  const pageTouched = changed.some((f) => /^app\/.*\/page\.tsx$/.test(f) || f === "app/page.tsx");
  if (!pageTouched) process.exit(0);

  // Run the orphan checker; collect new non-allowlisted orphans via --json.
  const scriptPath = resolve(
    new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
    "scripts",
    "check-orphans.mjs",
  );
  const result = run(`node "${scriptPath}" --json`);
  if (!result.ran) process.exit(0); // can't run script — fail open

  let parsed;
  try {
    parsed = JSON.parse(result.out);
  } catch {
    process.exit(0); // bad output — fail open
  }

  const newOrphans = parsed?.newOrphans ?? [];
  if (newOrphans.length === 0) process.exit(0);

  block(
    "ORPHAN PAGE — new page(s) with no inbound nav link",
    `These routes have no inbound link from any nav/footer file and are not\n` +
      `in the ALLOWLIST:\n\n` +
      newOrphans.map((r) => `  ${r}`).join("\n") +
      `\n\nFix options:\n` +
      `  1. Add an inbound link from a persistent chrome file (nav, footer, etc.)\n` +
      `  2. Add the route to the ALLOWLIST in scripts/check-orphans.mjs\n` +
      `     (only for by-design URL-entry routes — email links, iframes, auth)\n` +
      `  3. ALLOW_ORPHAN_PAGE=1 to override (use sparingly; it is logged)\n\n` +
      `Run 'node scripts/check-orphans.mjs --all' for the full classification.`,
  );
});

// Match both `git push` and `node scripts/safe-push.mjs`.
function isGitPush(cmd) {
  return /(^|\s|&&|;|\|\|)\s*git\s+push(\s|$)/.test(cmd) || /safe-push(\.mjs)?\b/.test(cmd);
}

function sh(c) {
  return execSync(c, { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

function run(c) {
  try {
    const out = execSync(c, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    return { ran: true, code: 0, out };
  } catch (err) {
    if (typeof err?.status !== "number") {
      process.stdout.write(
        `\n[orphan-page guard] WARN: could not run orphan check (${err?.code ?? "unknown"}); skipping.\n`,
      );
      return { ran: false, code: 0, out: "" };
    }
    // exit code 1 from check-orphans = real orphan found; any other code = error
    return { ran: true, code: err.status, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function block(title, body) {
  const msg = `\n${BANNER}\nPUSH BLOCKED — ${title}\n${BANNER}\n${body}\n${BANNER}\n`;
  process.stdout.write(msg);
  process.stderr.write(msg);
  process.exit(2);
}
