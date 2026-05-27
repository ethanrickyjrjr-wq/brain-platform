import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * fdot source connector — Florida DOT AADT (Annual Average Daily Traffic) for SWFL.
 *
 * Reads data_lake.fdot_aadt_fl (Tier 2, populated by the dlt pipeline at
 * ingest/pipelines/fdot/). Aggregates raw segment rows into (county, year)
 * length-weighted aggregates + one cohort-matched YoY fragment so the pack's
 * outputProducer is a thin reader of pre-aggregated values.
 *
 * Trust tier: 2 (state govt published, ~1yr publishing lag).
 *
 * County scope:
 *   - Lee + Collier — brain's standard SWFL scope (matches env-swfl, master).
 *   - Charlotte — Ian recovery exception only. The post-Ian index spans Lee +
 *     Collier + Charlotte because all three sat in the eye-wall path; the
 *     other 4 traffic concepts intentionally stay 2-county.
 *
 * Year scope: LATEST_FDOT_YEAR back 4 years (5-year window) for CAGR, YoY,
 * and Ian baseline (2022). Update LATEST_FDOT_YEAR when FDOT publishes the
 * next vintage.
 *
 * Length-weighting source: shape_length (auto-generated geometry length in
 * the layer projection). shape_leng attribute is unused — may be stale after
 * route realignments.
 */

const SOURCE_ID = "fdot_aadt_swfl";
const SCHEMA = "data_lake";
const TABLE = "fdot_aadt_fl";

/** Latest published FDOT AADT year — bump when FDOT publishes the next vintage. */
export const LATEST_FDOT_YEAR = 2025;
const WINDOW_YEARS = 5;
const EARLIEST_YEAR = LATEST_FDOT_YEAR - (WINDOW_YEARS - 1);
const IAN_BASELINE_YEAR = 2022;

const BRAIN_COUNTIES = ["Lee", "Collier"] as const;
const IAN_COUNTIES = ["Lee", "Collier", "Charlotte"] as const;
const ALL_COUNTIES = [
  ...new Set([...BRAIN_COUNTIES, ...IAN_COUNTIES]),
] as const;

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "traffic-swfl.sample.json",
);

/** Raw segment row as it lands from data_lake.fdot_aadt_fl. */
interface SegmentRow {
  yearx: number;
  county: string;
  roadway: string;
  desc_frm: string;
  desc_to: string;
  aadt: number;
  aadtflg: string | null;
  tfctr: number | null;
  shape_length: number | null;
}

/** Pre-aggregated (county, year) bucket — one fragment per bucket. */
export interface TrafficCountyYearNormalized {
  kind: "fdot-county-year";
  county: string;
  year: number;
  /** Length-weighted mean AADT: sum(aadt × shape_length) / sum(shape_length). */
  weighted_avg_aadt: number;
  /** Median of tfctr (truck factor) across the segments in the bucket. */
  median_tfctr: number;
  /** Total shape_length (denominator of the weighting + sanity check). */
  sum_shape_length: number;
  /** Number of non-null-AADT segments contributing. */
  segment_count: number;
}

/** Cohort-matched YoY: segments present (with non-null AADT) in BOTH prev_year and curr_year for Lee+Collier. */
export interface TrafficCohortYoYNormalized {
  kind: "fdot-cohort-yoy";
  counties: readonly string[];
  prev_year: number;
  curr_year: number;
  /** Number of segments present in both years' cohort. */
  cohort_size: number;
  prev_weighted_aadt: number;
  curr_weighted_aadt: number;
  /** (curr - prev) / prev × 100. */
  yoy_pct: number;
}

