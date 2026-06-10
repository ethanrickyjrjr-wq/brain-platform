/**
 * location-surface — §D3 web-surface decisions, as pure functions.
 *
 * The human's first move is typing into a box, not crafting a URL. These pure
 * helpers turn a resolved `LocationInput` / `ZipResolution` into the decisions a
 * page makes: where a query routes, whether to show a did-you-mean banner, how
 * to label coverage in plain human language, and what identity to confirm
 * BEFORE any metric. Kept JSX-free so they lock as `bun test` assertions; the
 * page components are thin shells over them.
 *
 * Honesty invariants carried here:
 *   - G6: an UNASSESSED barrier classification (null) yields NO tag — we never
 *     present the resolver's inland default as a fact.
 *   - did-you-mean keys off the RESOLVED name differing from the TYPED input —
 *     the truthful signal (an alias expansion like "bonita"→"Bonita Springs"
 *     resolves EXACTLY in the gazetteer and never reaches the fuzzy path, so a
 *     "resolvePlace confidence === fuzzy" check would miss it; matched-name ≠
 *     input is both more correct and more general).
 *
 * Plan: docs/superpowers/plans/2026-06-09-universal-location-search/04-surfaces.md
 */
import type { Grain, CountyFips, ZipResolution } from "../refinery/lib/zip-resolver.mts";
import type { LocationInput } from "../refinery/lib/location-resolver.mts";

// ---------------------------------------------------------------------------
// Grain → human chip language (NEVER the word "grain" on a human surface)
// ---------------------------------------------------------------------------

export const GRAIN_CHIP_LABEL: Record<Grain, string> = {
  zip: "ZIP-level",
  corridor: "Corridor",
  city: "City",
  county: "County-wide",
  msa: "Metro-wide",
  region: "Region-wide",
  state: "Statewide",
  national: "National",
};

/** Finest → coarsest, so chips read in zoom order. */
const GRAIN_ORDER: Grain[] = [
  "zip",
  "corridor",
  "city",
  "county",
  "msa",
  "region",
  "state",
  "national",
];

export function grainChipLabel(g: Grain): string {
  return GRAIN_CHIP_LABEL[g];
}

/** Distinct grains present across the dossier lines, finest-first, each labeled. */
export function distinctChips(lines: { grain: Grain }[]): { grain: Grain; label: string }[] {
  const present = new Set(lines.map((l) => l.grain));
  return GRAIN_ORDER.filter((g) => present.has(g)).map((g) => ({
    grain: g,
    label: GRAIN_CHIP_LABEL[g],
  }));
}

// ---------------------------------------------------------------------------
// Did-you-mean — surface a non-literal resolve so it's visible + correctable
// ---------------------------------------------------------------------------

/** Lowercase, fold any non-alphanumeric run to one space, collapse + trim. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Showing Bonita Springs (matched from 'bonita')" — only when a real match
 * resolved to a DIFFERENT name than what the user typed. Silent for a literal
 * match (so an exact "Naples" / "33931" never nags) and silent without both a
 * query and a matched name.
 */
export function didYouMeanBanner(
  query: string | null | undefined,
  matched: string | null | undefined,
): string | null {
  if (!query || !matched) return null;
  if (normalize(query) === normalize(matched)) return null;
  return `Showing ${matched} (matched from '${query.trim()}')`;
}

// ---------------------------------------------------------------------------
// Barrier tag — G6: never present an unassessed default as a fact
// ---------------------------------------------------------------------------

/**
 * A human barrier descriptor for the identity card, or `null` when the ZIP's
 * barrier status was never assessed (`classification === null`). A SOURCED
 * "inland"/"coastal-mainland" record IS a fact and shows; only the resolver's
 * unassessed default (already mapped to null upstream) is suppressed.
 */
export function barrierTagLabel(classification: string | null): string | null {
  if (!classification) return null;
  switch (classification) {
    case "barrier":
      return "barrier island";
    case "coastal-mainland":
      return "coastal mainland";
    case "inland":
      return "inland";
    default:
      return classification.replace(/[-_]+/g, " ");
  }
}

