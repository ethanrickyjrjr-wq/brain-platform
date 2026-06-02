// tools/lake-mcp-server.mts
import process from "node:process";
import { DuckDBInstance } from "@duckdb/node-api";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  composeQuery,
  sqlEscape,
  type ParquetView,
} from "../refinery/sources/duckdb-source.mts";
import { requirePgEnv, type PgCreds } from "../refinery/config/env.mts";

// env.mts calls process.loadEnvFile(".env.local") on import — no need to repeat.

// ---------- Types ----------

export interface InventoryRow {
  id: string;
  bucket: string;
  path: string;
  vintage: string | null;
  byte_size: number | null;
  pack_id: string | null;
  source_url: string | null;
}

export interface ViewMeta {
  name: string;
  format: string;
  /** How many Tier-1 files back this view (1 for a flat file; N for a merged
   *  partitioned dataset). */
  file_count: number;
  /** Single s3:// url, or "s3://bucket/<dataset>/ (N files)" for a merged view. */
  source: string;
  vintage: string | null;
}

// ---------- Pure helpers (exported for unit tests) ----------

/** Derives a DuckDB-safe view identifier from a storage path.
 *  e.g. "faf5/faf5_2024.parquet" → "faf5_2024"
 *  e.g. "tier1/run-20260527T002658Z.ndjson" → "run_20260527T002658Z"
 *  e.g. "leepa/just_value/2026-05-19.csv.gz" → "2026_05_19"
 */
export function deriveViewName(path: string): string {
  return path
    .split("/")
    .pop()!
    .replace(/\.(gz|bz2|zst|zstd)$/i, "") // drop compression suffix first
    .replace(/\.[^.]+$/, "") // then the data extension
    .replace(/[^a-zA-Z0-9_]/g, "_"); // hyphens/dots → underscore
}

/** Returns true when the SQL starts with a read-only keyword. */
export function isAllowedSql(sql: string): boolean {
  return /^\s*(select|explain|describe|show|pragma|with)\b/i.test(sql);
}

/** Appends LIMIT 10000 if the query has no LIMIT clause. */
export function buildFinalQuery(sql: string): string {
  if (/\blimit\b/i.test(sql)) return sql;
  return `${sql.trimEnd().replace(/;\s*$/, "")}\nLIMIT 10000`;
}

/** Maps a _tier1_inventory row to a ParquetView for composeQuery. */
export function inventoryRowToParquetView(row: InventoryRow): ParquetView {
  return {
    name: deriveViewName(row.path),
    s3_url: `s3://${row.bucket}/${row.path}`,
  };
}

export type Tier1Format = "parquet" | "csv" | "ndjson" | "geojson" | "other";

/** Classifies a Tier-1 object by file extension. Compression suffix aware. */
export function tier1Format(path: string): Tier1Format {
  const l = path.toLowerCase();
  if (l.endsWith(".parquet")) return "parquet";
  if (l.endsWith(".csv") || l.endsWith(".csv.gz")) return "csv";
  if (l.endsWith(".geojson") || l.endsWith(".geojson.gz")) return "geojson";
  if (l.endsWith(".ndjson") || l.endsWith(".jsonl") || l.endsWith(".json"))
    return "ndjson";
  return "other";
}

/** True when the path carries a Hive partition segment (e.g. `year=2026`). */
export function isPartitioned(path: string): boolean {
  return path.split("/").some((seg) => seg.includes("="));
}

/** Coerces an arbitrary string into a valid, non-empty DuckDB identifier. */
export function safeIdent(raw: string): string {
  let s = raw
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (/^[0-9]/.test(s)) s = `t_${s}`;
  return s || "view";
}

export interface ViewGroup {
  name: string;
  format: "parquet" | "csv" | "ndjson";
  rows: InventoryRow[];
}

/** Groups inventory rows into the views the MCP will register.
 *
 *  - Hive-PARTITIONED layouts (`<dataset>/<dim>/year=/month=/run-*.ndjson`)
 *    collapse into ONE view per top-level folder — all run-snapshots of one
 *    dataset, unioned (a time series of runs). This is what turns ~90 ndjson
 *    run-logs into a handful of queryable views.
 *  - FLAT layouts (a file directly in a folder, no partition) get ONE view per
 *    FILE. Flat folders mix distinct datasets (environmental/ holds several
 *    different parquet schemas) and flat files are usually full snapshots
 *    (leepa/just_value/<date>.csv.gz) where unioning would double-count — so
 *    per-file is the only safe grain.
 *  - geojson / unknown formats are skipped (their data lives in pg.data_lake.*).
 *
 *  Reader choices verified against the live lake before shipping.
 */
