/**
 * §02 — zhvi_zip_latest VIEW ⇆ home-values-swfl PACK equivalence (the load-bearing test).
 *
 * The cutover (§05) swaps the brain's source from an in-TS YoY/MoM loop to
 * `data_lake.zhvi_zip_latest`. That swap is silent-corruption-prone exactly on
 * period-matching (risk register #1): a bare month-bucket or a `LAG(col,12)` row
 * offset diverges from the pack on a missing/drifted month. This test pins that the
 * VIEW's `value_yoy_pct` equals the PACK's `buildSnapshot(...).zips[].value_yoy_pct`
 * on three crafted cases that exercise the boundary:
 *
 *   1. GAPPED      — no row within ±7d of (latest − 12mo) → both NULL.
 *   2. DRIFTED     — the only candidate sits >7d off target → both NULL.
 *   3. TWO-IN-WINDOW — two rows inside ±7d; both must pick the NEWER (= MAX-within-
 *                      window), NOT the closer-to-target. This is the locked rule
 *                      (ADJUDICATION CATCH 2; lookbackObservation walks newest→oldest
 *                      and returns the FIRST in-window row = newest).
 *
 * HOW IT STAYS HONEST: the pack side runs the real exported `buildSnapshot`. The
 * view side runs the view's *verbatim* per-ZIP subquery SQL (the `ORDER BY
 * period_end DESC LIMIT 1` within a `BETWEEN … ± 7 days` window) against a TEMP
 * table seeded with the *same* crafted rows, inside a rolled-back transaction —
 * so it touches no live data and needs no JS Postgres dep (driven via psycopg in a
 * short python subprocess, the same client used to run the migration). If anyone
 * ever rewrites the view to bucket-by-month or to a bare row-offset, case 1/2/3
 * will disagree and fail loudly.
 *
 * Requires DB creds in .dlt/secrets.toml + python/psycopg on PATH (same env that
 * ran the migration). If creds/python are absent the suite SKIPS rather than
 * false-greens (it never silently passes without proving the SQL).
 */
import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ZhviZipRow } from "../sources/zhvi-source.mts";
import { buildSnapshot } from "./_home-values-oracle.mts";
import { dbUri, pythonBin, gateDescribe } from "./_db-parity-harness.mts";

/**
 * Run the view's VERBATIM 12-month-YoY selection SQL for each ZIP against a TEMP
 * table seeded with `rows`, inside a rolled-back tx. Returns { zip: yoy|null }.
 * The SQL below is the view's subquery, byte-for-byte (see
 * docs/sql/20260612_zhvi_pivoted_views.sql) — that is the whole point of the test.
 */
function viewYoyByZip(rows: ZhviZipRow[], uri: string, py: string): Record<string, number | null> {
  const dir = mkdtempSync(path.join(tmpdir(), "zhvi-eqv-"));
  const rowsPath = path.join(dir, "rows.json");
  const outPath = path.join(dir, "out.json");
  writeFileSync(rowsPath, JSON.stringify(rows));

  const script = `
import json, psycopg
uri = ${JSON.stringify(uri)}
rows = json.load(open(${JSON.stringify(rowsPath)}))
out = {}
with psycopg.connect(uri) as conn:
    conn.autocommit = False
    with conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE _zhvi_eqv (zip_code text, period_end date, home_value double precision) ON COMMIT DROP")
        cur.executemany("INSERT INTO _zhvi_eqv (zip_code, period_end, home_value) VALUES (%s,%s,%s)",
                        [(r["zip_code"], r["period_end"], r["home_value"]) for r in rows])
        # latest-per-ZIP anchor (DISTINCT ON), mirrors the view's CTE
        cur.execute("""
          WITH latest AS (
            SELECT DISTINCT ON (zip_code)
              zip_code, period_end AS latest_period, home_value::float8 AS home_value_latest
            FROM _zhvi_eqv ORDER BY zip_code, period_end DESC
          )
          SELECT l.zip_code,
            ( l.home_value_latest
              / NULLIF((SELECT z.home_value::float8 FROM _zhvi_eqv z
                         WHERE z.zip_code = l.zip_code
                           AND z.period_end BETWEEN l.latest_period - INTERVAL '12 months' - INTERVAL '7 days'
                                                AND l.latest_period - INTERVAL '12 months' + INTERVAL '7 days'
                         ORDER BY z.period_end DESC LIMIT 1), 0) - 1) * 100 AS value_yoy_pct
          FROM latest l
        """)
        for zip_code, yoy in cur.fetchall():
            out[zip_code] = None if yoy is None else float(yoy)
    conn.rollback()  # touch no live data
json.dump(out, open(${JSON.stringify(outPath)}, "w"))
`;
  const r = spawnSync(py, ["-c", script], { encoding: "utf-8" });
  if (r.status !== 0) {
    throw new Error(`view-SQL subprocess failed:\n${r.stderr}\n${r.stdout}`);
  }
  return JSON.parse(readFileSync(outPath, "utf-8")) as Record<string, number | null>;
}

