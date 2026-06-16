import { describe, expect, test } from "bun:test";

import { cleanCitation, cleanCitations } from "./clean-url";

describe("cleanCitation — internal sources never link", () => {
  test("Supabase REST URL → no link, shows the human label only", () => {
    const c = cleanCitation({
      url: "https://jtkdowmrjaxfvwmemxso.supabase.co/rest/v1/fema_nfip_claims?select=*",
      label: "FEMA NFIP",
    });
    expect(c.linkable).toBe(false);
    expect(c.href).toBeUndefined();
    expect(c.is_internal).toBe(true);
    // A real upstream publisher label is honest provenance — keep it, don't overwrite.
    expect(c.label).toBe("FEMA NFIP");
  });

  test("Supabase REST URL with NO label → brand 'SWFL Data Gulf', is_internal, never the supabase host", () => {
    const c = cleanCitation({
      url: "https://jtkdowmrjaxfvwmemxso.supabase.co/rest/v1/x?select=*",
    });
    expect(c.linkable).toBe(false);
    expect(c.is_internal).toBe(true);
    expect(c.label).toBe("SWFL Data Gulf");
    expect(c.label).not.toContain("supabase");
  });

  test("bare data_lake table name → no link, brand label, is_internal", () => {
    const c = cleanCitation({ url: "data_lake.fema_nfip_claims_swfl" });
    expect(c.linkable).toBe(false);
    expect(c.is_internal).toBe(true);
    expect(c.label).toBe("SWFL Data Gulf");
  });

  test("absolute internal /api/ endpoint → no link, is_internal (keeps upstream label)", () => {
    const c = cleanCitation({
      url: "https://www.swfldatagulf.com/api/b/master?view=speak",
      label: "Master",
    });
    expect(c.linkable).toBe(false);
    expect(c.is_internal).toBe(true);
    expect(c.label).toBe("Master");
  });

  test("/rest/v1/ path on any host → no link, is_internal", () => {
    const c = cleanCitation({ url: "https://example.com/rest/v1/foo" });
    expect(c.linkable).toBe(false);
    expect(c.is_internal).toBe(true);
  });
});

describe("cleanCitation — API host rewrites to public landing pages", () => {
  test("api.bls.gov/* → https://www.bls.gov/data/", () => {
    const c = cleanCitation({
      url: "https://api.bls.gov/publicAPI/v2/timeseries/data/LAUCN120710000000003",
    });
    expect(c.linkable).toBe(true);
    expect(c.href).toBe("https://www.bls.gov/data/");
  });

  test("api.census.gov/* → https://data.census.gov", () => {
    const c = cleanCitation({
      url: "https://api.census.gov/data/2021/cbp?get=ESTAB&for=zipcode:33901",
    });
    expect(c.linkable).toBe(true);
    expect(c.href).toBe("https://data.census.gov");
  });
});

describe("cleanCitation — labels are human, never raw URLs or query strings", () => {
  test("/r/source provenance URL → uses decoded label param, never the query string", () => {
    const c = cleanCitation({
      url: "/r/source/fl_dor_tdt_collections?label=Florida%20DOR%20TDT%20collections&source=Florida%20DOR&brain=tourism-tdt&date_col=period",
      label: "Florida DOR TDT collections",
    });
    expect(c.linkable).toBe(true);
    expect(c.label).toBe("Florida DOR TDT collections");
    expect(c.label).not.toContain("?");
    expect(c.label).not.toContain("label=");
  });

  test("label that is itself a full URL → falls back to clean host domain", () => {
    const c = cleanCitation({
      url: "https://www.redfin.com/news/data-center/",
      label: "https://www.redfin.com/news/data-center/",
    });
    expect(c.linkable).toBe(true);
    expect(c.label).toBe("redfin.com");
  });

  test("generic external URL, no label → clean host domain as label, not internal", () => {
    const c = cleanCitation({ url: "https://www.fema.gov/flood-maps" });
    expect(c.linkable).toBe(true);
    expect(c.is_internal).toBe(false);
    expect(c.href).toBe("https://www.fema.gov/flood-maps");
    expect(c.label).toBe("fema.gov");
  });

  test("generic external URL with a human label → keeps the label", () => {
    const c = cleanCitation({
      url: "https://www.fema.gov/flood-maps",
      label: "FEMA Flood Maps",
    });
    expect(c.label).toBe("FEMA Flood Maps");
    expect(c.href).toBe("https://www.fema.gov/flood-maps");
  });
});

describe("cleanCitation — our own relative report pages stay linkable", () => {
  test("relative /r/{slug} keeps its href and uses the title label", () => {
    const c = cleanCitation({ url: "/r/housing-swfl", label: "Housing SWFL" });
    expect(c.linkable).toBe(true);
    expect(c.href).toBe("/r/housing-swfl");
    expect(c.label).toBe("Housing SWFL");
  });
});

describe("cleanCitation — degenerate input never throws", () => {
  test("empty url → no link, 'Source', NOT branded internal", () => {
    const c = cleanCitation({ url: "", label: "" });
    expect(c.linkable).toBe(false);
    expect(c.is_internal).toBe(false);
    expect(c.label).toBe("Source");
  });

  test("garbage url → no link, 'Source', NOT branded internal", () => {
    const c = cleanCitation({ url: "not a url at all" });
    expect(c.linkable).toBe(false);
    expect(c.is_internal).toBe(false);
    expect(c.label).toBe("Source");
  });

  test("origin_kind passes through", () => {
    const c = cleanCitation({
      url: "https://www.fema.gov/x",
      label: "FEMA",
      origin_kind: "metric",
    });
    expect(c.origin_kind).toBe("metric");
  });
});

describe("cleanCitations — list cleaning + dedupe", () => {
  test("dedupes by resolved href, drops nothing with a usable label", () => {
    const out = cleanCitations([
      { url: "https://www.fema.gov/x", label: "FEMA" },
      { url: "https://www.fema.gov/x", label: "FEMA (dup)" },
      { url: "https://jtk.supabase.co/rest/v1/y?select=*", label: "Internal" },
    ]);
    // fema deduped to one; supabase kept as label-only (still informative)
    expect(out.filter((c) => c.linkable && c.href === "https://www.fema.gov/x").length).toBe(1);
    expect(out.some((c) => !c.linkable && c.label === "Internal")).toBe(true);
  });
});
