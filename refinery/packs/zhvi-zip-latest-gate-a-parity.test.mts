/**
 * §04 — GATE A parity harness (machine-diff, never eyeballed).
 *
 * The §05 cutover swaps `home-values-swfl` from "computes per-ZIP YoY/MoM itself"
 * (the in-TS `buildSnapshot` loop) to "reads `data_lake.zhvi_zip_latest`". A silent
 * value shift at cutover looks like success — both paths emit a number, no error —
 * but moves the live figure AND, because `refined_at` is wall-clock
 * (4-output.mts:355), injects a forward methodology seam into the graded
 * `metric_observations` series (ADJUDICATION §00 FLAG 4 / risk register #6). GATE A
 * clean ×3 cycles is the ONLY defense against that seam. So this harness proves the
 * VIEW path and the PACK path produce the SAME numbers, machine-diffed, for the
 * same raw data.
 *
 * Both paths derive from the SAME source table (`data_lake.zhvi_swfl`):
 *   • PACK path — read the raw rows the pack source reads (the 24-month window,
 *     `zhvi-source.mts:45-48`: period_end >= now-24mo), run the real exported
 *     `buildSnapshot`, then apply the outputProducer's emit-rounding
 *     (home-values-swfl.mts:325/369/379/439-447: toFixed(0) USD, toFixed(2) %).
 *   • VIEW path — read the live `data_lake.zhvi_zip_latest` rows (the 109-row
 *     latest-per-ZIP brain-input view), apply the SAME emit-rounding.
 *
 * FOUR machine-diffs, scoped to the pack's 24-month read window:
 *   1. TWO assertions, like-for-like (this REPLACES the old ½-display-place epsilons,
 *      which were a DESIGN BUG — they diffed the view's full-precision float against
 *      the pack's toFixed-rounded scalar, so they measured rounding-truncation
 *      distance, not parity; the 0.5/0.005 slack was tautologically sized to absorb
 *      that self-injected artifact and would hide a real ¢/0.001% divergence):
 *        1a. CUTOVER-CRITICAL RAW parity — view RAW float8 vs pack RAW pre-emit value
 *            (buildZipSnapshot, before any toFixed), tolerance ≤ 1e-9 (IEEE-754 noise
 *            only; see EPS_RAW). The TS rollup medians over THESE full-precision
 *            values before rounding (home-values-swfl.mts:161-170), so a sub-dollar
 *            shift here is a real headline-number shift. NULL-YoY must agree exactly.
 *        1b. DISPLAYED parity — apply the pack's OWN rounding (toFixed(0)/toFixed(2))
 *            to BOTH sides, assert EXACT integer/2-dp equality (guards the per-ZIP slugs).
 *   2. Regional-median recompute: take the VIEW's per-ZIP rows, recompute
 *      `regional_median_yoy_pct` with the SAME median-over-finite-YoY logic
 *      (buildSnapshot:162-170), confirm it equals the live PACK's value. This is the
 *      headline `classifyPolarity` keys on — a small shift can cross a band
 *      (2.9→3.1% neutral→bullish; risk register #2).
 *   3. Emitted-slug-SET equality: the set of `home_value_*_zip_*` slugs the pack
 *      emits is data-dependent (top-3 heating + top-3 cooling, :298-302/:365-387). A
 *      sub-epsilon tie can flip top-N membership and silently change WHICH slugs
 *      exist (risk register #3). Assert the SETS are identical, not just shared
 *      values.
 *   4. detail_table cell stability: the `home_values_by_zip` table's cell names AND
 *      values must be byte-stable — downstream `investor-zip-swfl` reads
 *      `home_value_zhvi` from it via the thin pipe (investor-zip-swfl.mts:182; risk
 *      register #4).
 *
 * PASS = all four parts green (+ the §02 equivalence test, run separately, pins the
 * MAX-within-window selection rule). GATE A also requires clean across 3 full
 * rebuild cycles — this file runs ONE cycle; see the footer for how 2-3 accrue.
 *
 * HOW IT STAYS HONEST: the pack side runs the real exported `buildSnapshot` + the
 * pack's verbatim emit-rounding. The view side reads the live view via psycopg
 * (same client that ran the migration), READ-ONLY (a single SELECT in a rolled-back
 * tx; it never mutates live data). The BITE-PROOF block seeds a perturbed copy of
 * the raw rows into a TEMP table + a temp view with the view's verbatim SQL, inside
 * a rolled-back tx — proving (a) a 1¢ RAW shift now turns PART 1 RED (the tight raw
 * gate has no slack — the OLD "1¢ stays green" was the bug), and (b) a rank-flipping
 * shift turns PART 3 RED. Requires DB creds in .dlt/secrets.toml + python/psycopg
 * (same env as the migration); absent → SKIP, never false-green.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ZhviZipRow } from "../sources/zhvi-source.mts";
import { buildSnapshot } from "./home-values-swfl.mts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SECRETS = path.join(REPO_ROOT, ".dlt", "secrets.toml");

// RAW-vs-RAW float-noise tolerance (plan §04 part 1, CUTOVER-CRITICAL).
//
// JUSTIFICATION — why 1e-9 and NOT half-a-display-place:
//   Both paths read the SAME `double precision` column (data_lake.zhvi_swfl.home_value,
//   cast float8 in the view; the JS number is the same IEEE-754 double) and perform the
//   SAME arithmetic — home_value_latest is the raw value verbatim, and YoY is
//   (latest / partner − 1) * 100 on both sides (view SQL :73-78 ≡ buildZipSnapshot:125-126).
//   The ONLY legitimate residual is IEEE-754 representation / operation-order noise in the
//   last ULP, which for these magnitudes (~1e5 USD, ~±50% YoY) is far below 1e-9.
//   CRUCIALLY: the TS rollup medians over FULL precision before rounding
//   (home-values-swfl.mts:161-170) — so rounding either side to its display place BEFORE
//   this raw comparison would mask a real shift in the headline number. The OLD 0.5/0.005
//   "half-a-display-place" epsilons were the bug: they diffed the view's full-precision
//   float against the pack's toFixed-rounded scalar, so they measured rounding-truncation
//   distance (tautologically ≤ half a place), NOT parity — a real 1¢/0.001% divergence hid
//   inside the slack. This raw gate has NO such slack.
const EPS_RAW = 1e-9;

const TOP_N = 3; // mirrors home-values-swfl.mts:24

function dbUri(): string | null {
  if (!existsSync(SECRETS)) return null;
  const toml = readFileSync(SECRETS, "utf-8");
  const block = toml.split("[destination.postgres.credentials]")[1];
  if (!block) return null;
  const grab = (k: string) => block.match(new RegExp(`${k}\\s*=\\s*"([^"]+)"`))?.[1];
  const pw = grab("password");
  const host = grab("host");
  const port = grab("port") ?? "5432";
  const db = grab("database") ?? "postgres";
  const user = grab("username") ?? "postgres";
  if (!pw || !host) return null;
  return `postgresql://${user}:${pw}@${host}:${port}/${db}`;
}

function pythonBin(): string | null {
  for (const bin of ["python", "python3", "py"]) {
    const r = spawnSync(bin, ["-c", "import psycopg"], { encoding: "utf-8" });
    if (r.status === 0) return bin;
  }
  return null;
}

/** Run a python snippet that emits JSON to a temp file; return the parsed JSON. */
function runPy<T>(py: string, uri: string, body: string): T {
  const dir = mkdtempSync(path.join(tmpdir(), "zhvi-gatea-"));
  const outPath = path.join(dir, "out.json");
  const script = `
import json, psycopg
uri = ${JSON.stringify(uri)}
out_path = ${JSON.stringify(outPath)}
${body}
`;
  const r = spawnSync(py, ["-c", script], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`psycopg subprocess failed:\n${r.stderr}\n${r.stdout}`);
  return JSON.parse(readFileSync(outPath, "utf-8")) as T;
}

