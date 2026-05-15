import { readFile, writeFile, mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * Brain Factory scaffold — stamp a new brain in 60 seconds.
 *
 *   node refinery/scaffold.mts --id=macro-swfl --domain=finance --input-brains=master
 *   node refinery/scaffold.mts --id=foo --domain=finance --dry-run
 *
 * Generates four files atomically:
 *   1. refinery/sources/{id}-source.mts        (template SourceConnector with TODO fetch)
 *   2. refinery/packs/{id}.mts                 (template PackDefinition)
 *   3. refinery/packs/index.mts                (edited — adds import + registry entry)
 *   4. docs/sql/{YYYYMMDD}_{id}_signals.sql    (template signal table)
 *
 * Pre-check: refuses to overwrite an existing file. On any failure during
 * writes the scaffold rolls back files it just created (best-effort), so a
 * partial scaffold doesn't leak.
 *
 * Validation: id must be kebab-case, domain must be one of BrainDomain,
 * input_brains must already exist in PACKS (catches typos before code runs).
 */

const BRAIN_DOMAINS = [
  "real-estate",
  "finance",
  "environmental",
  "demographics",
  "logistics",
  "hospitality",
  "macro",
] as const;
type ScaffoldDomain = (typeof BRAIN_DOMAINS)[number];

interface ScaffoldArgs {
  id: string;
  domain: ScaffoldDomain;
  inputBrains: string[];
  dryRun: boolean;
}

function fail(msg: string): never {
  console.error(`[scaffold] FAILED: ${msg}`);
  process.exit(1);
}

function parseArgs(argv: string[]): ScaffoldArgs {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");

  function flag(name: string): string | undefined {
    const prefix = `--${name}=`;
    for (const a of args) {
      if (a.startsWith(prefix)) return a.slice(prefix.length);
    }
    return undefined;
  }

  const id = flag("id");
  const domain = flag("domain");
  const inputBrainsRaw = flag("input-brains") ?? "";

  if (!id || !domain) {
    fail(
      "Usage: node refinery/scaffold.mts --id=<kebab-case> --domain=<BrainDomain> " +
        "[--input-brains=a,b] [--dry-run]",
    );
  }

  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(id) || id.includes("--")) {
    fail(
      `--id "${id}" must be kebab-case (lowercase letters, digits, single hyphens; ` +
        `start with a letter, end with letter or digit).`,
    );
  }

  if (!(BRAIN_DOMAINS as readonly string[]).includes(domain)) {
    fail(
      `--domain "${domain}" is not in the BrainDomain union. ` +
        `Allowed: ${BRAIN_DOMAINS.join(", ")}. ` +
        `(Add new domains to refinery/types/pack.mts AND docs/sql/brain_registry.sql together.)`,
    );
  }

  const inputBrains = inputBrainsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return { id, domain: domain as ScaffoldDomain, inputBrains, dryRun };
}

