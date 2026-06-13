/**
 * §06 — GATE A parity harness for the ZORI series (machine-diff, never eyeballed).
 *
 * Clones the FIXED ZHVI harness (zhvi-zip-latest-gate-a-parity.test.mts). A later
 * cutover swaps `rentals-swfl` from "computes per-ZIP YoY/MoM itself" (the in-TS
 * `buildSnapshot` loop) to "reads `data_lake.zori_zip_latest`". A silent value shift
 * at cutover looks like success — both paths emit a number, no error — but moves the
 * live figure AND injects a forward methodology seam into the graded series. GATE A
 * clean ×3 cycles is the ONLY defense against that seam. This harness proves the VIEW
 * path and the PACK path produce the SAME numbers, machine-diffed, for the same raw data.
 *
 * Both paths derive from the SAME source table (`data_lake.zori_swfl`):
 *   • PACK path — read the raw rows the pack source reads (the 24-month window,
 *     zori-source.mts:45-48: period_end >= now-24mo), run the real exported
 *     `buildSnapshot`, then apply the outputProducer's emit-rounding
 *     (rentals-swfl.mts:327/372/382/441-449: toFixed(0) USD/month, toFixed(2) %).
 *   • VIEW path — read the live `data_lake.zori_zip_latest` rows (one row per ZIP),
 *     apply the SAME emit-rounding.
 *
 * COLUMN-NAME / SHAPE DEVIATIONS FROM ZHVI (verified live, RULE 3 C1):
 *   • rent value column is `rent_index` (NUMERIC), not `home_value` (double precision).
 *     The ::float8 cast is a REAL cast here, but PostgREST serializes numeric → JSON
 *     number → JS float8 IDENTICALLY (verified live: rent_index::float8 == the
 *     PostgREST-served JS number EXACTLY), so the raw value residual is 0.0.
 *   • ZipSnapshot fields: rent_index_latest / rent_yoy_pct / rent_mom_pct
 *     (rentals-swfl.mts:37-47).
 *   • per-ZIP slugs: rental_rent_yoy_pct_zip_${zip} + rental_rent_index_zori_zip_${zip}
 *     (rentals-swfl.mts:371/381).
 *   • detail_table id `rentals_by_zip`, cell `rent_index_latest` (rentals-swfl.mts:441).
 *
 * FOUR machine-diffs, scoped to the pack's 24-month read window:
 *   1. 1a RAW parity — view RAW float8 vs pack RAW pre-emit value, ≤ EPS_RAW.
 *      1b DISPLAYED parity — pack's OWN rounding on BOTH sides, EXACT equality.
 *   2. Regional-median recompute over full precision == live pack value (+ same band).
 *   3. Emitted top-N slug-SET equality (rental_rent_*_zip_* top-3 heating + top-3 cooling).
 *   4. detail_table `rentals_by_zip` cell names + values byte-stable.
 *
 * The BITE-PROOF block seeds a perturbed copy of the raw rows into a TEMP table + a
 * temp view (the view's verbatim SQL), inside a rolled-back tx — proving (a) a 1-cent
 * RAW shift turns PART 1 RED, and (b) a rank-flipping shift turns PART 3 RED.
 * Requires DB creds + python/psycopg; absent → SKIP, never false-green.
 */
import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ZoriZipRow } from "../sources/zori-source.mts";
import { buildSnapshot } from "./_rentals-oracle.mts";
import { dbUri, pythonBin, runPy, gateDescribe } from "./_db-parity-harness.mts";