// ---------------------------------------------------------------------------
// Identity model — the "where" confirmation, rendered BEFORE any metric
// ---------------------------------------------------------------------------

export interface IdentityModel {
  /** The big place/area name (or "ZIP NNNNN" when no place is known). */
  headline: string;
  /** Muted context line, e.g. "Lee County · barrier island · ZIP 33931". */
  subline: string;
}

const COUNTY_NAME: Record<CountyFips, string> = {
  "12015": "Charlotte",
  "12021": "Collier",
  "12043": "Glades",
  "12051": "Hendry",
  "12071": "Lee",
  "12115": "Sarasota",
};

function joinSubline(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join(" · ");
}

/** Identity for a resolved ZIP — primary place, county, sourced barrier (G6). */
export function identityForZip(res: ZipResolution): IdentityModel {
  const primary = res.places.find((p) => p.match === "primary") ?? res.places[0];
  const place = primary?.place ?? null;
  const countyName = res.county_names[0] ? `${res.county_names[0]} County` : null;
  const barrier = barrierTagLabel(res.barrier.classification);
  const headline = place ?? `ZIP ${res.zip}`;
  // Repeat the ZIP in the subline only when the headline isn't already the ZIP.
  const zipPart = place ? `ZIP ${res.zip}` : null;
  return { headline, subline: joinSubline([countyName, barrier, zipPart]) };
}

/** Identity for a non-ZIP location (county / corridor / region / out-of-scope). */
export function identityForLocation(loc: LocationInput): IdentityModel {
  switch (loc.kind) {
    case "zip":
    case "place":
    case "address":
      return identityForZip(loc.resolution);
    case "county":
      return { headline: loc.county_name, subline: "Southwest Florida" };
    case "corridor":
      return { headline: loc.pocket, subline: `${COUNTY_NAME[loc.county]} County` };
    case "region":
      return { headline: "Southwest Florida", subline: "Lee, Collier & neighboring counties" };
    case "out-of-scope":
    case "address-unsupported":
      return { headline: "Southwest Florida", subline: "" };
  }
}

// ---------------------------------------------------------------------------
// Search routing — the human's first move: type → resolve → go somewhere true
// ---------------------------------------------------------------------------

export type SearchRoute =
  | { kind: "redirect"; zip: string; matched: string | null }
  | { kind: "render" }
  | { kind: "out-of-scope" };

/**
 * Decide where a resolved query goes:
 *   - a ZIP-resolving kind in scope → REDIRECT to its canonical ZIP permalink;
 *   - county/corridor/region → RENDER the dossier inline (no ZIP permalink);
 *   - anything else (genuinely out of SWFL) → a friendly OUT-OF-SCOPE page.
 * Never a bare 404 for a typed query.
 */
export function searchRoute(loc: LocationInput): SearchRoute {
  switch (loc.kind) {
    case "zip":
    case "place":
    case "address":
      return loc.resolution.in_scope
        ? { kind: "redirect", zip: loc.resolution.zip, matched: loc.matched ?? null }
        : { kind: "out-of-scope" };
    case "county":
    case "corridor":
    case "region":
      return { kind: "render" };
    case "out-of-scope":
    case "address-unsupported":
      return { kind: "out-of-scope" };
  }
}

/**
 * The canonical ZIP permalink. Carries `q` + `matched` ONLY when a did-you-mean
 * applies, so a literal ZIP search keeps a clean, shareable URL.
 */
export function zipReportHref(zip: string, opts?: { q?: string; matched?: string }): string {
  const base = `/r/zip-report/${zip}`;
  if (opts?.q && opts?.matched && didYouMeanBanner(opts.q, opts.matched)) {
    const qs = new URLSearchParams({ q: opts.q, matched: opts.matched });
    return `${base}?${qs.toString()}`;
  }
  return base;
}
