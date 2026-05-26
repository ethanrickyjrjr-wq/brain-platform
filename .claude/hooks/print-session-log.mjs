#!/usr/bin/env node
// SessionStart hook: prints the most recent SESSION_LOG.md entries so every
// new Claude session sees what the previous one actually did. Also verifies
// that the locked rule marker is still present in CLAUDE.md — if someone
// (or a Claude) deletes the rule, this hook screams.

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const LOG_PATH = resolve(process.cwd(), "SESSION_LOG.md");
const CLAUDE_MD_PATH = resolve(process.cwd(), "CLAUDE.md");
const RULE_MARKER = "SESSION-LOG-RULE-MARKER";
const MAX_ENTRIES = 8;

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  const problems = [];

  // 1) SESSION_LOG.md must exist.
  let logText = "";
  try {
    logText = readFileSync(LOG_PATH, "utf8");
  } catch {
    problems.push(
      "MISSING: SESSION_LOG.md does not exist at repo root.\n" +
        "  → Recreate it. Every session reads it first; every push appends to it.",
    );
  }

  // 2) CLAUDE.md must still contain the locked rule marker.
  let claudeMdText = "";
  try {
    claudeMdText = readFileSync(CLAUDE_MD_PATH, "utf8");
  } catch {
    problems.push("MISSING: CLAUDE.md not found at repo root.");
  }
  if (claudeMdText && !claudeMdText.includes(RULE_MARKER)) {
    problems.push(
      `TAMPERED: CLAUDE.md no longer contains the locked rule marker "${RULE_MARKER}".\n` +
        "  → Restore the SESSION_LOG.md rule block at the top of CLAUDE.md.\n" +
        "  → This rule is non-removable by project policy. If you removed it, put it back NOW.",
    );
  }

  if (problems.length > 0) {
    const banner = "=".repeat(72);
    const msg =
      `\n${banner}\n` +
      `SESSION-LOG GATE FAILED\n` +
      `${banner}\n` +
      problems.join("\n\n") +
      `\n${banner}\n`;
    process.stdout.write(msg);
    process.stderr.write(msg);
    process.exit(2);
  }

  // 3) Print the most recent entries to stdout so Claude sees them as context.
  const entries = extractRecentEntries(logText, MAX_ENTRIES);
  const ageHours = (Date.now() - statSync(LOG_PATH).mtimeMs) / 3_600_000;

  const banner = "=".repeat(72);
  let out =
    `\n${banner}\n` +
    `SESSION_LOG — last ${entries.length} entries ` +
    `(file age ${ageHours.toFixed(1)}h)\n` +
    `${banner}\n` +
    `READ THIS BEFORE STARTING WORK.\n` +
    `Before any \`git push\`, append a 1–3 line entry to SESSION_LOG.md.\n` +
    `${banner}\n\n`;
  for (const e of entries) {
    out += e.trim() + "\n\n";
  }
  out += `${banner}\n[session-log] OK · ${entries.length} entries shown\n`;
  process.stdout.write(out);
});

function extractRecentEntries(text, n) {
  if (!text) return [];
  // Real entries start with "## YYYY-MM-DD" at column 0. The format example
  // inside the preamble code-fence uses "## YYYY-MM-DD HH:MM" as a template —
  // require literal digits to filter it out.
  const parts = text.split(/\n(?=## \d{4}-\d{2}-\d{2})/);
  const headers = parts.filter((p) => /^## \d{4}-\d{2}-\d{2}/.test(p));
  return headers.slice(0, n);
}