// ── RAW-vs-RAW float-noise tolerance — RE-DERIVED FOR ZORI'S SCALE ───────────
//
// HARD RULE (operator decree): do NOT transfer ZHVI's epsilon. ZHVI's home_value is
// ~$350,000; ZORI's rent_index is ~$2,000/month (verified live: median ~$1,966,
// range ~$714–$14,703). A ±0.5 ABSOLUTE tolerance — were one ever used — is ~1.4e-6
// relative on ZHVI but ~25,000× looser in relative terms on ZORI and would wave
// through real drift. So this tolerance is re-derived from ZORI's own magnitudes,
// with a cited reason, and is NOT sized to clear any observed diff.
//
// WHAT THE TWO SIDES ACTUALLY COMPARE:
//   • RAW rent_index_latest: the view casts numeric::float8; the pack receives the
//     SAME numeric via PostgREST as a JS float8 double. Verified LIVE that
//     rent_index::float8 == the PostgREST-served JS number EXACTLY (round-to-nearest
//     double is the same on both paths). ⇒ the raw VALUE residual is exactly 0.0
//     (byte-identical double), so any sane noise gate passes; 1e-9 is conservative.
//   • RAW YoY/MoM: (latest / partner − 1) * 100 on identical doubles on both sides
//     (view SQL ≡ buildZipSnapshot:125-130). The result is a PERCENTAGE — its
//     magnitude (~±50 at the extremes) is SCALE-INDEPENDENT of the $ rent level, so
//     its float8 noise floor is ~ |yoy|·2.2e-16 ≈ 50·2.2e-16 ≈ 1.1e-14 (ULP(50.0) ≈
//     7.1e-15). 1e-9 absolute sits ~5 orders of magnitude ABOVE that noise floor and
//     ~6 orders BELOW the smallest real divergence a 1¢ raw shift produces: on a
//     ~$1,900 partner, +$0.01 on latest moves YoY by ~5.3e-4 (percentage points) —
//     i.e. a real cent-level corruption is ~500,000× larger than EPS_RAW and is
//     REJECTED. So 1e-9 ABSOLUTE is correct for the YoY/MoM percentage on ZORI's
//     scale (the tolerance lives in percentage-space, where ZORI and ZHVI coincide —
//     NOT in dollar-space, where they differ 175×). The raw rent VALUE gate likewise
//     uses 1e-9 only as a noise guard over an expected-0.0 residual.
//   • DISPLAYED: the pack rounds rent_index via toFixed(0) (→ $1 step;
//     rentals-swfl.mts:327/382/441) and YoY/MoM via toFixed(2) (→ 0.01pp step;
//     :314/372/445/449). The displayed comparison applies THESE EXACT roundings to
//     both sides and asserts EXACT integer / 2-dp equality (no epsilon). The displayed
//     precision is taken from THIS pack's toFixed calls, NOT assumed equal to ZHVI's
//     (it happens to coincide: USD toFixed(0), % toFixed(2)).
const EPS_RAW = 1e-9;

const TOP_N = 3; // mirrors rentals-swfl.mts:24

// ── View shape (mirror of data_lake.zori_zip_latest) ─────────────────────────
interface ViewRow {
  zip_code: string;
  metro: string | null;
  county_name: string | null;
  city: string | null;
  latest_period: string; // ISO date "YYYY-MM-DD"
  rent_index_latest: number;
  rent_yoy_pct: number | null;
  rent_mom_pct: number | null;
}

// ── Raw read: the SAME 24-month window the pack source reads ─────────────────
// zori-source.mts:45-48 — monthsBack=24, period_end >= (now - 24mo) as ISO date.
function sinceIso24mo(): string {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 24);
  return since.toISOString().slice(0, 10);
}

function fetchRawRows(uri: string, py: string, sinceIso: string): ZoriZipRow[] {
  return runPy<ZoriZipRow[]>(
    py,
    uri,
    `
since = ${JSON.stringify(sinceIso)}
rows = []
with psycopg.connect(uri) as conn:
    with conn.cursor() as cur:
        cur.execute("""
          SELECT zip_code, period_end::text, rent_index::float8, metro, county_name, city
          FROM data_lake.zori_swfl
          WHERE period_end >= %s
          ORDER BY zip_code, period_end
        """, (since,))
        for zip_code, period_end, rent_index, metro, county_name, city in cur.fetchall():
            rows.append({"zip_code": zip_code, "period_end": period_end,
                         "rent_index": rent_index, "metro": metro,
                         "county_name": county_name, "city": city})
json.dump(rows, open(out_path, "w"))
`,
  );
}

