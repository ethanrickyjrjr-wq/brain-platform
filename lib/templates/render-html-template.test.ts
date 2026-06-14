import { describe, it, expect } from "bun:test";
import {
  renderHtmlTemplate,
  InvalidSlugError,
  TemplateNotFoundError,
} from "./render-html-template";
import { TEMPLATE_MANIFEST } from "./manifest";

const LOUD = { brand_primary: "#FF0000", brand_secondary: "#00FF00" };

describe("renderHtmlTemplate — slug guards", () => {
  it("rejects path traversal", async () => {
    await expect(renderHtmlTemplate("../secrets", {})).rejects.toBeInstanceOf(InvalidSlugError);
    await expect(renderHtmlTemplate("viz/../../etc", {})).rejects.toBeInstanceOf(InvalidSlugError);
  });

  it("rejects an unknown but well-formed slug with TemplateNotFoundError", async () => {
    await expect(renderHtmlTemplate("viz/does-not-exist", {})).rejects.toBeInstanceOf(
      TemplateNotFoundError,
    );
  });

  it("replaces an unknown {{token}} with empty string (no literal leaks)", async () => {
    const html = await renderHtmlTemplate("viz/storm-year-timeline", {
      // intentionally omit several tokens
      brand_primary: "#0a8078",
      brand_secondary: "#E08158",
    });
    expect(html).not.toContain("{{");
  });
});

describe("renderHtmlTemplate — every viz card renders clean", () => {
  for (const entry of TEMPLATE_MANIFEST) {
    it(`${entry.slug} fills all tokens with no residual {{ }}`, async () => {
      const html = await renderHtmlTemplate(entry.slug, entry.previewData);
      expect(html).not.toContain("{{");
      expect(html).not.toContain("}}");
    });

    it(`${entry.slug} — brand override wins (last :root before </head>)`, async () => {
      const html = await renderHtmlTemplate(entry.slug, { ...entry.previewData, ...LOUD });
      const baseIdx = html.indexOf('<style id="gulf-base">');
      const ovrIdx = html.indexOf('<style id="brand-override">');
      const headEnd = html.lastIndexOf("</head>");
      // base palette exists, override comes after it, and still inside <head>
      expect(baseIdx).toBeGreaterThan(-1);
      expect(ovrIdx).toBeGreaterThan(baseIdx);
      expect(ovrIdx).toBeLessThan(headEnd);
      // the override block re-declares --gulf-teal with the brand primary
      expect(html).toMatch(/<style id="brand-override">[\s\S]*?--gulf-teal:\s*#FF0000/);
    });
  }

  it("corridor-positioning tokenizes JS-driven SVG fills to the brand pair", async () => {
    const html = await renderHtmlTemplate("viz/corridor-positioning", {
      ...TEMPLATE_MANIFEST.find((e) => e.slug === "viz/corridor-positioning")!.previewData,
      ...LOUD,
    });
    expect(html).toMatch(/stable:\s*"#FF0000"/);
    expect(html).toMatch(/declining:\s*"#00FF00"/);
  });

  it("freight-nowcast injects z_value as a numeric JS constant", async () => {
    const html = await renderHtmlTemplate("viz/freight-nowcast", {
      ...TEMPLATE_MANIFEST.find((e) => e.slug === "viz/freight-nowcast")!.previewData,
    });
    expect(html).toContain("const Z_VALUE = -0.02;");
  });
});
