#!/usr/bin/env node
// PreToolUse hook (matcher: Edit|Write). Enforces Rule 8 — "no cross-project
// contamination" — MECHANICALLY instead of as a CLAUDE.md sentence (a prose
// rule is the ceremony the rule itself rejects). Blocks an Edit/Write whose
// target path lives in a *sibling project* (premise-engine, or any other repo
// under the same dev workspace) rather than this repo.
//
// Design (mirrors check-prepush-gate.mjs conventions):
//   • DENY (exit 2) iff the resolved path is NOT under this repo AND it is
//     either (a) under the dev workspace root — i.e. a sibling project — or
//     (b) contains a `premise-engine` segment anywhere (the named risk, caught
//     even if it lives outside the dev root).
//   • ALLOW (exit 0) for this repo's tree, the agent memory dir (~/.claude),
//     temp/scratch, and anything else outside the dev workspace. None of those
//     are cross-project contamination; blocking them would break legitimate
//     out-of-repo writes (memory!), which is worse than the gap.
//   • Fail-OPEN (exit 0) on any internal error — a broken guard must never
//     wedge legitimate edits.

import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // <repo>/.claude/hooks
const REPO_ROOT = path.resolve(HERE, "..", ".."); // <repo>
const DEV_ROOT = path.dirname(REPO_ROOT); // the dev workspace (parent of repo)
const WIN = process.platform === "win32";

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
  const fp = payload?.tool_input?.file_path;
  if (typeof fp !== "string" || fp.length === 0) process.exit(0); // nothing to check

  let abs;
  try {
    abs = path.resolve(process.cwd(), fp);
  } catch {
    process.exit(0); // can't resolve — fail open
  }

  if (isUnder(abs, REPO_ROOT)) process.exit(0); // this repo — always allowed
  if (isUnder(abs, DEV_ROOT) || hasSegment(abs, "premise-engine")) block(abs);
  process.exit(0); // outside the dev workspace (memory, temp, …) — allowed
});

// True when `p` is `root` itself or nested beneath it, compared on a
// path-segment boundary (case-insensitive on Windows) so a sibling like
// `<dev>/brain-platform-2` is NOT treated as under `<dev>/brain-platform`.
function isUnder(p, root) {
  const a = norm(p);
  const r = norm(root);
  return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

function hasSegment(p, segment) {
  const target = WIN ? segment.toLowerCase() : segment;
  return norm(p)
    .split(path.sep)
    .some((s) => s === target);
}

function norm(p) {
  const resolved = path.resolve(p);
  return WIN ? resolved.toLowerCase() : resolved;
}

function block(abs) {
  const bar = "=".repeat(72);
  const msg =
    `\n${bar}\n` +
    `WRITE BLOCKED — cross-project contamination (Rule 8)\n` +
    `${bar}\n` +
    `Target path is in a sibling project, not this repo:\n  ${abs}\n\n` +
    `This repo: ${REPO_ROOT}\n` +
    `If you meant to edit brain-platform, fix the path. If you genuinely need\n` +
    `to touch another project, do it from that project's own session.\n` +
    `${bar}\n`;
  process.stdout.write(msg);
  process.stderr.write(msg);
  process.exit(2);
}
