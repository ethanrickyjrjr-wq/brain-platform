/**
 * zip-dossier — §C fan-out of Universal Location Search. THE MOAT.
 *
 * Given a resolved `LocationInput` (§B), walk every brain in the catalog and
 * emit ONE line per brain that covers the place — at the brain's TRUE grain: a
 * real per-ZIP number where we hold one (`is_true_zip:true`), otherwise the
 * county/corridor/region figure LABELED "covers {place}" so a reader can never
 * mistake a county aggregate for a ZIP-specific fact.
 *
 * The no-fabrication guarantee lives here as typed invariants:
 *   G2 — `is_true_zip` ⇔ the brain declares the `zip` grain AND a real row/slug
 *        was found; a brain whose `covers` excludes the location's county is
 *        skipped entirely (never claim coverage we don't have).
 *   G5 — `master` is never walked (it is the synthesizer, not a reporter).
 *
 * Plan: docs/superpowers/plans/2026-06-09-universal-location-search/03-fanout.md
 */
import type { Grain, CountyFips, ZipResolution } from "../refinery/lib/zip-resolver.mts";
import type { LocationInput } from "../refinery/lib/location-resolver.mts";
import { BRAIN_CATALOG, type BrainCatalogEntry } from "../refinery/packs/catalog.mts";
import {
  toDisplayBrain,
  sanitizeProse,
  scrubCaveatTechnical,
  type ParsedBrain,
} from "../refinery/render/speaker.mts";
import type { BrainOutputMetric } from "../refinery/types/brain-output.mts";
import { loadParsedBrain, renderDetailRowText } from "./fetch-brain.ts";

// ---------------------------------------------------------------------------
// BRAIN_GEO (G2) — the sourced grain + county-coverage registry
// ---------------------------------------------------------------------------

export interface BrainGeo {
  /** Grains this brain holds, FINEST-FIRST. `grains[0]` is the best grain it answers. */
  grains: Grain[];
  /**
   * Counties whose data this brain actually covers. An explicit `CountyFips[]`
   * gates the fan-out: a location whose county ∉ `covers` is skipped (never
   * claim coverage we don't hold). `"all"` = NO county gate — national / state /
   * region-footprint brains that legitimately speak to any in-scope location.
   */
  covers: CountyFips[] | "all";
}

const LEE: CountyFips = "12071";
const COLLIER: CountyFips = "12021";
const CHARLOTTE: CountyFips = "12015";
const GLADES: CountyFips = "12043";
const HENDRY: CountyFips = "12051";
const SARASOTA: CountyFips = "12115";

const LEE_COLLIER: CountyFips[] = [LEE, COLLIER];
const SIX_COUNTY: CountyFips[] = [LEE, COLLIER, CHARLOTTE, GLADES, HENDRY, SARASOTA];
// Redfin/Zillow publish SITE-grade per-ZIP rows across the broader metro. Verified
// live 2026-06-10: housing_by_zip holds in-scope rows in Lee(34)/Collier(20)/
// Sarasota(24)/Charlotte(13) — none in Glades/Hendry; ZORI's per-ZIP slugs also reach
// Charlotte+Sarasota. Gating these to Lee+Collier would REFUSE ~37 per-ZIP answers we
// actually hold (the inverse moat-break). The plan's `covers: Lee,Col` for housing/
// rentals was a hypothesis the data refutes — see 03-fanout.md build-note.
const METRO_4: CountyFips[] = [LEE, COLLIER, CHARLOTTE, SARASOTA];

const COUNTY_NAME: Record<CountyFips, string> = {
  "12015": "Charlotte",
  "12021": "Collier",
  "12043": "Glades",
  "12051": "Hendry",
  "12071": "Lee",
  "12115": "Sarasota",
};

/** G5 — `master` is the synthesizer, not a per-place reporter. Never fan out to it. */
export const DOSSIER_EXCLUDED_BRAINS: readonly string[] = ["master"];

/**
 * Each entry's comment is its one-line source (CLAUDE.md directive 2). `covers`
 * mirrors what the upstream actually ingests; `grains` is finest-first.
 */
