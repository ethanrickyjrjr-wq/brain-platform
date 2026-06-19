/**
 * Extracts a QualEvent from a raw news article row.
 *
 * Brand detection: scans headline + body_text against BrandRegistry aliases (case-insensitive,
 * whole-word). ZIP extraction: finds first SWFL ZIP in text → zipToCentroid(). Event type
 * inferred from headline keywords (opening / closing / construction_start / business_news).
 */

import { zipToCentroid } from "@/lib/geo/zip-centroid";
import type { QualEvent, BrandRegistry, BrandEntry } from "./types";

export interface NewsArticleRow {
  id: string;
  article_url: string;
  headline: string;
  body_text: string | null;
  source_name: string;
  published_date: string;
}

// SWFL ZIP codes: Lee (339xx), Collier (341xx), Charlotte (339xx), Glades/Hendry (334xx/339xx),
// Sarasota (342xx). Covers all ranges present in zip-centroid.ts.
const SWFL_ZIP_RE = /\b(339\d{2}|341\d{2}|342\d{2}|340\d{2}|334[47]\d)\b/;

const OPENING_RE = /\bopen(?:s|ing|ed)?\b|\bgrand opening\b|\bnew location\b|\bcoming soon\b/i;
const CLOSING_RE =
  /\bclos(?:es|ing|ed|ure)\b|\bshut(?:s|ting)?\b|\bpermanent(?:ly)?\b|\bgoing out of business\b/i;
const CONSTRUCTION_RE =
  /\bbreaks? ground\b|\bconstruction begins\b|\bpermit filed\b|\bunder construction\b|\bgroundbreaking\b/i;

/** Match article text against brand registry aliases (case-insensitive whole-word). */
function detectBrandInText(
  text: string,
  brands: BrandRegistry,
): { brandKey: string; entry: BrandEntry; entityName: string } | null {
  for (const [key, entry] of Object.entries(brands)) {
    if (key === "_unclassified") continue;
    if (entry.tier >= 5) continue;
    const aliases = entry.aliases ?? [];
    for (const alias of aliases) {
      // Whole-word match, case-insensitive
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\\b${escaped}\\b`, "i");
      if (pattern.test(text)) {
        // Capitalize first letter of each word as entity name
        const entityName = alias
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");
        return { brandKey: key, entry, entityName };
      }
    }
  }
  return null;
}

function inferEventType(headline: string): QualEvent["event_type"] {
  if (CONSTRUCTION_RE.test(headline)) return "construction_start";
  if (CLOSING_RE.test(headline)) return "closing";
  if (OPENING_RE.test(headline)) return "opening";
  return "business_news";
}

/**
 * Extract a QualEvent from a raw news article row.
 * Returns null when: no known brand found, or no SWFL ZIP in text, or ZIP has no centroid.
brief */
export function extractEventFromArticle(
  article: NewsArticleRow,
  brands: BrandRegistry,
): QualEvent | null {
  const text = `${article.headline} ${(article.body_text ?? "").slice(0, 2000)}`;

  const brand = detectBrandInText(text, brands);
  if (!brand) return null;

  const zipMatch = SWFL_ZIP_RE.exec(text);
  if (!zipMatch) return null;

  const centroid = zipToCentroid(zipMatch[0]);
  if (!centroid) return null;

  return {
    entity_name: brand.entityName,
    entity_brand_key: brand.brandKey,
    event_type: inferEventType(article.headline),
    lat: centroid.lat,
    lng: centroid.lng,
    event_date: article.published_date,
    source: "news_crawl",
    headline: article.headline,
    source_url: article.article_url,
  };
}