// ── View shape (mirror of data_lake.zhvi_zip_latest) ─────────────────────────
interface ViewRow {
  zip_code: string;
  metro: string | null;
  county_name: string | null;
  city: string | null;
  latest_period: string; // ISO date "YYYY-MM-DD"
  home_value_latest: number;
  value_yoy_pct: number | null;
  value_mom_pct: number | null;
}

// ── Raw read: the SAME 24-month window the pack source reads ─────────────────
// zhvi-source.mts:45-48 — monthsBack=24, period_end >= (now - 24mo) as ISO date.
function sinceIso24mo(): string {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 24);
  return since.toISOString().slice(0, 10);
}

function fetchRawRows(uri: string, py: string, sinceIso: string): ZhviZipRow[] {
  return runPy<ZhviZipRow[]>(
    py,
    uri,
    `
since = ${JSON.stringify(sinceIso)}
rows = []
with psycopg.connect(uri) as conn:
    with conn.cursor() as cur:
        cur.execute("""
          SELECT zip_code, period_end::text, home_value::float8, metro, county_name, city
          FROM data_lake.zhvi_swfl
          WHERE period_end >= %s
          ORDER BY zip_code, period_end
        """, (since,))
        for zip_code, period_end, home_value, metro, county_name, city in cur.fetchall():
            rows.append({"zip_code": zip_code, "period_end": period_end,
                         "home_value": home_value, "metro": metro,
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
                 latest_period::text, home_value_latest::float8,
                 value_yoy_pct::float8, value_mom_pct::float8
          FROM data_lake.zhvi_zip_latest
          ORDER BY zip_code
        """)
        for r in cur.fetchall():
            rows.append({"zip_code": r[0], "metro": r[1], "county_name": r[2],
                         "city": r[3], "latest_period": r[4],
                         "home_value_latest": r[5], "value_yoy_pct": r[6],
                         "value_mom_pct": r[7]})
    conn.rollback()  # read-only
json.dump(rows, open(out_path, "w"))
`,
  );
}

