import { test, expect } from "bun:test";
import { EmailDocSchema, ContentPatchSchema, BlockContentPatchSchema, mintBlockId } from "./schema";
import { SEED_DOCS, createBlock, DEFAULT_GLOBAL_STYLE } from "./default-docs";
import type { EmailDoc } from "./types";

// A doc with EVERY optional prop on EVERY block populated. If the schema drops a
// field that types.ts declares (drift), the round-trip below fails — that is the
// real conformance guarantee (optional props are bidirectionally assignable, so
// a type-level check can't catch a dropped optional; a round-trip can).
const fullDoc: EmailDoc = {
  globalStyle: {
    primaryColor: "#0f1d24",
    accentColor: "#3DC9C0",
    fontFamily: "BOOK_SERIF",
    textColor: "#242424",
    backdropColor: "#F8F8F8",
  },
  blocks: [
    {
      id: "block_aaaa1111",
      type: "header",
      props: { logoUrl: "https://x/l.png", companyName: "Co", tagline: "tag", bgColor: "#000" },
    },
    {
      id: "block_bbbb2222",
      type: "hero",
      props: { kicker: "k", value: "$1", label: "l", prose: "p" },
    },
    {
      id: "block_cccc3333",
      type: "stats",
      props: {
        stats: [
          { value: "1", label: "a" },
          { value: "2", label: "b" },
        ],
      },
    },
    {
      id: "block_dddd4444",
      type: "signal",
      props: { kicker: "k", title: "t", body: "b", bgColor: "#fff" },
    },
    { id: "block_eeee5555", type: "text", props: { body: "body", align: "center" } },
    {
      id: "block_ffff6666",
      type: "image",
      props: { url: "https://x/i.jpg", alt: "a", caption: "c" },
    },
    {
      id: "block_aaaa7777",
      type: "agent-card",
      props: {
        photoUrl: "https://x/p.jpg",
        name: "N",
        title: "T",
        bio: "bio",
        phone: "239",
        ctaUrl: "https://x",
        ctaLabel: "CTA",
      },
    },
    {
      id: "block_eeee7777",
      type: "agent-hero",
      props: {
        photoUrl: "https://x/h.jpg",
        alt: "a",
        name: "N",
        designation: "D",
        tagline: "tg",
        ctaLabel: "C",
        ctaUrl: "https://x",
      },
    },
    {
      id: "block_ffff7777",
      type: "social-icons",
      props: {
        platforms: [
          { type: "instagram", url: "https://instagram.com/me" },
          {
            type: "custom",
            url: "https://substack.com/me",
            label: "Substack",
            logoUrl: "https://x/s.png",
          },
        ],
        displayMode: "icon+text",
        layout: "row",
        iconSize: "md",
        iconColor: "custom",
        customIconColor: "#123456",
      },
    },
    {
      id: "block_bbbb8888",
      type: "button",
      props: { label: "Go", url: "https://x", bgColor: "#111" },
    },
    { id: "block_cccc9999", type: "divider", props: { color: "#ccc" } },
    {
      id: "block_dddd0000",
      type: "footer",
      props: {
        companyName: "Co",
        address: "addr",
        websiteUrl: "https://x",
        phone: "239",
        email: "a@b.com",
        instagramUrl: "https://instagram.com/co",
        facebookUrl: "https://facebook.com/co",
        linkedinUrl: "https://linkedin.com/co",
        socialOrder: ["facebook", "instagram", "linkedin"],
        unsubscribeUrl: "https://x/u",
      },
    },
  ],
};

test("round-trips a fully-populated doc with no field stripped", () => {
  const parsed = EmailDocSchema.parse(fullDoc);
  expect(parsed).toEqual(fullDoc);
});

test("preserves a saved block id, mints one when absent", () => {
  const doc = {
    globalStyle: DEFAULT_GLOBAL_STYLE,
    blocks: [
      { id: "block_keepme1", type: "text", props: { body: "kept" } },
      { type: "divider", props: {} }, // no id → minted
    ],
  };
  const parsed = EmailDocSchema.parse(doc);
  expect(parsed.blocks[0].id).toBe("block_keepme1");
  expect(parsed.blocks[1].id).toMatch(/^block_[0-9a-f]{8}$/);
});

test("rejects a malformed block (unknown type) — not coerced", () => {
  const bad = { globalStyle: DEFAULT_GLOBAL_STYLE, blocks: [{ type: "carousel", props: {} }] };
  expect(EmailDocSchema.safeParse(bad).success).toBe(false);
});

test("rejects a block whose props violate a constraint (stats > 3 cells)", () => {
  const bad = {
    globalStyle: DEFAULT_GLOBAL_STYLE,
    blocks: [
      {
        type: "stats",
        props: {
          stats: [
            { value: "1", label: "a" },
            { value: "2", label: "b" },
            { value: "3", label: "c" },
            { value: "4", label: "d" },
          ],
        },
      },
    ],
  };
  expect(EmailDocSchema.safeParse(bad).success).toBe(false);
});

test("rejects an empty block list and an over-long one", () => {
  expect(EmailDocSchema.safeParse({ globalStyle: DEFAULT_GLOBAL_STYLE, blocks: [] }).success).toBe(
    false,
  );
  const many = Array.from({ length: 21 }, () => ({ type: "divider", props: {} }));
  expect(
    EmailDocSchema.safeParse({ globalStyle: DEFAULT_GLOBAL_STYLE, blocks: many }).success,
  ).toBe(false);
});

test("every seed builds a valid, parseable doc", () => {
  for (const seed of SEED_DOCS) {
    const doc = seed.build();
    expect(EmailDocSchema.safeParse(doc).success).toBe(true);
    expect(doc.blocks.length).toBeGreaterThan(0);
  }
});

test("two builds of the same seed have distinct (non-aliased) block ids", () => {
  const a = SEED_DOCS[0].build();
  const b = SEED_DOCS[0].build();
  expect(a.blocks[0].id).not.toBe(b.blocks[0].id);
});

test("createBlock mints a fresh block with default props", () => {
  const blk = createBlock("hero");
  expect(blk.type).toBe("hero");
  expect(blk.id).toMatch(/^block_[0-9a-f]{8}$/);
  expect(blk.props.value).toBeDefined();
});

test("mintBlockId is unique and prefixed", () => {
  const a = mintBlockId();
  const b = mintBlockId();
  expect(a).toMatch(/^block_[0-9a-f]{8}$/);
  expect(a).not.toBe(b);
});

// ── ContentPatchSchema (the AI no-restyle guard) ────────────────────────────

test("accepts a text-only content patch keyed by block id", () => {
  const patch = {
    block_bbbb2222: { value: "$499K", label: "Median · Naples", prose: "Up from last month." },
    block_cccc3333: { stats: [{ value: "41", label: "DOM" }] },
  };
  const r = ContentPatchSchema.safeParse(patch);
  expect(r.success).toBe(true);
});

test("REJECTS a patch that tries to set a color/style key (strictObject)", () => {
  expect(BlockContentPatchSchema.safeParse({ value: "$1", bgColor: "#000" }).success).toBe(false);
  expect(BlockContentPatchSchema.safeParse({ prose: "ok", color: "#fff" }).success).toBe(false);
});

test("REJECTS a patch that tries to set a link/asset/identity key", () => {
  // url / logoUrl / photoUrl / ctaUrl / companyName / name are user-owned — not AI-writable
  for (const key of ["url", "logoUrl", "photoUrl", "ctaUrl", "companyName", "name"]) {
    expect(BlockContentPatchSchema.safeParse({ body: "x", [key]: "y" }).success).toBe(false);
  }
});