function fetchViewRows(uri: string, py: string): ViewRow[] {
  return runPy<ViewRow[]>(
    py,
    uri,
    `
rows = []
with psycopg.connect(uri) as conn:
    conn.autocommit = False
    with conn.cursor() as cur:
        cur.execute("""
          SELECT zip_code, metro, county_name, city,
                 latest_period::text, rent_index_latest::float8,
                 rent_yoy_pct::float8, rent_mom_pct::float8
          FROM data_lake.zori_zip_latest
          ORDER BY zip_code
        """)
        for r in cur.fetchall():
            rows.append({"zip_code": r[0], "metro": r[1], "county_name": r[2],
                         "city": r[3], "latest_period": r[4],
                         "rent_index_latest": r[5], "rent_yoy_pct": r[6],
                         "rent_mom_pct": r[7]})
    conn.rollback()  # read-only
json.dump(rows, open(out_path, "w"))
`,
  );
}

// ── Emit-rounding: verbatim from the pack outputProducer ─────────────────────
// rentals-swfl.mts:327/382/441 → Number(value.toFixed(0)); :314/372/445/449 → toFixed(2).
const roundUsd = (v: number): number => Number(v.toFixed(0));
const roundYoy = (v: number | null): number | null =>
  v === null || !Number.isFinite(v) ? null : Number(v.toFixed(2));

// ── Pack path: build snapshot + the per-ZIP / slug-set / detail_table views ──
interface PackZip {
  zip_code: string;
  city: string | null;
  latest_period: string;
  rent_index_raw: number; // PRE-emit, full precision (buildZipSnapshot:138, no rounding)
  rent_yoy_raw: number | null; // PRE-emit, full precision (buildZipSnapshot:125-126)
  rent_index_emit: number; // toFixed(0)
  yoy_emit: number | null; // toFixed(2)
  yoy_raw: number | null; // for top-N ranking (pack ranks on raw, :300-302) — alias of rent_yoy_raw
}

function packZips(rows: ZoriZipRow[]): PackZip[] {
  const snap = buildSnapshot(rows);
  if (!snap) return [];
  return snap.zips.map((z) => ({
    zip_code: z.zip_code,
    city: z.city,
    latest_period: z.latest_period,
    rent_index_raw: z.rent_index_latest, // raw float8, before any toFixed
    rent_yoy_raw: z.rent_yoy_pct, // raw float8, before any toFixed
    rent_index_emit: roundUsd(z.rent_index_latest),
    yoy_emit: roundYoy(z.rent_yoy_pct),
    yoy_raw: z.rent_yoy_pct,
  }));
}

function packRegionalMedianYoy(rows: ZoriZipRow[]): number | null {
  return buildSnapshot(rows)?.regional_median_yoy_pct ?? null;
}

// median-over-finite-YoY (buildSnapshot:60-65/164-172) — reused for the view recompute.
function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Top-N slug SET — exactly the pack's logic (rentals-swfl.mts:300-304/368-390):
// rank finite-YoY ZIPs desc, take top-3 heating + bottom-3 cooling (reversed); emit
// `rental_rent_yoy_pct_zip_${zip}` + `rental_rent_index_zori_zip_${zip}` for each (skip null).
function slugSetFromYoy(entries: Array<{ zip_code: string; yoy_raw: number | null }>): Set<string> {
  const ranked = entries
    .filter((z) => z.yoy_raw !== null && Number.isFinite(z.yoy_raw))
    .sort((a, b) => (b.yoy_raw ?? 0) - (a.yoy_raw ?? 0));
  const topHeating = ranked.slice(0, TOP_N);
  const topCooling = ranked.slice(-TOP_N).reverse();
  const slugs = new Set<string>();
  for (const z of [...topHeating, ...topCooling]) {
    if (z.yoy_raw === null) continue;
    slugs.add(`rental_rent_yoy_pct_zip_${z.zip_code}`);
    slugs.add(`rental_rent_index_zori_zip_${z.zip_code}`);
  }
  return slugs;
}

// detail_table `rentals_by_zip` cell builder — verbatim cell shape
// (rentals-swfl.mts:436-450).
interface DetailCells {
  metro: string | null;
  county_name: string | null;
  city: string | null;
  latest_period: string;
  rent_index_latest: number;
  rent_yoy_pct: number | null;
  rent_mom_pct: number | null;
}

