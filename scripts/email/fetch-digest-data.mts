// scripts/email/fetch-digest-data.mts
import fs from "node:fs";
import path from "node:path";
import type {
  DigestPayload,
  ZipMetricSnapshot,
  CityVoiceSignal,
  FreshnessManifest,
} from "./types.ts";
import { ZIP_FOCUS } from "./types.ts";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
const REPO_ROOT = path.join(import.meta.dirname, "..", "..");
const DRY_RUN = process.env.DRY_RUN === "true";

// ── Brain file parsing ─────────────────────────────────────────────────────

export function parseBrainOutputSection(markdown: string): unknown | null {
  const marker = "--- OUTPUT ---";
  const idx = markdown.indexOf(marker);
  if (idx === -1) return null;
  const after = markdown.slice(idx + marker.length);
  const start = after.indexOf("{");
  if (start === -1) return null;
  // Parse only the first JSON object. The brain file continues after it with
  // `--- ACTIVE PROJECTS ---` / `--- RECENT NOTES ---` sections and a code
  // fence; a parse-to-EOF throws "Extra data". Brace-match (honoring string
  // literals + escapes) to find the object's true end.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < after.length; i++) {
    const ch = after[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      if (--depth === 0) {
        try {
          return JSON.parse(after.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Map a detail-table row's `cells` object to a ZipMetricSnapshot. Redfin ZIP
 * cells store sale-to-list as a 0–100 percent and carry no sold-above-list
 * column, so we normalize the first to 0–1 and null the second.
 */
export function extractZipMetrics(cells: Record<string, unknown>): ZipMetricSnapshot {
  const n = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const x = Number(v);
    return isNaN(x) ? null : x;
  };
  // Percent fields arrive as 0–100; ZipMetricSnapshot wants 0–1.
  const ratio = (v: unknown): number | null => {
    const x = n(v);
    return x === null ? null : x > 1.5 ? x / 100 : x;
  };
  return {
    median_sale_price: n(cells.median_sale_price),
    dom: n(cells.median_dom),
    months_of_supply: n(cells.months_of_supply),
    avg_sale_to_list: ratio(cells.avg_sale_to_list_pct),
    sold_above_list_pct: ratio(cells.sold_above_list_pct), // absent at ZIP grain → null
    inventory: n(cells.inventory),
    sale_count_period: n(cells.homes_sold),
  };
}

interface BrainDetailRow {
  key: string;
  label?: string;
  cells: Record<string, unknown>;
}
interface HousingOutput {
  detail_tables?: Array<{ title?: string; rows?: BrainDetailRow[] }>;
  key_metrics?: Array<{ metric: string; value: unknown }>;
}

function readHousingBrain(): {
  zipMetrics: Record<string, ZipMetricSnapshot>;
  countyMetrics: ZipMetricSnapshot;
  periodBegin: string;
} {
  const content = fs.readFileSync(path.join(REPO_ROOT, "brains", "housing-swfl.md"), "utf-8");
  const output = parseBrainOutputSection(content) as HousingOutput | null;

  // detail_tables[0] is the ZIP grain table: rows are {key=ZIP, label, cells}.
  const table = output?.detail_tables?.[0];
  const zipMetrics: Record<string, ZipMetricSnapshot> = {};
  for (const row of table?.rows ?? []) {
    const zip = String(row.key ?? "");
    if ((ZIP_FOCUS as readonly string[]).includes(zip)) {
      zipMetrics[zip] = extractZipMetrics(row.cells ?? {});
    }
  }
  // No per-row period; the table title carries the window date, e.g.
  // "SWFL housing by ZIP — latest 90-day window (2026-01-01)".
  const periodBegin = table?.title?.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";

  // key_metrics key on `metric` (not `slug`); the SWFL aggregates are
  // `housing_`-prefixed. These supply the county snapshot.
  const km = output?.key_metrics ?? [];
  const kv = (slug: string): number | null => {
    const found = km.find((m) => m.metric === slug);
    return found && typeof found.value === "number" ? found.value : null;
  };
  const toRatio = (v: number | null): number | null => (v === null ? null : v > 1.5 ? v / 100 : v);
  const countyMetrics: ZipMetricSnapshot = {
    median_sale_price: kv("housing_median_sale_price_swfl"),
    dom: kv("housing_median_dom_swfl"),
    months_of_supply: kv("housing_months_of_supply_swfl"),
    avg_sale_to_list: toRatio(kv("housing_avg_sale_to_list_swfl")),
    sold_above_list_pct: toRatio(kv("housing_sold_above_list_pct_swfl")),
    inventory: null,
    sale_count_period: null,
  };
  return { zipMetrics, countyMetrics, periodBegin };
}

// ── API narrative fetch ────────────────────────────────────────────────────

async function fetchSpeak(slug: string): Promise<{ text: string; freshness_token: string }> {
  const res = await fetch(`${SITE_URL}/api/b/${slug}?view=speak&tier=2`);
  if (!res.ok) throw new Error(`Brain speak fetch failed: ${slug} (${res.status})`);
  const text = await res.text();
  const token = text.match(/SWFL-\d{4}-v\d+-\d{8}/)?.[0] ?? "unknown";
  return { text, freshness_token: token };
}

/**
 * Parse city-pulse speak output. The tier-2 speak renders a markdown table:
 *   | {City} — {topic} | {City}: {signal text} | {direction} |
 * topic ∈ breaking|transactions|development|business|structural, already
 * priority-ordered. No per-signal source URL is exposed at this tier.
 */
export function parseCityVoices(text: string): CityVoiceSignal[] {
  const topics = new Set(["breaking", "transactions", "development", "business", "structural"]);
  const signals: CityVoiceSignal[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4) continue; // leading "" + 3 columns + trailing ""
    const head = cells[1].match(/^(.+?)\s[—–-]\s([a-z]+)$/i);
    if (!head) continue;
    const city = head[1].trim();
    const topic = head[2].toLowerCase();
    if (!topics.has(topic)) continue;
    // The value cell is "City: signal text" — strip the redundant "City: " prefix.
    let title = cells[2];
    const colon = title.indexOf(":");
    if (colon !== -1 && title.slice(0, colon).trim().toLowerCase() === city.toLowerCase()) {
      title = title.slice(colon + 1).trim();
    }
    signals.push({ topic: topic as CityVoiceSignal["topic"], title, city, source_url: "" });
  }
  return signals;
}

async function fetchCityVoices(): Promise<CityVoiceSignal[]> {
  const { text } = await fetchSpeak("city-pulse-swfl");
  return parseCityVoices(text);
}

// ── City-voice relevance filter (email-side curation) ───────────────────────
// city-pulse faithfully reports every current event — including human-interest
// "breaking" items (earthquakes, crime, weather) that are real but must never
// lead a real-estate digest. We curate here, in the email, rather than mutate
// the upstream reporter.

const MARKET_TOPICS = new Set<CityVoiceSignal["topic"]>([
  "transactions",
  "development",
  "business",
]);

// A breaking/structural item earns market relevance only if its text hits a
// real-estate / development / commerce term.
const MARKET_KEYWORDS =
  /\b(zon|rezone|permit|develop|construction|ground[- ]?break|project|sold|sells?|sale|listed|listing|leas|sq ?ft|acres?|commission|council|board|approv|housing|apartment|condo|townhom|residence|retail|commercial|industrial|warehouse|mixed[- ]use|hotel|resort|plaza|subdivision|tenant|vacancy|rent)\b|\$\s?\d/i;

/**
 * Market-relevant = a transaction/development/business topic, or a
 * breaking/structural item whose text hits a real-estate keyword. Human-
 * interest "breaking" (crime, weather, earthquakes) is NOT market-relevant and
 * must never drive the subject line or lead the City Voices body.
 */
export function isMarketRelevant(s: CityVoiceSignal): boolean {
  return MARKET_TOPICS.has(s.topic) || MARKET_KEYWORDS.test(s.title);
}

// Subject/lead priority. Market-relevant items first (breaking-market still
// wins, honoring EMAIL.md Rule 2's "breaking first" intent); everything
// human-interest sorts to the tail (+100).
const TOPIC_RANK: Record<CityVoiceSignal["topic"], number> = {
  breaking: 0,
  transactions: 1,
  development: 2,
  business: 3,
  structural: 4,
};
function voiceRank(s: CityVoiceSignal): number {
  return (isMarketRelevant(s) ? 0 : 100) + TOPIC_RANK[s.topic];
}

const normTitle = (t: string): string =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Collapse the same event surfaced across multiple cities (e.g. one quake
// reported by 3 city desks). Keeps the first occurrence; drops a later signal
// whose normalized title equals or is contained by / contains a kept one.
function dedupeSignals(signals: CityVoiceSignal[]): CityVoiceSignal[] {
  const kept: CityVoiceSignal[] = [];
  for (const s of signals) {
    const ns = normTitle(s.title);
    if (!ns) continue;
    const dup = kept.some((k) => {
      const nk = normTitle(k.title);
      return nk === ns || nk.includes(ns) || ns.includes(nk);
    });
    if (!dup) kept.push(s);
  }
  return kept;
}

// ── Subject-line eligibility (explicit allowlist) ───────────────────────────
// ONLY these topics may promote a city-pulse signal to the subject line. This
// is a hard TOPIC gate, NOT the keyword heuristic: a `breaking` item never
// becomes the subject — even one that hits a real-estate keyword — which kills
// the "Cuba earthquake leads the digest" failure at the gate. A per-signal
// `digestSubjectEligible` flag from city-pulse could refine this later, but
// that is an upstream-pack change we deliberately defer.
//
// NOTE — `business` is the loose member: `transactions`/`development` are tight
// real-estate vocab, but a non-breaking, non-real-estate `business` item (e.g. a
// restaurant award) could lead the subject without tripping any filter. Day-1
// acceptable (breaking-never-promotes is the real Cuba guard). FIRST thing to
// tighten if a bad subject ever ships: drop `business` here, or add the upstream
// `digestSubjectEligible` flag (the eventual fix).
export const SUBJECT_TOPICS: ReadonlySet<CityVoiceSignal["topic"]> = new Set([
  "transactions",
  "development",
  "business",
]);

/**
 * Curate city voices for the email. Two distinct gates, on purpose:
 *  - BODY order (`cityVoices`) uses `isMarketRelevant` (topic OR keyword), so a
 *    breaking real-estate item can still rank high in the body — after dedup.
 *  - SUBJECT (`topStory`) uses the strict `SUBJECT_TOPICS` allowlist — breaking
 *    NEVER promotes to the subject. Null → the subject falls back to the data
 *    lede (build-digest `buildSubjectLine`).
 */
export function selectCityVoices(
  signals: CityVoiceSignal[],
  cap = 4,
): { cityVoices: CityVoiceSignal[]; topStory: CityVoiceSignal | null } {
  const deduped = dedupeSignals(signals);
  const ranked = [...deduped].sort((a, b) => voiceRank(a) - voiceRank(b));
  return {
    cityVoices: ranked.slice(0, cap),
    topStory: ranked.find((s) => SUBJECT_TOPICS.has(s.topic)) ?? null,
  };
}

// ── Main export ────────────────────────────────────────────────────────────

export async function fetchDigestData(): Promise<DigestPayload> {
  const today = new Date().toISOString().slice(0, 10);
  const [masterSpeak, cityVoices, housing] = await Promise.all([
    fetchSpeak("master"),
    fetchCityVoices(),
    Promise.resolve(readHousingBrain()),
  ]);

  const manifest: FreshnessManifest = {
    master: { token: masterSpeak.freshness_token, as_of: today },
    housing_swfl: { token: "housing-swfl-disk", as_of: today, period_begin: housing.periodBegin },
    city_pulse: { token: "city-pulse-daily", as_of: today },
    lee_cre: null,
    source_env: DRY_RUN ? "preview" : "live",
  };

  // Curate: dedupe repeated events, rank market-relevant first, and pick a
  // top_story that is always market-relevant (never a human-interest item).
  const { cityVoices: selectedVoices, topStory } = selectCityVoices(cityVoices, 4);

  return {
    date: today,
    freshness_manifest: manifest,
    top_line: masterSpeak.text.split("\n").slice(0, 3).join(" ").trim(),
    zip_metrics: housing.zipMetrics,
    county_metrics: housing.countyMetrics,
    city_voices: selectedVoices,
    top_story: topStory
      ? { title: topStory.title, slug: "city-pulse-swfl", topic: topStory.topic }
      : null,
  };
}
