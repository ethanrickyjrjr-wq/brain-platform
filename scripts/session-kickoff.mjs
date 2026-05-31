#!/usr/bin/env node
// Called by the SessionStart hook (print-session-log.mjs) to print the
// KICKOFF BLOCK — last ship, open checks, build queue — as a ready-to-paste
// first message for a new Claude session. All data fetches are best-effort;
// any failure degrades gracefully rather than blocking session start.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const QUEUE_PATH = resolve(ROOT, "_AUDIT_AND_ROADMAP/build-queue.md");
const SECRETS_PATH = resolve(ROOT, ".dlt/secrets.toml");
const LOG_PATH = resolve(ROOT, "SESSION_LOG.md");

function parseTomlStr(toml, key) {
  const m = toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
  return m?.[1] ?? null;
}

function extractLastShip(logText) {
  const parts = logText.split(/\n(?=## \d{4}-\d{2}-\d{2})/);
  const first = parts.find((p) => /^## \d{4}-\d{2}-\d{2}/.test(p)) ?? "";
  return (first.match(/^## [^\n]+/)?.[0] ?? "").replace(/^## /, "");
}

function parseBuildQueue(text) {
  const building = [],
    next = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (/^-\s*\[~\]/.test(t)) building.push(t.replace(/^-\s*\[~\]\s*/, ""));
    else if (/^-\s*\[ \]/.test(t)) next.push(t.replace(/^-\s*\[ \]\s*/, ""));
  }
  return { building, next };
}

function fmtDate(iso) {
  if (!iso) return "?";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

async function getOpenChecks(sbUrl, sbKey) {
  const headers = { apikey: sbKey };
  headers["Authorization"] = "Bearer " + sbKey;
  try {
    const res = await fetch(
      `${sbUrl}/rest/v1/checks?state=eq.open&order=due_at.asc.nullslast&limit=8`,
      { headers },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function summariseChecks(rows) {
  if (!rows || rows.length === 0) return "none open ✓";
  return rows
    .map((r) => {
      const due = r.due_at
        ? ` [${r.resolution}, due ${fmtDate(r.due_at)}]`
        : ` [${r.resolution}]`;
      return r.label + due;
    })
    .join("\n    · ");
}

async function main() {
  const banner = "=".repeat(72);
  const today = new Date().toISOString().slice(0, 10);

  // Last ship from SESSION_LOG
  let lastShip = "(none found)";
  try {
    lastShip = extractLastShip(readFileSync(LOG_PATH, "utf8"));
  } catch {
    /* skip */
  }

  // Open checks from Supabase REST
  let checksLine = "(secrets not found)";
  try {
    const secrets = readFileSync(SECRETS_PATH, "utf8");
    const sbUrl =
      parseTomlStr(secrets, "SUPABASE_URL") ??
      parseTomlStr(secrets, "BRAINS_SUPABASE_URL");
    const sbKey =
      parseTomlStr(secrets, "SUPABASE_SERVICE_KEY") ??
      parseTomlStr(secrets, "BRAINS_SUPABASE_SERVICE_KEY");
    if (sbUrl && sbKey) {
      const rows = await getOpenChecks(sbUrl, sbKey);
      checksLine =
        rows === null
          ? "(could not reach Supabase)"
          : `${rows.length} open\n    · ${summariseChecks(rows)}`;
    }
  } catch {
    checksLine = "(secrets read error)";
  }

  // Build queue from local markdown
  let queueLine = "(build-queue.md not found)";
  try {
    const { building, next } = parseBuildQueue(
      readFileSync(QUEUE_PATH, "utf8"),
    );
    const parts = [];
    if (building.length) parts.push(`[~] ${building[0]}`);
    if (next.length) parts.push(`[ ] ${next[0]}`);
    queueLine =
      parts.length > 0
        ? parts.join("  ·  ")
        : "(nothing queued — all items done or queue is empty)";
  } catch {
    /* skip */
  }

  process.stdout.write(
    `\n${banner}\n` +
      `KICKOFF — ${today} · brain-platform · main\n` +
      `Paste below as your first message, or just type "go" / describe the task.\n` +
      `${banner}\n\n` +
      `Last shipped : ${lastShip}\n` +
      `Open checks  : ${checksLine}\n` +
      `Build queue  : ${queueLine}\n\n` +
      `What should we work on?\n` +
      `${banner}\n`,
  );
}

main().catch(() => {}); // never block session start
