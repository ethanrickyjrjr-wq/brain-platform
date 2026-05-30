/**
 * User-facing display names for corridors.
 *
 * Internally a corridor is a road "corridor" with an over-specific label
 * ("Vanderbilt Beach Rd / Mercato"). Users speak in places ("Vanderbilt").
 * This module maps any internal handle — the DB `corridor_name`, the centroid
 * `corridor_label`, or the `corridor_id` slug — to the plain `display_name`
 * authored in `fixtures/corridor-centroids.json`.
 *
 * Internal slugs are NOT renamed (that costs a SQL migration + slug-parity
 * churn). This is a presentation layer on top of frozen IDs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CorridorCentroid } from "./corridor-assignment.mts";

const FIXTURES_DIR = path.join(process.cwd(), "fixtures");

const CENTROIDS: CorridorCentroid[] = JSON.parse(
  readFileSync(path.join(FIXTURES_DIR, "corridor-centroids.json"), "utf-8"),
);

/**
 * Collapse any corridor name/label/slug to one comparable key: lowercased,
 * every run of non-alphanumerics folded to a single hyphen, edges trimmed.
 * So "Vanderbilt Beach Rd / Mercato", "Vanderbilt Beach Rd – Mercato"
 * (en-dash), and the slug "vanderbilt-beach-rd-mercato" all collapse to the
 * same key — this is what lets the lookup survive DB-vs-fixture punctuation
 * drift without a hard-coded alias per spelling.
 */
export function corridorKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const DISPLAY_BY_KEY = new Map<string, string>();
for (const c of CENTROIDS) {
  const display = c.display_name ?? c.corridor_label;
  DISPLAY_BY_KEY.set(corridorKey(c.corridor_id), display);
  DISPLAY_BY_KEY.set(corridorKey(c.corridor_label), display);
}

/**
 * Plain user-facing display name for a corridor, given its DB `corridor_name`,
 * centroid `corridor_label`, or `corridor_id` slug. Falls back to the input
 * unchanged when nothing matches — an unmapped corridor degrades to its
 * original name rather than throwing or rendering blank.
 */
export function displayNameFor(nameOrSlug: string): string {
  if (!nameOrSlug) return nameOrSlug;
  return DISPLAY_BY_KEY.get(corridorKey(nameOrSlug)) ?? nameOrSlug;
}
