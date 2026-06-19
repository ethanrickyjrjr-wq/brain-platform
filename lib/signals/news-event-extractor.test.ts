import { describe, it, expect } from "bun:test";
import { extractEventFromArticle } from "./news-event-extractor";
import type { NewsArticleRow } from "./news-event-extractor";
import type { BrandRegistry } from "./types";

const BRANDS: BrandRegistry = {
  walmart: {
    tier: 1,
    category: "grocery",
    weight_open: 10,
    weight_close: 10,
    aliases: ["walmart", "wal-mart"],
  },
  publix: { tier: 1, category: "grocery", weight_open: 9, weight_close: 9, aliases: ["publix"] },
  _unclassified: { tier: 5, category: "unknown", weight_open: 0, weight_close: 0, aliases: [] },
};

const baseArticle: NewsArticleRow = {
  id: "a1",
  article_url: "https://naplesnews.com/article/123",
  headline: "Walmart to open new store near 33912",
  body_text: "A new Walmart Supercenter is opening on US-41 in Fort Myers ZIP 33912.",
  source_name: "naples_daily_news",
  published_date: "2026-06-19",
};

describe("extractEventFromArticle", () => {
  it("returns QualEvent for known brand + SWFL ZIP", () => {
    const result = extractEventFromArticle(baseArticle, BRANDS);
    expect(result).not.toBeNull();
    expect(result?.entity_name).toBe("Walmart");
    expect(result?.event_type).toBe("opening");
    expect(result?.source).toBe("news_crawl");
    expect(result?.source_url).toBe(baseArticle.article_url);
  });

  it("returns null when no known brand in text", () => {
    const art: NewsArticleRow = {
      ...baseArticle,
      headline: "Local restaurant opens in 33912",
      body_text: "A local eatery opens.",
    };
    expect(extractEventFromArticle(art, BRANDS)).toBeNull();
  });

  it("returns null when no SWFL ZIP in text", () => {
    const art: NewsArticleRow = {
      ...baseArticle,
      headline: "Walmart opens in Atlanta",
      body_text: "New location in GA.",
    };
    expect(extractEventFromArticle(art, BRANDS)).toBeNull();
  });

  it("infers closing from headline", () => {
    const art: NewsArticleRow = {
      ...baseArticle,
      headline: "Publix closes Fort Myers Beach store permanently 33931",
    };
    const result = extractEventFromArticle(art, BRANDS);
    expect(result?.event_type).toBe("closing");
  });

  it("falls back to business_news when keyword unclear", () => {
    const art: NewsArticleRow = {
      ...baseArticle,
      headline: "Walmart announces community event 33912",
    };
    const result = extractEventFromArticle(art, BRANDS);
    expect(result?.event_type).toBe("business_news");
  });
});