interface FixtureShape {
  segments: SegmentRow[];
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function segmentKey(s: SegmentRow): string {
  return `${s.roadway}::${s.desc_frm}::${s.desc_to}`;
}

function aggregateCountyYear(
  segments: SegmentRow[],
  county: string,
  year: number,
): TrafficCountyYearNormalized | null {
  const bucket = segments.filter(
    (s) => s.county === county && s.yearx === year && s.aadt != null,
  );
  if (bucket.length === 0) return null;
  let weightedSum = 0;
  let totalLen = 0;
  const tfctrs: number[] = [];
  for (const s of bucket) {
    const len = s.shape_length ?? 0;
    if (len <= 0) continue;
    weightedSum += s.aadt * len;
    totalLen += len;
    if (s.tfctr != null) tfctrs.push(s.tfctr);
  }
  if (totalLen === 0) return null;
  return {
    kind: "fdot-county-year",
    county,
    year,
    weighted_avg_aadt: weightedSum / totalLen,
    median_tfctr: median(tfctrs),
    sum_shape_length: totalLen,
    segment_count: bucket.length,
  };
}

function aggregateCohortYoY(
  segments: SegmentRow[],
  counties: readonly string[],
  prevYear: number,
  currYear: number,
): TrafficCohortYoYNormalized | null {
  const inScope = (s: SegmentRow) =>
    counties.includes(s.county) && s.aadt != null && (s.shape_length ?? 0) > 0;
  const prev = new Map<string, SegmentRow>();
  const curr = new Map<string, SegmentRow>();
  for (const s of segments) {
    if (!inScope(s)) continue;
    if (s.yearx === prevYear) prev.set(segmentKey(s), s);
    else if (s.yearx === currYear) curr.set(segmentKey(s), s);
  }
  let prevWeighted = 0;
  let currWeighted = 0;
  let totalLen = 0;
  let cohortSize = 0;
  for (const [key, prevSeg] of prev) {
    const currSeg = curr.get(key);
    if (!currSeg) continue;
    const len = prevSeg.shape_length ?? 0;
    prevWeighted += prevSeg.aadt * len;
    currWeighted += currSeg.aadt * len;
    totalLen += len;
    cohortSize += 1;
  }
  if (totalLen === 0 || cohortSize === 0) return null;
  const prevAvg = prevWeighted / totalLen;
  const currAvg = currWeighted / totalLen;
  return {
    kind: "fdot-cohort-yoy",
    counties,
    prev_year: prevYear,
    curr_year: currYear,
    cohort_size: cohortSize,
    prev_weighted_aadt: prevAvg,
    curr_weighted_aadt: currAvg,
    yoy_pct: prevAvg === 0 ? 0 : ((currAvg - prevAvg) / prevAvg) * 100,
  };
}

async function loadFixture(): Promise<FixtureShape> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as FixtureShape;
}

/**
 * Throws a helpful error when the live query returns no rows. Extracted from
 * fetchLive so it can be unit-tested without standing up a Supabase mock.
 * The message names BOTH the pipeline command and the grant SQL because in
 * practice 0 rows almost always means one of those two steps was skipped.
 */
export function assertSegmentsNonEmpty(segments: SegmentRow[]): void {
  if (segments.length > 0) return;
  throw new Error(
    `fdot-source: ${SCHEMA}.${TABLE} returned 0 rows for counties=${ALL_COUNTIES.join(",")} years ${EARLIEST_YEAR}-${LATEST_FDOT_YEAR}. ` +
      "Confirm the dlt pipeline ran (python -m ingest.pipelines.fdot.pipeline) and that docs/sql/fdot_aadt_fl_grant.sql was applied (service_role needs SELECT on data_lake.fdot_aadt_fl).",
  );
}

/**
 * PostgREST enforces a project-level `db.max_rows` cap (default 1000 on
 * Supabase). A single `.limit(100000)` silently truncates to that cap and
 * the truncated slice happens to skew to the lowest objectid rows, so
 * later years (and the Lee+Collier cohort-yoy join) silently drop out.
 * Page explicitly with `.range()` instead.
 */
const PAGE_SIZE = 1000;
/** Hard ceiling on pagination iterations. ~4,600 rows in current scope; 200 pages = 200K row safety margin. */
const MAX_PAGES = 200;

