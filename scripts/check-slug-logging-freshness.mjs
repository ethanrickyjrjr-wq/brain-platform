#!/usr/bin/env node
// check-slug-logging-freshness.mjs — liveness watchdog for §6-A per-slug leaf
// prediction logging (the gradeable-yield multiplier).
//
// WHY: the §6-A path (refinery/lib/predictions-log.mts → logSlugPredictions,
// wired into Stage 4 for every pack) is the live half of the flywheel corpus.
// If it silently stops banking `prediction_kind='slug'` rows — a wiring
// regression, an env drop, a thrown-and-swallowed insert — nothing else turns
// red, because a refine still writes its .md and the grader still drains an
// (empty) queue. This is the thin SELECT-and-compare that makes that silence loud.
//
// WHAT: reads the freshest `refined_at` among slug rows and alerts (exit 1) when
// it is older than SLUG_STALL_DAYS (default 2) — or when zero slug rows exist.
//
// CADENCE CAVEAT (read before trusting a red): slug logging is non-overlap
// cadence-guarded — a slug is re-logged only after its window closes, never
// nightly. So `max(refined_at)` does NOT advance every day even when healthy; a
// stall alert during a genuinely quiet window is a false positive. 2 days is a
// starting threshold; raise SLUG_STALL_DAYS once real cadence is observed (the
// loop is young — 19 rows / 9 brains as of 2026-06-14). Graduate this from
// warn-only to a blocking gate / ops tile only after the threshold stops flapping.
//
// CREDS: env first (CI: SUPABASE_URL / SUPABASE_SERVICE_KEY), then .dlt/secrets.toml
// (local), mirroring scripts/check.mjs. Never printed.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STALL_DAYS = Number(process.env.SLUG_STALL_DAYS ?? "2");

/** Parse a double-quoted TOML scalar by key, line-by-line (tolerant of CRLF). */
function tomlStr(toml, key) {
  for (const line of toml.split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`));
    if (m) return m[1];
  }
  return null;
}

function creds() {
  let url = process.env.SUPABASE_URL ?? process.env.BRAINS_SUPABASE_URL ?? null;
  let key = process.env.SUPABASE_SERVICE_KEY ?? process.env.BRAINS_SUPABASE_SERVICE_KEY ?? null;
  if (!url || !key) {
    try {
      const toml = readFileSync(resolve(process.cwd(), ".dlt/secrets.toml"), "utf8");
      url = url ?? tomlStr(toml, "SUPABASE_URL") ?? tomlStr(toml, "BRAINS_SUPABASE_URL");
      key =
        key ??
        tomlStr(toml, "SUPABASE_SERVICE_KEY") ??
        tomlStr(toml, "BRAINS_SUPABASE_SERVICE_KEY");
    } catch {
      /* env-only environment: fall through to the guard below */
    }
  }
  if (!url || !key) {
    // config error, not a stall verdict (exit 2). Throw so the single catch
    // sets process.exitCode — never process.exit() here (see note on main()).
    throw new ConfigError("SUPABASE_URL / SUPABASE_SERVICE_KEY not found (env or secrets)");
  }
  return { url: url.replace(/\/$/, ""), key };
}

class ConfigError extends Error {}

// Sets process.exitCode (never process.exit()): calling exit() synchronously
// while an undici fetch handle is mid-close trips a libuv assertion on Windows
// (exit 127, not the intended code). Setting exitCode + returning lets node tear
// down cleanly — same fix as scripts/check.mjs. Verdicts: 0 OK · 1 stall · 2 config/RPC.
async function main() {
  const { url, key } = creds();
  const res = await fetch(
    `${url}/rest/v1/predictions?prediction_kind=eq.slug&select=refined_at&order=refined_at.desc&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "count=exact",
      },
    },
  );
  if (!res.ok) {
    console.error(`slug-watchdog: Supabase ${res.status}: ${await res.text()}`);
    process.exitCode = 2;
    return;
  }
  // content-range: "0-0/19" → total after the slash
  const total = Number((res.headers.get("content-range") ?? "*/0").split("/")[1] ?? 0);
  const rows = await res.json();
  const latest = rows[0]?.refined_at ?? null;

  if (!latest) {
    console.error(
      `ALERT slug-watchdog: 0 prediction_kind='slug' rows exist — §6-A logging never banked.`,
    );
    process.exitCode = 1;
    return;
  }

  const ageDays = (Date.now() - new Date(latest).getTime()) / 86_400_000;
  const stale = ageDays > STALL_DAYS;
  const line = `slug-watchdog: ${total} slug rows; latest refined_at=${latest} (${ageDays.toFixed(1)}d ago); threshold=${STALL_DAYS}d`;

  if (stale) {
    console.error(
      `ALERT ${line} — slug logging may have stalled (see cadence caveat in this file).`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`OK ${line}`);
}

main().catch((e) => {
  console.error(`slug-watchdog: ${e?.message ?? e}`);
  process.exitCode = 2;
});
