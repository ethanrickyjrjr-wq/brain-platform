/**
 * Step 4 — DB writer for the corridor-character preview output.
 *
 * Plan of record:
 *   docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md
 *   — Step 4 ("Only after operator returns 5/5 pass: write all 26 to DB").
 *
 * Reads the preview JSONs that `run-corridor-character-preview.mts`
 * dropped to disk, and UPSERTs the six character_* columns onto
 * corridor_profiles for each lint-clean corridor. `.rejected.json` files
 * are SKIPPED — lint failures stay out of the DB.
 *
 * --- Why a separate tool ---
 * The preview tool's job is "build fact pack + grounded NDJSON + synth +
 * write preview JSON." Adding --write-db to the same tool would conflate
 * two responsibilities (API spend vs. DB writes) and force a second
 * Anthropic run when the operator just wants to commit the previews they
 * already approved. Splitting lets the operator:
 *   1. Run --preview, scan output, iterate prompt/lint if needed.
 *   2. Once happy, point this tool at the preview dir and commit.
 * The two stages share no state besides the JSON files on disk.
 *
 * --- What gets written ---
 * Per the Step 2 SQL migration:
 *   - character_facts             (TEXT)     ← output.facts_block
 *   - character_chart             (JSONB)    ← output.chart_block
 *   - character_speculative       (TEXT)     ← output.speculative_block
 *   - character_citations         (JSONB)    ← output.citations
 *   - character_generated_at      (TIMESTAMPTZ) ← preview JSON's generated_at
 *   - character_fact_pack_vintage (TEXT)     ← preview JSON's fact_pack_vintage
 *
 * The legacy `character` TEXT column is NEVER touched — per the plan, it
 * stays as cold fallback for one full quarterly cycle before deletion is
 * considered.
 *
 * --- Idempotent ---
 * Re-running overwrites the six character_* fields with whatever the
 * latest preview produced. corridor_name match is exact; missing rows
 * cause the corridor to be skipped with a warning (operator likely
 * renamed but the preview is stale).
 *
 * CLI:
 *   bun refinery/tools/write-corridor-character-to-db.mts          # all clean previews
 *   bun refinery/tools/write-corridor-character-to-db.mts --corridor="Pine Ridge Rd Naples"
 *   bun refinery/tools/write-corridor-character-to-db.mts --corridors="A,B,C"
 *   bun refinery/tools/write-corridor-character-to-db.mts --preview-dir=/tmp/cc-step4-preview
 *   bun refinery/tools/write-corridor-character-to-db.mts --dry-run     # log what would write
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { getSupabase } from "../sources/supabase.mts";

const DEFAULT_PREVIEW_DIR = "/tmp/cc-step4-preview";

// ── CLI ─────────────────────────────────────────────────────────────────────

interface CliArgs {
  /** null = every clean *.json in the preview dir. */
  corridorFilter: string[] | null;
  previewDir: string;
  dryRun: boolean;
}

function parseCli(argv: readonly string[]): CliArgs {
  const out: CliArgs = {
    corridorFilter: null,
    previewDir: DEFAULT_PREVIEW_DIR,
    dryRun: false,
  };
  for (const a of argv) {
    if (a.startsWith("--corridor=")) {
      const v = a.slice("--corridor=".length).replace(/^"|"$/g, "");
      out.corridorFilter = [v];
    } else if (a.startsWith("--corridors=")) {
      const raw = a.slice("--corridors=".length).replace(/^"|"$/g, "");
      const names = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (names.length === 0) {
        throw new Error(
          "write-corridor-character-to-db: --corridors= must include at least one name.",
        );
      }
      out.corridorFilter = names;
    } else if (a.startsWith("--preview-dir=")) {
      out.previewDir = a.slice("--preview-dir=".length);
    } else if (a === "--dry-run") {
      out.dryRun = true;
    } else if (a === "--help" || a === "-h") {
      // handled in main()
    } else {
      throw new Error(
        `write-corridor-character-to-db: unknown argument "${a}". ` +
          `Use --corridor="NAME" or --corridors="A,B,C" --preview-dir=DIR [--dry-run].`,
      );
    }
  }
  return out;
}

const USAGE = `Usage:
  bun refinery/tools/write-corridor-character-to-db.mts [flags]

Flags:
  --corridor=NAME      Write one corridor by exact corridor_name. Default: all clean previews.
  --corridors=A,B,C    Write a comma-separated subset.
  --preview-dir=DIR    Directory holding preview JSONs.
                       Default: ${DEFAULT_PREVIEW_DIR}
  --dry-run            Log what would be written; skip the UPSERT.

Reads *.json files (NOT *.rejected.json — those are lint failures and stay out of the DB).
Writes 6 character_* columns on corridor_profiles. Idempotent.`;

// ── Preview-JSON shape (mirrors run-corridor-character-preview.mts dump) ─────

