import type { ChartRow } from "@/types/viz";

/** Raw row from public.rsw_airport_monthly (only the columns the chart selects). */
export interface AirportMonthRow {
  report_month: string; // PostgREST serializes a DATE as an ISO string, e.g. "2026-04-01"
  value: number | null;
}

export interface PassengerSeries {
  /** Chart-ready rows { month: "YYYY-MM", passengers }, oldest → newest. */
  entries: ChartRow[];
  /** Latest covered month ("YYYY-MM"), or undefined when nothing is renderable. */
  asOf?: string;
  /** Rows the query returned, before the null filter — for the provenance line. */
  rowCount: number;
}

/** Series key the airport panel plots; must match REGION_PASSENGER_SERIES in series.ts. */
const PASSENGER_KEY = "passengers";

/**
 * Pure mapper: raw airport rows → single-series chart rows. Normalizes the DATE
 * to a "YYYY-MM" month string (matching the pivoted-view shape so one component
 * renders both), drops rows with a null value, sorts ascending, and anchors
 * `asOf` to the newest month. Tolerates null/empty so a failed read degrades to
 * an empty chart instead of throwing.
 */
export function mapAirportRows(rows: AirportMonthRow[] | null | undefined): PassengerSeries {
  if (!rows || rows.length === 0) {
    return { entries: [], asOf: undefined, rowCount: 0 };
  }

  const entries: ChartRow[] = rows
    .filter((r): r is AirportMonthRow & { value: number } => r.value != null && !!r.report_month)
    .map((r) => ({ month: r.report_month.slice(0, 7), [PASSENGER_KEY]: r.value }))
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));

  const asOf = entries.length > 0 ? String(entries[entries.length - 1].month) : undefined;

  return { entries, asOf, rowCount: rows.length };
}
