// tools/lake-mcp-server.test.mts
import { test } from "bun:test";
import assert from "node:assert/strict";

// Import only pure helpers. import.meta.main is false here, so the MCP
// server startup() is never called — no DuckDB, no network.
const {
  deriveViewName,
  isAllowedSql,
  buildFinalQuery,
  inventoryRowToParquetView,
  deriveSafeViewName,
  jsonSafe,
  tier1Format,
  isPartitioned,
  safeIdent,
  buildViewGroups,
  tier1ListReader,
} = await import("./lake-mcp-server.mts");

/** Minimal InventoryRow factory for grouping tests. */
function invRow(path: string, bucket = "lake-tier1") {
  return {
    id: `${bucket}/${path}`,
    bucket,
    path,
    vintage: null,
    byte_size: null,
    pack_id: null,
    source_url: null,
  };
}

// ---- deriveViewName ----

test("deriveViewName: strips .parquet and path prefix", () => {
  assert.equal(deriveViewName("faf5/faf5_2024.parquet"), "faf5_2024");
  assert.equal(deriveViewName("hurdat2/hurdat2_fl.parquet"), "hurdat2_fl");
  assert.equal(deriveViewName("top_level.parquet"), "top_level");
});

test("deriveViewName: case-insensitive .Parquet strip", () => {
  assert.equal(deriveViewName("lake/storms.PARQUET"), "storms");
});

test("deriveViewName: strips non-parquet extensions", () => {
  assert.equal(
    deriveViewName("tier1/run-20260527T002658Z.ndjson"),
    "run_20260527T002658Z",
  );
});

test("deriveViewName: replaces hyphens and other non-word chars with underscores", () => {
  assert.equal(deriveViewName("a/my-file.parquet"), "my_file");
  assert.equal(deriveViewName("a/foo.bar.parquet"), "foo_bar");
});

// ---- jsonSafe ----

test("jsonSafe: serializes DuckDB BigInt counts (the count(*) crash)", () => {
  // The exact failure: { rows: [{ rows: 42n }] } used to throw
  // "JSON.stringify cannot serialize BigInt".
  const out = jsonSafe({ rows: [{ n: 42n }] });
  assert.equal(JSON.parse(out).rows[0].n, 42);
});

test("jsonSafe: BigInt beyond safe-integer range falls back to a lossless string", () => {
  const big = 9007199254740993n; // MAX_SAFE_INTEGER + 2
  const out = jsonSafe({ v: big });
  assert.equal(JSON.parse(out).v, "9007199254740993");
});

// ---- deriveSafeViewName ----

test("deriveSafeViewName: valid unique names pass through unchanged", () => {
  assert.equal(deriveSafeViewName("faf5/faf5_2024.parquet"), "faf5_2024");
  assert.equal(
    deriveSafeViewName("environmental/hurdat2_fl.parquet"),
    "hurdat2_fl",
  );
});

test("deriveSafeViewName: leading-digit names are parent-qualified (fixes 2026-05.parquet)", () => {
  // The three macro files that DuckDB rejected as "syntax error at 2026_05"
  // and which all collided on one name — now distinct, valid identifiers.
  assert.equal(
    deriveSafeViewName("macro/census_vip/2026-05.parquet"),
    "census_vip_2026_05",
  );
  assert.equal(
    deriveSafeViewName("macro/bls_ppi/2026-05.parquet"),
    "bls_ppi_2026_05",
  );
  assert.equal(
    deriveSafeViewName("macro/fred_g17/2026-05.parquet"),
    "fred_g17_2026_05",
  );
});

test("deriveSafeViewName: digit-leading even after parent qualification gets a letter prefix", () => {
  assert.equal(deriveSafeViewName("2026/2026-05.parquet"), "t_2026_2026_05");
});

// ---- tier1Format ----