// ── Emit-rounding: verbatim from the pack outputProducer ─────────────────────
// home-values-swfl.mts:325/379/439 → Number(value.toFixed(0)); :369/443 → toFixed(2).
const roundUsd = (v: number): number => Number(v.toFixed(0));
const roundYoy = (v: number | null): number | null =>
  v === null || !Number.isFinite(v) ? null : Number(v.toFixed(2));

// ── Pack path: build snapshot + the per-ZIP / slug-set / detail_table views ──
interface PackZip {
  zip_code: string;
  city: string | null;
  latest_period: string;
  home_value_raw: number; // PRE-emit, full precision (buildZipSnapshot:138, no rounding)
  value_yoy_raw: number | null; // PRE-emit, full precision (buildZipSnapshot:125-126)
  home_value_emit: number; // toFixed(0)
  yoy_emit: number | null; // toFixed(2)
  yoy_raw: number | null; // for top-N ranking (pack ranks on raw, :298-300) — alias of value_yoy_raw
}

function packZips(rows: ZhviZipRow[]): PackZip[] {
  const snap = buildSnapshot(rows);
  if (!snap) return [];
  return snap.zips.map((z) => ({
    zip_code: z.zip_code,
    city: z.city,
    latest_period: z.latest_period,
    home_value_raw: z.home_value_latest, // raw float8, before any toFixed
    value_yoy_raw: z.value_yoy_pct, // raw float8, before any toFixed
    home_value_emit: roundUsd(z.home_value_latest),
    yoy_emit: roundYoy(z.value_yoy_pct),
    yoy_raw: z.value_yoy_pct,
  }));
}

function packRegionalMedianYoy(rows: ZhviZipRow[]): number | null {
  return buildSnapshot(rows)?.regional_median_yoy_pct ?? null;
}

// median-over-finite-YoY (buildSnapshot:60-65/162-170) — reused for the view recompute.
function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Top-N slug SET — exactly the pack's logic (home-values-swfl.mts:298-302/365-387):
// rank finite-YoY ZIPs desc, take top-3 heating + bottom-3 cooling (reversed); emit
// `home_value_yoy_pct_zip_${zip}` + `home_value_zhvi_zip_${zip}` for each (skip null).
function slugSetFromYoy(entries: Array<{ zip_code: string; yoy_raw: number | null }>): Set<string> {
  const ranked = entries
    .filter((z) => z.yoy_raw !== null && Number.isFinite(z.yoy_raw))
    .sort((a, b) => (b.yoy_raw ?? 0) - (a.yoy_raw ?? 0));
  const topHeating = ranked.slice(0, TOP_N);
  const topCooling = ranked.slice(-TOP_N).reverse();
  const slugs = new Set<string>();
  for (const z of [...topHeating, ...topCooling]) {
    if (z.yoy_raw === null) continue;
    slugs.add(`home_value_yoy_pct_zip_${z.zip_code}`);
    slugs.add(`home_value_zhvi_zip_${z.zip_code}`);
  }
  return slugs;
}

