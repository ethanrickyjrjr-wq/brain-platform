/**
 * Nearest-centroid corridor assignment for permits-swfl v1.
 *
 * Path B per spec: corridor centroids live in Sanity, not Postgres. We pull
 * them at build time and run an in-memory nearest-centroid pick per permit.
 * Documented limitation: this is a point-to-point heuristic, not polygon
 * containment. Tune `maxRadiusMi` to balance coverage vs. precision.
 *
 * Backlog: promote corridor centroids to a Tier 1 Parquet mirror and switch
 * to `makeDuckDBSource` cross-tier (Path A from spec).
 */

export interface CorridorCentroid {
  corridor_id: string;
  corridor_label: string;
  center_lat: number;
  center_lon: number;
  submarket?: string;
  /**
   * Owning county for per-county rollups in `permits-swfl`. Optional so that
   * pre-existing test fixtures + literal constructor sites keep typechecking.
   * Live fixture (`fixtures/corridor-centroids.json`) sets it on every row;
   * a per-county rollup helper that encounters `undefined` should treat the
   * centroid as Lee (the legacy default) and log a defensive warning so the
   * backfill miss is visible in CI logs.
   */
  county?: "lee" | "collier";
}

export interface CorridorAssignmentOptions {
  /** Max distance (statute miles) from centroid; beyond this, return null. */
  maxRadiusMi: number;
}

export interface CorridorAssignment {
  corridor_id: string;
  corridor_label: string;
  distance_mi: number;
}

const EARTH_RADIUS_MI = 3958.7613;

function haversineMi(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_MI * 2 * Math.asin(Math.sqrt(a));
}

export function assignCorridor(
  lat: number | null | undefined,
  lon: number | null | undefined,
  centroids: ReadonlyArray<CorridorCentroid>,
  opts: CorridorAssignmentOptions,
): CorridorAssignment | null {
  if (
    lat == null ||
    lon == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    return null;
  }
  if (centroids.length === 0) {
    return null;
  }
  let best: CorridorAssignment | null = null;
  for (const c of centroids) {
    const d = haversineMi(lat, lon, c.center_lat, c.center_lon);
    if (d > opts.maxRadiusMi) continue;
    if (best === null || d < best.distance_mi) {
      best = {
        corridor_id: c.corridor_id,
        corridor_label: c.corridor_label,
        distance_mi: d,
      };
    }
  }
  return best;
}
