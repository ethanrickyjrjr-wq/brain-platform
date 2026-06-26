// scripts/check-schema-drift.ts
// Fails if database-generated.types.ts is stale vs the live prod DB.
// Run:  bun run check:schema-drift
// CI only � requires DB creds; NOT wired into local pre-push hook.
import { readFileSync } from "fs";
import { execSync } from "child_process";

// ---- connection (same logic as scripts/gen-supabase-types.ts) ----
const secrets = readFileSync(".dlt/secrets.toml", "utf8");
const t = (k: string) => secrets.match(new RegExp(`^${k}\\s*=\\s*"([^"]+)"`, "m"))![1];
const port = (secrets.match(/^port\s*=\s*(\d+)/m) || [])[1] || "5432";
const conn = `postgres://${t("username")}:${encodeURIComponent(t("password"))}@${t("host")}:${port}/${t("database")}?sslmode=require`;
const sql = new Bun.SQL(conn);

const rows = (await sql.unsafe(`
  SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public'
  ORDER BY table_name, ordinal_position
`)) as Array<{
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
}>;
await sql.end();

function tsType(dt: string, udt: string): string {
  if (dt === "ARRAY") return tsBase(udt.replace(/^_/, "")) + "[]";
  return tsBase(udt || dt);
}
function tsBase(u: string): string {
  if (/^(text|varchar|bpchar|char|uuid|name|citext)$/.test(u)) return "string";
  if (/^(timestamptz|timestamp|date|time|timetz|interval)$/.test(u)) return "string";
  if (/^(int2|int4|int8|numeric|float4|float8|money)$/.test(u)) return "number";
  if (/^bool$/.test(u)) return "boolean";
  if (/^(jsonb|json)$/.test(u)) return "Json";
  return "string";
}
const byTable: Record<string, typeof rows> = {};
for (const r of rows) (byTable[r.table_name] ??= []).push(r);
let fresh = `export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]\n\nexport interface Database {\n  public: {\n    Tables: {\n`;
for (const [table, cols] of Object.entries(byTable)) {
  fresh += `      ${table}: {\n        Row: {\n`;
  for (const c of cols) {
    const nul = c.is_nullable === "YES" ? " | null" : "";
    fresh += `          ${c.column_name}: ${tsType(c.data_type, c.udt_name)}${nul}\n`;
  }
  fresh += `        }\n        Insert: {\n`;
  for (const c of cols) {
    const optional = c.is_nullable === "YES" || c.column_default !== null;
    const nul = c.is_nullable === "YES" ? " | null" : "";
    fresh += `          ${c.column_name}${optional ? "?" : ""}: ${tsType(c.data_type, c.udt_name)}${nul}\n`;
  }
  fresh += `        }\n        Update: {\n`;
  for (const c of cols) {
    const nul = c.is_nullable === "YES" ? " | null" : "";
    fresh += `          ${c.column_name}?: ${tsType(c.data_type, c.udt_name)}${nul}\n`;
  }
  fresh += `        }\n        Relationships: []\n      }\n`;
}
fresh += `    }\n    Views: Record<string, never>\n    Functions: Record<string, never>\n    Enums: Record<string, never>\n    CompositeTypes: Record<string, never>\n  }\n}\n`;

const current = readFileSync("database-generated.types.ts", "utf8");

// Normalize both sides through prettier to eliminate formatting differences
// (semicolons added by the pre-commit hook, trailing newlines, etc.).
function prettify(src: string): string {
  return execSync("bunx prettier --parser typescript", {
    input: src,
    encoding: "utf8",
  });
}

const freshNorm = prettify(fresh);
const currentNorm = prettify(current);

if (freshNorm !== currentNorm) {
  console.error("database-generated.types.ts is STALE vs live prod � run: bun run gen:types");
  process.exit(1);
} else {
  console.log(
    `database-generated.types.ts is in-sync with live prod (${Object.keys(byTable).length} tables, ${rows.length} columns).`,
  );
  process.exit(0);
}