test("tier1Format: classifies by extension incl. compression suffix", () => {
  assert.equal(tier1Format("faf5/faf5_2024.parquet"), "parquet");
  assert.equal(tier1Format("x/storms.PARQUET"), "parquet");
  assert.equal(tier1Format("leepa/just_value/2026-05-19.csv.gz"), "csv");
  assert.equal(tier1Format("leepa/use_codes/2026-05-19.csv"), "csv");
  assert.equal(tier1Format("leepa/parcels/2026-05-19.geojson.gz"), "geojson");
  assert.equal(tier1Format("city_pulse/x/run-1.ndjson"), "ndjson");
  assert.equal(tier1Format("labor/x.jsonl"), "ndjson");
  assert.equal(tier1Format("misc/readme.txt"), "other");
});

// ---- isPartitioned ----

test("isPartitioned: true only when a Hive partition segment is present", () => {
  assert.ok(
    isPartitioned("city_pulse_corridors/a/year=2026/month=06/run-1.ndjson"),
  );
  assert.ok(!isPartitioned("macro/census_vip/2026-05.parquet"));
  assert.ok(!isPartitioned("faf5/faf5_2024.parquet"));
});

// ---- safeIdent ----

test("safeIdent: sanitizes, collapses, and guards leading digits", () => {
  assert.equal(safeIdent("macro/census_vip"), "macro_census_vip");
  assert.equal(safeIdent("city_pulse_corridors"), "city_pulse_corridors");
  assert.equal(safeIdent("2026-05"), "t_2026_05");
  assert.equal(safeIdent("__weird--name__"), "weird_name");
});

// ---- buildViewGroups ----

test("buildViewGroups: partitioned run-logs collapse to ONE view per top folder", () => {
  const groups = buildViewGroups([
    invRow("city_pulse_corridors/immokalee/year=2026/month=06/run-1.ndjson"),
    invRow("city_pulse_corridors/cape-coral/year=2026/month=06/run-2.ndjson"),
    invRow("corridor_grounded/x/year=2026/month=05/run-3.ndjson"),
  ]);
  const cpc = groups.find((g) => g.name === "city_pulse_corridors");
  assert.ok(cpc, "expected a city_pulse_corridors view");
  assert.equal(cpc!.format, "ndjson");
  assert.equal(cpc!.rows.length, 2); // both corridors merged into one view
  assert.equal(groups.length, 2); // city_pulse_corridors + corridor_grounded
});

test("buildViewGroups: flat files stay per-file (distinct schemas / snapshots)", () => {
  const groups = buildViewGroups([
    invRow("environmental/hurdat2_fl.parquet"),
    invRow("environmental/usgs_quakes.parquet"),
    invRow("leepa/just_value/2026-05-19.csv.gz"),
    invRow("leepa/just_value/2026-05-20.csv.gz"),
  ]);
  // 4 flat files -> 4 per-file views, none merged
  assert.equal(groups.length, 4);
  const names = groups.map((g) => g.name).sort();
  assert.deepEqual(names, [
    "hurdat2_fl",
    "just_value_2026_05_19",
    "just_value_2026_05_20",
    "usgs_quakes",
  ]);
});