export function buildViewGroups(rows: InventoryRow[]): ViewGroup[] {
  const acc = new Map<
    string,
    {
      format: "parquet" | "csv" | "ndjson";
      nameBase: string;
      rows: InventoryRow[];
    }
  >();
  for (const row of rows) {
    const format = tier1Format(row.path);
    if (format === "geojson" || format === "other") continue;
    const segs = row.path.split("/").filter(Boolean);
    let key: string;
    let nameBase: string;
    if (isPartitioned(row.path)) {
      const top = segs[0] ?? row.path;
      key = `P:${top}:${format}`;
      nameBase = top;
    } else {
      key = `F:${row.path}`; // per-file grain
      nameBase = deriveSafeViewName(row.path);
    }
    const g = acc.get(key) ?? { format, nameBase, rows: [] };
    g.rows.push(row);
    acc.set(key, g);
  }
  const used = new Set<string>();
  const out: ViewGroup[] = [];
  for (const g of acc.values()) {
    let name = safeIdent(g.nameBase);
    if (used.has(name)) {
      let i = 2;
      while (used.has(`${name}_${i}`)) i++;
      name = `${name}_${i}`;
    }
    used.add(name);
    out.push({ name, format: g.format, rows: g.rows });
  }
  return out;
}

/** Builds the DuckDB reader expression for a group of same-format S3 objects.
 *  Passes the explicit file list (not a glob) so only inventoried files are
 *  read. ndjson/csv use union_by_name so files with drifting columns union
 *  cleanly; ndjson adds ignore_errors + a raised object-size cap (run records
 *  can be large). These exact forms were verified against the live lake.
 */
export function tier1ListReader(
  format: "parquet" | "csv" | "ndjson",
  s3Urls: string[],
): string {
  const list = `[${s3Urls.map((u) => `'${sqlEscape(u)}'`).join(", ")}]`;
  switch (format) {
    case "parquet":
      return `read_parquet(${list})`;
    case "csv":
      return `read_csv_auto(${list}, union_by_name=true)`;
    case "ndjson":
      return `read_json_auto(${list}, union_by_name=true, ignore_errors=true, maximum_object_size=104857600)`;
  }
}

/** Produces a valid, collision-resistant DuckDB identifier for a view.
 *  deriveViewName() uses only the filename, which can (a) start with a digit
 *  (e.g. "2026-05.parquet" -> "2026_05", which DuckDB rejects as an unquoted
 *  identifier) and (b) collide across folders (macro/census_vip/2026-05.parquet
 *  and macro/bls_ppi/2026-05.parquet both -> "2026_05"). When the base name is
 *  invalid (leading digit), qualify it with its parent folder; if that still
 *  leads with a digit, prefix "t_". Names that are already valid and unique
 *  (e.g. "faf5_2024") are returned unchanged.
 */
export function deriveSafeViewName(path: string): string {
  let name = deriveViewName(path);
  if (/^[0-9]/.test(name)) {
    const segs = path.split("/").filter(Boolean);
    const parent = segs.length >= 2 ? segs[segs.length - 2]! : "";
    name = `${parent}_${name}`.replace(/[^a-zA-Z0-9_]/g, "_");
  }
  if (/^[0-9]/.test(name)) name = `t_${name}`;
  return name;
}

// ---------- Startup ----------

/** Fetch _tier1_inventory via a dedicated short-lived DuckDB connection.
 *  A separate connection avoids the chicken-and-egg problem of needing
 *  inventory rows to configure the main connection's Parquet views.
 */
async function fetchInventory(pg: PgCreds): Promise<InventoryRow[]> {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  try {
    await conn.run("INSTALL postgres; LOAD postgres;");
    await conn.run(
      [
        "CREATE OR REPLACE SECRET inv_pg (",
        "  TYPE POSTGRES,",
        `  HOST '${sqlEscape(pg.host)}',`,
        `  PORT ${pg.port},`,
        `  DATABASE '${sqlEscape(pg.database)}',`,
        `  USER '${sqlEscape(pg.user)}',`,
        `  PASSWORD '${sqlEscape(pg.password)}'`,
        ");",
      ].join("\n"),
    );
    await conn.run(
      "ATTACH '' AS inv (TYPE POSTGRES, SECRET inv_pg, READ_ONLY);",
    );
    const reader = await conn.runAndReadAll(
      "SELECT id, bucket, path, vintage, byte_size, pack_id, source_url" +
        " FROM inv.data_lake._tier1_inventory",
    );
    return reader.getRowObjects() as unknown as InventoryRow[];
  } finally {
    conn.closeSync();
  }
}

