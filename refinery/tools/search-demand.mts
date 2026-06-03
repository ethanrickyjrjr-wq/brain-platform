#!/usr/bin/env bun
/**
 * search-demand.mts — the SWFL search-demand digest (operator-only).
 *
 * Reads public.swfl_search_demand (a DEMAND PROXY — what SWFL searches for, via
 * DataForSEO; NOT our own engagement data) and ranks it into:
 *   Build   — real demand with NO shipped brain → roadmap candidates
 *   Sharpen — demand landing on a brain we already ship → deepen / improve
 *   Rising  — coarse monthly uptrend (stand-in for "happenings" until Trends)
 *   Thin    — below the volume floor → listed, never actioned
 *
 * Passive: it PRINTS suggested `check.mjs open` lines for Build items; it never
 * runs them and never mutates a tracker. Run on-demand during the RULE-2 CHECK.
 *
 *   bun refinery/tools/search-demand.mts [--out FILE]
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { classify } from "../lib/swfl_taxonomy.mts";

// ── Pinned thresholds (FLAG 1 — no uncited magic numbers) ──────────────────────
// Both chosen EMPIRICALLY; revisit after the first 3 months (one quarter) of data.
//
// MIN_AVG_MONTHLY_SEARCHES: per-keyword floor. Google/DataForSEO volume buckets
//   step 10→20→30→50→70…; 50/mo (geo-locked) is the first step that reads as
//   recurring demand rather than bucket-noise, while still catching niche SWFL
//   terms. Below it → Thin, not actionable.
export const MIN_AVG_MONTHLY_SEARCHES = 50;
// MIN_TOTAL_MAPPED_VOLUME: if summed volume across all above-floor mapped
//   keywords is under this, the whole digest is "directional only" — under ~1k
//   total the ordering is dominated by bucket-noise and shouldn't drive priority.
export const MIN_TOTAL_MAPPED_VOLUME = 1000;
// Rising: latest month must beat the prior-3-month mean by this factor (and both
//   windows must clear the floor) before a term counts as a coarse uptrend.
export const RISING_FACTOR = 1.25;

export interface MonthlyPoint {
  year: number;
  month: number;
  search_volume: number;
}
export interface DemandRow {
  keyword: string;
  source: string;
  location: string;
  captured_month: string;
  avg_monthly_searches: number | null;
  competition: string | null;
  cpc: number | null;
  monthly_searches: MonthlyPoint[] | null;
  is_bucketed: boolean;
}

export interface DemandItem {
  keyword: string;
  volume: number;
  location: string;
  competition: string | null;
  is_bucketed: boolean;
  source: string;
  brains: string[];
  topic: string | null;
  rising: { recent: number; priorMean: number; pct: number } | null;
}

export interface Buckets {
  build: DemandItem[];
  sharpen: DemandItem[];
  rising: DemandItem[];
  thin: DemandItem[];
  unmappedCount: number;
  totalMappedVolume: number;
  banner: boolean;
  sources: string[];
}

export interface BucketConfig {
  floor: number;
  totalFloor: number;
  shippedBrains: Set<string>;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

/** One row per keyword: freshest captured_month, then highest-volume location. */
export function dedupeToBestPerKeyword(rows: DemandRow[]): DemandRow[] {
  const best = new Map<string, DemandRow>();
  for (const r of rows) {
    const cur = best.get(r.keyword);
    if (!cur) {
      best.set(r.keyword, r);
      continue;
    }
    const newer = r.captured_month > cur.captured_month;
    const sameMonth = r.captured_month === cur.captured_month;
    const higher =
      (r.avg_monthly_searches ?? 0) > (cur.avg_monthly_searches ?? 0);
    if (newer || (sameMonth && higher)) best.set(r.keyword, r);
  }
  return [...best.values()];
}