interface PreviewFile {
  corridor_name: string;
  slug: string;
  county: string;
  generated_at: string;
  fact_pack_vintage: string;
  lint_ok?: boolean;
  output: {
    facts_block: string;
    chart_block: unknown;
    speculative_block: string;
    citations: unknown;
  };
}

// ── Discovery + write ───────────────────────────────────────────────────────

async function discoverPreviewFiles(
  previewDir: string,
  filter: string[] | null,
): Promise<{ corridor: string; path: string }[]> {
  let entries: string[];
  try {
    entries = await readdir(previewDir);
  } catch (err) {
    throw new Error(
      `preview-dir ${previewDir} unreadable — run ` +
        `run-corridor-character-preview.mts first. (${err instanceof Error ? err.message : err})`,
    );
  }
  const cleanJsons = entries.filter(
    (f) => f.endsWith(".json") && !f.endsWith(".rejected.json"),
  );

  const out: { corridor: string; path: string }[] = [];
  for (const fname of cleanJsons) {
    const fpath = path.join(previewDir, fname);
    const raw = await readFile(fpath, "utf-8");
    const j = JSON.parse(raw) as PreviewFile;
    if (filter && !filter.includes(j.corridor_name)) continue;
    out.push({ corridor: j.corridor_name, path: fpath });
  }

  if (filter && out.length !== filter.length) {
    const found = new Set(out.map((x) => x.corridor));
    const missing = filter.filter((c) => !found.has(c));
    if (missing.length > 0) {
      console.warn(
        `  ⚠ filter named ${missing.length} corridor(s) with no matching clean preview:`,
      );
      for (const m of missing) console.warn(`    - ${m}`);
    }
  }
  return out;
}

interface WriteResult {
  corridor: string;
  ok: boolean;
  rows_updated?: number;
  error?: string;
}

async function writeOneCorridor(
  previewPath: string,
  dryRun: boolean,
): Promise<WriteResult> {
  const raw = await readFile(previewPath, "utf-8");
  const j = JSON.parse(raw) as PreviewFile;

  const result: WriteResult = { corridor: j.corridor_name, ok: false };

  if (dryRun) {
    console.log(
      `  [dry-run] would UPSERT ${j.corridor_name} ` +
        `(facts:${j.output.facts_block.length}c, ` +
        `spec:${j.output.speculative_block.length}c, ` +
        `chart:${j.output.chart_block ? "present" : "null"}, ` +
        `vintage:${j.fact_pack_vintage})`,
    );
    result.ok = true;
    result.rows_updated = 1;
    return result;
  }

  const supa = getSupabase();
  const { data, error } = await supa
    .from("corridor_profiles")
    .update({
      character_facts: j.output.facts_block,
      character_chart: j.output.chart_block,
      character_speculative: j.output.speculative_block,
      character_citations: j.output.citations,
      character_generated_at: j.generated_at,
      character_fact_pack_vintage: j.fact_pack_vintage,
    })
    .eq("corridor_name", j.corridor_name)
    .select("corridor_name");

  if (error) {
    result.error = `UPDATE failed: ${error.message}`;
    return result;
  }
  const rows = (data ?? []).length;
  if (rows === 0) {
    result.error = `0 rows matched corridor_name="${j.corridor_name}" — verify the name is current.`;
    return result;
  }
  result.ok = true;
  result.rows_updated = rows;
  return result;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }

  let args: CliArgs;
  try {
    args = parseCli(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    console.error("\n" + USAGE);
    return 2;
  }

  console.log("write-corridor-character-to-db:");
  console.log(`  preview-dir : ${args.previewDir}`);
  console.log(
    `  filter      : ${args.corridorFilter ? args.corridorFilter.join(", ") : "(every clean preview)"}`,
  );
  console.log(
    `  mode        : ${args.dryRun ? "dry-run" : "LIVE (will UPSERT)"}\n`,
  );

  const files = await discoverPreviewFiles(
    args.previewDir,
    args.corridorFilter,
  );
  if (files.length === 0) {
    console.error(
      "write-corridor-character-to-db: 0 clean previews matched. Nothing to write.",
    );
    return args.corridorFilter ? 2 : 0;
  }
  console.log(`  ${files.length} clean preview(s) to process.\n`);

  const results: WriteResult[] = [];
  let i = 0;
  for (const f of files) {
    i += 1;
    process.stdout.write(`[${i}/${files.length}] ${f.corridor}... `);
    try {
      const r = await writeOneCorridor(f.path, args.dryRun);
      results.push(r);
      console.log(r.ok ? "ok" : `ERROR: ${r.error}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ corridor: f.corridor, ok: false, error: msg });
      console.log(`ERROR: ${msg}`);
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const errd = results.length - ok;
  console.log(`\nwrite-corridor-character-to-db: ${ok} ok / ${errd} errored.`);
  if (args.dryRun) {
    console.log("(--dry-run — no DB rows were modified.)");
  }
  return errd > 0 ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
