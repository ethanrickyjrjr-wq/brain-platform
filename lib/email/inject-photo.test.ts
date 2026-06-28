import { describe, it, expect } from "bun:test";
import { brandWebsiteUrl, heroPhotoBlock, upsertHeroPhoto } from "./inject-photo";
import { upsertChartBlock, chartImageBlock } from "./inject-chart";
import { DEFAULT_GLOBAL_STYLE } from "./doc/default-docs";
import type { EmailBlock, EmailDoc } from "./doc/types";

const doc = (blocks: EmailBlock[]): EmailDoc => ({
  globalStyle: { ...DEFAULT_GLOBAL_STYLE },
  blocks,
});
const header = (): EmailBlock => ({ id: "h", type: "header", props: {} });
const hero = (): EmailBlock => ({ id: "hero", type: "hero", props: {} });
const urlOf = (b: EmailBlock) => (b.type === "image" ? b.props.url : undefined);

describe("heroPhotoBlock", () => {
  it("mints a kind:photo image block carrying url + alt + linkUrl", () => {
    const b = heroPhotoBlock({
      url: "https://x/p.jpg",
      alt: "home",
      linkUrl: "https://listing/123",
    });
    expect(b.type).toBe("image");
    expect(b.props.kind).toBe("photo");
    expect(b.props.url).toBe("https://x/p.jpg");
    expect(b.props.alt).toBe("home");
    expect(b.props.linkUrl).toBe("https://listing/123");
  });
});

describe("upsertHeroPhoto", () => {
  it("inserts right after the header", () => {
    const d = upsertHeroPhoto(doc([header(), hero()]), heroPhotoBlock({ url: "u" }));
    expect(d.blocks.map((b) => b.type)).toEqual(["header", "image", "hero"]);
  });
  it("prepends when there is no header", () => {
    const d = upsertHeroPhoto(doc([hero()]), heroPhotoBlock({ url: "u" }));
    expect(d.blocks.map((b) => b.type)).toEqual(["image", "hero"]);
  });
  it("replaces an existing photo in place (never stacks)", () => {
    const d1 = upsertHeroPhoto(doc([header(), hero()]), heroPhotoBlock({ url: "a" }));
    const d2 = upsertHeroPhoto(d1, heroPhotoBlock({ url: "b" }));
    const photos = d2.blocks.filter((b) => b.type === "image");
    expect(photos).toHaveLength(1);
    expect(urlOf(photos[0])).toBe("b");
  });
  it("does NOT mutate the input doc", () => {
    const input = doc([header(), hero()]);
    upsertHeroPhoto(input, heroPhotoBlock({ url: "u" }));
    expect(input.blocks).toHaveLength(2);
  });
});

describe("photo + chart coexist (the collision guard)", () => {
  it("the chart never overwrites the hero photo", () => {
    let d = upsertHeroPhoto(doc([header(), hero()]), heroPhotoBlock({ url: "photo.jpg" }));
    d = upsertChartBlock(d, chartImageBlock({ url: "chart.png", alt: "chart" }));
    const urls = d.blocks.filter((b) => b.type === "image").map(urlOf);
    expect(urls).toContain("photo.jpg");
    expect(urls).toContain("chart.png");
    expect(urls).toHaveLength(2);
  });

  it("never overwrites an UNTAGGED uploaded photo (the bug the chart tag fixes)", () => {
    const uploaded: EmailBlock = {
      id: "up",
      type: "image",
      props: { url: "https://cdn/email-media/u/abc.jpg" },
    };
    let d = doc([header(), uploaded, hero()]);
    d = upsertChartBlock(
      d,
      chartImageBlock({ url: "https://cdn/email-charts/c.png", alt: "chart" }),
    );
    const urls = d.blocks.filter((b) => b.type === "image").map(urlOf);
    expect(urls).toContain("https://cdn/email-media/u/abc.jpg"); // upload survived
    expect(urls).toContain("https://cdn/email-charts/c.png"); // chart added separately
    expect(urls).toHaveLength(2);
  });

  it("REPLACES a legacy untagged chart (url under /email-charts/) in place", () => {
    const legacy: EmailBlock = {
      id: "lc",
      type: "image",
      props: { url: "https://cdn/email-charts/old.png" },
    };
    let d = doc([header(), hero(), legacy]);
    d = upsertChartBlock(d, chartImageBlock({ url: "https://cdn/email-charts/new.png", alt: "c" }));
    const imgs = d.blocks.filter((b) => b.type === "image");
    expect(imgs).toHaveLength(1); // replaced, not duplicated
    expect(urlOf(imgs[0])).toBe("https://cdn/email-charts/new.png");
  });
});

describe("brandWebsiteUrl", () => {
  const footer = (websiteUrl?: string): EmailBlock => ({
    id: "f",
    type: "footer",
    props: websiteUrl !== undefined ? { websiteUrl } : {},
  });
  it("reads the saved brand website off the footer", () => {
    expect(brandWebsiteUrl(doc([header(), footer("https://youragent.com")]))).toBe(
      "https://youragent.com",
    );
  });
  it("trims whitespace and ignores an empty website", () => {
    expect(brandWebsiteUrl(doc([footer("  https://x.com  ")]))).toBe("https://x.com");
    expect(brandWebsiteUrl(doc([footer("   ")]))).toBeUndefined();
    expect(brandWebsiteUrl(doc([footer()]))).toBeUndefined();
  });
  it("is undefined when there is no footer", () => {
    expect(brandWebsiteUrl(doc([header(), hero()]))).toBeUndefined();
  });
});