/** kebab-case → camelCase. `macro-swfl` → `macroSwfl`. */
function toCamel(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Today's date as YYYYMMDD for SQL filenames. */
function isoDateCompact(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// ---------- Templates ----------

function renderSourceTemplate(id: string): string {
  const camel = toCamel(id);
  const pascal = camel.charAt(0).toUpperCase() + camel.slice(1);
  return `import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * ${id} source connector — fill in fetch() with your data source.
 *
 * Trust tier (REPLACE THIS):
 *   1 = primary (federal / SEC / NOAA / official-stat agency)
 *   2 = verified editorial (curated, cited, human-reviewed)
 *   3 = secondary aggregator / industry report
 *   4 = inferred / weakly attested
 *
 * Single point of schema knowledge — if the source's column shape changes,
 * this is the only file to update.
 */

const SOURCE_ID = "${id}_primary";

/** Normalized shape one fragment carries — Stage 2's fitScore() reads this. */
export interface ${pascal}Normalized {
  // TODO: define the normalized columns for one fragment
  placeholder: string;
}

export const ${camel}Source: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 3, // TODO: replace with the actual tier for this source
  async fetch(): Promise<RawFragment[]> {
    // TODO: fetch + normalize. For fixture-mode support, read env.source and
    // load refinery/__fixtures__/${id}.sample.json when set to "fixture".
    throw new Error("${id}-source: fetch() not implemented");
    // Reference shape — uncomment and adapt:
    // const fetched_at = isoTimestamp();
    // return rows.map((row): RawFragment<${pascal}Normalized> => ({
    //   fragment_id: fragmentId(SOURCE_ID, String(row.id)),
    //   source_id: SOURCE_ID,
    //   source_trust_tier: 3,
    //   fetched_at,
    //   raw: row,
    //   normalized: { placeholder: String(row.id) },
    // }));
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source: "TODO: human-readable source name (will appear in CITATION TABLE)",
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
`;
}

function renderPackTemplate(args: ScaffoldArgs): string {
  const { id, domain, inputBrains } = args;
  const camel = toCamel(id);
  const inputBrainImports =
    inputBrains.length > 0
      ? `\nimport { makeBrainInputSource } from "../sources/brain-input-source.mts";`
      : "";
  const inputBrainSources = inputBrains
    .map((u) => `    makeBrainInputSource(${JSON.stringify(u)}),`)
    .join("\n");
  const inputBrainsArrayLiteral =
    inputBrains.length === 0
      ? "[]"
      : `[${inputBrains.map((u) => JSON.stringify(u)).join(", ")}]`;

  return `import type { PackDefinition } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import { ${camel}Source } from "../sources/${id}-source.mts";${inputBrainImports}

/**
 * ${id} pack — scaffolded by refinery/scaffold.mts.
 *
 * TODO list to ship this brain:
 *   1. Implement ${camel}Source.fetch() in refinery/sources/${id}-source.mts
 *   2. Set the correct trust_tier on the source connector
 *   3. Tune fitScore (deterministic pack-fit) for this brain's signal
 *   4. Add an optional corpusSummary if you have deterministic aggregates
 *   5. Replace the placeholder preferences / activeProject / prompts
 *   6. Run \`npm run refinery ${id} --dry-run\` to validate
 *   7. Run \`npm run refinery ${id}\` to render brains/${id}.md
 */
export const ${camel}: PackDefinition = {
  id: "${id}",
  brain_id: "${id}",
  domain: ${JSON.stringify(domain)},
  scope:
    "TODO: one-line scope statement — what this brain COVERS, never who it serves.",
  ttl_seconds: 604800, // 7 days — adjust to your data's refresh cadence
  sources: [
    ${camel}Source,${inputBrainSources ? "\n" + inputBrainSources : ""}
  ],
  input_brains: ${inputBrainsArrayLiteral},
  fitScore: (_fragment: RawFragment): number => 5, // TODO: deterministic pack-fit
  preferences: [
    "TODO: third-person line about how the user reads this brain's data.",
  ],
  activeProject: "${id}: TODO one-line active-project description.",
  prompts: {
    triageContext:
      "TODO: pack-specific Haiku triage context — what makes a fragment decision-relevant for this brain.",
    synthesisContext:
      "TODO: pack-specific Sonnet synthesis context — what facts to produce, in what voice, with what guardrails.",
  },
};
`;
}

function renderSignalsSql(id: string): string {
  return `-- =====================================================================
-- ${id} — signal table (scaffold). Fill in columns once the source connector
-- and normalize() shape are finalized.
--
-- Standard signal shape:
--   • stable id (PRIMARY KEY)
--   • verified_at TIMESTAMPTZ
--   • brain-specific columns (numeric, categorical, etc.)
-- Paste-and-run in the Supabase SQL editor — there is no migration infra.
-- =====================================================================

-- CREATE TABLE IF NOT EXISTS ${id.replace(/-/g, "_")}_signals (
--   id              TEXT PRIMARY KEY,
--   verified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
--   -- TODO: domain-specific columns
--   created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
--   updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
-- );
`;
}

// ---------- index.mts editor ----------

interface IndexEdit {
  before: string;
  after: string;
}

function planIndexEdit(
  existing: string,
  id: string,
): { edit: IndexEdit; reason: string } {
  const camel = toCamel(id);
  const importLine = `import { ${camel} } from "./${id}.mts";`;
  const entryLine = `  [${camel}.id]: ${camel},`;

  if (existing.includes(importLine)) {
    return {
      edit: { before: existing, after: existing },
      reason: `index.mts already registers "${id}" — nothing to change.`,
    };
  }

  const importsMarker = "// scaffold:imports";
  const entriesMarker = "  // scaffold:entries";
  if (!existing.includes(importsMarker) || !existing.includes(entriesMarker)) {
    throw new Error(
      `refinery/packs/index.mts is missing scaffold markers. ` +
        `Restore "${importsMarker}" and "${entriesMarker}" before re-running.`,
    );
  }

  const withImport = existing.replace(
    importsMarker,
    `${importsMarker}\n${importLine}`,
  );
  const withEntry = withImport.replace(
    entriesMarker,
    `${entriesMarker}\n${entryLine}`,
  );

  return {
    edit: { before: existing, after: withEntry },
    reason: `Inserted import + registry entry for ${camel}.`,
  };
}

// ---------- Main ----------

interface FileWrite {
  path: string;
  content: string;
  /** true if this file is being edited (already exists), false if it's a fresh create */
  edit: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const { id, domain, inputBrains, dryRun } = args;

  // Validate input_brains exist in the unified PACKS registry.
  if (inputBrains.length > 0) {
    const { PACKS } = await import("./config/packs.mts");
    const known = new Set(Object.keys(PACKS));
    const unknown = inputBrains.filter((b) => !known.has(b));
    if (unknown.length > 0) {
      fail(
        `--input-brains contains unknown ids: ${unknown.join(", ")}. ` +
          `Known: ${[...known].join(", ")}.`,
      );
    }
  }

  const root = process.cwd();
  const sourcePath = path.join(root, "refinery", "sources", `${id}-source.mts`);
  const packPath = path.join(root, "refinery", "packs", `${id}.mts`);
  const indexPath = path.join(root, "refinery", "packs", "index.mts");
  const sqlPath = path.join(
    root,
    "docs",
    "sql",
    `${isoDateCompact()}_${id.replace(/-/g, "_")}_signals.sql`,
  );

  // Pre-flight: refuse to overwrite existing files (other than index.mts, which we edit).
  for (const p of [sourcePath, packPath, sqlPath]) {
    if (await fileExists(p)) {
      fail(`Refusing to overwrite existing file: ${path.relative(root, p)}`);
    }
  }
  const indexExisting = (await fileExists(indexPath))
    ? await readFile(indexPath, "utf-8")
    : null;
  if (indexExisting === null) {
    fail(
      `refinery/packs/index.mts is missing — restore the scaffold-managed file before continuing.`,
    );
  }

  // Compute outputs
  const indexPlan = planIndexEdit(indexExisting, id);
  const writes: FileWrite[] = [
    { path: sourcePath, content: renderSourceTemplate(id), edit: false },
    { path: packPath, content: renderPackTemplate(args), edit: false },
    { path: indexPath, content: indexPlan.edit.after, edit: true },
    { path: sqlPath, content: renderSignalsSql(id), edit: false },
  ];

  console.log(`[scaffold] id=${id} domain=${domain}`);
  if (inputBrains.length > 0) {
    console.log(`[scaffold] input_brains=${inputBrains.join(", ")}`);
  }
  for (const w of writes) {
    console.log(
      `[scaffold] ${w.edit ? "edit " : "create"} ${path.relative(root, w.path)}`,
    );
  }
  console.log(`[scaffold] ${indexPlan.reason}`);

  if (dryRun) {
    console.log("[scaffold] --dry-run — no files written.");
    return;
  }

  // Execute writes — track created paths for best-effort rollback on failure.
  const created: string[] = [];
  try {
    for (const w of writes) {
      await mkdir(path.dirname(w.path), { recursive: true });
      await writeFile(w.path, w.content, "utf-8");
      if (!w.edit) created.push(w.path);
    }
  } catch (e) {
    // Best-effort rollback: only the freshly-created files. index.mts edit is
    // left as-is — the marker-based insertion is idempotent on retry.
    for (const p of created) {
      try {
        await unlink(p);
      } catch {
        // ignore
      }
    }
    fail(
      `Write failure mid-scaffold; rolled back ${created.length} new file(s): ` +
        `${(e as Error).message}`,
    );
  }

  console.log(
    `[scaffold] done. Next: implement fetch() in ${path.relative(root, sourcePath)}, ` +
      `then \`npm run refinery ${id} --dry-run\`.`,
  );
}

main().catch((err: unknown) => {
  console.error(
    `[scaffold] FAILED: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