// detail_table `home_values_by_zip` cell builder — verbatim cell shape
// (home-values-swfl.mts:431-449). MoM not in the view's per-row diff scope (the
// view DOES emit value_mom_pct; we diff it here for byte-stability completeness).
interface DetailCells {
  metro: string | null;
  county_name: string | null;
  city: string | null;
  latest_period: string;
  home_value_zhvi: number;
  value_yoy_pct: number | null;
  value_mom_pct: number | null;
}

function packDetailCells(rows: ZhviZipRow[]): Map<string, DetailCells> {
  const snap = buildSnapshot(rows);
  const out = new Map<string, DetailCells>();
  for (const z of snap?.zips ?? []) {
    out.set(z.zip_code, {
      metro: z.metro ?? null,
      county_name: z.county_name ?? null,
      city: z.city ?? null,
      latest_period: z.latest_period,
      home_value_zhvi: roundUsd(z.home_value_latest),
      value_yoy_pct: roundYoy(z.value_yoy_pct),
      value_mom_pct:
        z.value_mom_pct === null || !Number.isFinite(z.value_mom_pct)
          ? null
          : Number(z.value_mom_pct.toFixed(2)),
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
      home_value_zhvi: roundUsd(v.home_value_latest),
      value_yoy_pct: roundYoy(v.value_yoy_pct),
      value_mom_pct:
        v.value_mom_pct === null || !Number.isFinite(v.value_mom_pct)
          ? null
          : Number(v.value_mom_pct.toFixed(2)),
    });
  }
  return out;
}

const uri = dbUri();
const py = uri ? pythonBin() : null;
const runnable = Boolean(uri && py);

// CI-safe skip: describe.skip STILL invokes its body, and this body does a live psycopg
// fetch at collection time (fetchRawRows/fetchViewRows below) that THROWS — not skips —
// when creds/python are absent (CI). So when not runnable, register an empty skipped block
// and never touch the body. Manual cycle — runs only with .dlt creds + python (see header).
function gateDescribe(name: string, body: () => void): void {
  if (runnable) describe(name, body);
  else describe.skip(name, () => {});
}

