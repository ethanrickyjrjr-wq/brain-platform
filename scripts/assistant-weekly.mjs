#!/usr/bin/env node
// Weekly maintenance: archive any newly-dead specs/handoffs, write _ASSISTANT/TODAY.md.
// Re-runnable at any time. Safe to run without --dry-run.

import { readFileSync, readdirSync, existsSync } from "node:fs"; // existsSync used for QUEUE_PATH
import { resolve } from "node:path";
import { isDeadSpec, isDeadHandoff, archiveFile, appendCleaned } from "./assistant-lib.mjs";

const ROOT = process.cwd();
const DRY_RUN = process.argv.includes("--dry-run");
const SPECS_DIR = resolve(ROOT, "docs/superpowers/specs");
const SPECS_ARCHIVE = resolve(ROOT, "docs/superpowers/specs/_archive");
const HANDOFF_DIR = resolve(ROOT, "docs/handoff");
const HANDOFF_ARCHIVE = resolve(ROOT, "docs/handoff/_archive");
const QUEUE_PATH = resolve(ROOT, "_AUDIT_AND_ROADMAP/build-queue.md");
const CLEANED_PATH = resolve(ROOT, "_ASSISTANT/CLEANED.md");
const SECRETS_PATH = resolve(ROOT, ".dlt/secrets.toml");

function parseTomlStr(toml, key) {
  const m = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"));
  return m?.[1] ?? null;
}

async function getOpenCheckKeys() {
  try {
    const secrets = readFileSync(SECRETS_PATH, "utf8");
    const sbUrl =
      parseTomlStr(secrets, "SUPABASE_URL") ?? parseTomlStr(secrets, "BRAINS_SUPABASE_URL");
    const sbKey =
      parseTomlStr(secrets, "SUPABASE_SERVICE_KEY") ??
      parseTomlStr(secrets, "BRAINS_SUPABASE_SERVICE_KEY");
    if (!sbUrl || !sbKey) return [];
    const res = await fetch(`${sbUrl}/rest/v1/checks?state=eq.open&select=check_key&limit=200`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
    });
    if (!res.ok) return [];
    return (await res.json()).map((r) => r.check_key);
  } catch {
    return [];
  }
}

async function main() {
  if (DRY_RUN) console.log("[DRY RUN] No files will be moved.\n");

  const queueText = existsSync(QUEUE_PATH) ? readFileSync(QUEUE_PATH, "utf8") : "";
  const openCheckKeys = await getOpenCheckKeys();
  const entries = [];

  // Scan specs (skip _archive/ and files starting with _)
  const specs = readdirSync(SPECS_DIR).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  for (const f of specs) {
    const filepath = resolve(SPECS_DIR, f);
    const { dead, reason } = isDeadSpec(filepath, queueText, openCheckKeys);
    if (!dead) continue;
    console.log(`ARCHIVE spec: ${f} — ${reason}`);
    if (!DRY_RUN) {
      const dest = archiveFile(filepath, SPECS_ARCHIVE);
      entries.push({ src: filepath, dest, reason });
    }
  }

  // Scan handoffs (skip _archive/ and files starting with _)
  const handoffs = readdirSync(HANDOFF_DIR).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  for (const f of handoffs) {
    const filepath = resolve(HANDOFF_DIR, f);
    const { dead, reason } = isDeadHandoff(filepath, openCheckKeys);
    if (!dead) continue;
    console.log(`ARCHIVE handoff: ${f} — ${reason}`);
    if (!DRY_RUN) {
      const dest = archiveFile(filepath, HANDOFF_ARCHIVE);
      entries.push({ src: filepath, dest, reason });
    }
  }

  if (!DRY_RUN && entries.length) {
    appendCleaned(CLEANED_PATH, entries);
  }

  console.log(`\n${DRY_RUN ? "[DRY RUN] Would archive" : "Archived"} ${entries.length} files.`);
  if (!DRY_RUN && entries.length) {
    console.log(
      'Commit archive moves:\n  git add docs/superpowers/specs/_archive/ docs/handoff/_archive/ _ASSISTANT/CLEANED.md\n  git commit -m "chore(assistant): weekly archive pass"',
    );
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
