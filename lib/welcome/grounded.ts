/**
 * welcome/grounded — turn the anonymous welcome chat into a GROUNDED reader.
 *
 * The converse pattern, scoped to the top-of-funnel welcome surface: when a
 * visitor names an in-scope SWFL ZIP (or a known town), we fan out the real
 * per-location dossier (`assembleLocationDossier`) and hand Haiku ONLY that
 * cited block. Haiku relays — never derives, never invents. This is the moat
 * half of overriding the Phase-3 "chat = explain only" rule: grounding the chat
 * is safe ONLY because the no-invent floor here is as airtight as /api/converse.
 *
 * Kept OUT of `lib/grounded-answer.ts` on purpose: that module hardcodes the
 * highlighter `GroundingBlock` path + in-page-analyst voice + follow-up chips.
 * The welcome voice (recurring-email hook, prospect audience) is different, so
 * this is a sibling assembler over the same `assembleLocationDossier` substrate.
 *
 * Plan: docs/superpowers/plans (wire-the-welcome-chat / phase3_welcome_funnel).
 */
import { resolveZip } from "@/refinery/lib/zip-resolver.mts";
import { RULES_OF_ENGAGEMENT } from "@/refinery/lib/rules-of-engagement.mts";
import { PLACE_ZIP_CROSSWALK, type PlaceZipEntry } from "@/refinery/lib/geography-gazetteer.mts";
import { buildPlaceContext } from "@/lib/place-context";
import { FORMAT_RULE, freshnessDirective } from "@/lib/assistant/system-prompt";
import {
  renderLocationDossierText,
  selectDossierLines,
  type LocationDossier,
} from "@/lib/zip-dossier";

// ---------------------------------------------------------------------------
// Location detection over the conversation
// ---------------------------------------------------------------------------