async function fetchLive(): Promise<FixtureShape> {
  const sb = getSupabase().schema(SCHEMA);
  const segments: SegmentRow[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const to = from + PAGE_SIZE - 1;
    const resp = await sb
      .from(TABLE)
      .select(
        "yearx,county,roadway,desc_frm,desc_to,aadt,aadtflg,tfctr,shape_length",
      )
      .in("county", [...ALL_COUNTIES])
      .gte("yearx", Math.min(EARLIEST_YEAR, IAN_BASELINE_YEAR))
      .lte("yearx", LATEST_FDOT_YEAR)
      .not("aadt", "is", null)
      // Stable ordering — PostgREST without ORDER BY can repeat or skip rows across pages.
      .order("objectid", { ascending: true })
      .range(from, to);
    if (resp.error) {
      throw new Error(
        `fdot-source: ${SCHEMA}.${TABLE} query failed — ${resp.error.message}`,
      );
    }
    const rows = (resp.data ?? []) as SegmentRow[];
    segments.push(...rows);
    if (rows.length < PAGE_SIZE) {
      assertSegmentsNonEmpty(segments);
      return { segments };
    }
    from += PAGE_SIZE;
  }
  throw new Error(
    `fdot-source: ${SCHEMA}.${TABLE} pagination exceeded MAX_PAGES=${MAX_PAGES} (${MAX_PAGES * PAGE_SIZE} rows) — raise MAX_PAGES or narrow the query.`,
  );
}

export const fdotSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 2,
  async fetch(): Promise<RawFragment[]> {
    const data =
      env.source === "fixture" ? await loadFixture() : await fetchLive();
    const fetched_at = isoTimestamp();
    const fragments: RawFragment[] = [];

    // Per (county, year) aggregates for every (county × year) in scope.
    const years: number[] = [];
    for (let y = EARLIEST_YEAR; y <= LATEST_FDOT_YEAR; y++) years.push(y);
    if (!years.includes(IAN_BASELINE_YEAR)) years.unshift(IAN_BASELINE_YEAR);

    for (const county of ALL_COUNTIES) {
      for (const year of years) {
        const agg = aggregateCountyYear(data.segments, county, year);
        if (!agg) continue;
        fragments.push({
          fragment_id: fragmentId(SOURCE_ID, `${county.toLowerCase()}-${year}`),
          source_id: SOURCE_ID,
          source_trust_tier: 2,
          fetched_at,
          raw: { county, year, segment_count: agg.segment_count },
          normalized: agg,
        });
      }
    }

    // Cohort-matched YoY for Lee + Collier (the brain's standard scope) — drives traffic_aadt_swfl_yoy_pct.
    const cohort = aggregateCohortYoY(
      data.segments,
      BRAIN_COUNTIES,
      LATEST_FDOT_YEAR - 1,
      LATEST_FDOT_YEAR,
    );
    if (cohort) {
      fragments.push({
        fragment_id: fragmentId(
          SOURCE_ID,
          `cohort-yoy-${cohort.prev_year}-${cohort.curr_year}`,
        ),
        source_id: SOURCE_ID,
        source_trust_tier: 2,
        fetched_at,
        raw: { cohort_size: cohort.cohort_size },
        normalized: cohort,
      });
    }

    return fragments;
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    const liveUrl =
      env.source === "live" && env.supabaseUrl
        ? `${env.supabaseUrl}/rest/v1/${TABLE}?select=yearx,county,roadway,desc_frm,desc_to,aadt,aadtflg,tfctr,shape_length&county=in.(${ALL_COUNTIES.join(",")})&yearx=gte.${Math.min(EARLIEST_YEAR, IAN_BASELINE_YEAR)}&yearx=lte.${LATEST_FDOT_YEAR}&aadt=not.is.null`
        : `fixture://refinery/__fixtures__/traffic-swfl.sample.json`;
    return {
      source:
        env.source === "fixture"
          ? `FDOT AADT (fixture; ${SCHEMA}.${TABLE}, counties ${ALL_COUNTIES.join("+")}, years ${EARLIEST_YEAR}-${LATEST_FDOT_YEAR}) — ${liveUrl}`
          : `FDOT AADT segments via ${SCHEMA}.${TABLE} (dlt-ingested from FDOT FTO_PROD/MapServer/7; counties ${ALL_COUNTIES.join("+")}, years ${EARLIEST_YEAR}-${LATEST_FDOT_YEAR}, non-null AADT only) — ${liveUrl}`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};