// ---------- Session state (populated by startup()) ----------

type DuckDBConn = Awaited<
  ReturnType<InstanceType<typeof DuckDBInstance>["connect"]>
>;
let mainConn: DuckDBConn | null = null;
let registeredViews: ViewMeta[] = [];

async function startup(): Promise<void> {
  const pg = requirePgEnv();

  // Step 1 — Discover Tier 1 Parquet views
  let inventoryRows: InventoryRow[] = [];
  try {
    inventoryRows = await fetchInventory(pg);
  } catch (err) {
    console.error("[lake-mcp] Warning: _tier1_inventory fetch failed:", err);
    // Proceed with zero Parquet views; Postgres still available.
  }

  // Step 2 — Group inventory rows into the views to register. Partitioned
  // datasets merge into one view per top folder; flat files stay per-file;
  // geojson / unknown formats are skipped (reachable via pg.data_lake.*).
  const groups = buildViewGroups(inventoryRows);
  const viewableRows = groups.reduce((n, g) => n + g.rows.length, 0);
  const skippedCount = inventoryRows.length - viewableRows;

  // Step 3 — Resolve S3 creds (required to read any Tier-1 view).
  let s3:
    | { endpoint: string; accessKey: string; secretKey: string }
    | undefined;
  if (groups.length > 0) {
    const endpointRaw = process.env["SUPABASE_S3_ENDPOINT"];
    const accessKey = process.env["SUPABASE_S3_ACCESS_KEY_ID"];
    const secretKey = process.env["SUPABASE_S3_SECRET_ACCESS_KEY"];
    if (!endpointRaw || !accessKey || !secretKey) {
      console.error(
        "[lake-mcp] Warning: SUPABASE_S3_* env vars missing; Tier-1 views skipped.",
      );
    } else {
      s3 = {
        endpoint: endpointRaw.replace(/^https?:\/\//, ""),
        accessKey,
        secretKey,
      };
    }
  }

  // Step 4 — Open the connection and run setup. Postgres attach comes from
  // composeQuery (parquetViews: [] => pg-only, emits no view statements); the
  // S3/httpfs block is emitted directly here. Views are registered per-group in
  // Step 5 so a single unreadable dataset can never abort startup again.
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();

  const pgSetup = composeQuery({
    source_id: "lake_mcp",
    parquetViews: [],
    pgAttachments: [{ alias: "pg", readOnly: true }],
    query: "SELECT 1", // placeholder — dropped below
    pg,
  }).slice(0, -1);
  for (const stmt of pgSetup) {
    await conn.run(stmt);
  }

  if (s3) {
    // Mirrors composeQuery's S3 block (refinery/sources/duckdb-source.mts).
    await conn.run("INSTALL httpfs; LOAD httpfs;");
    await conn.run(
      [
        `SET s3_endpoint='${sqlEscape(s3.endpoint)}';`,
        `SET s3_access_key_id='${sqlEscape(s3.accessKey)}';`,
        `SET s3_secret_access_key='${sqlEscape(s3.secretKey)}';`,
        "SET s3_region='us-east-1';",
        "SET s3_url_style='path';",
        "SET s3_use_ssl=true;",
      ].join("\n"),
    );
  }

  // Step 5 — Register each dataset view in its own try/catch. A view that fails
  // (corrupt file, transient S3 error, drifting schema) is logged and skipped;
  // the server still comes up with every view that did register.
  const registered: ViewMeta[] = [];
  if (s3) {
    for (const g of groups) {
      const urls = g.rows.map((r) => `s3://${r.bucket}/${r.path}`);
      const reader = tier1ListReader(g.format, urls);
      try {
        await conn.run(
          `CREATE OR REPLACE VIEW ${g.name} AS SELECT * FROM ${reader};`,
        );
        const top = g.rows[0]!.path.split("/")[0] ?? "";
        registered.push({
          name: g.name,
          format: g.format,
          file_count: urls.length,
          source:
            urls.length === 1
              ? urls[0]!
              : `s3://${g.rows[0]!.bucket}/${top}/ (${urls.length} files)`,
          vintage:
            g.rows
              .map((r) => r.vintage)
              .filter((v): v is string => !!v)
              .sort()
              .pop() ?? null,
        });
      } catch (err) {
        console.error(
          `[lake-mcp] skipped view "${g.name}" (${g.format}, ${urls.length} file(s)): ` +
            String(err).split("\n")[0].slice(0, 140),
        );
      }
    }
  }
  registeredViews = registered;
  mainConn = conn;

  console.error(
    `[lake-mcp] Ready — ${registered.length} Tier-1 view(s) over ${viewableRows} file(s); ` +
      `${skippedCount} row(s) skipped (geojson/other — query via pg.data_lake.*); ` +
      `Postgres READ_ONLY (pg.data_lake.*)`,
  );
}

// ---------- Tool handlers ----------

function handleListViews(): object {
  return {
    views: registeredViews,
    postgres_alias: "pg",
    note:
      "Tier-1 datasets are exposed as the views above (parquet/csv/ndjson) — use their " +
      "names with query_lake / describe_view. Tier-2 tables live under the pg alias, e.g. " +
      'query_lake("SELECT * FROM pg.data_lake.<table> LIMIT 10").',
  };
}

async function handleDescribeView(viewName: string): Promise<object> {
  const knownNames = new Set(registeredViews.map((v) => v.name));
  if (!knownNames.has(viewName)) {
    const valid = [...knownNames].join(", ") || "(none registered)";
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unknown view "${viewName}". Valid names: ${valid}. For Postgres tables use query_lake.`,
    );
  }
  const reader = await mainConn!.runAndReadAll(
    `DESCRIBE SELECT * FROM ${viewName} LIMIT 0`,
  );
  return { columns: reader.getRowObjects() };
}

async function handleQueryLake(sql: string): Promise<object> {
  if (!isAllowedSql(sql)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Query rejected: must start with SELECT, WITH, EXPLAIN, DESCRIBE, SHOW, or PRAGMA.\n` +
        `Got: ${sql.slice(0, 120)}`,
    );
  }
  const finalSql = buildFinalQuery(sql);
  const reader = await mainConn!.runAndReadAll(finalSql);
  return { rows: reader.getRowObjects() };
}

