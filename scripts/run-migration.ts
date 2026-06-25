// Generic SQL migration runner. Usage:
//   bun scripts/run-migration.ts migrations/20260625_active_listings_residential.sql [more.sql ...]
// Reads Postgres creds from .dlt/secrets.toml (psql is not installed on this box).
import { readFileSync } from "fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: bun scripts/run-migration.ts <file.sql> [file2.sql ...]");
  process.exit(1);
}

const secrets = readFileSync(".dlt/secrets.toml", "utf8");
function tomlStr(key: string): string {
  const m = secrets.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
  if (!m) throw new Error(`Could not find ${key} in .dlt/secrets.toml`);
  return m[1];
}
const host = tomlStr("host");
const password = tomlStr("password");
const username = tomlStr("username");
const database = tomlStr("database");
const portMatch = secrets.match(/^port\s*=\s*(\d+)/m);
const port = portMatch ? portMatch[1] : "5432";

const connStr = `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/${database}?sslmode=require`;
const sql = new Bun.SQL(connStr);

for (const file of files) {
  console.log(`Running ${file}...`);
  await sql.unsafe(readFileSync(file, "utf8"));
  console.log(`  ✓ done`);
}
await sql.end();
console.log("Migrations complete.");
