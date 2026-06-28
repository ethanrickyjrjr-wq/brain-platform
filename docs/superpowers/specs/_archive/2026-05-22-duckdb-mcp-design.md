# DuckDB Lake MCP Server — Design Spec

**Date:** 2026-05-22
**Status:** Approved, pending implementation
**Use case:** Dev-time exploration of Tier 1 Parquet lake + Tier 2 Postgres `data_lake.*` from Claude Code sessions, without running a full refinery pack build.

---

## 1. Architecture

**Entry point:** `tools/lake-mcp-server.mts`
**Protocol:** MCP stdio (standard input/output JSON-RPC)
**DuckDB:** Single `:memory:` instance, created at startup and held for the session. Closed via `conn.closeSync()` on process exit.
**New dependency:** `@modelcontextprotocol/sdk` added to `package.json` `dependencies`.

### Startup sequence

1. Load env vars (`.env.local`) — `SUPABASE_S3_*`, `SUPABASE_PG_*`.
2. Query `_tier1_inventory` in Supabase Postgres to auto-discover registered Tier 1 Parquet files. Columns used: `name` (view alias), `s3_url`, `description`, `row_count`.
3. Build `ParquetView[]` from inventory rows.
4. Import and call `composeQuery` from `refinery/sources/duckdb-source.mts` (do **not** copy-paste) with all discovered views + one `PgAttachment` (`alias: "pg"`, `readOnly: true`).
5. Execute setup statements one-at-a-time via `conn.run()` (same pattern as `runLive` in `duckdb-source.mts`).
6. Register MCP tools and start the stdio listener.

**Startup failure mode:** If `_tier1_inventory` query fails (Supabase unreachable, missing env vars), log a warning to `stderr`, register zero Parquet views, but keep the process alive. CT can still query `pg.data_lake.*` via `query_lake`. A flaky network moment must not kill the entire Claude Code MCP setup.

---

## 2. `PgAttachment` extension (in `refinery/sources/duckdb-source.mts`)

Add `readOnly?: boolean` to the existing `PgAttachment` interface (default: `false`; existing pack connectors are unaffected):

```typescript
export interface PgAttachment {
  alias: string;
  secret_name?: string;
  readOnly?: boolean; // default false; pass true in MCP server
}
```

Update the `ATTACH` statement in `composeQuery` to honor it:

```typescript
`ATTACH '' AS ${att.alias} (TYPE POSTGRES, SECRET ${secretName}${att.readOnly ? ", READ_ONLY" : ""});`;
```

This is the database-engine-level write guard. The MCP server passes `readOnly: true` on its `PgAttachment`, preventing any accidental `INSERT`, `UPDATE`, `DELETE`, or `CREATE TABLE` from reaching `data_lake.*`.

---

## 3. MCP Tools (three)

### `list_views`

- **Input:** none
- **Behavior:** Returns the in-memory inventory array: `name`, `s3_url`, `pack_id`, `vintage`, `byte_size` for each registered Parquet view. Also lists the `pg` alias for Postgres.
- **Error:** none (pure in-memory read).

### `describe_view`

- **Input:** `view: string`
- **Behavior:** Validates `view` against known names (inventory set + `"pg"`). If unknown, returns an error listing valid names. If known: runs `DESCRIBE SELECT * FROM <view> LIMIT 0` via `conn.runAndReadAll()` and returns column names + types.
- **Injection guard:** Only pre-validated names reach the SQL string — no user-supplied text in the query.
- **Note:** Postgres schema exploration (`pg.data_lake.*` tables) is accessible through `query_lake("DESCRIBE SELECT * FROM pg.data_lake.whatever LIMIT 0")` — no capability gap.

### `query_lake`

- **Input:** `sql: string`
- **Behavior:**
  1. **Allowlist guard:** trim + check that the first keyword matches `/^\s*(select|explain|describe|show|pragma|with)\b/i`. `WITH` is included to support CTEs (`WITH recent AS (...) SELECT ...`). If the guard fails, return a user-readable error listing allowed keywords — do not execute.
  2. **Single-statement execution:** use `conn.runAndReadAll()` (single-statement API). DuckDB will naturally error on a semicolon-appended second statement (e.g., `SELECT 1; CREATE TABLE exfil ...`), closing the multi-statement injection gap without needing to parse or strip semicolons.
  3. **Row cap:** `LIMIT 10000` appended if the query lacks any `LIMIT` clause (same rail as `composeQuery`'s `LIMIT 5000000` production guard, tightened for MCP payload sizes).
  4. Return rows as a JSON array.
- **Combined write protection:** READ_ONLY ATTACH (engine level) + allowlist guard (application level) = defense in depth.

---

## 4. `.mcp.json` update

Add a `lake` entry alongside the existing `serena` entry:

```json
{
  "mcpServers": {
    "serena": {
      "command": "serena",
      "args": ["start-mcp-server", "--context", "claude-code", "--project", "."]
    },
    "lake": {
      "command": "bun",
      "args": ["tools/lake-mcp-server.mts"]
    }
  }
}
```

Claude Code picks up `.mcp.json` on startup. The `lake` server starts as a child process and communicates over stdio.

---

## 5. Security model

| Threat                                         | Mitigation                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| CT `INSERT`/`UPDATE`/`DELETE` to `data_lake.*` | `READ_ONLY` on the Postgres ATTACH (engine-level; DuckDB rejects writes at the driver)                               |
| CT `CREATE TABLE` or `COPY TO` local disk      | SQL allowlist guard rejects any query not starting with `SELECT`, `EXPLAIN`, `DESCRIBE`, `SHOW`, `PRAGMA`, or `WITH` |
| Multi-statement injection via `;`              | Single-statement API (`runAndReadAll`); DuckDB errors on second statement naturally                                  |
| `describe_view` SQL injection via view name    | Known-name allowlist; user-supplied string never reaches SQL                                                         |
| Unbounded result sets                          | `LIMIT 10000` appended if missing                                                                                    |

---

## 6. Out of scope

- Write operations of any kind (CREATE, INSERT, COPY).
- Mutation of `data_lake.*` tables.
- Exposing this server to any network endpoint (stdio only, local Claude Code use).
- Automated schema migrations or DDL.
- Persistent DuckDB database files (`:memory:` only).

---

## 7. Files changed

| File                                 | Change                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `tools/lake-mcp-server.mts`          | **New** — MCP server entry point (~250 lines)                                           |
| `refinery/sources/duckdb-source.mts` | Add `readOnly?: boolean` to `PgAttachment`; update `ATTACH` statement in `composeQuery` |
| `.mcp.json`                          | Add `lake` server entry                                                                 |
| `package.json`                       | Add `@modelcontextprotocol/sdk` to `dependencies`                                       |

No changes to existing pack connectors, `packs.mts`, `cli.mts`, or brain files.
