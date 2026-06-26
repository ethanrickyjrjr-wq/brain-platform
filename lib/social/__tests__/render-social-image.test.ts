import { test, expect, describe, afterEach } from "bun:test";
import {
  renderSocialImage,
  composeCardSvg,
  fetchLogo,
  _clearLogoCache,
  SOCIAL_FORMATS,
  isSocialFormat,
  type SocialModel,
  type SocialFormat,
} from "../render-social-image";
import type { BrandTheme } from "@/scripts/email/types";

// PNG IHDR carries the image width/height as big-endian uint32 at byte offsets
// 16 and 20 — decode them directly so dimension assertions need no image lib.
function pngDims(buf: Buffer): { width: number; height: number } {
  const magic = buf.subarray(0, 8).toString("hex");
  expect(magic).toBe("89504e470d0a1a0a"); // \x89PNG\r\n\x1a\n
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const BRAND: BrandTheme = {
  primary: "#123456",
  accent: "#abcdef",
  logoUrl: null,
};

const BASE_MODEL: SocialModel = {
  headline: "Lee County housing cooling",
  stat: { label: "median sale price, 33908", value: "$412K", caption: "down 3% MoM" },
  as_of: "2026-06-19",
  source: "Lee County housing",
  freshness_token: "SWFL-7421-v5-20260619",
};

afterEach(() => _clearLogoCache());

describe("isSocialFormat", () => {
  test("accepts the four platform formats, rejects others", () => {
    for (const f of ["square", "portrait", "landscape", "story"]) {
      expect(isSocialFormat(f)).toBe(true);
    }
    expect(isSocialFormat("banner")).toBe(false);
    expect(isSocialFormat("")).toBe(false);
    expect(isSocialFormat(undefined)).toBe(false);
  });
});

describe("per-format dimensions", () => {
  const cases: Array<[SocialFormat, number, number]> = [
    ["square", 1080, 1080],
    ["portrait", 1080, 1350],
    ["landscape", 1200, 630],
    ["story", 1080, 1920],
  ];
  for (const [format, w, h] of cases) {
    test(`${format} → ${w}×${h} PNG`, async () => {
      const png = await renderSocialImage({ model: BASE_MODEL, theme: BRAND, format });
      expect(Buffer.isBuffer(png)).toBe(true);
      expect(png.length).toBeGreaterThan(0);
      const dims = pngDims(png);
      expect(dims.width).toBe(w);
      expect(dims.height).toBe(h);
      // Sanity: SOCIAL_FORMATS is the single source of truth.
      expect(dims).toEqual(SOCIAL_FORMATS[format]);
    });
  }
});

describe("watermark is burned in", () => {
  test("SVG carries 'SWFL Data Gulf • as of {MM/DD/YYYY}' + source brain (rule 5)", () => {
    const svg = composeCardSvg({ model: BASE_MODEL, theme: BRAND, format: "square" });
    // Rule 5 (CLEAN): the as-of reads MM/DD/YYYY — NEVER the backwards ISO slice.
    expect(svg).toContain("SWFL Data Gulf • as of 06/19/2026");
    expect(svg).not.toContain("SWFL Data Gulf • as of 2026-06-19");
    expect(svg).toContain("Lee County housing");
    // The provenance is real <text>, not metadata → survives a screenshot.
    expect(svg).toContain("<text");
  });

  test("no backwards YYYY-MM-DD date survives anywhere in the rendered card", () => {
    const svg = composeCardSvg({ model: BASE_MODEL, theme: BRAND, format: "square" });
    // The whole card is dash-ISO-free: watermark is MM/DD/YYYY, the freshness
    // token (20260619, no dashes) can't match, and no other date paints raw ISO.
    expect(svg).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("falls back to today's date as MM/DD/YYYY when as_of is absent", () => {
    const fixedNow = new Date("2026-03-01T12:00:00Z");
    const svg = composeCardSvg({
      model: { headline: "h" },
      theme: BRAND,
      format: "square",
      now: fixedNow,
    });
    expect(svg).toContain("SWFL Data Gulf • as of 03/01/2026");
    expect(svg).not.toContain("2026-03-01");
  });

  test("freshness shows the cleaned as-of date — never the raw token", () => {
    const svg = composeCardSvg({ model: BASE_MODEL, theme: BRAND, format: "square" });
    // PUBLIC share card → cleaned MM/DD/YYYY only; the internal token never leaks.
    expect(svg).toContain("06/19/2026");
    expect(svg).not.toContain("SWFL-7421-v5-20260619");
  });
});

describe("NO-FABRICATION tripwire (the moat)", () => {
  test("empty model → no placeholder literal, no stat block, still a valid card", async () => {
    const empty: SocialModel = { headline: "Market read" };
    const svg = composeCardSvg({
      model: empty,
      theme: BRAND,
      format: "square",
      now: new Date("2026-01-01T00:00:00Z"),
    });
    // Stat value strings must NOT appear because there is no stat.
    expect(svg).not.toContain("$0");
    expect(svg).not.toContain("N/A");
    expect(svg).not.toContain(">undefined<");
    expect(svg).not.toContain(">null<");
    expect(svg).not.toContain("NaN");
    // It still renders to a valid PNG of the right size.
    const png = await renderSocialImage({
      model: empty,
      theme: BRAND,
      format: "square",
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(pngDims(png)).toEqual({ width: 1080, height: 1080 });
  });

  test("stat with null/empty value → stat block OMITTED entirely (no $0/N/A)", () => {
    for (const bad of [null, undefined, "", "   ", Number.NaN, Infinity]) {
      const m: SocialModel = {
        headline: "h",
        stat: { label: "median price", value: bad as never },
      };
      const svg = composeCardSvg({ model: m, theme: BRAND, format: "portrait" });
      // The stat label only appears when a real value exists; here it must not.
      expect(svg).not.toContain("median price");
      expect(svg).not.toContain("$0");
      expect(svg).not.toContain("N/A");
      expect(svg).not.toContain("NaN");
      expect(svg).not.toContain("Infinity");
    }
  });

  test("a real stat value DOES appear verbatim (proves omission ≠ blanket suppression)", () => {
    const svg = composeCardSvg({ model: BASE_MODEL, theme: BRAND, format: "square" });
    expect(svg).toContain("$412K");
    expect(svg).toContain("median sale price, 33908");
  });

  test("numeric zero is a REAL value and is shown (0 ≠ missing)", () => {
    const m: SocialModel = { headline: "h", stat: { label: "net new permits", value: 0 } };
    const svg = composeCardSvg({ model: m, theme: BRAND, format: "square" });
    expect(svg).toContain(">0<");
    expect(svg).toContain("net new permits");
  });
});

describe("brand colors carry through", () => {
  test("brand primary + accent appear in the SVG", () => {
    const svg = composeCardSvg({ model: BASE_MODEL, theme: BRAND, format: "square" });
    expect(svg).toContain("#123456"); // primary (background)
    expect(svg).toContain("#abcdef"); // accent (stat value + rule)
  });

  test("falls back to SWFL house theme when no brand passed", () => {
    const svg = composeCardSvg({ model: BASE_MODEL, theme: null, format: "square" });
    expect(svg).toContain("#0f1d24"); // SWFL primary
    expect(svg).toContain("#3DC9C0"); // SWFL accent
  });
});

describe("chart embedding", () => {
  test("sparkline (pure SVG from renderChart) is inlined as a <g>", () => {
    const m: SocialModel = {
      headline: "trend",
      chart: {
        type: "sparkline",
        data: [
          { x: 1, y: 2 },
          { x: 2, y: 5 },
          { x: 3, y: 3 },
        ],
      },
    };
    const svg = composeCardSvg({ model: m, theme: BRAND, format: "square" });
    expect(svg).toContain("<polyline"); // sparkline body re-parented in
    expect(svg).toContain("<g transform=");
  });

  test("bar chart (HTML table from renderChart) falls back to native SVG bars", async () => {
    const m: SocialModel = {
      headline: "by zip",
      chart: {
        type: "bar",
        data: [
          { label: "33908", value: 12 },
          { label: "33919", value: 7 },
        ],
      },
    };
    const svg = composeCardSvg({ model: m, theme: BRAND, format: "landscape" });
    expect(svg).toContain("<rect"); // native bar rects
    // bar values appear verbatim — none invented.
    expect(svg).toContain(">12<");
    expect(svg).toContain(">7<");
    const png = await renderSocialImage({ model: m, theme: BRAND, format: "landscape" });
    expect(pngDims(png)).toEqual({ width: 1200, height: 630 });
  });
});

describe("logo-fetch graceful degradation", () => {
  test("fetchLogo returns null on network failure (no throw)", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    try {
      const buf = await fetchLogo("https://example.com/logo.png");
      expect(buf).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("fetchLogo returns null on non-2xx (no throw, no placeholder)", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    try {
      expect(await fetchLogo("https://example.com/missing.png")).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("renderSocialImage still produces a valid PNG when the logo fetch fails", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("boom");
    }) as typeof fetch;
    try {
      const themeWithLogo: BrandTheme = { ...BRAND, logoUrl: "https://example.com/logo.png" };
      const png = await renderSocialImage({
        model: BASE_MODEL,
        theme: themeWithLogo,
        format: "square",
      });
      expect(pngDims(png)).toEqual({ width: 1080, height: 1080 });
    } finally {
      globalThis.fetch = original;
    }
  });

  test("no <image> element when the logo is unavailable (no placeholder image)", () => {
    const svg = composeCardSvg({
      model: BASE_MODEL,
      theme: BRAND,
      format: "square",
      logoBuffer: null,
    });
    expect(svg).not.toContain("<image");
  });

  test("an <image> IS embedded when logo bytes are provided", () => {
    const fakeLogo = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // any non-empty bytes
    const svg = composeCardSvg({
      model: BASE_MODEL,
      theme: BRAND,
      format: "square",
      logoBuffer: fakeLogo,
    });
    expect(svg).toContain("<image");
    expect(svg).toContain("data:image/png;base64,");
  });

  test("a provided logoBuffer bypasses fetch entirely", async () => {
    const original = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      throw new Error("should not be called");
    }) as typeof fetch;
    try {
      const themeWithLogo: BrandTheme = { ...BRAND, logoUrl: "https://example.com/logo.png" };
      const png = await renderSocialImage({
        model: BASE_MODEL,
        theme: themeWithLogo,
        format: "square",
        logoBuffer: Buffer.from([1, 2, 3, 4]),
      });
      expect(pngDims(png)).toEqual({ width: 1080, height: 1080 });
      expect(fetched).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("input safety", () => {
  test("malicious text is escaped, cannot inject SVG markup", () => {
    const m: SocialModel = {
      headline: "</text><script>alert(1)</script>",
      stat: { label: "x", value: '<rect width="9999"/>' },
    };
    const svg = composeCardSvg({ model: m, theme: BRAND, format: "square" });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&lt;rect");
  });

  test("unknown format throws from renderSocialImage", async () => {
    await expect(
      renderSocialImage({ model: BASE_MODEL, theme: BRAND, format: "banner" as never }),
    ).rejects.toThrow(/Unknown social format/);
  });
});
