// Generates web-search queries for verifying metric values when brain data is stale.
// Returns a query string + authoritative domain hints, fed to the Anthropic
// web_search tool's `allowed_domains`. Called by the data-readiness verification
// ladder before each email blast.

export interface VerificationQuery {
  query: string;
  /** Authoritative domains, used to scope web_search via `allowed_domains`. */
  preferred_domains: string[];
}

const GOVT_DOMAINS = ["bls.gov", "census.gov", "hud.gov", "federalreserve.gov", "fhfa.gov"];
const RE_DOMAINS = ["redfin.com", "zillow.com", "realtor.com"];
const FINANCIAL_DOMAINS = ["freddiemac.com", "bankrate.com", "mortgagenewsdaily.com"];

/** Month name for readable search queries, e.g. "June 2026" */
function monthYear(asOf: Date): string {
  return asOf.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Scope label for search — e.g. "Fort Myers Beach FL" or "Lee County FL" */
function scopeLabel(scope: { zip?: string; place?: string; county?: string }): string {
  if (scope.place) return `${scope.place} FL`;
  if (scope.zip) return `ZIP ${scope.zip} Florida`;
  if (scope.county) return `${scope.county} County FL`;
  return "Southwest Florida";
}

export function verificationQuery(
  slug: string,
  scope: { zip?: string; place?: string; county?: string },
  asOf: Date,
): VerificationQuery {
  const when = monthYear(asOf);
  const where = scopeLabel(scope);

  // Mortgage / interest rates
  if (slug.includes("mortgage_rate") || slug.includes("fed_funds")) {
    return {
      query: `30-year fixed mortgage rate ${when}`,
      preferred_domains: [...FINANCIAL_DOMAINS, "federalreserve.gov"],
    };
  }

  // Median sale price
  if (slug.includes("median_sale_price") || slug.includes("median_home_price")) {
    return {
      query: `median home sale price ${where} ${when}`,
      preferred_domains: RE_DOMAINS,
    };
  }

  // Active listings / inventory
  if (slug.includes("active_listing") || slug.includes("inventory")) {
    return {
      query: `homes for sale ${where} ${when} listings count`,
      preferred_domains: RE_DOMAINS,
    };
  }

  // Days on market
  if (slug.includes("days_on_market") || slug.includes("dom")) {
    return {
      query: `average days on market ${where} ${when}`,
      preferred_domains: RE_DOMAINS,
    };
  }

  // Unemployment / labor
  if (slug.includes("unemployment") || slug.includes("labor")) {
    const county = scope.county ?? "Lee";
    return {
      query: `${county} County Florida unemployment rate ${when} BLS`,
      preferred_domains: ["bls.gov"],
    };
  }

  // Cap rate / CRE
  if (slug.includes("cap_rate") || slug.includes("cre")) {
    return {
      query: `commercial real estate cap rate ${where} ${when}`,
      preferred_domains: ["costar.com", "loopnet.com", "cbre.com"],
    };
  }

  // Flood / AAL
  if (slug.includes("flood") || slug.includes("aal")) {
    return {
      query: `FEMA flood risk ${where} annual loss`,
      preferred_domains: ["fema.gov", "nfip.fema.gov"],
    };
  }

  // Default fallback
  return {
    query: `${slug.replace(/_/g, " ")} ${where} ${when}`,
    preferred_domains: [...RE_DOMAINS, ...GOVT_DOMAINS],
  };
}

/**
 * Split authoritative domains into two disjoint groups (alternating by index)
 * so the data-readiness ladder can ground two *independent* web_search calls —
 * one per group — and only claim consensus when genuinely-different sources
 * agree. A single-domain metric (e.g. unemployment → bls.gov) yields an empty
 * second group, signalling "no real second source" so the ladder skips
 * consensus rather than searching the same source twice.
 */
export function splitDomains(domains: string[]): [string[], string[]] {
  const groupA = domains.filter((_, i) => i % 2 === 0);
  const groupB = domains.filter((_, i) => i % 2 === 1);
  return [groupA, groupB];
}

/** Extract first plausible numeric value from scraped markdown/text */
export function extractNumericValue(text: string): number | null {
  // Match patterns like: 6.75%, $425,000, 312, 45 days
  const patterns = [
    /\$?([\d,]+\.?\d*)\s*%/, // percentages: 6.75%
    /\$([\d,]+)/, // dollar values: $425,000
    /([\d,]+\.?\d*)\s*days?/i, // days: 45 days
    /^([\d,]+\.?\d*)$/m, // bare numbers
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) {
      const clean = m[1].replace(/,/g, "");
      const n = parseFloat(clean);
      if (!isNaN(n)) return n;
    }
  }
  return null;
}