function packDetailCells(rows: ZoriZipRow[]): Map<string, DetailCells> {
  const snap = buildSnapshot(rows);
  const out = new Map<string, DetailCells>();
  for (const z of snap?.zips ?? []) {
    out.set(z.zip_code, {
      metro: z.metro ?? null,
      county_name: z.county_name ?? null,
      city: z.city ?? null,
      latest_period: z.latest_period,
      rent_index_latest: roundUsd(z.rent_index_latest),
      rent_yoy_pct: roundYoy(z.rent_yoy_pct),
      rent_mom_pct:
        z.rent_mom_pct === null || !Number.isFinite(z.rent_mom_pct)
          ? null
          : Number(z.rent_mom_pct.toFixed(2)),
    });
  }
  return out;
}

function viewDetailCells(view: ViewRow[]): Map<string, DetailCells> {
  const out = new Map<string, DetailCells>();
  for (const v of view) {
    out.set(v.zip_code, {
      metro: v.metro ?? null,
      county_name: v.county_name ?? null,
      city: v.city ?? null,
      latest_period: v.latest_period,
      rent_index_latest: roundUsd(v.rent_index_latest),
      rent_yoy_pct: roundYoy(v.rent_yoy_pct),
      rent_mom_pct:
        v.rent_mom_pct === null || !Number.isFinite(v.rent_mom_pct)
          ? null
          : Number(v.rent_mom_pct.toFixed(2)),
    });
  }
  return out;
}

// Opt-in (RUN_DB_PARITY=1) + fail-loud gate lives in the shared harness
// (_db-parity-harness.mts). uri/py are resolved ONLY when opted in, so the default
// `bun test` never spawns python or touches the DB.
const uri = process.env.RUN_DB_PARITY === "1" ? dbUri() : null;
const py = uri ? pythonBin() : null;

