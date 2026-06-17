/**
 * project-scope.ts — Piece 3 (Signal Layer) Track A
 *
 * `projectScopeSet` derives the feed-matching scope set for a project's items.
 * It wraps `inferScopeFromItems` (the ONE scope-inference root in derive-name.ts)
 * and expands a place-inferred scope into the full set of ZIP scopes needed to
 * match ZIP-keyed data-change rows in `project_feed`.
 *
 * Correction #5: a place-scoped project must match ZIP-keyed data-change rows →
 * a place scope emits both {scope_kind:'place'} AND one {scope_kind:'zip'} per
 * zip in the place's crosswalk entry.
 *
 * Correction #6: `zipsForPlace` is NEW — the deliverables build path defers
 * place→ZIP expansion to render time; it does NOT provide this helper.
 *
 * Pure; no I/O; no side effects.
 */
import { inferScopeFromItems } from "@/lib/project/derive-name";
import type { ProjectItem } from "@/lib/project/items";
import { PLACE_ZIP_CROSSWALK } from "@/refinery/lib/geography-gazetteer.mts";

export interface ScopeEntry {
  scope_kind: "zip" | "place" | "county";
  scope_value: string; // canonical lowercase+trimmed
}

// ---------------------------------------------------------------------------
// zipsForPlace — place name → ZIP list
// ---------------------------------------------------------------------------

/** Normalize for case-insensitive matching (mirrors geography-gazetteer.mts). */
function normalizePlaceName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Build lookup map at module load (mirrors derive-name.ts PLACE_BY_ZIP pattern).
const PLACE_ZIPS_BY_NORM = new Map<string, string[]>();
for (const entry of PLACE_ZIP_CROSSWALK.entries) {
  const zips = [entry.zip, ...entry.alt_zips];
  PLACE_ZIPS_BY_NORM.set(normalizePlaceName(entry.place), zips);
  for (const alias of entry.aliases) {
    const key = normalizePlaceName(alias);
    if (!PLACE_ZIPS_BY_NORM.has(key)) PLACE_ZIPS_BY_NORM.set(key, zips);
  }
}

/**
 * Return [primary_zip, ...alt_zips] for a known SWFL place name or alias.
 * Matching is case-insensitive. Returns [] when the place is not in the
 * crosswalk (never invent a ZIP).
 */
export function zipsForPlace(place: string): string[] {
  return PLACE_ZIPS_BY_NORM.get(normalizePlaceName(place)) ?? [];
}

// ---------------------------------------------------------------------------
// projectScopeSet
// ---------------------------------------------------------------------------

/**
 * Derive the set of scope entries that the `project_feed` read seam
 * (`readProjectFeed`) should match against for a project whose items are
 * `items`.
 *
 * Rules (spec §AUDIT-VERIFIED BUILD CONTRACT correction #5):
 *  - zip inferred  → one {scope_kind:'zip', scope_value: zip}
 *  - place inferred → {scope_kind:'place', scope_value: place.toLowerCase().trim()}
 *                    PLUS one {scope_kind:'zip', scope_value: z} per z in zipsForPlace(place)
 *  - topic only    → [] (topic is not geographic; project_feed has no topic column)
 *  - empty         → []
 *
 * Deduplication: a Set over `${scope_kind}:${scope_value}` keys ensures no
 * duplicate entries even when the inferred ZIP matches the place's primary ZIP.
 *
 * scope_value is always canonical lowercase+trimmed.
 */
export function projectScopeSet(items: ProjectItem[]): ScopeEntry[] {
  if (items.length === 0) return [];

  const { zip, place } = inferScopeFromItems(items);
  // topic is not geographic → skip

  const seen = new Set<string>();
  const result: ScopeEntry[] = [];

  function add(scope_kind: ScopeEntry["scope_kind"], scope_value: string): void {
    const canonical = scope_value.toLowerCase().trim();
    const key = `${scope_kind}:${canonical}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ scope_kind, scope_value: canonical });
    }
  }

  if (zip) {
    // ZIP is the dominant signal: emit a single zip scope.
    add("zip", zip);
    return result;
  }

  if (place) {
    // Place scope + all ZIPs the place spans.
    add("place", place);
    for (const z of zipsForPlace(place)) {
      add("zip", z);
    }
  }

  return result;
}