/** Run the real pack and pull each ZIP's value_yoy_pct (null when undefined). */
function packYoyByZip(rows: ZhviZipRow[]): Record<string, number | null> {
  const snap = buildSnapshot(rows);
  const out: Record<string, number | null> = {};
  for (const z of snap?.zips ?? []) out[z.zip_code] = z.value_yoy_pct;
  return out;
}

const META = { metro: "Cape Coral-Fort Myers, FL", county_name: "Lee County", city: "Test City" };
const row = (zip: string, period_end: string, home_value: number): ZhviZipRow => ({
  zip_code: zip,
  period_end,
  home_value,
  ...META,
});

const uri = process.env.RUN_DB_PARITY === "1" ? dbUri() : null;
const py = uri ? pythonBin() : null;

gateDescribe("zhvi_zip_latest VIEW ⇆ home-values-swfl PACK YoY equivalence", () => {
  // CASE 1 — GAPPED: latest 2026-04-30; the 12-mo target (~2025-04-30) is absent
  // and the nearest existing row (2025-08-31) is far outside ±7d → both NULL.
  const gapped: ZhviZipRow[] = [
    row("90001", "2025-08-31", 400000),
    row("90001", "2025-12-31", 410000),
    row("90001", "2026-04-30", 264505.672125785),
  ];

  // CASE 2 — DRIFTED: the ONLY 12-mo-back candidate sits 2025-04-19, which is
  // 11 days before the 2025-04-30 target (>7d) → outside tolerance → both NULL.
  const drifted: ZhviZipRow[] = [
    row("90002", "2025-04-19", 300000),
    row("90002", "2026-04-30", 330000),
  ];

  // CASE 3 — TWO-IN-WINDOW: target 2025-04-30; two rows inside ±7d:
  //   2025-04-25 (5d before, CLOSER)  value 280000
  //   2025-05-02 (2d after,  NEWER)   value 250000   ← MAX-within-window wins
  // Newer (250000) → YoY = (330000/250000 - 1)*100 = +32%.
  // Closer (280000) would give +17.857…% — so the cases are distinguishable.
  const twoInWindow: ZhviZipRow[] = [
    row("90003", "2025-04-25", 280000),
    row("90003", "2025-05-02", 250000),
    row("90003", "2026-04-30", 330000),
  ];

  const allRows = [...gapped, ...drifted, ...twoInWindow];

  it("agrees on all three crafted cases (gapped / drifted / two-in-window)", () => {
    const pack = packYoyByZip(allRows);
    const view = viewYoyByZip(allRows, uri!, py!);

    // Case 1 — both NULL
    expect(pack["90001"]).toBeNull();
    expect(view["90001"]).toBeNull();

    // Case 2 — both NULL
    expect(pack["90002"]).toBeNull();
    expect(view["90002"]).toBeNull();

    // Case 3 — both pick the NEWER row (= +32%), not the closer (+17.857…%)
    const expectedNewer = (330000 / 250000 - 1) * 100; // 32
    const closerWrong = (330000 / 280000 - 1) * 100; // ≈17.857
    expect(pack["90003"]).toBeCloseTo(expectedNewer, 10);
    expect(view["90003"]).toBeCloseTo(expectedNewer, 10);
    expect(pack["90003"]).not.toBeCloseTo(closerWrong, 3);

    // The load-bearing assertion: pack == view (float8, within 1e-9 to absorb
    // only last-bit float-print noise — the math engine is identical).
    for (const zip of ["90001", "90002", "90003"]) {
      const p = pack[zip];
      const v = view[zip];
      if (p === null || v === null) {
        expect(p).toBe(v);
      } else {
        expect(Math.abs(p - v)).toBeLessThan(1e-9);
      }
    }
  });
});