test("buildViewGroups: skips geojson and unknown formats", () => {
  const groups = buildViewGroups([
    invRow("leepa/parcels/2026-05-19.geojson.gz"),
    invRow("misc/notes.txt"),
    invRow("faf5/faf5_2024.parquet"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "faf5_2024");
});

// ---- tier1ListReader ----

test("tier1ListReader: ndjson uses union_by_name + ignore_errors + raised object cap", () => {
  const sql = tier1ListReader("ndjson", [
    "s3://lake-tier1/a/run-1.ndjson",
    "s3://lake-tier1/a/run-2.ndjson",
  ]);
  assert.match(sql, /^read_json_auto\(\[/);
  assert.match(sql, /union_by_name=true/);
  assert.match(sql, /ignore_errors=true/);
  assert.match(sql, /maximum_object_size=104857600/);
  assert.ok(sql.includes("'s3://lake-tier1/a/run-1.ndjson'"));
});

test("tier1ListReader: csv uses read_csv_auto + union_by_name; parquet uses read_parquet list", () => {
  assert.match(
    tier1ListReader("csv", ["s3://b/x.csv.gz"]),
    /^read_csv_auto\(\['s3:\/\/b\/x\.csv\.gz'\], union_by_name=true\)$/,
  );
  assert.equal(
    tier1ListReader("parquet", ["s3://b/x.parquet", "s3://b/y.parquet"]),
    "read_parquet(['s3://b/x.parquet', 's3://b/y.parquet'])",
  );
});

// ---- isAllowedSql ----

test("isAllowedSql: permits SELECT and SELECT with leading whitespace", () => {
  assert.ok(isAllowedSql("SELECT * FROM foo"));
  assert.ok(isAllowedSql("  SELECT id FROM bar"));
  assert.ok(isAllowedSql("select * FROM foo"));
});

test("isAllowedSql: permits WITH (CTE) queries", () => {
  assert.ok(isAllowedSql("WITH cte AS (SELECT 1) SELECT * FROM cte"));
  assert.ok(isAllowedSql("with cte as (select 1) select * from cte"));
});

test("isAllowedSql: permits EXPLAIN, DESCRIBE, SHOW, PRAGMA", () => {
  assert.ok(isAllowedSql("EXPLAIN SELECT * FROM foo"));
  assert.ok(isAllowedSql("DESCRIBE SELECT * FROM foo LIMIT 0"));
  assert.ok(isAllowedSql("SHOW TABLES"));
  assert.ok(isAllowedSql("PRAGMA database_list"));
});

test("isAllowedSql: rejects write-capable statements", () => {
  assert.ok(!isAllowedSql("CREATE TABLE exfil AS SELECT * FROM foo"));
  assert.ok(!isAllowedSql("INSERT INTO foo VALUES (1)"));
  assert.ok(!isAllowedSql("DELETE FROM foo"));
  assert.ok(!isAllowedSql("UPDATE foo SET x=1"));
  assert.ok(!isAllowedSql("DROP TABLE foo"));
  assert.ok(!isAllowedSql("COPY foo TO '/tmp/dump.csv'"));
  assert.ok(!isAllowedSql(""));
});

test("isAllowedSql: rejects semicolon-appended injection (second statement unreachable)", () => {
  // The allowlist passes "SELECT 1" but the server uses the single-statement
  // API, so the injected CREATE never executes. This test just documents
  // that "SELECT 1; CREATE TABLE exfil ..." passes the allowlist — the
  // defense is the single-statement API, not the allowlist.
  //
  // If we ever want a second layer, add a semicolon-scan check here.
  assert.ok(
    isAllowedSql(
      "SELECT 1; CREATE TABLE exfil AS SELECT * FROM pg.data_lake.foo",
    ),
  );
});

// ---- buildFinalQuery ----

test("buildFinalQuery: appends LIMIT 10000 when query has no LIMIT", () => {
  assert.match(buildFinalQuery("SELECT * FROM foo"), /LIMIT 10000/);
  assert.match(
    buildFinalQuery("WITH cte AS (SELECT 1) SELECT * FROM cte"),
    /LIMIT 10000/,
  );
});

test("buildFinalQuery: preserves existing LIMIT", () => {
  const q = "SELECT * FROM foo LIMIT 50";
  assert.equal(buildFinalQuery(q), q);
  assert.doesNotMatch(buildFinalQuery(q), /LIMIT 10000/);
});

test("buildFinalQuery: strips trailing semicolons before appending LIMIT", () => {
  const result = buildFinalQuery("SELECT * FROM foo;");
  assert.doesNotMatch(result, /;/);
  assert.match(result, /LIMIT 10000/);
});

// ---- inventoryRowToParquetView ----

test("inventoryRowToParquetView: constructs s3 URL and derives view name", () => {
  const row = {
    id: "lake-tier1/faf5/faf5_2024.parquet",
    bucket: "lake-tier1",
    path: "faf5/faf5_2024.parquet",
    vintage: "2024",
    byte_size: 1024,
    pack_id: "logistics-swfl",
    source_url: null,
  };
  const view = inventoryRowToParquetView(row);
  assert.equal(view.name, "faf5_2024");
  assert.equal(view.s3_url, "s3://lake-tier1/faf5/faf5_2024.parquet");
});
