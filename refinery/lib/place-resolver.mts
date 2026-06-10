/**
 * Place -> pocket resolver. Never reject a real SWFL place.
 *
 * Users say "Bonita Bay", "Mercato", "downtown Naples" — colloquial places,
 * not road corridors. This maps any such string to the corridor/pocket it
 * sits in. The ONLY honest rejection is a place genuinely outside Lee/Collier
 * (a geography fact) — never a vocabulary gap.
 *
 * Resolution chain (cheap -> robust):
 *   1. exact  — the string already collapses to a known corridor slug/label
 *   2. pocket — the string names a pocket ("North Naples")
 *   3. alias  — a curated colloquial name ("Mercato" -> Vanderbilt)
 *   4. fuzzy  — Levenshtein against display/pocket/alias names (typo tolerance)
 *
 * A geocode fallback (Mapbox -> assignCorridor) is intentionally NOT wired:
 * the consuming AI already knows SWFL geography, so the payload gazetteer
 * (see rules-of-engagement) carries the real load. `resolvePlace` exists for
 * the website UI / non-Claude consumers; geocoding can be added behind this
 * same interface later without changing callers.
 */
import { levenshteinSimilarity } from "./embedder.mts";
import { corridorKey, displayNameFor } from "./corridor-display.mts";
import { pocketFor, allPockets, type Pocket } from "./pockets.mts";
import type { CorridorCentroid } from "./corridor-assignment.mts";
import centroidsJson from "../../fixtures/corridor-centroids.json";

/** Lowercase, fold dashes/underscores to spaces, collapse whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Static ESM JSON import (G1 — pure, no `fs`): `import.meta.dirname` is
// `undefined` in the Next/Vercel server bundle, so the old
// `path.resolve(import.meta.dirname, …)` + readFileSync threw at module-eval the
// moment a web surface (§D) imported `resolveLocation`. A static import is
// bundle-traced and cwd-independent — same pattern as zip-resolver.mts.
const CENTROIDS = centroidsJson as unknown as CorridorCentroid[];

/**
 * Curated colloquial place name -> centroid corridor_id. Only the handful of
 * names a model might genuinely fumble (plazas, neighborhoods, abbreviations);
 * the broad case is handled by exact/pocket/fuzzy + the model's own geography.
 * Keys are matched after `normalize()` (lowercase, dashes/underscores -> space).
 */
export const PLACE_ALIASES: Record<string, string> = {
  mercato: "vanderbilt-beach-rd-mercato",
  "bonita bay": "bonita-beach-rd-bonita-beach",
  "coconut point": "coconut-point-mall",
  miromar: "ben-hill-griffin-pkwy",
  "miromar outlets": "ben-hill-griffin-pkwy",
  "gulf coast town center": "gulf-coast-town-center",
  "old naples": "5th-ave-south-3rd-street-south",
  "downtown naples": "5th-ave-south-3rd-street-south",
  "5th avenue": "5th-ave-south-3rd-street-south",
  "5th ave": "5th-ave-south-3rd-street-south",
  "third street south": "5th-ave-south-3rd-street-south",
  waterside: "waterside-shops",
  gateway: "daniels-pkwy",
  fmb: "estero-blvd-fort-myers-beach",
};

export type PlaceConfidence = "exact" | "pocket" | "alias" | "fuzzy" | "none";

export interface PlaceResolution {
  query: string;
  matched: boolean;
  corridor_id?: string;
  pocket?: Pocket;
  /** User-facing name to speak back (a place or a pocket). */
  display_name?: string;
  confidence: PlaceConfidence;
}

const FUZZY_THRESHOLD = 0.82;

// Normalized pocket lookup.
const POCKET_BY_NORM = new Map<string, Pocket>(allPockets().map((p) => [normalize(p), p]));

// Normalized alias lookup (keys re-normalized so authoring spelling is forgiving).
const ALIAS_BY_NORM = new Map<string, string>(
  Object.entries(PLACE_ALIASES).map(([k, v]) => [normalize(k), v]),
);

// Fuzzy candidate set: corridor display names + labels, pocket names, alias keys.
interface FuzzyCandidate {
  norm: string;
  corridor_id?: string;
  pocket?: Pocket;
}
const FUZZY_CANDIDATES: FuzzyCandidate[] = [];
for (const c of CENTROIDS) {
  const display = c.display_name ?? c.corridor_label;
  FUZZY_CANDIDATES.push({
    norm: normalize(display),
    corridor_id: c.corridor_id,
  });
  FUZZY_CANDIDATES.push({
    norm: normalize(c.corridor_label),
    corridor_id: c.corridor_id,
  });
}
for (const p of allPockets()) FUZZY_CANDIDATES.push({ norm: normalize(p), pocket: p });
for (const [k, v] of ALIAS_BY_NORM) FUZZY_CANDIDATES.push({ norm: k, corridor_id: v });

function fromCorridor(
  corridor_id: string,
  confidence: PlaceConfidence,
  query: string,
): PlaceResolution {
  return {
    query,
    matched: true,
    corridor_id,
    pocket: pocketFor(corridor_id),
    display_name: displayNameFor(corridor_id),
    confidence,
  };
}

/**
 * Resolve a free-text place to the corridor/pocket it belongs to. Returns
 * `matched: false` only when nothing clears the fuzzy bar — the caller then
 * says "outside our Lee/Collier coverage" (geography), never "not in our
 * system" (vocabulary).
 */
export function resolvePlace(input: string): PlaceResolution {
  const query = (input ?? "").trim();
  if (!query) return { query, matched: false, confidence: "none" };
  const norm = normalize(query);

  // 1. exact corridor (slug or label punctuation variants)
  const key = corridorKey(query);
  const exact = CENTROIDS.find((c) => corridorKey(c.corridor_id) === key);
  if (exact) return fromCorridor(exact.corridor_id, "exact", query);

  // 2. pocket name
  const pocket = POCKET_BY_NORM.get(norm);
  if (pocket) {
    return {
      query,
      matched: true,
      pocket,
      display_name: pocket,
      confidence: "pocket",
    };
  }

  // 3. curated alias
  const aliasTarget = ALIAS_BY_NORM.get(norm);
  if (aliasTarget) return fromCorridor(aliasTarget, "alias", query);

  // 4. fuzzy
  let best: { score: number; cand: FuzzyCandidate } | null = null;
  for (const cand of FUZZY_CANDIDATES) {
    const score = levenshteinSimilarity(norm, cand.norm);
    if (best === null || score > best.score) best = { score, cand };
  }
  if (best && best.score >= FUZZY_THRESHOLD) {
    if (best.cand.corridor_id) {
      return fromCorridor(best.cand.corridor_id, "fuzzy", query);
    }
    if (best.cand.pocket) {
      return {
        query,
        matched: true,
        pocket: best.cand.pocket,
        display_name: best.cand.pocket,
        confidence: "fuzzy",
      };
    }
  }

  return { query, matched: false, confidence: "none" };
}