/** JSON.stringify that survives DuckDB's native value types. DuckDB returns
 *  64-bit integers (count/sum, ids) as JS BigInt, which JSON.stringify throws
 *  on. Convert BigInt within the safe-integer range to Number; anything larger
 *  to a string (lossless). Dates already serialize to ISO strings.
 */
export function jsonSafe(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) =>
      typeof v === "bigint"
        ? v >= BigInt(Number.MIN_SAFE_INTEGER) &&
          v <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(v)
          : v.toString()
        : v,
    2,
  );
}

// ---------- MCP server ----------

const server = new Server(
  { name: "lake", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_views",
      description:
        "List registered Tier 1 dataset views (parquet/csv/ndjson) and the Tier 2 " +
        "Postgres alias (pg). Use these names with query_lake or describe_view.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "describe_view",
      description:
        "Show the column names and types of a registered Tier 1 dataset view.",
      inputSchema: {
        type: "object",
        properties: {
          view: {
            type: "string",
            description: "View name from list_views (e.g. 'faf5_2024')",
          },
        },
        required: ["view"],
      },
    },
    {
      name: "query_lake",
      description:
        "Execute a read-only SQL query against Tier 1 dataset views (from list_views) or " +
        "Tier 2 Postgres (pg.data_lake.*). Allowed keywords: SELECT, WITH, EXPLAIN, DESCRIBE, " +
        "SHOW, PRAGMA. Results capped at 10,000 rows. " +
        "Example: SELECT * FROM pg.data_lake.corridor_profiles LIMIT 5",
      inputSchema: {
        type: "object",
        properties: {
          sql: { type: "string", description: "SQL query to execute" },
        },
        required: ["sql"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "list_views") {
      return {
        content: [{ type: "text", text: jsonSafe(handleListViews()) }],
      };
    }
    if (name === "describe_view") {
      const result = await handleDescribeView((args as { view: string }).view);
      return {
        content: [{ type: "text", text: jsonSafe(result) }],
      };
    }
    if (name === "query_lake") {
      const result = await handleQueryLake((args as { sql: string }).sql);
      return {
        content: [{ type: "text", text: jsonSafe(result) }],
      };
    }
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  } catch (err) {
    if (err instanceof McpError) throw err;
    return {
      content: [{ type: "text", text: `Error: ${String(err)}` }],
      isError: true,
    };
  }
});

// Only start when invoked directly (not when imported by tests).
if (import.meta.main) {
  process.on("exit", () => {
    mainConn?.closeSync();
  });
  startup()
    .then(() => {
      const transport = new StdioServerTransport();
      return server.connect(transport);
    })
    .catch((err) => {
      console.error("[lake-mcp] Fatal startup error:", err);
      process.exit(1);
    });
}
