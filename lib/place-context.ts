import { PLACE_ZIP_CROSSWALK, type PlaceZipEntry } from "@/refinery/lib/geography-gazetteer.mts";

// --- Deterministic ZIP/place ground truth (built ONCE at import, no per-request I/O) ---
// Source of record: fixtures/swfl-place-zip-crosswalk.json via the gazetteer. Any model
// that names a SWFL place from its own weights gets it wrong (the un-grounded welcome
// chat glossed 33931 as Lehigh Acres; 33931 is Fort Myers Beach). Place identity is a
// deterministic lookup, not speculation — so wherever a model can name a SWFL place,
// inject the verified mapping the user referenced as top-line ground truth. Shared by
// every such surface (welcome chat, converse, ...) so there is one implementation.

/** Lowercase, fold punctuation to single spaces — aligns the scan text with the needles. */
function flatten(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ZIP -> entry. Primary/dedicated codes win; alt ZIPs fill in only if unclaimed
// (33913 is Gateway's dedicated code, even though Fort Myers lists it as an alt).
const ZIP_TO_ENTRY = new Map<string, PlaceZipEntry>();
for (const entry of PLACE_ZIP_CROSSWALK.entries) ZIP_TO_ENTRY.set(entry.zip, entry);
for (const entry of PLACE_ZIP_CROSSWALK.entries)
  for (const alt of entry.alt_zips) if (!ZIP_TO_ENTRY.has(alt)) ZIP_TO_ENTRY.set(alt, entry);

// Place name + every alias -> entry, longest needle first so "fort myers beach"
// wins over "fort myers" and we consume the matched span before testing shorter ones.
const ALIAS_NEEDLES: { needle: string; entry: PlaceZipEntry }[] = PLACE_ZIP_CROSSWALK.entries
  .flatMap((entry) =>
    [entry.place, ...entry.aliases].map((name) => ({ needle: flatten(name), entry })),
  )
  .filter((n) => n.needle.length > 0)
  .sort((a, b) => b.needle.length - a.needle.length);

const COUNTY_LABEL: Record<string, string> = { lee: "Lee", collier: "Collier" };

/**
 * Scan a user message for any SWFL ZIP (primary or alt) or known place alias and
 * return a sourced GROUND-TRUTH system prefix naming the correct ZIP<->place
 * identities. Returns "" when nothing SWFL is referenced — we never fabricate an
 * identity for a ZIP we don't hold, and add no noise when no place is named.
 */
export function buildPlaceContext(message: string): string {
  if (!message) return "";

  // Keyed by place name so a ZIP hit and an alias hit for the same town dedupe.
  const lines = new Map<string, string>();

  // 1. ZIP scan — only 5-digit tokens that map to a crosswalk ZIP.
  for (const zip of message.match(/\b\d{5}\b/g) ?? []) {
    const entry = ZIP_TO_ENTRY.get(zip);
    if (entry && !lines.has(entry.place))
      lines.set(entry.place, `ZIP ${zip} = ${entry.place}, ${COUNTY_LABEL[entry.county]} County.`);
  }

  // 2. Place name / alias scan — word boundaries via space padding, longest first,
  //    consuming matched spans so "fort myers" can't re-fire inside "fort myers beach".
  let scan = ` ${flatten(message)} `;
  for (const { needle, entry } of ALIAS_NEEDLES) {
    const padded = ` ${needle} `;
    if (!scan.includes(padded)) continue;
    if (!lines.has(entry.place))
      lines.set(
        entry.place,
        `${entry.place} = primary ZIP ${entry.zip}, ${COUNTY_LABEL[entry.county]} County.`,
      );
    scan = scan.split(padded).join("  ");
  }

  if (lines.size === 0) return "";

  return (
    "GROUND TRUTH — the user's message names these Southwest Florida places. These " +
    "ZIP-to-place identities are sourced (USPS ZIP Code Lookup; U.S. Census 2024 ZCTA), are " +
    "fact you already hold (not something to fetch), and must never be reassigned to the wrong town:\n" +
    [...lines.values()].map((l) => `- ${l}`).join("\n") +
    "\n\n"
  );
}