gateDescribe("§06 GATE A — ZORI view ⇆ pack parity (cycle)", () => {
  const sinceIso = sinceIso24mo();
  // single fetch shared across parts
  const raw: ZoriZipRow[] = fetchRawRows(uri!, py!, sinceIso);
  const view: ViewRow[] = fetchViewRows(uri!, py!);
  const pack: PackZip[] = packZips(raw);
  const packByZip: Map<string, PackZip> = new Map(pack.map((p) => [p.zip_code, p]));
  const viewByZip: Map<string, ViewRow> = new Map(view.map((v) => [v.zip_code, v]));

  it("loaded both paths over the SAME 24-month window", () => {
    expect(raw.length).toBeGreaterThan(0);
    expect(view.length).toBeGreaterThan(0);
    expect(pack.length).toBeGreaterThan(0);
    const packZ = new Set(packByZip.keys());
    const viewZ = new Set(viewByZip.keys());
    const onlyPack = [...packZ].filter((z) => !viewZ.has(z));
    const onlyView = [...viewZ].filter((z) => !packZ.has(z));
    expect({ onlyPack, onlyView }).toEqual({ onlyPack: [], onlyView: [] });
  });

  it("PART 1 — per-ZIP RAW parity (≤1e-9, like-for-like) AND displayed-emit parity (exact)", () => {
    const rawValueOffenders: Array<{ zip: string; view: number; pack: number; d: number }> = [];
    const rawYoyOffenders: Array<{
      zip: string;
      view: number | null;
      pack: number | null;
      d: number | null;
    }> = [];
    const dispValueOffenders: Array<{ zip: string; view: number; pack: number }> = [];
    const dispYoyOffenders: Array<{ zip: string; view: number | null; pack: number | null }> = [];

    for (const [zip, p] of packByZip) {
      const v = viewByZip.get(zip)!;

      // ── 1a · RAW value: view float8 vs pack pre-emit float8, ≤ 1e-9 (expected 0.0) ──
      const dVal = Math.abs(v.rent_index_latest - p.rent_index_raw);
      if (dVal > EPS_RAW) {
        rawValueOffenders.push({ zip, view: v.rent_index_latest, pack: p.rent_index_raw, d: dVal });
      }
      // ── 1a · RAW YoY: NULL must agree EXACTLY; else ≤ 1e-9 ──
      {
        const pv = p.rent_yoy_raw;
        const vv = v.rent_yoy_pct;
        if (pv === null || vv === null) {
          if (pv !== vv) rawYoyOffenders.push({ zip, view: vv, pack: pv, d: null });
        } else {
          const d = Math.abs(vv - pv);
          if (d > EPS_RAW) rawYoyOffenders.push({ zip, view: vv, pack: pv, d });
        }
      }

      // ── 1b · DISPLAYED value: both rounded toFixed(0) → exact integer equality ──
      {
        const vDisp = roundUsd(v.rent_index_latest);
        const pDisp = p.rent_index_emit; // already roundUsd(raw)
        if (vDisp !== pDisp) dispValueOffenders.push({ zip, view: vDisp, pack: pDisp });
      }
      // ── 1b · DISPLAYED YoY: both rounded toFixed(2) → exact 2-dp equality ──
      {
        const vDisp = roundYoy(v.rent_yoy_pct);
        const pDisp = p.yoy_emit; // already roundYoy(raw)
        if (vDisp !== pDisp) dispYoyOffenders.push({ zip, view: vDisp, pack: pDisp });
      }
    }

    expect({ rawValueOffenders, rawYoyOffenders }).toEqual({
      rawValueOffenders: [],
      rawYoyOffenders: [],
    });
    expect({ dispValueOffenders, dispYoyOffenders }).toEqual({
      dispValueOffenders: [],
      dispYoyOffenders: [],
    });
  });

  it("PART 2 — regional_median_yoy_pct recompute from view == live pack value", () => {
    // FULL PRECISION on BOTH sides: viewYoys are the view's RAW float8 rent_yoy_pct
    // (unrounded — the SQL does not round); packMedian is
    // buildSnapshot().regional_median_yoy_pct, which medians the raw per-ZIP YoY before
    // any emit-rounding (rentals-swfl.mts:164-172). No toFixed anywhere here.
    const viewYoys = view
      .map((v) => v.rent_yoy_pct)
      .filter((y): y is number => y !== null && Number.isFinite(y));
    const viewMedian = viewYoys.length > 0 ? median(viewYoys) : null;

    const packMedian = packRegionalMedianYoy(raw);

    if (viewMedian === null || packMedian === null) {
      expect(viewMedian).toBe(packMedian);
    } else {
      expect(Math.abs(viewMedian - packMedian)).toBeLessThan(1e-9);
      // And: the polarity band must not differ (the live consequence). Bands are
      // rentals-swfl.classifyPolarity's (rentals-swfl.mts:199-217) — NOT ZHVI's:
      //   <0 bearish | <2 neutral(sub-inflation) | <=6 bullish | <=10 bullish(durability) | >10 neutral(surge)
      const band = (y: number) =>
        y < 0
          ? "bearish"
          : y < 2
            ? "neutral"
            : y <= 6
              ? "bullish"
              : y <= 10
                ? "bullish*"
                : "neutral*";
      expect(band(viewMedian)).toBe(band(packMedian));
    }
  });

  it("PART 3 — emitted top-N slug SET equality (data-dependent)", () => {
    const packSlugs = slugSetFromYoy(
      pack.map((p) => ({ zip_code: p.zip_code, yoy_raw: p.yoy_raw })),
    );
    const viewSlugs = slugSetFromYoy(
      view.map((v) => ({ zip_code: v.zip_code, yoy_raw: v.rent_yoy_pct })),
    );
    const onlyPack = [...packSlugs].filter((s) => !viewSlugs.has(s)).sort();
    const onlyView = [...viewSlugs].filter((s) => !packSlugs.has(s)).sort();
    expect({ onlyPack, onlyView }).toEqual({ onlyPack: [], onlyView: [] });
    expect(packSlugs.size).toBeGreaterThan(0);
  });

  it("PART 4 — detail_table rentals_by_zip cell names + values byte-stable", () => {
    const packCells = packDetailCells(raw);
    const viewCells = viewDetailCells(view);
    const cellKeys: (keyof DetailCells)[] = [
      "metro",
      "county_name",
      "city",
      "latest_period",
      "rent_index_latest",
      "rent_yoy_pct",
      "rent_mom_pct",
    ];
    const offenders: Array<{ zip: string; cell: string; pack: unknown; view: unknown }> = [];
    for (const [zip, pc] of packCells) {
      const vc = viewCells.get(zip);
      if (!vc) {
        offenders.push({ zip, cell: "(missing in view)", pack: pc, view: undefined });
        continue;
      }
      for (const k of cellKeys) {
        if (pc[k] !== vc[k]) offenders.push({ zip, cell: k, pack: pc[k], view: vc[k] });
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ── BITE-PROOF — prove the harness catches what it exists to catch ───────────
// Seeds a perturbed COPY of the raw rows into a TEMP table + a temp view (the view's
// verbatim SQL), inside a ROLLED-BACK tx. Two assertions:
//   (a) a 1-cent RAW shift on one ZIP's latest value → PART 1 (RAW, ≤1e-9) goes RED.
//   (b) a shift large enough to flip a top-N rank → PART 3 goes RED (slug-set live).
// NOTE the TEMP table is `rent_index numeric` (matches the live column type) so the
// ::float8 cast path is exercised identically to production.
gateDescribe("§06 GATE A — bite-proof (rolled-back perturbation)", () => {
  const sinceIso = sinceIso24mo();
  const raw = fetchRawRows(uri!, py!, sinceIso);
  const basePack = packZips(raw);
  const basePackByZip = new Map(basePack.map((p) => [p.zip_code, p]));

  function viewFromTempRows(rows: ZoriZipRow[]): ViewRow[] {
    const dir = mkdtempSync(path.join(tmpdir(), "zori-gatea-bite-"));
    const rowsPath = path.join(dir, "rows.json");
    const outPath = path.join(dir, "out.json");
    writeFileSync(rowsPath, JSON.stringify(rows));
    const script = `
import json, psycopg
uri = ${JSON.stringify(uri!)}
rows = json.load(open(${JSON.stringify(rowsPath)}))
out = []
with psycopg.connect(uri) as conn:
    conn.autocommit = False
    with conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE _zori_bite (zip_code text, period_end date, rent_index numeric, metro text, county_name text, city text) ON COMMIT DROP")
        cur.executemany("INSERT INTO _zori_bite VALUES (%s,%s,%s,%s,%s,%s)",
            [(r["zip_code"], r["period_end"], r["rent_index"], r.get("metro"), r.get("county_name"), r.get("city")) for r in rows])
        # The view's VERBATIM per-ZIP latest + ±7d MAX-within-window YoY/MoM SQL,
        # pointed at the TEMP table (byte-identical to docs/sql/20260612_zori_pivoted_views.sql).
        cur.execute("""
          WITH latest AS (
            SELECT DISTINCT ON (zip_code)
              zip_code, metro, county_name, city,
              period_end AS latest_period, rent_index::float8 AS rent_index_latest
            FROM _zori_bite ORDER BY zip_code, period_end DESC
          )
          SELECT l.zip_code, l.metro, l.county_name, l.city,
            l.latest_period::text, l.rent_index_latest,
            ( l.rent_index_latest
              / NULLIF((SELECT z.rent_index::float8 FROM _zori_bite z
                         WHERE z.zip_code = l.zip_code
                           AND z.period_end BETWEEN l.latest_period - INTERVAL '12 months' - INTERVAL '7 days'
                                                AND l.latest_period - INTERVAL '12 months' + INTERVAL '7 days'
                         ORDER BY z.period_end DESC LIMIT 1), 0) - 1) * 100 AS rent_yoy_pct,
            ( l.rent_index_latest
              / NULLIF((SELECT z.rent_index::float8 FROM _zori_bite z
                         WHERE z.zip_code = l.zip_code
                           AND z.period_end BETWEEN l.latest_period - INTERVAL '1 month' - INTERVAL '7 days'
                                                AND l.latest_period - INTERVAL '1 month' + INTERVAL '7 days'
                         ORDER BY z.period_end DESC LIMIT 1), 0) - 1) * 100 AS rent_mom_pct
          FROM latest l ORDER BY l.zip_code
        """)
        for r in cur.fetchall():
            out.append({"zip_code": r[0], "metro": r[1], "county_name": r[2], "city": r[3],
                        "latest_period": r[4], "rent_index_latest": r[5],
                        "rent_yoy_pct": (None if r[6] is None else float(r[6])),
                        "rent_mom_pct": (None if r[7] is None else float(r[7]))})
    conn.rollback()  # touch no live data
json.dump(out, open(${JSON.stringify(outPath)}, "w"))
`;
    const r = spawnSync(py!, ["-c", script], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`bite subprocess failed:\n${r.stderr}\n${r.stdout}`);
    return JSON.parse(readFileSync(outPath, "utf-8")) as ViewRow[];
  }

  it("control — unperturbed temp-view == pack (per-ZIP RAW, ≤1e-9)", () => {
    const v = viewFromTempRows(raw);
    const vByZip = new Map(v.map((x) => [x.zip_code, x]));
    const offenders: string[] = [];
    for (const [zip, p] of basePackByZip) {
      const vr = vByZip.get(zip);
      if (!vr) {
        offenders.push(`${zip}: missing`);
        continue;
      }
      if (Math.abs(vr.rent_index_latest - p.rent_index_raw) > EPS_RAW)
        offenders.push(`${zip}: value`);
      const pv = p.rent_yoy_raw;
      const vv = vr.rent_yoy_pct;
      if (pv === null || vv === null) {
        if (pv !== vv) offenders.push(`${zip}: yoy-null`);
      } else if (Math.abs(vv - pv) > EPS_RAW) offenders.push(`${zip}: yoy`);
    }
    expect(offenders).toEqual([]);
  });

  it("(a) 1-cent perturbation on one ZIP's latest value → PART 1 (RAW) goes RED", () => {
    // At ZORI's ~$2k scale a $0.01 raw shift is ~5e-6 relative — far above EPS_RAW
    // (1e-9) and far above the YoY noise floor (~1e-14). The RAW gate has NO slack.
    const targetZip = basePack[0].zip_code;
    const perturbed = raw.map((r) => {
      const isLatestOfTarget =
        r.zip_code === targetZip && r.period_end === basePackByZip.get(targetZip)!.latest_period;
      return isLatestOfTarget ? { ...r, rent_index: r.rent_index + 0.01 } : r;
    });
    const v = viewFromTempRows(perturbed);
    const vr = v.find((x) => x.zip_code === targetZip)!;
    const p = basePackByZip.get(targetZip)!;
    const dRaw = Math.abs(vr.rent_index_latest - p.rent_index_raw);
    expect(dRaw).toBeGreaterThan(EPS_RAW);
    expect(dRaw).toBeCloseTo(0.01, 9); // it is exactly the 1¢ we injected
  });

  it("(b) rank-flipping perturbation → PART 3 (slug SET) goes RED", () => {
    const packSlugs = slugSetFromYoy(
      basePack.map((p) => ({ zip_code: p.zip_code, yoy_raw: p.yoy_raw })),
    );

    const rankedDesc = [...basePack]
      .filter((p) => p.yoy_raw !== null && Number.isFinite(p.yoy_raw))
      .sort((a, b) => (b.yoy_raw ?? 0) - (a.yoy_raw ?? 0));
    const topHeatingZips = new Set(rankedDesc.slice(0, TOP_N).map((p) => p.zip_code));
    const topCoolingZips = new Set(rankedDesc.slice(-TOP_N).map((p) => p.zip_code));
    const victim = rankedDesc.find(
      (p) => !topHeatingZips.has(p.zip_code) && !topCoolingZips.has(p.zip_code),
    );
    expect(victim, "need a middle-ranked ZIP to promote").toBeTruthy();
    const victimZip = victim!.zip_code;

    // Triple the latest value → YoY ~ +200%, guaranteed new #1 heating.
    const perturbed = raw.map((r) => {
      const isLatestOfVictim =
        r.zip_code === victimZip && r.period_end === basePackByZip.get(victimZip)!.latest_period;
      return isLatestOfVictim ? { ...r, rent_index: r.rent_index * 3 } : r;
    });
    const v = viewFromTempRows(perturbed);
    const perturbedSlugs = slugSetFromYoy(
      v.map((x) => ({ zip_code: x.zip_code, yoy_raw: x.rent_yoy_pct })),
    );

    expect(perturbedSlugs.has(`rental_rent_yoy_pct_zip_${victimZip}`)).toBe(true);
    expect(perturbedSlugs.has(`rental_rent_index_zori_zip_${victimZip}`)).toBe(true);
    expect(packSlugs.has(`rental_rent_yoy_pct_zip_${victimZip}`)).toBe(false);
    const onlyPerturbed = [...perturbedSlugs].filter((s) => !packSlugs.has(s));
    expect(onlyPerturbed.length).toBeGreaterThan(0);
  });
});
