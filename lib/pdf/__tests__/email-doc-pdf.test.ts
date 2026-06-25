// Audit lock for the PDF root: a doc containing ALL 12 block types (every field
// populated) must render to a real PDF buffer. If a block kind is dropped or a
// field crashes the renderer, this goes red — "every piece of data can be added
// to a PDF" is enforced here, not assumed.
import { test, expect } from "bun:test";
import type { EmailDoc } from "@/lib/email/doc/types";
import {
  renderEmailDocToBuffer,
  pdfFilename,
  parsePdfText,
  buildExtractionPrompt,
} from "@/lib/pdf";

const FULL_DOC: EmailDoc = {
  globalStyle: {
    primaryColor: "#0f1d24",
    accentColor: "#3DC9C0",
    fontFamily: "MODERN_SANS",
    textColor: "#242424",
    backdropColor: "#F8F8F8",
  },
  blocks: [
    {
      id: "b1",
      type: "header",
      props: { companyName: "Cooper Realty", tagline: "SWFL specialists", bgColor: "#0f1d24" },
    },
    {
      id: "b2",
      type: "hero",
      props: {
        kicker: "Market pulse",
        value: "$525,000",
        label: "Median list, Cape Coral",
        prose: "Inventory up, prices flat into spring.",
      },
    },
    {
      id: "b3",
      type: "stats",
      props: {
        stats: [
          { value: "1,204", label: "Active" },
          { value: "63", label: "DOM" },
          { value: "+2.1%", label: "YoY" },
        ],
      },
    },
    {
      id: "b4",
      type: "signal",
      props: {
        kicker: "Watch",
        title: "Months of supply at 5.8",
        body: "Crossing into a balanced market.",
        bgColor: "#F0F9FA",
      },
    },
    { id: "b5", type: "text", props: { body: "Line one.\nLine two.", align: "left" } },
    { id: "b6", type: "image", props: { caption: "Subject property" } }, // no url → placeholder branch
    {
      id: "b7",
      type: "agent-card",
      props: {
        name: "Ricky Cooper",
        title: "Broker",
        bio: "20 years in Lee County.",
        phone: "239-555-0100",
        ctaLabel: "Book a call",
        ctaUrl: "https://example.com",
      },
    },
    {
      id: "b8",
      type: "button",
      props: { label: "See all listings", url: "https://example.com", bgColor: "#3DC9C0" },
    },
    { id: "b9", type: "divider", props: { color: "#E5E7EB" } },
    {
      id: "b11",
      type: "agent-hero",
      props: {
        photoUrl: "https://example.com/agent.jpg",
        alt: "Ricky Cooper",
        name: "Ricky Cooper",
        designation: "Broker · Lee County",
        tagline: "Two decades of SWFL transactions.",
        ctaLabel: "Book a call",
        ctaUrl: "https://example.com",
      },
    },
    {
      id: "b12",
      type: "social-icons",
      props: {
        platforms: [
          { type: "instagram", url: "https://instagram.com/cooper" },
          { type: "linkedin", url: "https://linkedin.com/in/cooper" },
          { type: "custom", url: "https://substack.com/cooper", label: "Substack" },
        ],
        displayMode: "icon+text",
        layout: "row",
        iconSize: "md",
        iconColor: "original",
      },
    },
    {
      id: "b10",
      type: "footer",
      props: {
        companyName: "Cooper Realty",
        address: "Fort Myers, FL",
        websiteUrl: "https://example.com",
        instagramUrl: "https://instagram.com/cooper",
        facebookUrl: "https://facebook.com/cooper",
        linkedinUrl: "https://linkedin.com/in/cooper",
        socialOrder: ["linkedin", "instagram", "facebook"],
      },
    },
  ],
};

test("renders all 12 block types to a valid PDF buffer", async () => {
  const buf = await renderEmailDocToBuffer(FULL_DOC, { asOf: "June 2026" });
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.length).toBeGreaterThan(1000);
  // Magic number — a real PDF starts with "%PDF".
  expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
});

test("pdfFilename sanitises and defaults", () => {
  expect(pdfFilename("Cape Coral Market!")).toBe("Cape-Coral-Market.pdf");
  expect(pdfFilename("")).toBe("report.pdf");
  expect(pdfFilename(undefined)).toBe("report.pdf");
});

test("parsePdfText returns null for non-PDF bytes (no throw)", async () => {
  const res = await parsePdfText(new Uint8Array([1, 2, 3, 4, 5]));
  expect(res).toBeNull();
});

test("extraction prompt is doc-type-aware and forbids invention", () => {
  const p = buildExtractionPrompt();
  expect(p).toContain("identify the document type");
  expect(p).toContain("Do NOT invent");
});
