/**
 * Allowlist of tables publishable via `/r/source/[table]`.
 *
 * Public exposure of arbitrary Supabase tables is a footgun — the
 * service-role client used by the provenance page can read anything the
 * `service_role` Postgres role has SELECT on, including future PII landings
 * or `_ingest_metadata` artifacts. This gate keeps the blast radius small:
 * a table that isn't on this list renders the "not published" panel, never
 * any rows.
 *
 * **When adding a new entry:**
 * 1. Pick `date_col` to match the column the pack actually orders by (i.e.
 *    the *normalized* name when the source normalizes, otherwise the raw
 *    Postgres column).
 * 2. Larger Tier 2 tables: ship a `CREATE INDEX ON {table}({date_col} DESC)`
 *    migration alongside this entry — the page issues `ORDER BY {date_col}
 *    DESC LIMIT 12` and will seq-scan without one.
 * 3. Migrate the corresponding source connector's citation URL builder to
 *    `buildSourceCitationUrl` in the same PR so the entry doesn't sit unused.
 */
export interface SourceTableEntry {
  /** Human label rendered when no `label` query param is supplied. */
  label: string;
  /** Consuming brain id; rendered as a `/r/{brain}` link in the meta grid. */
  brain: string;
  /**
   * Optional column the page orders by, descending. Walks a prioritized
   * fallback list when absent — see `[table]/page.tsx`.
   */
  date_col?: string;
}

export const SOURCE_PROVENANCE_TABLES: Record<string, SourceTableEntry> = {
  fl_dor_tdt_collections: {
    label: "Florida DOR — Tourist Development Tax collections",
    brain: "tourism-tdt",
    date_col: "period",
  },
};

export function isPublishedSourceTable(table: string): boolean {
  return Object.prototype.hasOwnProperty.call(SOURCE_PROVENANCE_TABLES, table);
}