export const BRAIN_GEO: Record<string, BrainGeo> = {
  // Zillow ZORI per-ZIP rent index (site-grade, reaches Charlotte+Sarasota) + a SWFL regional median.
  "rentals-swfl": { grains: ["zip", "region"], covers: METRO_4 },
  // Collier permits now carry SITE `zip_code` (Census-geocoded, scope-gated — J2/7f67f1f); Lee
  // permits' `zip_code` is MAILING-grade contractor (out-of-state ZIPs fenced at resolution). The
  // pack's `permits_by_zip` (grain="zip") detail table feeds branch (a) once the brain is rebuilt.
  "permits-swfl": { grains: ["zip", "corridor", "county"], covers: LEE_COLLIER },
  // MHS Data Book commercial permits — per-ZIP `commercial_permits_by_zip` detail table
  // (grain="zip", Census-geocoded site ZIP, scope-gated — J3) feeds branch (a). Submarkets
  // are jurisdictions that roll up to county; corridor/county declared so a non-ZIP query
  // resolves at the brain's true grain. covers Lee+Collier+Charlotte (verified live 2026-06-10).
  "permits-commercial-swfl": {
    grains: ["zip", "corridor", "county"],
    covers: [LEE, COLLIER, CHARLOTTE],
  },
  // Redfin `housing_by_zip` detail table, grain="zip" (site-grade, 4-county metro) + a SWFL regional read.
  "housing-swfl": { grains: ["zip", "region"], covers: METRO_4 },
  // NOAA HURDAT2 best-track × OpenFEMA NFIP across the 6-county footprint.
  "hurricane-tracks-fl": { grains: ["county", "region"], covers: SIX_COUNTY },
  // LeePA parcel snapshot → Lee County only.
  "properties-lee-value": { grains: ["county"], covers: [LEE] },
  // FDOR CO_NO=21 parcels + Redfin Collier tracker → Collier only.
  "properties-collier-value": { grains: ["county"], covers: [COLLIER] },
  // FDOT AADT corridor traffic, Lee + Collier.
  "traffic-swfl": { grains: ["county"], covers: LEE_COLLIER },
  // CRE corridor profiles + MarketBeat per-place, Lee + Collier.
  "cre-swfl": { grains: ["corridor", "city"], covers: LEE_COLLIER },
  // NFIP per-ZIP AAL + FEMA NFHL + regional, across the 6-county footprint.
  "env-swfl": { grains: ["zip", "county", "region"], covers: SIX_COUNTY },
  // FL DOR TDT Form 3 collections, Lee + Collier.
  "tourism-tdt": { grains: ["county"], covers: LEE_COLLIER },
  // SBA 7(a)/504 charge-off rates by county + NAICS, Lee + Collier.
  "sector-credit-swfl": { grains: ["county"], covers: LEE_COLLIER },
  // SOFR + US CPI — national context; no county gate.
  "macro-us": { grains: ["national"], covers: "all" },
  // FL labor + Census CBP — state context; no county gate.
  "macro-florida": { grains: ["state"], covers: "all" },
  // BLS LAUS + QCEW for Lee + Collier.
  "macro-swfl": { grains: ["county", "region"], covers: LEE_COLLIER },
  // FAF5 inbound freight to SWFL zone 129 — region footprint; no county gate.
  "logistics-swfl": { grains: ["region"], covers: "all" },
  // FDOT-AADT activity proxy for the SWFL region — region footprint; no county gate.
  "logistics-swfl-nowcast": { grains: ["region"], covers: "all" },
  // NOAA Storm Events history, Lee + Collier + Charlotte.
  "storm-history-swfl": { grains: ["county", "region"], covers: [LEE, COLLIER, CHARLOTTE] },
  // FGCU RERI monthly regional indicators — region footprint; no county gate.
  "fgcu-reri": { grains: ["region"], covers: "all" },
  // FBI CDE NIBRS property-crime rate, Lee + Collier.
  "safety-swfl": { grains: ["county"], covers: LEE_COLLIER },
  // SWFL Inc. economic-development announcements — Lee + Collier + Charlotte.
  "econ-dev-swfl": { grains: ["region"], covers: [LEE, COLLIER, CHARLOTTE] },
  // RSW + PGD enplanements — regional airport demand; no county gate.
  "rsw-airport": { grains: ["region"], covers: "all" },
  // Daily city pulse for 7 cities in Lee + Collier.
  "city-pulse-swfl": { grains: ["city"], covers: LEE_COLLIER },
  // Weekly corridor pulse on the CRE corridors, Lee + Collier.
  "corridor-pulse-swfl": { grains: ["corridor"], covers: LEE_COLLIER },
  // BLS OEWS by MSA (Cape Coral-Fort Myers + Naples-Marco Island).
  "labor-demand-swfl": { grains: ["msa"], covers: LEE_COLLIER },
  // FL DBPR enforcement — Lee, Collier, Charlotte, Sarasota, Hendry (5-county).
  "news-swfl": { grains: ["region"], covers: [LEE, COLLIER, CHARLOTTE, SARASOTA, HENDRY] },
  // FL DBPR Construction (06) + Electrical (08) license counts, Lee + Collier.
  "licenses-swfl": { grains: ["county"], covers: LEE_COLLIER },
  // DBPR SIRS confirmed filings, Lee + Collier.
  "condo-sirs-swfl": { grains: ["county"], covers: LEE_COLLIER },
};

