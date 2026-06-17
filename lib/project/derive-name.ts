import type { ProjectItem } from "@/lib/project/items";
import { PLACE_ZIP_CROSSWALK } from "@/refinery/lib/geography-gazetteer.mts";
import { cityForZip } from "@/lib/swfl-zip-city";

/**
 * Deterministic project auto-naming (Piece 1 §G) — turn a set of filed items into
 * a human title like "Fort Myers Beach 33931" or "SWFL Permits", so a project
 * created from anywhere (briefcase draft, charts page, /r/ answer, MCP claim)
 * lands already named with nothing to set up (FINAL BOSS J1).
 *
 * Pure + no LLM. Place identity is a *grounded lookup*, never speculation: ZIP →
 * place comes from the sourced crosswalk (`fixtures/swfl-place-zip-crosswalk.json`
 * via the gazetteer) with `cityForZip` as the broader fallback — the same ground
 * truth the converse/MCP surfaces use so 33931 reads "Fort Myers Beach", not
 * "Lehigh Acres" (see [[lib/place-context.ts]]). The ZIP is the dominant signal;
 * a free-text place-name scan + a small topic table fill the gaps.
 */

// ZIP -> full place name. Crosswalk first (full names: "Fort Myers Beach"), then
// the wider USPS city map (137 ZIPs, abbreviated) as fallback. Built once at import.
const PLACE_BY_ZIP = new Map<string, string>();
for (const e of PLACE_ZIP_CROSSWALK.entries) {
  PLACE_BY_ZIP.set(e.zip, e.place);
  for (const z of e.alt_zips) if (!PLACE_BY_ZIP.has(z)) PLACE_BY_ZIP.set(z, e.place);
}

/** Place-name needles (place + aliases), normalized, longest-first so the most
 *  specific name wins ("fort myers beach" before "fort myers"). */
const PLACE_NEEDLES: { needle: string; place: string }[] = (() => {
  const out: { needle: string; place: string }[] = [];
  for (const e of PLACE_ZIP_CROSSWALK.entries) {
    out.push({ needle: flatten(e.place), place: e.place });
    for (const a of e.aliases) out.push({ needle: flatten(a), place: e.place });
  }
  return out.sort((a, b) => b.needle.length - a.needle.length);
})();

/** Topic keyword table (rent / permit / flood / cre / price) → display label. */
const TOPICS: { topic: string; re: RegExp }[] = [
  { topic: "Flood", re: /\b(flood|nfip|aal|surge|storm)\b/i },
  { topic: "Permits", re: /\bpermit/i },
  { topic: "Rentals", re: /\b(rent|rental|lease)\b/i },
  { topic: "CRE", re: /\b(cre|commercial|vacancy|absorption|cap rate|nnn|triple[- ]?net)\b/i },
  { topic: "Prices", re: /\b(price|value|valuation|sale|zhvi|median)\b/i },
];

function flatten(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fields worth scanning for a place / topic — excludes opaque tokens
 *  (freshness_token, added_at) so an "8-digit token date" can't read as a ZIP. */
function itemText(item: ProjectItem): string {
  switch (item.kind) {
    case "qa":
      return `${item.report_id} ${item.question}`;
    case "metric":
      return `${item.report_id} ${item.label}`;
    case "report":
      return `${item.slug} ${item.title ?? ""}`;
    case "source":
      return `${item.table} ${item.label}`;
    case "note":
      return item.text;
    case "chart":
    case "frame":
      return item.title;
    case "table_slice":
      return `${item.report_id} ${item.title}`;
    case "file":
      return item.caption ?? item.storage_path;
  }
}

// A 5-digit run starting with 3, NOT followed by ".digit" (so "33901.5" — a cap rate
// or ratio — is not read as a ZIP). A candidate is only counted if it resolves to a
// known SWFL place (below), which also rejects bare 5-digit dollar figures like 30074.
const ZIP_RE = /\b3\d{4}\b(?!\.\d)/g;

function topKey<T>(counts: Map<T, number>): T | undefined {
  let best: T | undefined;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

function placeForZip(zip: string): string | undefined {
  return PLACE_BY_ZIP.get(zip) ?? cityForZip(zip);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jun 17, 2026" from an ISO string — UTC so the test is timezone-stable. */
function datedFallback(items: ProjectItem[]): string {
  const earliest = items
    .map((i) => i.added_at)
    .filter(Boolean)
    .sort()[0];
  if (!earliest) return "Untitled project";
  const d = new Date(earliest);
  if (Number.isNaN(d.getTime())) return "Untitled project";
  return `Project ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function deriveProjectName(items: ProjectItem[]): string {
  if (items.length === 0) return "Untitled project";

  const zipCounts = new Map<string, number>();
  const placeNameCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();

  for (const item of items) {
    const raw = itemText(item);
    const flat = flatten(raw);

    for (const m of raw.matchAll(ZIP_RE)) {
      if (placeForZip(m[0])) zipCounts.set(m[0], (zipCounts.get(m[0]) ?? 0) + 1);
    }
    // Most-specific (longest) place needle present as WHOLE WORDS (so "landscape"
    // does not match "cape" → Cape Coral). `flat` is space-normalized; pad + match.
    const padded = ` ${flat} `;
    const hit = PLACE_NEEDLES.find((p) => p.needle && padded.includes(` ${p.needle} `));
    if (hit) placeNameCounts.set(hit.place, (placeNameCounts.get(hit.place) ?? 0) + 1);

    for (const t of TOPICS) {
      if (t.re.test(raw)) topicCounts.set(t.topic, (topicCounts.get(t.topic) ?? 0) + 1);
    }
  }

  const topZip = topKey(zipCounts);
  const topic = topKey(topicCounts);

  // ZIP is the dominant signal: resolve its place + keep the ZIP for the title.
  if (topZip) {
    const place = placeForZip(topZip);
    if (place) return `${place} ${topZip}`;
    return topic ? `SWFL ${topic}` : `SWFL ${topZip}`;
  }

  const namePlace = topKey(placeNameCounts);
  if (namePlace) return topic ? `${namePlace} ${topic}` : namePlace;

  if (topic) return `SWFL ${topic}`;
  return datedFallback(items);
}
