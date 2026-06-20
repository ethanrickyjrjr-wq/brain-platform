import { describe, expect, it } from "bun:test";
import { composeCampaign, type CampaignDeps, type CampaignContent } from "./campaign";
import type { OutreachTarget } from "./targets";
import type { BrandEnrichment } from "@/lib/prospects/enrich-brand";

const HIGH_CONF: BrandEnrichment = {
  primary: "#0a3d62",
  secondary: "#e74c3c",
  logo_url: "https://cdn.acme.com/logo.png",
  company_name: "Acme Realty",
  confidence: 0.9,
  source: "meta",
};
const LOW_CONF: BrandEnrichment = {
  primary: null,
  secondary: null,
  logo_url: null,
  company_name: null,
  confidence: 0,
  source: "fallback",
};

function content(over: Partial<CampaignContent> = {}): CampaignContent {
  return {
    kicker: "FORT MYERS BEACH",
    title: "Home values up 4%",
    chart: { type: "sparkline", data: [{ x: "May", y: 1 }, { x: "Jun", y: 2 }] },
    explanation: "Tight inventory firmed prices.",
    subject: "FMB market update",
    freshness: "SWFL-7421-v5-20260620",
    ...over,
  };
}

function deps(over: Partial<CampaignDeps> = {}): CampaignDeps {
  return {
    enrich: async () => HIGH_CONF,
    buildContent: async () => content(),
    siteOrigin: "https://www.swfldatagulf.com",
    ...over,
  };
}

const target = (over: Partial<OutreachTarget> = {}): OutreachTarget => ({
  email: "broker@acme.com",
  name: "Acme Realty",
  domain: "acme.com",
  zip: "33931",
  ...over,
});

describe("composeCampaign", () => {
  it("renders a branded, ready message for a high-confidence target", async () => {
    const { messages, summary } = await composeCampaign([target()], deps());
    expect(summary).toMatchObject({ total: 1, ready: 1, used_house_brand: 0 });
    const m = messages[0];
    expect(m.status).toBe("ready");
    expect(m.usedHouseBrand).toBe(false);
    expect(m.brandSource).toBe("meta");
    expect(m.primary).toBe("#0a3d62");
    expect(m.html).toContain("https://cdn.acme.com/logo.png");
    // The arrival carries the recipient's color (auto-populate) + their zip.
    expect(m.arrivalUrl).toContain("primary=%230a3d62");
    expect(m.arrivalUrl).toContain("zip=33931");
  });

  it("falls back to the house brand below the confidence threshold (no guessed colors)", async () => {
    const { messages, summary } = await composeCampaign(
      [target()],
      deps({ enrich: async () => LOW_CONF }),
    );
    expect(summary.used_house_brand).toBe(1);
    const m = messages[0];
    expect(m.status).toBe("ready");
    expect(m.usedHouseBrand).toBe(true);
    expect(m.brandSource).toBe("house");
    expect(m.primary).toBeNull();
    // No scraped color leaks into the arrival when we don't trust the scrape.
    expect(m.arrivalUrl).not.toContain("primary=");
    // ...but the zip seed still rides along.
    expect(m.arrivalUrl).toContain("zip=33931");
  });

  it("marks a target out_of_scope when there is no content (never sends empty)", async () => {
    const { messages, summary } = await composeCampaign(
      [target()],
      deps({ buildContent: async () => null }),
    );
    expect(summary.out_of_scope).toBe(1);
    expect(messages[0].status).toBe("out_of_scope");
    expect(messages[0].html).toBeUndefined();
  });

  it("isolates a per-recipient failure as an error row (never throws the batch)", async () => {
    const { messages, summary } = await composeCampaign([target(), target({ email: "b@x.com" })], {
      ...deps(),
      buildContent: async (t) => {
        if (t.email === "broker@acme.com") throw new Error("brain load failed");
        return content();
      },
    });
    expect(summary).toMatchObject({ total: 2, ready: 1, error: 1 });
    const errRow = messages.find((m) => m.status === "error");
    expect(errRow?.email).toBe("broker@acme.com");
    expect(errRow?.reason).toContain("brain load failed");
  });

  it("handles a target with no domain (house brand, no scrape)", async () => {
    let enrichCalls = 0;
    const { messages } = await composeCampaign(
      [target({ domain: undefined })],
      deps({
        enrich: async () => {
          enrichCalls++;
          return HIGH_CONF;
        },
      }),
    );
    expect(enrichCalls).toBe(0); // no domain → no scrape attempted
    expect(messages[0].usedHouseBrand).toBe(true);
    expect(messages[0].status).toBe("ready");
  });
});
