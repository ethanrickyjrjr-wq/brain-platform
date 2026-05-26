/**
 * Corridor `character` snapshot puller — read-only.
 *
 * Pulls every verified, non-deleted row from Supabase `corridor_profiles`
 * and writes a markdown snapshot file at
 *   docs/audits/{YYYY-MM-DD}-corridor-character-snapshot.md
 *
 * Purpose: freeze the live `corridor_profiles.character` strings (and
 * adjacent editorial fields) as a dated baseline before the
 * corridor-character generator pipeline replaces them with synthesized
 * output. Snapshots are diff/restore artifacts — never an interactive
 * worksheet, never a source of decisions.
 *
 * This script DOES NOT mutate Supabase. It reads only. Output files are
 * committed; re-running on the same day overwrites that day's snapshot
 * with byte-identical content (modulo the embedded run timestamp).
 *
 * Usage:
 *   bun refinery/tools/pull-corridor-character-snapshot.mts
 *   npm run snapshot:corridor-character
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { getSupabase } from "../sources/supabase.mts";

const OUTPUT_DIR = path.join(process.cwd(), "docs", "audits");

const CITY_TO_COUNTY: Record<string, "Lee" | "Collier"> = {
  Naples: "Collier",
  "Fort Myers": "Lee",
  "Cape Coral": "Lee",
  Estero: "Lee",
  "Bonita Springs": "Lee",
  "Fort Myers Beach": "Lee",
};

function cityToCounty(city: string): "Lee" | "Collier" | "Unknown" {
  return CITY_TO_COUNTY[city] ?? "Unknown";
}

interface CorridorRow {
  corridor_name: string | null;
  city: string | null;
  corridor_type: string | null;
  character: string | null;
  evolution_direction: string | null;
  tenant_mix: string | null;
  source_url: string | null;
  active_flags: unknown;
  character_broker_narrative: unknown;
  character_broker_narrative_pending: unknown;
  cap_rate_pct: number | null;
  cap_rate_direction: string | null;
  vacancy_rate_pct: number | null;
  vacancy_rate_direction: string | null;
  absorption_sqft: number | null;
  absorption_sqft_direction: string | null;
  asking_rent_psf: number | null;
  asking_rent_psf_direction: string | null;
  metrics_period: string | null;
  metrics_verified_date: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const SELECT_COLS = [
  "corridor_name",
  "city",
  "corridor_type",
  "character",
  "evolution_direction",
  "tenant_mix",
  "source_url",
  "active_flags",
  "character_broker_narrative",
  "character_broker_narrative_pending",
  "cap_rate_pct",
  "cap_rate_direction",
  "vacancy_rate_pct",
  "vacancy_rate_direction",
  "absorption_sqft",
  "absorption_sqft_direction",
  "asking_rent_psf",
  "asking_rent_psf_direction",
  "metrics_period",
  "metrics_verified_date",
  "created_at",
  "updated_at",
].join(",");

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmt(value: unknown, fallback = "null"): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "null";
  return Number(value).toFixed(digits);
}

function blockquote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return "(none)";
  if (Array.isArray(value) && value.length === 0) return "(none)";
  if (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value as Record<string, unknown>).length === 0
  ) {
    return "(none)";
  }
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

function rowSection(row: CorridorRow): string {
  const city = row.city ?? "";
  const county = cityToCounty(city);
  const name = row.corridor_name ?? "(unnamed)";
  const type = row.corridor_type ?? "unknown";

  const characterBody =
    row.character === null ||
    row.character === undefined ||
    row.character.trim() === ""
      ? "_(null)_"
      : blockquote(row.character);

  const lines: string[] = [];
  lines.push(`## ${name}  ·  ${city || "(no city)"} (${county})  ·  ${type}`);
  lines.push("");
  lines.push(`**Current \`source_url\`:** ${row.source_url ?? "(none)"}`);
  lines.push("");
  lines.push("**`character` (rendered verbatim to end users):**");
  lines.push("");
  lines.push(characterBody);
  lines.push("");
  lines.push("**Other editorial fields:**");
  lines.push(`- \`evolution_direction\`: ${fmt(row.evolution_direction)}`);
  lines.push(`- \`tenant_mix\`: ${fmt(row.tenant_mix)}`);
  lines.push(`- \`active_flags\`: ${prettyJson(row.active_flags)}`);
  lines.push("");
  lines.push("**Metrics snapshot (for context):**");
  lines.push(
    `- cap_rate: ${fmtNum(row.cap_rate_pct)}% ${row.cap_rate_direction ?? "—"} · vacancy: ${fmtNum(row.vacancy_rate_pct)}% ${row.vacancy_rate_direction ?? "—"}`,
  );
  lines.push(
    `- absorption: ${row.absorption_sqft ?? "null"} sqft ${row.absorption_sqft_direction ?? "—"} · asking_rent: $${fmtNum(row.asking_rent_psf)} psf ${row.asking_rent_psf_direction ?? "—"}`,
  );
  lines.push(
    `- metrics_period: ${fmt(row.metrics_period)} · metrics_verified_date: ${fmt(row.metrics_verified_date)}`,
  );
  lines.push("");
  lines.push("**Broker narrative state:**");
  const liveNarrative =
    row.character_broker_narrative === null ||
    row.character_broker_narrative === undefined
      ? "(none — expected)"
      : prettyJson(row.character_broker_narrative);
  const pendingNarrative =
    row.character_broker_narrative_pending === null ||
    row.character_broker_narrative_pending === undefined
      ? "(none — pipeline has not yet produced rows)"
      : prettyJson(row.character_broker_narrative_pending);
  lines.push(`- Live (\`character_broker_narrative\`): ${liveNarrative}`);
  lines.push(
    `- Quarantined (\`character_broker_narrative_pending\`): ${pendingNarrative}`,
  );
  lines.push("");
  lines.push(
    `**Created:** ${fmt(row.created_at)} · **Updated:** ${fmt(row.updated_at)}`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const supa = getSupabase();
  const { data, error } = await supa
    .from("corridor_profiles")
    .select(SELECT_COLS)
    .is("deleted_at", null)
    .eq("verification_status", "verified");

  if (error) {
    throw new Error(`corridor_profiles fetch failed — ${error.message}`);
  }
  const rows = (data ?? []) as unknown as CorridorRow[];
  if (rows.length === 0) {
    throw new Error(
      "corridor_profiles returned 0 verified rows — stop and check the filter.",
    );
  }

  // Sort: Collier (Naples) first, then everyone else by city then corridor_name.
  rows.sort((a, b) => {
    const aCollier = (a.city ?? "") === "Naples" ? 0 : 1;
    const bCollier = (b.city ?? "") === "Naples" ? 0 : 1;
    if (aCollier !== bCollier) return aCollier - bCollier;
    const cityCmp = (a.city ?? "").localeCompare(b.city ?? "");
    if (cityCmp !== 0) return cityCmp;
    return (a.corridor_name ?? "").localeCompare(b.corridor_name ?? "");
  });

  let lee = 0;
  let collier = 0;
  let unknown = 0;
  const unknownCityRows: string[] = [];
  let pendingNonNullCount = 0;
  const pendingNonNullRows: string[] = [];

  for (const row of rows) {
    const county = cityToCounty(row.city ?? "");
    if (county === "Lee") lee++;
    else if (county === "Collier") collier++;
    else {
      unknown++;
      unknownCityRows.push(
        `${row.corridor_name ?? "(unnamed)"} — city=${JSON.stringify(row.city)}`,
      );
    }
    if (
      row.character_broker_narrative_pending !== null &&
      row.character_broker_narrative_pending !== undefined
    ) {
      pendingNonNullCount++;
      pendingNonNullRows.push(row.corridor_name ?? "(unnamed)");
    }
  }

  const date = todayIso();
  const total = rows.length;
  const pendingPhrase =
    pendingNonNullCount === 0
      ? "0 pending broker narratives (expected — Firecrawl pipeline has not landed a row)"
      : `${pendingNonNullCount} pending broker narratives present — see anomaly note below`;

  const header: string[] = [];
  header.push(`# Corridor character snapshot — ${date}`);
  header.push("");
  header.push(
    "Frozen snapshot of `corridor_profiles.character` (and adjacent editorial fields) for every verified non-deleted corridor in live Supabase, taken before the corridor-character generator pipeline replaces this text with synthesized output backed by deterministic local data + Gemini grounded answers.",
  );
  header.push("");
  header.push(
    "**Why this file exists:** the strings below were Claude-drafted in May 2026 without per-claim primary sources. They are being replaced — but kept here as (a) a diff baseline for evaluating generator output, and (b) restore safety in case the generator regresses and the live column gets blanked.",
  );
  header.push("");
  header.push(
    "**Do not edit.** This is a dated artifact. Future snapshots get new filenames.",
  );
  header.push("");
  header.push(
    `**Stats:** ${total} corridors · ${collier} Collier · ${lee} Lee · ${pendingPhrase} · ${unknown} unknown-county row${unknown === 1 ? "" : "s"}.`,
  );
  header.push("");
  header.push(
    "**Generator:** `refinery/tools/pull-corridor-character-snapshot.mts` (re-runnable; produces dated snapshot files).",
  );
  header.push("");
  if (unknown > 0) {
    header.push(
      "> ⚠️ **Anomaly — unknown county rows:** the `CITY_TO_COUNTY` map in",
    );
    header.push(
      "> `refinery/sources/cre-source.mts` does not cover the following city values.",
    );
    header.push(
      "> Add them to the map (or correct the row) before the next snapshot:",
    );
    header.push(">");
    for (const u of unknownCityRows) header.push(`> - ${u}`);
    header.push("");
  }
  if (pendingNonNullCount > 0) {
    header.push(
      `> ⚠️ **Anomaly — \`character_broker_narrative_pending\` is non-null on ${pendingNonNullCount} row(s):** ${pendingNonNullRows.join(", ")}.`,
    );
    header.push(
      "> The Firecrawl broker pipeline has not yet landed a row, so this should be NULL everywhere.",
    );
    header.push("> Something changed; surface to the operator.");
    header.push("");
  }
  header.push("---");
  header.push("");

  const body = rows.map(rowSection).join("");
  const md = header.join("\n") + body;

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(
    OUTPUT_DIR,
    `${date}-corridor-character-snapshot.md`,
  );
  writeFileSync(outPath, md, "utf-8");

  const relPath = path.relative(process.cwd(), outPath).replace(/\\/g, "/");
  console.log(
    `corridor-character-snapshot: wrote ${total} corridors to ${relPath} (${lee} Lee, ${collier} Collier, ${unknown} unknown-county)`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