/**
 * G2 CI gate. Every non-excluded catalog brain MUST have a `BRAIN_GEO` entry;
 * a missing one throws a self-documenting error so when a new brain (J3) lands
 * the failure names exactly what to add instead of being a cryptic crash.
 */
export function validateBrainGeo(geo: Record<string, BrainGeo> = BRAIN_GEO): void {
  for (const entry of BRAIN_CATALOG) {
    if (DOSSIER_EXCLUDED_BRAINS.includes(entry.id)) continue;
    if (!geo[entry.id]) {
      throw new Error(
        `BRAIN_GEO missing entry for catalog brain '${entry.id}' — add it (see §C brief, 03-fanout.md).`,
      );
    }
  }
}

let _validated = false;
function ensureValidated(): void {
  if (_validated) return;
  validateBrainGeo();
  _validated = true;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface LocationDossierLine {
  brain_id: string;
  domain: string;
  grain: Grain;
  /** Honest scope label, e.g. "Lee county-wide — covers 33931". Empty only for true-ZIP lines (grain "zip"). */
  coverage_label: string;
  is_true_zip: boolean;
  text: string;
  source_citation: string;
  source_url: string;
}

export interface LocationDossier {
  /** The grain the input resolved to. `"out-of-scope"` = no honest grain (non-SWFL / unsupported address). */
  resolved_as: Grain | "out-of-scope";
  zip: string | null;
  in_scope: boolean;
  resolution: ZipResolution | null;
  lines: LocationDossierLine[];
  /** brain_id → freshness_token, one per emitted line. */
  freshness_tokens: Record<string, string>;
  /**
   * Honest coverage-asymmetry notes. Non-empty only when an in-scope ZIP sits
   * OUTSIDE the Lee/Collier core (Charlotte / Sarasota / Glades / Hendry) and one
   * or more brains were skipped by the G2 covers gate — so a thinner dossier reads
   * as a stated boundary, never a silent refusal. Empty for Lee/Collier (full
   * coverage) and for non-ZIP grains.
   */
  coverage_caveats: string[];
}

// ---------------------------------------------------------------------------
// Labeling — honest scope phrasing per grain
// ---------------------------------------------------------------------------

const MSA_NAME: Partial<Record<CountyFips, string>> = {
  "12071": "Cape Coral-Fort Myers MSA",
  "12021": "Naples-Marco Island MSA",
};

/** "Lee + Collier" — used when a county/MSA/city brain answers a region query (no single county). */
function countiesLabel(covers: CountyFips[] | "all"): string {
  if (covers === "all") return "Southwest Florida";
  return covers.map((c) => COUNTY_NAME[c]).join(" + ");
}

/** The scope adjective for a non-ZIP grain — never a bare number, so it can't read as a ZIP. */
function scopePhrase(
  grain: Grain,
  geo: BrainGeo,
  gateCounty: CountyFips | null,
  localityName: string,
): string {
  switch (grain) {
    case "county":
      return gateCounty
        ? `${COUNTY_NAME[gateCounty]} county-wide`
        : `${countiesLabel(geo.covers)} county-level`;
    case "msa":
      return gateCounty
        ? (MSA_NAME[gateCounty] ?? `${COUNTY_NAME[gateCounty]} metro`)
        : `${countiesLabel(geo.covers)} metro`;
    case "corridor":
    case "city":
      return `${localityName}-area`;
    case "region":
      return "Southwest Florida region";
    case "state":
      return "Florida statewide";
    case "national":
      return "U.S. national";
    case "zip":
      // A zip-grain brain that held no row for THIS zip — its regional read.
      return "Southwest Florida-wide";
  }
}

function coverageLabel(
  grain: Grain,
  geo: BrainGeo,
  gateCounty: CountyFips | null,
  localityName: string,
  coveredPlace: string | null,
): string {
  const scope = scopePhrase(grain, geo, gateCounty, localityName);
  return coveredPlace ? `${scope} — covers ${coveredPlace}` : scope;
}

// ---------------------------------------------------------------------------
// Location context extraction
// ---------------------------------------------------------------------------

type EmittingInput = Exclude<
  LocationInput,
  { kind: "out-of-scope" } | { kind: "address-unsupported" }
>;

/** Best human place name for the location, for corridor/city scope phrases. */
function localityName(loc: EmittingInput): string {
  switch (loc.kind) {
    case "zip":
    case "place":
    case "address": {
      const r = loc.resolution;
      const primary = r.places.find((p) => p.match === "primary") ?? r.places[0];
      return (
        primary?.place ?? primary?.usps_preferred_city ?? r.county_names[0] ?? "Southwest Florida"
      );
    }
    case "corridor":
      return loc.pocket;
    case "county":
      return loc.county_name;
    case "region":
      return "Southwest Florida";
  }
}

/** The place a (c) line is labeled as covering, e.g. "33931" / "North Naples" / "Lee County". */
function coveredPlace(loc: EmittingInput): string | null {
  switch (loc.kind) {
    case "zip":
    case "place":
    case "address":
      return loc.resolution.zip;
    case "corridor":
      return loc.pocket;
    case "county":
      return loc.county_name;
    case "region":
      return null; // the whole region — nothing finer to "cover"
  }
}

// ---------------------------------------------------------------------------
// Per-metric value formatting (mirrors fetch-brain's private formatDetailCell)
// ---------------------------------------------------------------------------

function formatMetricValue(m: BrainOutputMetric): string {
  const v = m.value;
  if (typeof v === "string") return v;
  switch (m.display_format) {
    case "currency":
      return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    case "percent":
      return `${v}%`;
    case "count":
      return v.toLocaleString("en-US");
    default:
      return String(v);
  }
}

function cleanCitation(citation: string): string {
  return scrubCaveatTechnical(sanitizeProse(citation));
}

/** Branch (b) text — a per-ZIP key_metric rendered as a clean block. */
function renderMetricText(m: BrainOutputMetric, freshnessToken: string): string {
  return [
    `**${sanitizeProse(m.label)}** — ${formatMetricValue(m)}.`,
    `Source: ${cleanCitation(m.source.citation)}`,
    `_Freshness:_ \`${freshnessToken}\``,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Per-brain emission — (a) true-ZIP row · (b) true-ZIP slug · (c) labeled headline
// ---------------------------------------------------------------------------

interface EmitCtx {
  zip: string | null;
  gateCounty: CountyFips | null;
  localityName: string;
  coveredPlace: string | null;
  origin?: string;
}

function emitLine(
  entry: BrainCatalogEntry,
  geo: BrainGeo,
  brain: ParsedBrain,
  ctx: EmitCtx,
): LocationDossierLine {
  const holdsZip = geo.grains.includes("zip");

  // (a) + (b) — true-ZIP ONLY when the brain declares the zip grain (G2).
  if (ctx.zip && holdsZip) {
    // (a) a zip-grain detail-table row whose key === the ZIP.
    for (const table of brain.output.detail_tables ?? []) {
      if (table.grain !== "zip") continue;
      const row = table.rows.find((r) => r.key === ctx.zip);
      if (!row) continue;
      return {
        brain_id: entry.id,
        domain: entry.domain,
        grain: "zip",
        coverage_label: `ZIP ${ctx.zip}`,
        is_true_zip: true,
        text: renderDetailRowText(table, row, {
          slug: entry.id,
          freshnessToken: brain.freshness_token,
          origin: ctx.origin,
        }),
        source_citation: cleanCitation(table.source.citation),
        source_url: table.source.url,
      };
    }
    // (b) a key_metric whose slug carries `_zip_<zip>`.
    const m = (brain.output.key_metrics ?? []).find((km) => km.metric.includes(`_zip_${ctx.zip}`));
    if (m) {
      return {
        brain_id: entry.id,
        domain: entry.domain,
        grain: "zip",
        coverage_label: `ZIP ${ctx.zip}`,
        is_true_zip: true,
        text: renderMetricText(m, brain.freshness_token),
        source_citation: cleanCitation(m.source.citation),
        source_url: m.source.url,
      };
    }
  }

  // (c) — labeled headline at the brain's true (non-ZIP) grain, via the scrub
  // chokepoint (toDisplayBrain), never raw key_metrics.
  const fallbackGrain: Grain = geo.grains.filter((g) => g !== "zip")[0] ?? geo.grains[0]!;
  const display = toDisplayBrain(brain);
  const top = display.metrics[0];
  const label = coverageLabel(
    fallbackGrain,
    geo,
    ctx.gateCounty,
    ctx.localityName,
    ctx.coveredPlace,
  );
  return {
    brain_id: entry.id,
    domain: entry.domain,
    grain: fallbackGrain,
    coverage_label: label,
    is_true_zip: false,
    text: top ? `${display.conclusion} (${top.label}: ${top.value})` : display.conclusion,
    source_citation: top?.sourceFull ?? "",
    source_url: top?.sourceUrl ?? "",
  };
}

// ---------------------------------------------------------------------------
// assembleLocationDossier — the fan-out
// ---------------------------------------------------------------------------

export interface AssembleOptions {
  /** Injectable brain loader (defaults to disk). Tests pass synthetic fixtures. */
  loadBrain?: (slug: string) => Promise<ParsedBrain | null>;
  origin?: string;
}

function emptyDossier(
  resolved_as: Grain | "out-of-scope",
  zip: string | null,
  resolution: ZipResolution | null,
): LocationDossier {
  return {
    resolved_as,
    zip,
    in_scope: false,
    resolution,
    lines: [],
    freshness_tokens: {},
    coverage_caveats: [],
  };
}

/**
 * The data asymmetry verified live 2026-06-10: housing + rentals reach the 4-county
 * metro (METRO_4); most other brains hold Lee/Collier only. So an in-scope Charlotte
 * or Sarasota ZIP legitimately gets a thinner read. We SURFACE that, never silently
 * thin it. The core is Lee + Collier — any other in-scope county can carry the note.
 */
const CORE_COUNTIES: CountyFips[] = [LEE, COLLIER];

/** Skipped-brain domain → a plain-English noun for the coverage note (no pack ids). */
const DOMAIN_CAVEAT_NOUN: Record<string, string> = {
  "real-estate": "permits & property records",
  environmental: "storm & flood history",
  finance: "small-business credit",
  regulatory: "licensing & code enforcement",
  hospitality: "tourism",
  logistics: "traffic & freight",
  macro: "regional labor & economic data",
};

/**
 * Build the coverage-asymmetry note for an in-scope, non-core-county ZIP. Returns
 * [] for Lee/Collier (full coverage), for region/no-gate inputs, or when nothing
 * was gated out. Names up to three plain-English categories — never a brain id.
 */
function buildCoverageCaveats(
  gateCounty: CountyFips | null,
  skippedDomains: ReadonlySet<string>,
  coveredCount: number,
): string[] {
  if (gateCounty === null || CORE_COUNTIES.includes(gateCounty)) return [];
  if (skippedDomains.size === 0) return [];
  const county = COUNTY_NAME[gateCounty];
  const cats = [...skippedDomains]
    .map((d) => DOMAIN_CAVEAT_NOUN[d])
    .filter((n): n is string => Boolean(n));
  const phrase = cats.length ? ` (e.g. ${cats.slice(0, 3).join(", ")})` : "";
  return [
    `${county} County is inside our six-county footprint and the ${coveredCount} ` +
      `read${coveredCount === 1 ? "" : "s"} above cover it, but some data sets${phrase} ` +
      `hold Lee/Collier data only and don't extend to ${county} yet — they're left ` +
      `out rather than guessed.`,
  ];
}

export async function assembleLocationDossier(
  loc: LocationInput,
  opts: AssembleOptions = {},
): Promise<LocationDossier> {
  ensureValidated();
  const loadBrain = opts.loadBrain ?? loadParsedBrain;

  // Non-emitting kinds: no honest grain, no lines.
  if (loc.kind === "out-of-scope" || loc.kind === "address-unsupported") {
    return emptyDossier("out-of-scope", null, null);
  }

  const hasResolution = loc.kind === "zip" || loc.kind === "place" || loc.kind === "address";
  const resolution = hasResolution ? loc.resolution : null;

  // An out-of-SWFL ZIP/place still resolved AS a zip — but holds no lines.
  if (resolution && !resolution.in_scope) {
    return emptyDossier("zip", resolution.zip, resolution);
  }

  const zip = resolution ? resolution.zip : null;
  const resolved_as: Grain =
    loc.kind === "county"
      ? "county"
      : loc.kind === "corridor"
        ? "corridor"
        : loc.kind === "region"
          ? "region"
          : "zip";

  // The county we gate on. corridor/county carry it explicitly (ALWAYS present
  // on the corridor variant — so `corridor_id===null` NEVER drops the pocket).
  // zip/place/address derive it from the resolution. region → null (no gate).
  const gateCounty: CountyFips | null =
    loc.kind === "corridor" || loc.kind === "county"
      ? loc.county
      : resolution
        ? resolution.primary_county
        : null;

  const ctx: Omit<EmitCtx, never> = {
    zip,
    gateCounty,
    localityName: localityName(loc),
    coveredPlace: coveredPlace(loc),
    origin: opts.origin,
  };

  const lines: LocationDossierLine[] = [];
  const freshness_tokens: Record<string, string> = {};
  const skippedDomains = new Set<string>();

  for (const entry of BRAIN_CATALOG) {
    if (DOSSIER_EXCLUDED_BRAINS.includes(entry.id)) continue; // G5
    const geo = BRAIN_GEO[entry.id];
    if (!geo) {
      throw new Error(
        `BRAIN_GEO missing entry for catalog brain '${entry.id}' — add it (see §C brief, 03-fanout.md).`,
      );
    }

    // G2 covers gate — a known county outside this brain's coverage → skip it,
    // recording the domain so the asymmetry can be surfaced (never silently thinned).
    if (gateCounty !== null && geo.covers !== "all" && !geo.covers.includes(gateCounty)) {
      skippedDomains.add(entry.domain);
      continue;
    }

    // Resilience: one missing/malformed brain must never 500 the dossier.
    const brain = await loadBrain(entry.id);
    if (!brain) continue;

    lines.push(emitLine(entry, geo, brain, ctx));
    freshness_tokens[entry.id] = brain.freshness_token;
  }

  const coverage_caveats = buildCoverageCaveats(gateCounty, skippedDomains, lines.length);

  return {
    resolved_as,
    zip,
    in_scope: true,
    resolution,
    lines,
    freshness_tokens,
    coverage_caveats,
  };
}

// ---------------------------------------------------------------------------
// Token budget — tier-aware line selection + render
// ---------------------------------------------------------------------------

/** Cap on labeled (c) lines in a tier-2 reply (mirrors MAX_WEB_FACTS, server.ts:130). */
const MAX_HEADLINE_LINES = 8;

/** Real-estate + environmental + safety lead; macro/labor trail. Drop low-priority first under the cap. */
const DOMAIN_PRIORITY: Record<string, number> = {
  "real-estate": 0,
  environmental: 1,
  hospitality: 2,
  finance: 3,
  logistics: 4,
  regulatory: 5,
  macro: 6,
};

function priorityOf(line: LocationDossierLine): number {
  return DOMAIN_PRIORITY[line.domain] ?? 9;
}

/**
 * Pick which lines a tier renders. True-ZIP lines are the answer — always first,
 * never capped. Labeled (c) lines are ranked by domain relevance and capped:
 * tier 1 = one rollup, tier 2 = up to MAX_HEADLINE_LINES, tier 3 = all.
 */
export function selectDossierLines(
  lines: LocationDossierLine[],
  tier: 1 | 2 | 3,
): LocationDossierLine[] {
  const trueZip = lines.filter((l) => l.is_true_zip);
  const headline = lines
    .filter((l) => !l.is_true_zip)
    .slice()
    .sort((a, b) => priorityOf(a) - priorityOf(b));
  if (tier === 3) return [...trueZip, ...headline];
  const cap = tier === 1 ? 1 : MAX_HEADLINE_LINES;
  return [...trueZip, ...headline.slice(0, cap)];
}

/** Render the selected lines as one clean text block — true-ZIP answers first. */
export function renderLocationDossierText(dossier: LocationDossier, tier: 1 | 2 | 3): string {
  const selected = selectDossierLines(dossier.lines, tier);
  const caveatBlock =
    dossier.coverage_caveats.length > 0
      ? "\n\n" + dossier.coverage_caveats.map((c) => `_Coverage:_ ${c}`).join("\n\n")
      : "";
  if (selected.length === 0) {
    if (dossier.in_scope) {
      // in-scope but everything was gated out → still surface the asymmetry, never a bare refusal
      return caveatBlock
        ? caveatBlock.trimStart()
        : "No covering reads for this location in the lake right now.";
    }
    return "That location is outside the Southwest Florida footprint we cover.";
  }
  const body = selected
    .map((l) => (l.is_true_zip ? l.text : `**${l.coverage_label}** — ${l.text}`))
    .join("\n\n");
  return body + caveatBlock;
}
