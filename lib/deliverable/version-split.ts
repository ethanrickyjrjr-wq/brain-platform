/**
 * lib/deliverable/version-split.ts — FINAL BOSS Piece 4.
 *
 * Split a project's deliverable rows (loaded newest-first) into:
 *   - heads:   the LIVE rows shown in the Built lane. A head is a live row that no
 *              OTHER live row supersedes; its older live versions are attached
 *              (newest-first) by walking the `supersedes_id` chain. Trashing the
 *              newest version promotes the prior live version back to a head.
 *   - trashed: rows with `deleted_at` set (the "Recently deleted" disclosure).
 *
 * Pure + generic + cycle-guarded (corrupted lineage can't infinite-loop). The page
 * server component calls this; the lanes stay presentational.
 */

export interface Versioned {
  id: string;
  deleted_at: string | null;
  supersedes_id: string | null;
}

export function splitDeliverableVersions<T extends Versioned>(
  rows: T[],
): { heads: (T & { versions: T[] })[]; trashed: T[] } {
  const trashed = rows.filter((r) => r.deleted_at);
  const live = rows.filter((r) => !r.deleted_at);
  const byId = new Map(live.map((r) => [r.id, r]));
  const superseded = new Set(
    live.map((r) => r.supersedes_id).filter((x): x is string => x != null),
  );

  // `claimed` makes each ancestor attach to exactly ONE head. Heads iterate newest-first
  // (rows arrive newest-first), so if a corrupted/branched lineage has two live rows
  // superseding the same ancestor, the newest head claims it and it isn't duplicated.
  const claimed = new Set<string>();
  const heads: (T & { versions: T[] })[] = [];
  for (const r of live) {
    if (superseded.has(r.id)) continue; // a newer live version replaced this one
    const versions: T[] = [];
    const seen = new Set<string>([r.id]);
    let cur = r.supersedes_id;
    while (cur != null && byId.has(cur) && !seen.has(cur) && !claimed.has(cur)) {
      seen.add(cur);
      claimed.add(cur);
      const prev = byId.get(cur)!;
      versions.push(prev);
      cur = prev.supersedes_id;
    }
    heads.push({ ...r, versions });
  }
  return { heads, trashed };
}
