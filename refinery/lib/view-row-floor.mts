// refinery/lib/view-row-floor.mts
//
// GATE B partial-view floor for the latest-per-ZIP brain-input views
// (data_lake.zhvi_zip_latest, data_lake.zori_zip_latest). These views hold ~one
// row per SWFL ZIP, so their row count is a direct coverage signal. The existing
// 0-row throw in each *-zip-latest-source.mts catches a missing GRANT / unpublished
// view (the 404/empty case). This floor catches the OTHER partial-view failure:
// the grant works and the view returns rows, but FEWER than the SWFL ZIP universe —
// a half-refreshed view or a shrunken raw partition. Without it, GATE B "floors at
// 0 rows only" and a partial-coverage regional median builds GREEN (check:
// zhvi_zori_gate_b_minrows).
//
// LIVE-BRANCH ONLY: call this from a source's fetchFromSupabase, never the fixture
// path (the crafted fixtures hold far fewer than ~90 rows). Same discipline as
// selectAllPaged's minRows (paginate.mts:50-54).
//
// The thrown message is intentionally free of transient markers (no "socket",
// "econnreset", "etimedout", "fetch failed") so resilient-build.isTransientError
// classifies it DETERMINISTIC → deriveExitCode escalates it to a loud exit 1
// (red + notify), never a quiet self-healing exit 2.

/**
 * Assert a latest-per-ZIP view returned at least `minRows` rows. Throws a
 * deterministic (loud) error when `rowCount < minRows`. No-op at or above the floor.
 *
 * @param viewName  the data_lake view name (for the diagnostic, e.g. "zhvi_zip_latest")
 * @param rowCount  rows actually returned by the live read
 * @param minRows   the coverage floor (below the verified live ZIP count, above churn)
 */
export function assertViewRowFloor(viewName: string, rowCount: number, minRows: number): void {
  if (rowCount < minRows) {
    throw new Error(
      `GATE B partial-view: data_lake.${viewName} returned ${rowCount} rows ` +
        `(< ${minRows} floor). A latest-per-ZIP view should hold ~one row per SWFL ZIP; ` +
        `a sub-floor count means a partial / half-refreshed view or a shrunken raw ` +
        `partition. Aborting before a partial-coverage regional median can build GREEN. ` +
        `Verify the underlying raw table's ZIP coverage and the view's refresh.`,
    );
  }
}
