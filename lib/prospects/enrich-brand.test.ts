import { test, expect } from "bun:test";
import { enrichBrand, type EnrichDeps } from "./enrich-brand";

// Real branding shapes captured from the 2026-06-12 vendor bake-off.
const C21 = {
  colorScheme: "light",
  colors: {
    primary: "#6E5E5E",
    secondary: "#1D4ED8",
    accent: "#262627",
    background: "#FDFCFC",
    textPrimary: "#121212",
    link: "#BEAF87",
  },
  images: {
    logo: "https://www.century21.com/images/logo/c21-logo-white.svg",
    favicon: "https://www.century21.com/favicon/C21-favicon.ico",
    ogImage: "https://www.century21.com/images/home/C21/home-image-600.webp",
    logoAlt: "C21 Logo",
  },
  logo: null,
  confidence: 0.8,
};

function firecrawlOk(branding: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ success: true, data: { branding } }), {
      status: 200,
    })) as unknown as typeof fetch;
}
function anthropicReturning(input: Record<string, unknown>) {
  return {
    messages: {
      create: async () => ({ content: [{ type: "tool_use", name: "select_brand", input }] }),
    },
  } as unknown as EnrichDeps["anthropic"];
}

test("promotes the real brand color even when Firecrawl mislabels it (C21 gold under link)", async () => {
  // Simulate Haiku correctly reading colors.link → primary.
  const out = await enrichBrand("century21.com", {
    fetchImpl: firecrawlOk(C21),
    anthropic: anthropicReturning({
      primary_hex: "#BEAF87",
      secondary_hex: "#262627",
      logo_url: "https://www.century21.com/images/logo/c21-logo-white.svg",
      company_name: "Century 21",
      confidence: 0.85,
    }),
    firecrawlKey: "fc-test",
  });
  expect(out.primary).toBe("#BEAF87");
  expect(out.source).toBe("firecrawl-branding+haiku");
  expect(out.logo_url).toContain("c21-logo-white.svg");
  expect(out.company_name).toBe("Century 21");
});

test("Firecrawl non-2xx → fallback nulls, confidence 0", async () => {
  const out = await enrichBrand("example.com", {
    fetchImpl: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    anthropic: anthropicReturning({}),
    firecrawlKey: "fc-test",
  });
  expect(out).toMatchObject({
    primary: null,
    secondary: null,
    logo_url: null,
    confidence: 0,
    source: "fallback",
  });
});

test("empty branding → fallback", async () => {
  const out = await enrichBrand("nobrand.com", {
    fetchImpl: firecrawlOk(undefined),
    anthropic: anthropicReturning({}),
    firecrawlKey: "fc-test",
  });
  expect(out.source).toBe("fallback");
});

test("missing firecrawl key → fallback without any network call", async () => {
  let called = false;
  const out = await enrichBrand("x.com", {
    fetchImpl: (async () => {
      called = true;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch,
    firecrawlKey: "",
  });
  expect(out.source).toBe("fallback");
  expect(called).toBe(false);
});

test("non-hex primary from Haiku → null; relative logo is absolutized", async () => {
  const out = await enrichBrand("sagerealtor.com", {
    fetchImpl: firecrawlOk({
      colors: { primary: "#2EA3F2" },
      images: { logo: "/wp-content/logo.png" },
    }),
    anthropic: anthropicReturning({
      primary_hex: "teal",
      secondary_hex: "",
      logo_url: "",
      company_name: "",
      confidence: 0.3,
    }),
    firecrawlKey: "fc-test",
  });
  expect(out.primary).toBeNull(); // "teal" fails HEX_RE
  expect(out.logo_url).toBe("https://sagerealtor.com/wp-content/logo.png"); // fell back to images.logo, absolutized
  expect(out.company_name).toBeNull();
});
