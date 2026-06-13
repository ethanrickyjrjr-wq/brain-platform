/**
 * Pivoted-Views build §08a — view_vintages → ALFRED Vintage mapper. UNWIRED.
 *
 * Maps rows captured by ingest/scripts/capture_view_vintages.py (one row per
 * view_name/as_of/period/series_key) into the point-in-time `Vintage` shape that
 * grid.mts already consumes:
 *
 *   as_of  → realtime_start   (when this value was first/again observed)
 *   period → observation_date (the month the value describes, as month-end YYYY-MM-DD)
 *
 * From there the EXISTING `initialVintages()` + `pitInitial()` (grid.mts) give an
 * honest, look-ahead-free read — no new PIT math. This module only RESHAPES.
 *
 * ⚠️ DELIBERATELY UNWIRED. Nothing imports it yet. Registering ZHVI/ZORI as
 * backtestable is §08c and is GATED on ~9 months of real captured history — flipping
 * the switch on near-zero N produces phantom grades. This file is the inert half of
 * that future wiring; do NOT add a BACKTESTABLE entry here. See
 * docs/superpowers/plans/2026-06-12-pivoted-views-build/08-view-vintages-GATED.md.
 */
import type { Vintage } from "./grid.mts";

/** One row of data_lake.view_vintages (the capture table). */
export interface ViewVintageRow {
  view_name: string;
  /** YYYY-MM-DD — the capture run date. Becomes realtime_start. */
  as_of: string;
  /** The unpivoted period, normally 'YYYY-MM'. Becomes observation_date. */
  period: string;
  /** The unpivoted column name (e.g. 'cape_coral'). */
  series_key: string;
  value: number;
}

/**
 * Normalize a captured period to a YYYY-MM-DD observation_date. 'YYYY-MM' → that
 * month's last day (matches the raw `*_swfl.period_end` month-end convention and the
 * `Vintage` "dates are YYYY-MM-DD" contract). An already-full 'YYYY-MM-DD' passes
 * through unchanged.
 */
export function periodToObservationDate(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period; // already a full date, or an unexpected shape — leave as-is
  const year = Number(m[1]);
  const month = Number(m[2]); // 1-12
  // Day 0 of the next month === the last day of this month (UTC, no DST drift).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * Reshape captured view_vintages rows for ONE (view_name, series_key) series into
 * ALFRED-style `Vintage[]`. Filtering by series is the caller's join key — a view
 * has many series (one per unpivoted column); each is its own time series.
 */
export function viewVintagesToVintages(
  rows: readonly ViewVintageRow[],
  viewName: string,
  seriesKey: string,
): Vintage[] {
  return rows
    .filter((r) => r.view_name === viewName && r.series_key === seriesKey)
    .map((r) => ({
      observation_date: periodToObservationDate(r.period),
      value: r.value,
      realtime_start: r.as_of,
    }));
}
