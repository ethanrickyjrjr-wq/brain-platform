/**
 * Q0 smoke test — proves `@duckdb/node-api` can autoload DuckDB's `postgres`
 * extension at runtime, and (if SUPABASE_PG_* creds are available) round-trip
 * against the Supabase Postgres instance via CREATE SECRET + ATTACH + SELECT.
 *
 * This is the gate the Tool Placement policy (docs/API_BLUEPRINTS.md) refers
 * to. Architecture is "proven" only if this script exits 0.
 *
 * Two run modes:
 *   1. Creds absent (CI / fresh checkout): runs INSTALL postgres; LOAD postgres;
 *      and prints PARTIAL PASS. The binary half of the question is answered.
 *   2. Creds present (SUPABASE_PG_HOST/PORT/USER/PASSWORD set, typically
 *      loaded from .env.local): also runs CREATE SECRET, ATTACH, and a
 *      SELECT against pg.information_schema.tables. Prints FULL PASS.
 *
 * Any throw at any step is fatal — re-thrown verbatim, exit 1. Do not mask.
 *
 * Run with:  npx tsx scripts/duckdb_postgres_smoke_test.mts
 *      or:  bun scripts/duckdb_postgres_smoke_test.mts
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const ENV_PATH = path.join(REPO_ROOT, ".env.local");

function loadEnvLocal(): void {
  if (!existsSync(ENV_PATH)) return;
  const text = readFileSync(ENV_PATH, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

async function main(): Promise<void> {
  loadEnvLocal();

  const host = process.env["SUPABASE_PG_HOST"];
  const port = process.env["SUPABASE_PG_PORT"] ?? "5432";
  const user = process.env["SUPABASE_PG_USER"];
  const password = process.env["SUPABASE_PG_PASSWORD"];
  const database = process.env["SUPABASE_PG_DATABASE"] ?? "postgres";

  const credsPresent = Boolean(host && user && password);

  console.log("duckdb_postgres_smoke_test: starting");
  console.log(`  @duckdb/node-api: in-process`);
  console.log(`  SUPABASE_PG_* present: ${credsPresent ? "yes" : "no"}`);

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();

  // Step 1 — extension autoload. Always runs. This is the load-bearing half.
  await conn.run("INSTALL postgres; LOAD postgres;");
  console.log("  step 1: INSTALL postgres + LOAD postgres — OK");

  if (!credsPresent) {
    console.log(
      "  (skipping ATTACH round-trip — set SUPABASE_PG_HOST/USER/PASSWORD to exercise it)",
    );
    conn.closeSync();
    console.log(
      "SMOKE TEST PASSED (partial — extension loads; no creds for ATTACH)",
    );
    return;
  }

  // Clamp connection budget BEFORE any ATTACH — safety rail.
  await conn.run("SET pg_connection_limit=4;");
  console.log("  step 2: pg_connection_limit clamped to 4");

  // CREATE SECRET — keeps the password out of any SQL text the runtime logs.
  await conn.run(`
    CREATE OR REPLACE SECRET pg_smoke (
      TYPE POSTGRES,
      HOST '${sqlEscape(host!)}',
      PORT ${Number.parseInt(port, 10)},
      DATABASE '${sqlEscape(database)}',
      USER '${sqlEscape(user!)}',
      PASSWORD '${sqlEscape(password!)}'
    );
  `);
  console.log("  step 3: CREATE SECRET pg_smoke (TYPE POSTGRES) — OK");

  await conn.run("ATTACH '' AS pg (TYPE POSTGRES, SECRET pg_smoke);");
  console.log(
    "  step 4: ATTACH '' AS pg (TYPE POSTGRES, SECRET pg_smoke) — OK",
  );

  const reader = await conn.runAndReadAll(
    "SELECT 1 AS smoke FROM pg.information_schema.tables LIMIT 1;",
  );
  const rows = reader.getRowObjects();
  if (rows.length !== 1) {
    throw new Error(
      `expected exactly 1 row from smoke query, got ${rows.length}`,
    );
  }
  const smokeValue = rows[0]?.["smoke"];
  // DuckDB returns small ints as JS number, but BIGINT-shaped scalars come back as BigInt.
  const smokeNum =
    typeof smokeValue === "bigint" ? Number(smokeValue) : smokeValue;
  if (smokeNum !== 1) {
    throw new Error(`expected smoke=1, got ${String(smokeValue)}`);
  }
  console.log(
    "  step 5: SELECT 1 FROM pg.information_schema.tables LIMIT 1 — OK",
  );

  conn.closeSync();
  console.log(
    "SMOKE TEST PASSED — DuckDB postgres extension + Supabase ATTACH round-trip works.",
  );
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED");
  console.error(err);
  process.exit(1);
});
