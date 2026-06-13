/**
 * TEST-ONLY independent oracle for the ZORI view-parity tests.
 *
 * `buildSnapshot` is the raw-row YoY/MoM/median reimplementation that the
 * `zori-zip-latest-*` parity tests diff the SQL view (`data_lake.zori_zip_latest`)
 * against: VIEW SQL == this independent TS implementation. After the §05 GATE-B
 * cutover, `rentals-swfl` reads the view via `buildSnapshotFromViewRows`, so this
 * raw-row path is no longer a production export — but it MUST survive as the
 * independent cross-check, or the view could drift silently with nothing to catch it
 * (risk-register #12). Re-pointing the parity tests at `buildSnapshotFromViewRows`
 * would make them compare the view to itself (vacuous). So the oracle lives here,
 * deliberately SELF-CONTAINED (its own `median` + types) so it shares zero code with
 * production and cannot drift in lockstep with a production bug.
 *
 * Structural clone of `_home-values-oracle.mts` (ZHVI), swapping home_value →
 * rent_index. Leading `_`, no `.test.` in the name → `bun test` never collects it
 * directly.
 */
import type { ZoriZipRow } from "../sources/zori-source.mts";

// ── Domain types (self-contained copies — see header) ────────────────────────

interface ZipSeries {
  zip_code: string;
  metro: string | null;
  county_name: string | null;
  city: string | null;
  /** Sorted ascending by period_end. */
  observations: Array<{ period_end: string; rent_index: number }>;
}

export interface ZipSnapshot {
  zip_code: string;
  metro: string | null;
  county_name: string | null;
  city: string | null;
  /** Latest period_end seen. */
  latest_period: string;
  rent_index_latest: number;
  rent_yoy_pct: number | null;
  rent_mom_pct: number | null;
}

export interface RentalsSnapshot {
  zips: ZipSnapshot[];
  regional_latest_period: string;
  regional_median_rent_index: number;
  regional_median_yoy_pct: number | null;
  zips_covered: number;
  zips_with_yoy: number;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function groupByZip(rows: ZoriZipRow[]): Map<string, ZipSeries> {
  const out = new Map<string, ZipSeries>();
  for (const r of rows) {
    let series = out.get(r.zip_code);
    if (!series) {
      series = {
        zip_code: r.zip_code,
        metro: r.metro,
        county_name: r.county_name,
        city: r.city,
        observations: [],
      };
      out.set(r.zip_code, series);
    }
    series.observations.push({
      period_end: r.period_end,
      rent_index: r.rent_index,
    });
  }
  for (const series of out.values()) {
    series.observations.sort((a, b) =>
      a.period_end < b.period_end ? -1 : a.period_end > b.period_end ? 1 : 0,
    );
  }
  return out;
}

/** Return the observation N months before `latest`, or null if not present. */
function lookbackObservation(
  observations: ZipSeries["observations"],
  monthsBack: number,
): { period_end: string; rent_index: number } | null {
  if (observations.length === 0) return null;
  const latestDate = new Date(observations[observations.length - 1].period_end);
  const target = new Date(latestDate);
  target.setUTCMonth(target.getUTCMonth() - monthsBack);

  // Walk backwards from the end until we find an observation whose date is
  // <= the target. Tolerance of 7 days for month-end-vs-month-start drift.
  const targetMs = target.getTime();
  const toleranceMs = 7 * 86400_000;
  for (let i = observations.length - 1; i >= 0; i--) {
    const obs = observations[i];
    const obsMs = new Date(obs.period_end).getTime();
    if (Math.abs(obsMs - targetMs) <= toleranceMs) return obs;
    if (obsMs < targetMs - toleranceMs) return null;
  }
  return null;
}

function buildZipSnapshot(series: ZipSeries): ZipSnapshot | null {
  const obs = series.observations;
  if (obs.length === 0) return null;
  const latest = obs[obs.length - 1];

  const yearAgo = lookbackObservation(obs, 12);
  const monthAgo = lookbackObservation(obs, 1);

  const rent_yoy_pct =
    yearAgo && yearAgo.rent_index > 0 ? (latest.rent_index / yearAgo.rent_index - 1) * 100 : null;
  const rent_mom_pct =
    monthAgo && monthAgo.rent_index > 0
      ? (latest.rent_index / monthAgo.rent_index - 1) * 100
      : null;

  return {
    zip_code: series.zip_code,
    metro: series.metro,
    county_name: series.county_name,
    city: series.city,
    latest_period: latest.period_end,
    rent_index_latest: latest.rent_index,
    rent_yoy_pct,
    rent_mom_pct,
  };
}

/**
 * Independent raw-row oracle: per-ZIP YoY/MoM + regional median rollup, computed
 * in TS straight from `zori_swfl` raw rows. Byte-for-byte the pre-§05 pack math.
 */
export function buildSnapshot(rows: ZoriZipRow[]): RentalsSnapshot | null {
  if (rows.length === 0) return null;
  const grouped = groupByZip(rows);

  const zipSnaps: ZipSnapshot[] = [];
  for (const series of grouped.values()) {
    const snap = buildZipSnapshot(series);
    if (snap) zipSnaps.push(snap);
  }
  if (zipSnaps.length === 0) return null;

  // Use the single latest period_end across all ZIPs as the regional anchor —
  // every ZIP should land on the same month after a clean ZORI publish.
  zipSnaps.sort((a, b) => (a.zip_code < b.zip_code ? -1 : a.zip_code > b.zip_code ? 1 : 0));
  const regional_latest_period = zipSnaps
    .map((z) => z.latest_period)
    .sort()
    .reverse()[0];

  const indices = zipSnaps.map((z) => z.rent_index_latest);
  const yoys = zipSnaps
    .map((z) => z.rent_yoy_pct)
    .filter((y): y is number => y !== null && Number.isFinite(y));

  return {
    zips: zipSnaps,
    regional_latest_period,
    regional_median_rent_index: median(indices),
    regional_median_yoy_pct: yoys.length > 0 ? median(yoys) : null,
    zips_covered: zipSnaps.length,
    zips_with_yoy: yoys.length,
  };
}
