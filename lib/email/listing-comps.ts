// lib/email/listing-comps.ts
//
// Comparable active listings for the property flyer comps chart (spec §5).
// fetchAreaComps derives the area search page from the listing URL, fetches it,
// and uses Haiku to extract a handful of nearby active list prices. Pure helpers
// (deriveAreaUrl, buildCompsSpec) are unit-tested; the async fetch is best-effort
// and always returns [] on any failure — never throws, never blocks the build.

import { getAnthropic } from "@/refinery/agents/anthropic.mts";
import { htmlToText } from "./listing-scrape";
import { resolveEmailModel } from "./model-router";
import type { ListingFacts } from "./listing-scrape";
import type { ChartSpec } from "@/components/charts/registry/chart-spec";

export interface Comp {
  label: string; // short street address, e.g. "27804 Hickory Blvd"
  price: number; // integer list price in USD
}

/** Strip the last path segment to derive the area search-page URL.
 *  e.g. beach-homes.com/florida/bonita-springs/<slug> → .../florida/bonita-springs
 *  Returns null when the path has fewer than 2 non-empty segments. */
export function deriveAreaUrl(listingUrl: string): string | null {
  try {
    const u = new URL(listingUrl);
    const parts = u.pathname.replace(/\/$/, "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    parts.pop();
    u.pathname = "/" + parts.join("/");
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** PURE: build a bar ChartSpec from comps + the subject listing.
 *  Subject bar is labeled "(Subject)" and placed first; comps sorted price-desc.
 *  Returns null when fewer than 2 comps (a 2-bar chart is not informative enough).
 *  `asOf` defaults to today so callers can override it in tests. */
export function buildCompsSpec(
  comps: Comp[],
  facts: ListingFacts,
  areaUrl: string,
  asOf?: string,
): ChartSpec | null {
  const subjectPrice = facts.price ? Number(facts.price.replace(/[^0-9]/g, "")) : 0;
  if (!subjectPrice || comps.length < 2) return null;

  const today = asOf ?? new Date().toISOString().slice(0, 10);
  const subjectStreet = facts.address?.split(",")[0]?.trim() ?? facts.city ?? "Subject";
  const subjectLabel = `${subjectStreet} (Subject)`;

  const rows: (string | number | null)[][] = [
    [subjectLabel, subjectPrice],
    ...[...comps].sort((a, b) => b.price - a.price).map((c) => [c.label, c.price]),
  ];

  const areaHost = (() => {
    try {
      return new URL(areaUrl).hostname.replace(/^www\./, "");
    } catch {
      return areaUrl;
    }
  })();

  return {
    frameId: "bar-table",
    title: `Active listing prices near ${subjectStreet}`,
    columns: ["Property", "List Price"],
    rows,
    value_format: "usd",
    chart_type: "bar",
    asOf: today,
    source: { citation: `Active listings via ${areaHost}`, url: areaUrl },
  } as ChartSpec;
}

const COMPS_SYSTEM = `Extract real estate listing data from a search-results page. Return ONLY a JSON array (no other text). Each object: {"label":"short street address like '27804 Hickory Blvd'","price":number}. Price must be a plain integer — no $ or commas. Extract ONLY values visible on the page — never invent. Omit any listing where price is unclear. If fewer than 2 listings are visible, return [].`;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Best-effort: fetch the area search page and extract comparable active listings.
 *  Returns [] on any failure. Excludes the subject itself (matched by first address token).
 *  Max 6 comps returned (keeps the bar chart readable). */
export async function fetchAreaComps(listingUrl: string, facts: ListingFacts): Promise<Comp[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const areaUrl = deriveAreaUrl(listingUrl);
  if (!areaUrl) return [];

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    let html: string;
    try {
      const res = await fetch(areaUrl, {
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "user-agent": BROWSER_UA, accept: "text/html,*/*" },
      });
      if (!res.ok) return [];
      html = (await res.text()).slice(0, 2_000_000);
    } finally {
      clearTimeout(timer);
    }

    const text = htmlToText(html).slice(0, 8000);
    const msg = await getAnthropic("other").messages.create({
      model: resolveEmailModel("interactive"),
      max_tokens: 600,
      system: COMPS_SYSTEM,
      messages: [{ role: "user", content: text }],
    });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "";

    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrMatch) return [];
    let arr: unknown[];
    try {
      arr = JSON.parse(arrMatch[0]) as unknown[];
    } catch {
      return [];
    }

    const subjectPrice = facts.price ? Number(facts.price.replace(/[^0-9]/g, "")) : 0;
    const subjectStreet = facts.address?.split(",")[0]?.trim().toLowerCase() ?? "";

    const comps: Comp[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const label = typeof obj.label === "string" ? obj.label.trim() : "";
      const price = typeof obj.price === "number" ? Math.round(obj.price) : 0;
      if (!label || !price) continue;
      // Skip subject listing
      if (subjectStreet && label.toLowerCase().includes(subjectStreet)) continue;
      // Loose price band filter (±3× of subject) — keeps the chart in one visual range
      if (subjectPrice && (price < subjectPrice / 3 || price > subjectPrice * 3)) continue;
      comps.push({ label, price });
    }

    return comps.slice(0, 6);
  } catch {
    return [];
  }
}