/** Coarse uptrend: latest month vs the mean of the 3 months before it. */
export function risingFromMonthly(
  monthly: MonthlyPoint[] | null,
  floor: number,
): { recent: number; priorMean: number; pct: number } | null {
  if (!monthly || monthly.length < 4) return null;
  const sorted = [...monthly].sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );
  const recent = sorted[sorted.length - 1].search_volume;
  const prior = sorted.slice(-4, -1).map((m) => m.search_volume);
  const priorMean = prior.reduce((s, v) => s + v, 0) / prior.length;
  if (recent < floor || priorMean < floor) return null;
  if (recent < priorMean * RISING_FACTOR) return null;
  const pct =
    priorMean > 0 ? Math.round(((recent - priorMean) / priorMean) * 100) : 0;
  return { recent, priorMean: Math.round(priorMean), pct };
}

export function bucketize(rows: DemandRow[], cfg: BucketConfig): Buckets {
  const build: DemandItem[] = [];
  const sharpen: DemandItem[] = [];
  const rising: DemandItem[] = [];
  const thin: DemandItem[] = [];
  const sources = new Set<string>();
  let unmappedCount = 0;
  let totalMappedVolume = 0;

  for (const r of dedupeToBestPerKeyword(rows)) {
    sources.add(r.source);
    const c = classify(r.keyword);
    const volume = r.avg_monthly_searches ?? 0;
    const risingMetrics = risingFromMonthly(r.monthly_searches, cfg.floor);
    const item: DemandItem = {
      keyword: r.keyword,
      volume,
      location: r.location,
      competition: r.competition,
      is_bucketed: r.is_bucketed,
      source: r.source,
      brains: c.brains,
      topic: c.topic,
      rising: risingMetrics,
    };

    if (!c.isSwfl) {
      unmappedCount++;
      continue; // off-grain — never Build/Sharpen
    }
    if (volume < cfg.floor) {
      thin.push(item);
      continue;
    }
    totalMappedVolume += volume;
    const covered = c.brains.some((b) => cfg.shippedBrains.has(b));
    (covered ? sharpen : build).push(item);
    if (risingMetrics) rising.push(item);
  }

  const byVolume = (a: DemandItem, b: DemandItem) => b.volume - a.volume;
  build.sort(byVolume);
  sharpen.sort(byVolume);
  thin.sort(byVolume);
  rising.sort((a, b) => (b.rising?.pct ?? 0) - (a.rising?.pct ?? 0));

  return {
    build,
    sharpen,
    rising,
    thin,
    unmappedCount,
    totalMappedVolume,
    banner: totalMappedVolume < cfg.totalFloor,
    sources: [...sources].sort(),
  };
}