/** Lowercase, fold any non-alphanumeric run to one space — aligns scan text with needles. */
function flatten(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Gazetteer place/alias needles, longest-first (so "fort myers beach" beats
// "fort myers"). Built ONCE from the same crosswalk `resolvePlaceZip` uses, so a
// needle we match here is guaranteed to resolve cleanly via resolveLocation step
// 2 (gazetteer) — it can NEVER fall through to the external geocoder.
const ALIAS_NEEDLES: { needle: string; entry: PlaceZipEntry }[] = PLACE_ZIP_CROSSWALK.entries
  .flatMap((entry) =>
    [entry.place, ...entry.aliases].map((name) => ({ needle: flatten(name), entry })),
  )
  .filter((n) => n.needle.length > 0)
  .sort((a, b) => b.needle.length - a.needle.length);

export interface DetectedLocation {
  /** The 5-digit ZIP we resolve on (a typed ZIP, or a matched town's primary ZIP). */
  token: string;
  /**
   * TRUE only when the USER typed the 5 digits. A town name resolves to its
   * primary ZIP but stays `false` — flood AAL is shown ONLY for an explicit ZIP
   * (a town spans many ZIPs with very different flood; presenting one as the
   * town's "representative" flood would mislead — see buildWelcomeGroundedSystem).
   */
  explicitZip: boolean;
}

/** Extract a location signal from ONE message, in precedence order. */
function detectInMessage(content: string): DetectedLocation | null {
  const zips = content.match(/\b\d{5}\b/g) ?? [];

  // 1. in-scope typed ZIP — the strongest, most-specific signal (last one wins
  //    within the message: "33901 ... actually 33931" → 33931).
  for (let i = zips.length - 1; i >= 0; i--) {
    if (resolveZip(zips[i]).in_scope) return { token: zips[i], explicitZip: true };
  }

  // 2. a known town/place → resolve on its primary ZIP, but explicitZip stays false.
  const scan = ` ${flatten(content)} `;
  for (const { needle, entry } of ALIAS_NEEDLES) {
    if (scan.includes(` ${needle} `)) return { token: entry.zip, explicitZip: false };
  }

  // 3. an out-of-scope 5-digit token (a Miami ZIP, or a "50000" salary) — counts
  //    as "a ZIP was named" so the route answers honestly ("outside our footprint").
  //    It can ONLY reach the gap path: resolveZip().in_scope is false, so it never
  //    grounds and never invents. (5-digit false-positive invariant.)
  if (zips.length > 0) return { token: zips[zips.length - 1], explicitZip: true };

  return null;
}

/**
 * Scan the conversation (user turns only, newest-first) for a SWFL location.
 * A ZIP/place named several turns ago still anchors the topic, so we fall back
 * through older user messages until one carries a signal. Returns null when the
 * conversation names no location → the route keeps the un-grounded explainer.
 */
export function detectWelcomeLocation(
  messages: { role: "user" | "assistant"; content: string }[],
): DetectedLocation | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const hit = detectInMessage(m.content);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// prettySource — logical-source MAP (NOT naive domain-stripping)
// ---------------------------------------------------------------------------

/**
 * Naive "registrable tail" is WRONG: `redfin-public-data.s3.us-west-2.amazonaws.com`
 * and `noaa-ghcn-pds.s3.amazonaws.com` both collapse to `amazonaws.com`, and the
 * internal storage host `*.supabase.co` (242 source URLs in the lake) would leak as
 * a "source." So: an explicit map keyed on host/bucket/citation tokens, DEFAULT-DENY
 * (unmapped → ""). Seeded from the actual source hosts in `brains/*.md` (audited
 * 2026-06-13). Match is case-insensitive over the raw URL string AND the citation.
 */
const SOURCE_MAP: [RegExp, string][] = [
  [/redfin/i, "redfin.com"],
  [/zillow|zhvi|zori/i, "zillow.com"],
  [/\bfema\b|nfip|nfhl|flood hazard|s_fld_haz/i, "fema.gov"],
  [/noaa|hurdat|\bghcn\b|storm events|ncei/i, "noaa.gov"],
  [/fgcu|\breri\b/i, "fgcu.edu"],
  [/mhsappraisal|data book|maxwell.*hendry|hendry.*simmons/i, "mhsappraisal.com"],
  [/cushman|wakefield/i, "cushmanwakefield.com"],
  [/accela/i, "accela.com"],
  [
    /floridarevenue|florida department of revenue|tourist development tax|\btdt\b/i,
    "floridarevenue.com",
  ],
  [/dbpr|myfloridalicense/i, "myfloridalicense.com"],
  [/\bfbi\b|\bcjis\b|nibrs|\bucr\b|crime data explorer/i, "fbi.gov"],
  [/census|county business patterns|\bcbp\b|\bzcta\b|american community survey/i, "census.gov"],
  [/\bbls\b|bureau of labor|\boews\b|\blaus\b|\bqcew\b/i, "bls.gov"],
  [/stlouisfed|\bfred\b|\bsofr\b/i, "stlouisfed.org"],
  [/\bfhfa\b/i, "fhfa.gov"],
  [/\bfaf\b|ornl|freight analysis/i, "ornl.gov"],
  [/\bfdot\b|\baadt\b/i, "fdot.gov"],
  [/\bfhwa\b/i, "fhwa.dot.gov"],
  [/\busgs\b/i, "usgs.gov"],
  [/swfl inc|swflinc/i, "swflinc.com"],
  [/leepa|lee county property/i, "leepa.org"],
  [/collier county property|collier county appraiser|collierappraiser/i, "collierappraiser.com"],
  [/wink news|winknews/i, "winknews.com"],
  [/news-press|news press/i, "news-press.com"],
  [/naples (daily )?news|naplesnews/i, "naplesnews.com"],
  [/marco news|marconews/i, "marconews.com"],
  [/gulfshore business|gulfshorebusiness/i, "gulfshorebusiness.com"],
];

/**
 * Map a source URL and/or citation to a clean homepage domain (RULE 5). Returns
 * "" when nothing is recognized — the caller keeps the existing (already-scrubbed)
 * citation rather than emit a wrong or internal source. NEVER returns `amazonaws.com`,
 * a `*.supabase.co` host, or a `data_lake.*` name.
 */
export function prettySource(input: string, citation = ""): string {
  const hay = `${input ?? ""} ${citation ?? ""}`;
  for (const [re, dom] of SOURCE_MAP) if (re.test(hay)) return dom;
  return "";
}

/** Rewrite each rendered `Source: <citation>` line to a clean domain when we recognize it. */
function applyPrettySource(text: string): string {
  return text.replace(/^Source: (.+)$/gm, (whole, cite) => {
    const dom = prettySource("", String(cite));
    return dom ? `Source: ${dom}` : whole;
  });
}

// ---------------------------------------------------------------------------
// Grounded system-prompt assembly
// ---------------------------------------------------------------------------

/** One token to quote — first emitted line's brain token (mirrors MCP server.ts). */
export function representativeFreshnessToken(dossier: LocationDossier): string | undefined {
  for (const line of selectDossierLines(dossier.lines, 3)) {
    const tok = dossier.freshness_tokens[line.brain_id];
    if (tok) return tok;
  }
  return undefined;
}

/** The no-math / no-estimate floor + coverage-label rule + the welcome hook. */
export function welcomeGroundedSpeakLine(
  token?: string,
  voice: "welcome" | "analyst" = "welcome",
): string {
  // The data-reader floor is identical for both voices; only the CLOSING line
  // differs. `welcome` (public landing) closes on the recurring-email hook;
  // `analyst` (standalone in-app chat) closes by offering to file the read into
  // the user's project — no pitch.
  const close =
    voice === "analyst"
      ? "When the user wants to keep an answer, tell them they can save it with the 'File this answer' link and build it into a client-ready deliverable in their project. Do not pitch."
      : "Close in one line by connecting it to the hook: this is the kind of cited, branded market read they can auto-email their own clients every week.";
  return (
    "\n\nANSWER ONLY FROM THE DATA ABOVE. Every Southwest Florida number you state must appear " +
    "verbatim on a line above, with its source. You are a data reader, not an analyst: relay the cited " +
    "values exactly as written. Do NOT do arithmetic, averaging, totaling, rounding, per-unit " +
    "(per-month, per-square-foot) derivation, or comparison math on these numbers — any number you " +
    "derive is a fabrication even when its inputs are sourced. If a figure is not on a line above, say " +
    "you don't have it at that grain and offer to pull it. Never estimate, never use outside knowledge " +
    "for a Southwest Florida figure, and never say 'typically', 'generally', 'roughly', or 'around' " +
    "about a number. When a line is labeled with a coverage scope (for example 'Lee county-wide — " +
    "covers 33913'), carry that label when you relay it — never present a county-wide or regional figure " +
    "as the specific place's own number. " +
    (token ? freshnessDirective(token) + " " : "") +
    close +
    " Plain text only — no markdown. Never say 'master', 'brain', 'payload', 'grain', or 'dossier'."
  );
}

export interface WelcomeGroundedInput {
  dossier: LocationDossier;
  /** Text whose ZIP/place identities to pin (the resolved token is fine). */
  detectedText: string;
  /** Whether the user typed the 5-digit ZIP (gates flood AAL — see DetectedLocation). */
  explicitZip: boolean;
  tier?: 1 | 2 | 3;
  /** "welcome" (public landing, default) keeps the recurring-email-hook close;
   *  "analyst" (standalone in-app chat) closes by offering to file into a project. */
  voice?: "welcome" | "analyst";
}

/**
 * Build the welcome-grounded system prompt:
 *   place-pin → format rule → rules of engagement → the cited data block → speak line.
 * Flood AAL (`env-swfl`) is included ONLY for an explicit ZIP; for a town name it is
 * suppressed (a town spans ZIPs with very different flood, and Collier in particular
 * splits inland Mode-3/zero vs coastal Mode-1/2 — a single number would mislead).
 */
export function buildWelcomeGroundedSystem(input: WelcomeGroundedInput): string {
  const tier = input.tier ?? 2;
  const lines = input.explicitZip
    ? input.dossier.lines
    : input.dossier.lines.filter((l) => l.brain_id !== "env-swfl");
  const filtered: LocationDossier = { ...input.dossier, lines };
  const block = applyPrettySource(renderLocationDossierText(filtered, tier));
  const token = representativeFreshnessToken(filtered);
  return (
    buildPlaceContext(input.detectedText) +
    FORMAT_RULE +
    RULES_OF_ENGAGEMENT +
    "\n\n=== LIVE SOUTHWEST FLORIDA DATA — ANSWER ONLY FROM THIS ===\n\n" +
    block +
    welcomeGroundedSpeakLine(token, input.voice)
  );
}

// ---------------------------------------------------------------------------
// Gap copy (no model call — these are streamed verbatim, so they cannot invent)
// ---------------------------------------------------------------------------

export const OUT_OF_SCOPE_GAP =
  "That's outside the six Southwest Florida counties we cover — Lee, Collier, Charlotte, Glades, " +
  "Hendry, and Sarasota. Give me a ZIP or a town inside that footprint and I'll pull the real, " +
  "cited read.";

export const BUSY_GAP =
  "We're getting a lot of look-ups right now, so I've paused live reads for a moment. Try again " +
  "shortly — or drop your email and I'll send the full cited report for your ZIP.";