gateDescribe("§04 GATE A — view ⇆ pack parity (cycle)", () => {
  const sinceIso = sinceIso24mo();
  // single fetch shared across parts
  const raw: ZhviZipRow[] = fetchRawRows(uri!, py!, sinceIso);
  const view: ViewRow[] = fetchViewRows(uri!, py!);
  const pack: PackZip[] = packZips(raw);
  const packByZip: Map<string, PackZip> = new Map(pack.map((p) => [p.zip_code, p]));
  const viewByZip: Map<string, ViewRow> = new Map(view.map((v) => [v.zip_code, v]));

  it("loaded both paths over the SAME 24-month window", () => {
    expect(raw.length).toBeGreaterThan(0);
    expect(view.length).toBeGreaterThan(0);
    expect(pack.length).toBeGreaterThan(0);
    // The view is latest-per-ZIP; the pack snapshot is also one ZipSnapshot per ZIP.
    // Same ZIP universe (both keyed off the same table).
    const packZ = new Set(packByZip.keys());
    const viewZ = new Set(viewByZip.keys());
    const onlyPack = [...packZ].filter((z) => !viewZ.has(z));
    const onlyView = [...viewZ].filter((z) => !packZ.has(z));
    expect({ onlyPack, onlyView }).toEqual({ onlyPack: [], onlyView: [] });
  });

  it("PART 1 — per-ZIP RAW parity (≤1e-9, like-for-like) AND displayed-emit parity (exact)", () => {
    // (1a) CUTOVER-CRITICAL raw parity: the view's RAW float8 vs the pack's RAW
    //      pre-emit value (buildZipSnapshot, before any toFixed). Tolerance EPS_RAW
    //      = 1e-9 (justification at the constant). This is the gate that matters: the
    //      TS rollup medians over THESE full-precision values before rounding, so a
    //      sub-dollar / sub-0.01% shift here is a real headline-number shift.
    const rawValueOffenders: Array<{ zip: string; view: number; pack: number; d: number }> = [];
    const rawYoyOffenders: Array<{
      zip: string;
      view: number | null;
      pack: number | null;
      d: number | null;
    }> = [];
    // (1b) DISPLAYED parity: apply the pack's OWN rounding (roundUsd→toFixed(0),
    //      roundYoy→toFixed(2)) to BOTH sides and assert EXACT integer / 2-dp equality
    //      (not epsilon). Guards the displayed per-ZIP slugs.
    const dispValueOffenders: Array<{ zip: string; view: number; pack: number }> = [];
    const dispYoyOffenders: Array<{ zip: string; view: number | null; pack: number | null }> = [];

    for (const [zip, p] of packByZip) {
      const v = viewByZip.get(zip)!;

      // ── 1a · RAW value: view float8 vs pack pre-emit float8, ≤ 1e-9 ──
      const dVal = Math.abs(v.home_value_latest - p.home_value_raw);
      if (dVal > EPS_RAW) {
        rawValueOffenders.push({ zip, view: v.home_value_latest, pack: p.home_value_raw, d: dVal });
      }
      // ── 1a · RAW YoY: NULL must agree EXACTLY; else ≤ 1e-9 ──
      {
        const pv = p.value_yoy_raw;
        const vv = v.value_yoy_pct;
        if (pv === null || vv === null) {
          if (pv !== vv) rawYoyOffenders.push({ zip, view: vv, pack: pv, d: null });
        } else {
          const d = Math.abs(vv - pv);
          if (d > EPS_RAW) rawYoyOffenders.push({ zip, view: vv, pack: pv, d });
        }
      }

      // ── 1b · DISPLAYED value: both rounded toFixed(0) → exact integer equality ──
      {
        const vDisp = roundUsd(v.home_value_latest);
        const pDisp = p.home_value_emit; // already roundUsd(raw)
        if (vDisp !== pDisp) dispValueOffenders.push({ zip, view: vDisp, pack: pDisp });
      }
      // ── 1b · DISPLAYED YoY: both rounded toFixed(2) → exact 2-dp equality ──
      {
        const vDisp = roundYoy(v.value_yoy_pct);
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
    // Recompute from the VIEW's per-ZIP rows with the SAME median-over-finite-YoY.
    // FULL PRECISION on BOTH sides: viewYoys are the view's RAW float8 value_yoy_pct
    // (unrounded — the SQL does not round, :72/78-85); packMedian is
    // buildSnapshot().regional_median_yoy_pct, which medians the raw per-ZIP YoY before
    // any emit-rounding (home-values-swfl.mts:161-170). No toFixed anywhere here.
    const viewYoys = view
      .map((v) => v.value_yoy_pct)
      .filter((y): y is number => y !== null && Number.isFinite(y));
    const viewMedian = viewYoys.length > 0 ? median(viewYoys) : null;

    const packMedian = packRegionalMedianYoy(raw);

    if (viewMedian === null || packMedian === null) {
      expect(viewMedian).toBe(packMedian);
    } else {
      // Pre-rounding, full precision — must match to float noise (both medians over
      // the SAME per-ZIP YoY set; only float-print noise can differ).
      expect(Math.abs(viewMedian - packMedian)).toBeLessThan(1e-9);
      // And: the polarity band must not differ (the live consequence).
      const band = (y: number) =>
        y < 0
          ? "bearish"
          : y < 3
            ? "neutral"
            : y <= 10
              ? "bullish"
              : y <= 15
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
      view.map((v) => ({ zip_code: v.zip_code, yoy_raw: v.value_yoy_pct })),
    );
    const onlyPack = [...packSlugs].filter((s) => !viewSlugs.has(s)).sort();
    const onlyView = [...viewSlugs].filter((s) => !packSlugs.has(s)).sort();
    expect({ onlyPack, onlyView }).toEqual({ onlyPack: [], onlyView: [] });
    expect(packSlugs.size).toBeGreaterThan(0);
  });

  it("PART 4 — detail_table home_values_by_zip cell names + values byte-stable", () => {
    const packCells = packDetailCells(raw);
    const viewCells = viewDetailCells(view);
    const cellKeys: (keyof DetailCells)[] = [
      "metro",
      "county_name",
      "city",
      "latest_period",
      "home_value_zhvi",
      "value_yoy_pct",
      "value_mom_pct",
    ];
    const offenders: Array<{ zip: string; cell: string; pack: unknown; view: unknown }> = [];
    for (const [zip, pc] of packCells) {
      const vc = viewCells.get(zip);
      if (!vc) {
        offenders.push({ zip, cell: "(missing in view)", pack: pc, view: undefined });
        continue;
      }
      for (const k of cellKeys) {
        // home_value_zhvi: byte-stable after the identical toFixed(0); the rest exact.
        if (pc[k] !== vc[k]) offenders.push({ zip, cell: k, pack: pc[k], view: vc[k] });
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ── BITE-PROOF — prove the harness catches what it exists to catch ───────────
// Seeds a perturbed COPY of the raw rows into a TEMP table + a temp view (the
// view's verbatim SQL), inside a ROLLED-BACK tx. Two assertions:
//   (a) a 1-cent RAW shift on one ZIP's latest value → PART 1 (RAW, ≤1e-9) goes RED.
//       (Under the OLD ±0.5 epsilon this stayed green — THAT was the design bug.)
//   (b) a shift large enough to flip a top-N rank → PART 3 goes RED (slug-set live).
gateDescribe("§04 GATE A — bite-proof (rolled-back perturbation)", () => {
  const sinceIso = sinceIso24mo();
  const raw = fetchRawRows(uri!, py!, sinceIso);
  const basePack = packZips(raw);
  const basePackByZip = new Map(basePack.map((p) => [p.zip_code, p]));

  // Helper: run the view's VERBATIM SQL against a TEMP-seeded copy of `rows`,
  // rolled back. Returns the same ViewRow shape.
  function viewFromTempRows(rows: ZhviZipRow[]): ViewRow[] {
    const dir = mkdtempSync(path.join(tmpdir(), "zhvi-gatea-bite-"));
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
        cur.execute("CREATE TEMP TABLE _zhvi_bite (zip_code text, period_end date, home_value double precision, metro text, county_name text, city text) ON COMMIT DROP")
        cur.executemany("INSERT INTO _zhvi_bite VALUES (%s,%s,%s,%s,%s,%s)",
            [(r["zip_code"], r["period_end"], r["home_value"], r.get("metro"), r.get("county_name"), r.get("city")) for r in rows])
        # The view's VERBATIM per-ZIP latest + ±7d MAX-within-window YoY/MoM SQL,
        # pointed at the TEMP table (byte-identical to docs/sql/20260612_zhvi_pivoted_views.sql).
        cur.execute("""
          WITH latest AS (
            SELECT DISTINCT ON (zip_code)
              zip_code, metro, county_name, city,
              period_end AS latest_period, home_value::float8 AS home_value_latest
            FROM _zhvi_bite ORDER BY zip_code, period_end DESC
          )
          SELECT l.zip_code, l.metro, l.county_name, l.city,
            l.latest_period::text, l.home_value_latest,
            ( l.home_value_latest
              / NULLIF((SELECT z.home_value::float8 FROM _zhvi_bite z
                         WHERE z.zip_code = l.zip_code
                           AND z.period_end BETWEEN l.latest_period - INTERVAL '12 months' - INTERVAL '7 days'
                                                AND l.latest_period - INTERVAL '12 months' + INTERVAL '7 days'
                         ORDER BY z.period_end DESC LIMIT 1), 0) - 1) * 100 AS value_yoy_pct,
            ( l.home_value_latest
              / NULLIF((SELECT z.home_value::float8 FROM _zhvi_bite z
                         WHERE z.zip_code = l.zip_code
                           AND z.period_end BETWEEN l.latest_period - INTERVAL '1 month' - INTERVAL '7 days'
                                                AND l.latest_period - INTERVAL '1 month' + INTERVAL '7 days'
                         ORDER BY z.period_end DESC LIMIT 1), 0) - 1) * 100 AS value_mom_pct
          FROM latest l ORDER BY l.zip_code
        """)
        for r in cur.fetchall():
            out.append({"zip_code": r[0], "metro": r[1], "county_name": r[2], "city": r[3],
                        "latest_period": r[4], "home_value_latest": r[5],
                        "value_yoy_pct": (None if r[6] is None else float(r[6])),
                        "value_mom_pct": (None if r[7] is None else float(r[7]))})
    conn.rollback()  # touch no live data
json.dump(out, open(${JSON.stringify(outPath)}, "w"))
`;
    const r = spawnSync(py!, ["-c", script], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`bite subprocess failed:\n${r.stderr}\n${r.stdout}`);
    return JSON.parse(readFileSync(outPath, "utf-8")) as ViewRow[];
  }

  // Sanity: the UNPERTURBED temp-view path equals the pack (proves the temp harness
  // faithfully reproduces the live view before we perturb it). RAW gate, ≤1e-9.
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
      if (Math.abs(vr.home_value_latest - p.home_value_raw) > EPS_RAW)
        offenders.push(`${zip}: value`);
      const pv = p.value_yoy_raw;
      const vv = vr.value_yoy_pct;
      if (pv === null || vv === null) {
        if (pv !== vv) offenders.push(`${zip}: yoy-null`);
      } else if (Math.abs(vv - pv) > EPS_RAW) offenders.push(`${zip}: yoy`);
    }
    expect(offenders).toEqual([]);
  });

  it("(a) 1-cent perturbation on one ZIP's latest value → PART 1 (RAW) goes RED", () => {
    // THE STRONGER GATE the operator wants. Under the OLD ±0.5 epsilon a $0.01 shift
    // STAYED GREEN (the bug — half-a-dollar slack swallowed a real cent-level
    // divergence). The new RAW gate (≤1e-9) has NO slack: a real 1¢ raw divergence
    // must now be REJECTED.
    const targetZip = basePack[0].zip_code;
    const perturbed = raw.map((r) => {
      const isLatestOfTarget =
        r.zip_code === targetZip && r.period_end === basePackByZip.get(targetZip)!.latest_period;
      return isLatestOfTarget ? { ...r, home_value: r.home_value + 0.01 } : r;
    });
    const v = viewFromTempRows(perturbed);
    const vr = v.find((x) => x.zip_code === targetZip)!;
    const p = basePackByZip.get(targetZip)!;
    // The view's RAW home_value_latest is now +0.01 vs the pack's RAW value — a
    // divergence of ~0.01, which is >> EPS_RAW (1e-9). PART 1's raw assertion fires.
    const dRaw = Math.abs(vr.home_value_latest - p.home_value_raw);
    expect(dRaw).toBeGreaterThan(EPS_RAW);
    expect(dRaw).toBeCloseTo(0.01, 9); // it is exactly the 1¢ we injected
  });

  it("(b) rank-flipping perturbation → PART 3 (slug SET) goes RED", () => {
    // Baseline slug set (pack).
    const packSlugs = slugSetFromYoy(
      basePack.map((p) => ({ zip_code: p.zip_code, yoy_raw: p.yoy_raw })),
    );

    // Find a ZIP that is NOT currently in the top-3 heating, and inflate its latest
    // value massively so its YoY rockets to the #1 heating slot — forcing a new
    // `home_value_*_zip_${zip}` pair into the set and evicting the prior #3.
    const rankedDesc = [...basePack]
      .filter((p) => p.yoy_raw !== null && Number.isFinite(p.yoy_raw))
      .sort((a, b) => (b.yoy_raw ?? 0) - (a.yoy_raw ?? 0));
    const topHeatingZips = new Set(rankedDesc.slice(0, TOP_N).map((p) => p.zip_code));
    const topCoolingZips = new Set(rankedDesc.slice(-TOP_N).map((p) => p.zip_code));
    // A ZIP that is neither in heating nor cooling top-N (a "middle" ZIP) — flipping
    // it into #1 heating must change the SET.
    const victim = rankedDesc.find(
      (p) => !topHeatingZips.has(p.zip_code) && !topCoolingZips.has(p.zip_code),
    );
    expect(victim, "need a middle-ranked ZIP to promote").toBeTruthy();
    const victimZip = victim!.zip_code;

    // Triple the latest value → YoY ~ +200%, guaranteed new #1 heating.
    const perturbed = raw.map((r) => {
      const isLatestOfVictim =
        r.zip_code === victimZip && r.period_end === basePackByZip.get(victimZip)!.latest_period;
      return isLatestOfVictim ? { ...r, home_value: r.home_value * 3 } : r;
    });
    const v = viewFromTempRows(perturbed);
    const perturbedSlugs = slugSetFromYoy(
      v.map((x) => ({ zip_code: x.zip_code, yoy_raw: x.value_yoy_pct })),
    );

    // The perturbed view's slug SET must DIFFER from the unperturbed pack's — i.e.
    // PART 3 would go RED. Specifically the victim's slugs must now be present.
    expect(perturbedSlugs.has(`home_value_yoy_pct_zip_${victimZip}`)).toBe(true);
    expect(perturbedSlugs.has(`home_value_zhvi_zip_${victimZip}`)).toBe(true);
    expect(packSlugs.has(`home_value_yoy_pct_zip_${victimZip}`)).toBe(false);
    // Set inequality = the bite.
    const onlyPerturbed = [...perturbedSlugs].filter((s) => !packSlugs.has(s));
    expect(onlyPerturbed.length).toBeGreaterThan(0);
  });
});