export function slugify(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function suggestedCheckLine(item: DemandItem): string {
  const key = `demand_${slugify(item.keyword).replace(/-/g, "_")}`.slice(0, 48);
  return (
    `node scripts/check.mjs open roadmap ${key} ` +
    `"Demand: ${item.keyword} (${item.volume}/mo, no brain)" ` +
    `--detail "DataForSEO ${item.volume}/mo at ${item.location}; topic=${item.topic ?? "?"}"`
  );
}

const SOURCE_LABELS: Record<string, string> = {
  dataforseo: "DataForSEO Google Ads search volume",
};
function sourceLabel(sources: string[]): string {
  const names = sources.map((s) => SOURCE_LABELS[s] ?? s).join(" + ");
  return `${names} (demand proxy — NOT our site's engagement)`;
}

export function renderDigest(
  b: Buckets,
  opts: { floor: number; date: string },
): string {
  const L: string[] = [];
  L.push(`# SWFL Search Demand — ${opts.date}`);
  L.push("");
  L.push(`_Source: ${sourceLabel(b.sources)}._`);
  L.push("");
  if (b.banner) {
    L.push(
      `> ⚠️ THIN SIGNAL — directional only. Total mapped volume ` +
        `${b.totalMappedVolume}/mo is below ${MIN_TOTAL_MAPPED_VOLUME}/mo; ` +
        `rankings are dominated by bucket-noise. Don't fit a roadmap to it yet.`,
    );
    L.push("");
  }

  L.push(`## Build — demand with no shipped brain (${b.build.length})`);
  if (b.build.length === 0) L.push("_none above floor_");
  for (const it of b.build) {
    L.push(
      `- **${it.keyword}** — ${it.volume}/mo (${it.location}, comp=${it.competition ?? "?"})` +
        (it.is_bucketed ? " ⚠︎ bucketed range" : ""),
    );
    L.push(`  - suggested: \`${suggestedCheckLine(it)}\``);
  }
  L.push("");

  L.push(
    `## Sharpen — demand on a brain we already ship (${b.sharpen.length})`,
  );
  if (b.sharpen.length === 0) L.push("_none above floor_");
  for (const it of b.sharpen) {
    L.push(
      `- **${it.keyword}** — ${it.volume}/mo → ${it.brains.join(", ")} (${it.location})`,
    );
  }
  L.push("");

  L.push(
    `## Rising — coarse monthly trend, not real-time (${b.rising.length})`,
  );
  if (b.rising.length === 0) L.push("_no clear uptrend_");
  for (const it of b.rising) {
    L.push(
      `- **${it.keyword}** — ${it.rising!.recent}/mo, +${it.rising!.pct}% vs prior 3-mo avg (${it.rising!.priorMean}/mo)`,
    );
  }
  L.push("");

  L.push(
    `## Thin — below ${opts.floor}/mo, listed not actioned (${b.thin.length})`,
  );
  if (b.thin.length) {
    L.push(b.thin.map((it) => `${it.keyword} (${it.volume})`).join(" · "));
  }
  if (b.unmappedCount) {
    L.push("");
    L.push(
      `_${b.unmappedCount} above-floor terms classified off-grain (not SWFL) — ignored._`,
    );
  }
  L.push("");
  return L.join("\n");
}

// ── IO (main) ──────────────────────────────────────────────────────────────────

function creds(): { url: string; key: string } {
  const toml = readFileSync(
    resolve(process.cwd(), ".dlt/secrets.toml"),
    "utf8",
  );
  const get = (k: string) => {
    for (const line of toml.split(/\r?\n/)) {
      const m = line.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]+)"`));
      if (m) return m[1];
    }
    return null;
  };
  const url = get("SUPABASE_URL") ?? get("BRAINS_SUPABASE_URL");
  const key = get("SUPABASE_SERVICE_KEY") ?? get("BRAINS_SUPABASE_SERVICE_KEY");
  if (!url || !key)
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_KEY not in .dlt/secrets.toml",
    );
  return { url: url.replace(/\/$/, ""), key };
}

async function fetchAllDemand(): Promise<DemandRow[]> {
  const { url, key } = creds();
  const select =
    "keyword,source,location,captured_month,avg_monthly_searches,competition,cpc,monthly_searches,is_bucketed";
  const pageSize = 1000; // PostgREST db-max-rows cap — paginate past it explicitly.
  const out: DemandRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetch(
      `${url}/rest/v1/swfl_search_demand?select=${select}` +
        `&order=captured_month.desc,keyword.asc&limit=${pageSize}&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    const page = (await res.json()) as DemandRow[];
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

function shippedBrains(): Set<string> {
  const dir = resolve(process.cwd(), "brains");
  const slugs = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .filter((s) => s !== "test-alpha");
  return new Set(slugs);
}

async function main(argv: string[]): Promise<number> {
  const outIdx = argv.indexOf("--out");
  const outFile = outIdx >= 0 ? argv[outIdx + 1] : null;

  const rows = await fetchAllDemand();
  const today = new Date().toISOString().slice(0, 10);

  if (rows.length === 0) {
    const msg =
      `# SWFL Search Demand — ${today}\n\n` +
      `_No demand data yet._ Run the SQL migration (docs/sql/20260603_swfl_search_demand_create.sql) ` +
      `and the pipeline (\`python -m ingest.pipelines.swfl_search_demand.pipeline\`, needs DataForSEO creds) ` +
      `to populate public.swfl_search_demand, then re-run this digest.\n`;
    if (outFile) writeFileSync(outFile, msg);
    else console.log(msg);
    return 0;
  }

  const buckets = bucketize(rows, {
    floor: MIN_AVG_MONTHLY_SEARCHES,
    totalFloor: MIN_TOTAL_MAPPED_VOLUME,
    shippedBrains: shippedBrains(),
  });
  const md = renderDigest(buckets, {
    floor: MIN_AVG_MONTHLY_SEARCHES,
    date: today,
  });
  if (outFile) writeFileSync(outFile, md);
  else console.log(md);
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
