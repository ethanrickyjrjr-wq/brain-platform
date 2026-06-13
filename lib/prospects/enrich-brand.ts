import Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, TRIAGE_MODEL } from "@/refinery/agents/anthropic.mts";
import { env } from "@/refinery/config/env.mts";

export type BrandEnrichment = {
  primary: string | null;
  secondary: string | null;
  logo_url: string | null;
  confidence: number; // 0..1; 0 on fallback
  source: "firecrawl-branding+haiku" | "fallback";
  company_name?: string | null;
};

export type EnrichDeps = {
  fetchImpl?: typeof fetch;
  anthropic?: Pick<Anthropic, "messages">;
  firecrawlKey?: string;
};

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

const FALLBACK: BrandEnrichment = {
  primary: null,
  secondary: null,
  logo_url: null,
  confidence: 0,
  source: "fallback",
  company_name: null,
};

const SELECT_BRAND_TOOL = {
  name: "select_brand",
  description: "Record the company's real brand identity selected from the labeled signals.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      primary_hex: {
        type: "string",
        description:
          "Dominant brand color as #RRGGBB. Never a neutral white/black/near-gray or the background.",
      },
      secondary_hex: {
        type: "string",
        description: "Complementary brand color #RRGGBB, or empty string.",
      },
      logo_url: {
        type: "string",
        description:
          "Best logo URL (prefer images.logo, else ogImage, else favicon), or empty string.",
      },
      company_name: {
        type: "string",
        description:
          "Company/brand name from images.logoAlt or the domain; empty string if unknown.",
      },
      confidence: {
        type: "number",
        description: "0..1 confidence the chosen colors are the real brand colors.",
      },
    },
    required: ["primary_hex", "secondary_hex", "logo_url", "company_name", "confidence"],
  },
} as const;

function normDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}
function absUrl(href: string, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}
function hexOrNull(v: unknown): string | null {
  return typeof v === "string" && HEX_RE.test(v) ? v : null;
}

/**
 * Hybrid prospect brand enrichment. Firecrawl v2 `branding` (one call) senses the
 * palette; claude-haiku-4-5 selects the real primary/secondary from the COMPLETE
 * labeled map (the real brand color often hides under colors.link/accent/buttons).
 * Network I/O but no app coupling — deps are injectable for tests. NEVER throws and
 * NEVER applies SWFL defaults: any failure returns nulls + source "fallback" so the
 * CONSUMER decides defaults.
 */
export async function enrichBrand(domain: string, deps: EnrichDeps = {}): Promise<BrandEnrichment> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const key = deps.firecrawlKey ?? env.firecrawlApiKey;
  if (!key) return FALLBACK;

  const d = normDomain(domain);
  const base = `https://${d}`;

  let branding: Record<string, unknown> | undefined;
  try {
    const res = await fetchImpl("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: base, formats: ["branding"] }),
    });
    if (!res.ok) return FALLBACK;
    const json = await res.json();
    branding = json?.data?.branding;
    if (!branding) return FALLBACK;
  } catch {
    return FALLBACK;
  }

  // Pass the WHOLE labeled sub-objects verbatim — no key whitelist (forward-compatible).
  const candidates = {
    domain: d,
    colorScheme: branding.colorScheme,
    colors: branding.colors,
    components: branding.components,
    images: branding.images,
    firecrawl_confidence: branding.confidence,
  };

  let input: Record<string, unknown> = {};
  try {
    const client = deps.anthropic ?? getAnthropic();
    const msg = await client.messages.create({
      model: TRIAGE_MODEL,
      max_tokens: 300,
      tools: [SELECT_BRAND_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: "select_brand" },
      messages: [
        {
          role: "user",
          content:
            `Select the REAL brand identity for ${d} from these labeled signals Firecrawl extracted. ` +
            `The real brand color is frequently NOT under "primary" — it often hides under "link", "accent", ` +
            `or a components button color (e.g. a real-estate brand's gold under colors.link). Examine EVERY key. ` +
            `Pick the dominant brand color (never a neutral white/black/near-gray or the background) as primary_hex, ` +
            `a complementary secondary_hex, the best logo_url (prefer images.logo, else ogImage, else favicon), ` +
            `the company_name, and a confidence 0..1.\n\n` +
            JSON.stringify(candidates).slice(0, 12_000),
        },
      ],
    });
    const block = msg.content.find((b) => b.type === "tool_use") as
      | Anthropic.ToolUseBlock
      | undefined;
    input = (block?.input ?? {}) as Record<string, unknown>;
  } catch {
    return FALLBACK;
  }

  // Logo: Haiku's pick, else the explicit images.logo path. NEVER read branding.logo
  // (top-level) — it is null in this API. Then ogImage, then favicon.
  const imgs =
    branding.images != null && typeof branding.images === "object"
      ? (branding.images as Record<string, unknown>)
      : {};
  const rawLogo =
    (typeof input.logo_url === "string" && input.logo_url) ||
    (typeof imgs.logo === "string" && imgs.logo) ||
    (typeof imgs.ogImage === "string" && imgs.ogImage) ||
    (typeof imgs.favicon === "string" && imgs.favicon) ||
    "";
  const company =
    typeof input.company_name === "string" && input.company_name.trim()
      ? input.company_name.trim()
      : null;

  return {
    primary: hexOrNull(input.primary_hex),
    secondary: hexOrNull(input.secondary_hex),
    logo_url: absUrl(String(rawLogo), base),
    confidence: typeof input.confidence === "number" ? input.confidence : 0,
    source: "firecrawl-branding+haiku",
    company_name: company,
  };
}
