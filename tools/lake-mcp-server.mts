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
  s3_url: string;
  pack_id: string | null;
  vintage: string | null;
  byte_size: number | null;
}

// ---------- Pure helpers (exported for unit tests) ----------

/** Derives a DuckDB-safe view identifier from a storage path.
 *  e.g. "faf5/faf5_2024.parquet" → "faf5_2024"
 *  e.g. "tier1/run-20260527T002658Z.ndjson" → "run_20260527T002658Z"
 */
export function deriveViewName(path: string): string {
  return path
    .split("/")
    .pop()!
    .replace(/\.[^.]+$/, "") // strip any extension
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

/** Picks the DuckDB reader expression for a Tier-1 object by file extension,
 *  with the URL already escaped and embedded. Returns null for any format that
 *  is NOT registered as a DuckDB view.
 *
 *  Only `.parquet` is registered: read_parquet is the reader composeQuery emits,
 *  and the inventory also holds ndjson run-logs + .csv.gz / .geojson.gz cold
 *  dumps. Running read_parquet on those throws "No magic bytes found" — which
 *  used to abort the entire server. Probing the live files confirmed ndjson
 *  run-logs have irregular/colliding schemas and geojson is a single >16MB
 *  FeatureCollection, so neither is a clean tabular view. Their distilled,
 *  queryable form lives in Tier-2 Postgres (pg.data_lake.*), already exposed
 *  via query_lake. (csv/ndjson view support is a tracked follow-up.)
 */
export function tier1ReaderExpr(s3Url: string): string | null {
  if (s3Url.toLowerCase().endsWith(".parquet")) {
    return `read_parquet('${sqlEscape(s3Url)}')`;
  }
  return null;
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

  // Step 2 — Keep only rows we can register as a DuckDB view (`.parquet`).
  // The inventory also tracks ndjson run-logs and .csv.gz / .geojson.gz cold
  // dumps; those are reachable via Postgres (pg.data_lake.*), not as views.
  const viewRows = inventoryRows.filter((r) =>
    tier1ReaderExpr(`s3://${r.bucket}/${r.path}`),
  );
  const skippedCount = inventoryRows.length - viewRows.length;

  // Step 3 — Resolve S3 creds (required to read any Tier-1 view).
  let s3:
    | { endpoint: string; accessKey: string; secretKey: string }
    | undefined;
  if (viewRows.length > 0) {
    const endpointRaw = process.env["SUPABASE_S3_ENDPOINT"];
    const accessKey = process.env["SUPABASE_S3_ACCESS_KEY_ID"];
    const secretKey = process.env["SUPABASE_S3_SECRET_ACCESS_KEY"];
    if (!endpointRaw || !accessKey || !secretKey) {
      console.error(
        "[lake-mcp] Warning: SUPABASE_S3_* env vars missing; Parquet views skipped.",
      );
    } else {
      s3 = {
        endpoint: endpointRaw.replace(/^https?:\/\//, ""),
        accessKey,
        secretKey,
      };
    }
  }

  // Step 4 — Run setup (S3 + Postgres) once. We deliberately strip the
  // CREATE VIEW statements composeQuery emits and register each view ourselves
  // in Step 5, so a single unreadable object can never abort startup again.
  const setupStatements = composeQuery({
    source_id: "lake_mcp",
    parquetViews: s3 ? viewRows.map(inventoryRowToParquetView) : [],
    pgAttachments: [{ alias: "pg", readOnly: true }],
    query: "SELECT 1", // placeholder — dropped below
    s3,
    pg,
  })
    .slice(0, -1) // drop the "SELECT 1" placeholder
    .filter((stmt) => !/^\s*CREATE OR REPLACE VIEW\b/i.test(stmt));

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  for (const stmt of setupStatements) {
    await conn.run(stmt);
  }

  // Step 5 — Register each Tier-1 view in its own try/catch. A view that fails
  // (corrupt file, transient S3 error) is logged and skipped; the server still
  // comes up with every view that did register.
  const registered: ViewMeta[] = [];
  const usedNames = new Set<string>();
  if (s3) {
    for (const row of viewRows) {
      const s3_url = `s3://${row.bucket}/${row.path}`;
      const reader = tier1ReaderExpr(s3_url);
      if (!reader) continue;
      let name = deriveSafeViewName(row.path);
      // Final guard: two distinct objects could still resolve to one name.
      if (usedNames.has(name)) {
        let i = 2;
        while (usedNames.has(`${name}_${i}`)) i++;
        name = `${name}_${i}`;
      }
      usedNames.add(name);
      try {
        await conn.run(
          `CREATE OR REPLACE VIEW ${name} AS SELECT * FROM ${reader};`,
        );
        registered.push({
          name,
          s3_url,
          pack_id: row.pack_id,
          vintage: row.vintage,
          byte_size: row.byte_size,
        });
      } catch (err) {
        console.error(
          `[lake-mcp] skipped view "${name}" (${row.path}): ` +
            String(err).split("\n")[0].slice(0, 140),
        );
      }
    }
  }
  registeredViews = registered;
  mainConn = conn;

  console.error(
    `[lake-mcp] Ready — ${registered.length} Parquet view(s) registered; ` +
      `${skippedCount} non-parquet row(s) skipped (run-logs / cold dumps — query via pg.data_lake.*); ` +
      `Postgres READ_ONLY (pg.data_lake.*)`,
  );
}

// ---------- Tool handlers ----------

function handleListViews(): object {
  return {
    parquet_views: registeredViews,
    postgres_alias: "pg",
    postgres_note:
      'Use query_lake("SELECT * FROM pg.data_lake.<table> LIMIT 10") to explore Tier 2 tables.',
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
        "List registered Tier 1 Parquet views and the Tier 2 Postgres alias (pg). " +
        "Use these names with query_lake or describe_view.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "describe_view",
      description:
        "Show the column names and types of a registered Parquet view.",
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
        "Execute a read-only SQL query against Tier 1 Parquet views or Tier 2 Postgres " +
        "(pg.data_lake.*). Allowed keywords: SELECT, WITH, EXPLAIN, DESCRIBE, SHOW, PRAGMA. " +
        "Results capped at 10,000 rows. " +
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
