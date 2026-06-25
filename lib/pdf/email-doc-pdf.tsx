// lib/pdf/email-doc-pdf.tsx — THE single source of PDF visual truth.
//
// Renders an EmailDoc (the Email Lab block canvas) to a @react-pdf/renderer
// <Document>. This is the ONE place EmailDoc → PDF happens; the download route
// AND the blast attachment both render through here, so a block-rendering fix
// lands everywhere at once (single-root discipline — see lib/pdf/README.md).
//
// FIDELITY CONTRACT: every block type the email renders (BlockRenderer.tsx, 10
// types) must render here too, with every field. A `default: null` that silently
// drops agent-card / button / divider blocks is a regression — the audit test
// (lib/pdf/__tests__/email-doc-pdf.test.ts) asserts all 10 are handled.
//
// @react-pdf/renderer constraints honored below:
//  • Built-in fonts only (Helvetica / Times-Roman) — no network font fetch.
//  • Border longhand (borderBottomWidth/Color), not the CSS shorthand.
//  • No `gap` (spotty in flex) — cells use margins.
//  • <Page wrap> (default) flows long emails onto multiple pages automatically.
/* eslint-disable jsx-a11y/alt-text --
   The <Image> here is @react-pdf/renderer's PDF primitive, NOT an HTML <img>; it
   has no `alt` prop (adding one is a TS error). eslint-config-next maps any
   `Image` element to `img` by name, so the a11y rule mis-fires — disable it for
   this PDF-only file. */
import { Document, Page, View, Text, Image, Link, StyleSheet } from "@react-pdf/renderer";
import type { EmailBlock, EmailDoc, EmailGlobalStyle, FontFamily } from "@/lib/email/doc/types";
import { PLATFORMS, platformMeta, domainFromUrl } from "@/lib/email/social/platforms";

/** Map the doc's font family onto a @react-pdf built-in (no font registration). */
function pdfFont(family: FontFamily): string {
  return family === "BOOK_SERIF" ? "Times-Roman" : "Helvetica";
}

const BORDER = "#E5E7EB";
const MUTED = "#6B7280";
const CARD_BG = "#ffffff";

const s = StyleSheet.create({
  page: { backgroundColor: CARD_BG, paddingTop: 0, paddingBottom: 36, fontSize: 11 },
  // Section padding mirrors the email's "20px 24px".
  section: {
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  asOf: { paddingHorizontal: 28, paddingTop: 10, fontSize: 9, color: MUTED },
});

/** One block → its PDF view. Exhaustive over EmailBlock["type"] (all 10). */
function PdfBlock({ block, gs }: { block: EmailBlock; gs: EmailGlobalStyle }) {
  const font = pdfFont(gs.fontFamily);

  switch (block.type) {
    case "header": {
      const p = block.props;
      const bg = p.bgColor ?? gs.primaryColor;
      return (
        <View
          style={{
            backgroundColor: bg,
            paddingVertical: 16,
            paddingHorizontal: 28,
            borderBottomWidth: 3,
            borderBottomColor: gs.accentColor,
          }}
        >
          {p.logoUrl ? (
            <Image src={p.logoUrl} style={{ maxHeight: 42, maxWidth: 180, marginBottom: 8 }} />
          ) : null}
          {p.companyName ? (
            <Text style={{ fontFamily: font, fontSize: 18, fontWeight: "bold", color: "#ffffff" }}>
              {p.companyName}
            </Text>
          ) : null}
          {p.tagline ? (
            <Text style={{ fontFamily: font, fontSize: 12, color: gs.accentColor, marginTop: 4 }}>
              {p.tagline}
            </Text>
          ) : null}
        </View>
      );
    }

    case "hero": {
      const p = block.props;
      return (
        <View style={[s.section, { paddingVertical: 24 }]}>
          {p.kicker ? (
            <Text
              style={{
                fontFamily: font,
                fontSize: 10,
                fontWeight: "bold",
                color: gs.accentColor,
                letterSpacing: 1,
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              {p.kicker}
            </Text>
          ) : null}
          {p.value ? (
            <Text
              style={{ fontFamily: font, fontSize: 34, fontWeight: "bold", color: gs.primaryColor }}
            >
              {p.value}
            </Text>
          ) : null}
          {p.label ? (
            <Text style={{ fontFamily: font, fontSize: 12, color: MUTED, marginTop: 6 }}>
              {p.label}
            </Text>
          ) : null}
          {p.prose ? (
            <Text
              style={{
                fontFamily: font,
                fontSize: 13,
                lineHeight: 1.6,
                color: gs.textColor,
                marginTop: 12,
              }}
            >
              {p.prose}
            </Text>
          ) : null}
        </View>
      );
    }

    case "stats": {
      const stats = block.props.stats ?? [];
      return (
        <View style={[s.section, { flexDirection: "row" }]}>
          {stats.map((st, i) => (
            <View key={i} style={{ flex: 1, alignItems: "center", paddingHorizontal: 6 }}>
              <Text
                style={{
                  fontFamily: font,
                  fontSize: 22,
                  fontWeight: "bold",
                  color: gs.primaryColor,
                }}
              >
                {st.value}
              </Text>
              <Text
                style={{
                  fontFamily: font,
                  fontSize: 10,
                  color: MUTED,
                  marginTop: 4,
                  textAlign: "center",
                }}
              >
                {st.label}
              </Text>
            </View>
          ))}
        </View>
      );
    }

    case "signal": {
      const p = block.props;
      return (
        <View style={s.section}>
          <View
            style={{
              backgroundColor: p.bgColor ?? "#F0F9FA",
              borderLeftWidth: 4,
              borderLeftColor: gs.accentColor,
              borderRadius: 4,
              padding: 14,
            }}
          >
            {p.kicker ? (
              <Text
                style={{
                  fontFamily: font,
                  fontSize: 10,
                  fontWeight: "bold",
                  color: gs.accentColor,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                {p.kicker}
              </Text>
            ) : null}
            {p.title ? (
              <Text
                style={{
                  fontFamily: font,
                  fontSize: 14,
                  fontWeight: "bold",
                  color: gs.primaryColor,
                  marginBottom: 6,
                }}
              >
                {p.title}
              </Text>
            ) : null}
            {p.body ? (
              <Text
                style={{ fontFamily: font, fontSize: 12, lineHeight: 1.6, color: gs.textColor }}
              >
                {p.body}
              </Text>
            ) : null}
          </View>
        </View>
      );
    }

    case "text": {
      const p = block.props;
      if (!p.body) return <View style={s.section} />;
      return (
        <View style={s.section}>
          <Text
            style={{
              fontFamily: font,
              fontSize: 13,
              lineHeight: 1.7,
              color: gs.textColor,
              textAlign: p.align ?? "left",
            }}
          >
            {p.body}
          </Text>
        </View>
      );
    }

    case "image": {
      const p = block.props;
      return (
        <View style={{ borderBottomWidth: 1, borderBottomColor: BORDER }}>
          {p.url ? (
            <Image src={p.url} style={{ width: "100%" }} />
          ) : (
            <View style={{ paddingVertical: 40, alignItems: "center", backgroundColor: "#F3F4F6" }}>
              <Text style={{ fontFamily: font, fontSize: 12, color: MUTED }}>Image</Text>
            </View>
          )}
          {p.caption ? (
            <Text
              style={{
                fontFamily: font,
                fontSize: 11,
                color: MUTED,
                textAlign: "center",
                marginVertical: 8,
                paddingHorizontal: 28,
              }}
            >
              {p.caption}
            </Text>
          ) : null}
        </View>
      );
    }

    case "agent-card": {
      const p = block.props;
      return (
        <View style={[s.section, { flexDirection: "row" }]}>
          {p.photoUrl ? (
            <Image
              src={p.photoUrl}
              style={{ width: 64, height: 64, borderRadius: 32, marginRight: 14 }}
            />
          ) : null}
          <View style={{ flex: 1 }}>
            {p.name ? (
              <Text
                style={{
                  fontFamily: font,
                  fontSize: 14,
                  fontWeight: "bold",
                  color: gs.primaryColor,
                }}
              >
                {p.name}
              </Text>
            ) : null}
            {p.title ? (
              <Text style={{ fontFamily: font, fontSize: 11, color: MUTED, marginTop: 2 }}>
                {p.title}
              </Text>
            ) : null}
            {p.bio ? (
              <Text
                style={{
                  fontFamily: font,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: gs.textColor,
                  marginTop: 8,
                }}
              >
                {p.bio}
              </Text>
            ) : null}
            {p.phone ? (
              <Text style={{ fontFamily: font, fontSize: 11, color: MUTED, marginTop: 8 }}>
                {p.phone}
              </Text>
            ) : null}
            {p.ctaLabel && p.ctaUrl ? (
              <Link
                src={p.ctaUrl}
                style={{
                  fontFamily: font,
                  fontSize: 12,
                  fontWeight: "bold",
                  color: gs.accentColor,
                  marginTop: 8,
                }}
              >
                {p.ctaLabel} {"→"}
              </Link>
            ) : null}
          </View>
        </View>
      );
    }

    case "social-icons": {
      // @react-pdf has no HTML-SVG support, so the brand glyphs degrade to their
      // labels here (the spec's "icon + url text" fallback) — fidelity = every
      // link present, just text-only.
      const entries = (block.props.platforms ?? []).filter((e) => e.url.trim().length > 0);
      if (entries.length === 0) return <View style={s.section} />;
      const column = block.props.layout === "column";
      return (
        <View style={[s.section, { flexDirection: column ? "column" : "row", flexWrap: "wrap" }]}>
          {entries.map((e, i) => {
            const label =
              e.type === "custom"
                ? e.label || domainFromUrl(e.url) || "Link"
                : platformMeta(e.type).label;
            return (
              <Link
                key={i}
                src={e.url}
                style={{
                  fontFamily: font,
                  fontSize: 11,
                  color: gs.accentColor,
                  marginRight: column ? 0 : 14,
                  marginBottom: 4,
                }}
              >
                {label}
              </Link>
            );
          })}
        </View>
      );
    }

    case "button": {
      const p = block.props;
      if (!p.label) return null;
      const bg = p.bgColor ?? gs.primaryColor;
      const pill = {
        backgroundColor: bg,
        color: "#ffffff",
        paddingVertical: 11,
        paddingHorizontal: 26,
        borderRadius: 6,
        fontFamily: font,
        fontSize: 13,
        fontWeight: "bold" as const,
      };
      return (
        <View style={[s.section, { alignItems: "center" }]}>
          {p.url ? (
            <Link src={p.url} style={pill}>
              {p.label}
            </Link>
          ) : (
            <Text style={pill}>{p.label}</Text>
          )}
        </View>
      );
    }

    case "divider": {
      const p = block.props;
      return (
        <View style={{ paddingVertical: 8, paddingHorizontal: 28, backgroundColor: CARD_BG }}>
          <View style={{ borderBottomWidth: 1, borderBottomColor: p.color ?? BORDER }} />
        </View>
      );
    }

    case "agent-hero": {
      const p = block.props;
      return (
        <View style={[s.section, { backgroundColor: CARD_BG, padding: 0 }]}>
          {p.photoUrl ? (
            <Image src={p.photoUrl} style={{ width: "100%", height: 200, objectFit: "cover" }} />
          ) : (
            <View style={{ width: "100%", height: 200, backgroundColor: "#1a2e35" }} />
          )}
          <View
            style={{
              backgroundColor: gs.primaryColor,
              padding: 16,
              borderTopWidth: 3,
              borderTopColor: gs.accentColor,
            }}
          >
            {p.name ? (
              <Text
                style={{ fontFamily: font, fontSize: 18, fontWeight: "bold", color: "#ffffff" }}
              >
                {p.name}
              </Text>
            ) : null}
            {p.designation ? (
              <Text
                style={{
                  fontFamily: font,
                  fontSize: 10,
                  color: gs.accentColor,
                  marginTop: 4,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                {p.designation}
              </Text>
            ) : null}
          </View>
          {p.tagline || (p.ctaLabel && p.ctaUrl) ? (
            <View style={{ padding: 16 }}>
              {p.tagline ? (
                <Text style={{ fontFamily: font, fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
                  {p.tagline}
                </Text>
              ) : null}
              {p.ctaLabel && p.ctaUrl ? (
                <Link
                  src={p.ctaUrl}
                  style={{
                    fontFamily: font,
                    fontSize: 12,
                    fontWeight: "bold",
                    color: gs.accentColor,
                    marginTop: 8,
                  }}
                >
                  {p.ctaLabel} →
                </Link>
              ) : null}
            </View>
          ) : null}
        </View>
      );
    }

    case "footer": {
      const p = block.props;
      const contact = [p.phone, p.email, p.websiteUrl?.replace(/^https?:\/\//, "")]
        .filter(Boolean)
        .join(" · ");
      // Footer holds only the 3 registry-mapped socials (IG/FB/LI); order by
      // socialOrder (registry default when unset), keep those with a URL.
      const socialOrder =
        p.socialOrder ?? PLATFORMS.filter((m) => m.footerPropKey).map((m) => m.type);
      const footerSocials = socialOrder
        .map((type) => {
          const meta = platformMeta(type);
          const url = meta.footerPropKey
            ? (p[meta.footerPropKey] as string | undefined)
            : undefined;
          return url && url.trim() ? { label: meta.label, url } : null;
        })
        .filter((x): x is { label: string; url: string } => x !== null);
      return (
        <View style={{ backgroundColor: "#F9FAFB", paddingVertical: 16, paddingHorizontal: 28 }}>
          <View style={{ borderBottomWidth: 1, borderBottomColor: BORDER, marginBottom: 14 }} />
          {p.companyName ? (
            <Text style={{ fontFamily: font, fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
              {p.companyName}
              {p.address ? `\n${p.address}` : ""}
            </Text>
          ) : null}
          {contact ? (
            <Text style={{ fontFamily: font, fontSize: 10, color: MUTED, marginTop: 6 }}>
              {contact}
            </Text>
          ) : null}
          {footerSocials.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}>
              {footerSocials.map((soc, i) => (
                <Link
                  key={i}
                  src={soc.url}
                  style={{ fontFamily: font, fontSize: 10, color: gs.accentColor, marginRight: 12 }}
                >
                  {soc.label}
                </Link>
              ))}
            </View>
          ) : null}
          {p.unsubscribeUrl ? (
            <Link
              src={p.unsubscribeUrl}
              style={{
                fontFamily: font,
                fontSize: 9,
                color: MUTED,
                marginTop: 8,
                textDecoration: "underline",
              }}
            >
              Unsubscribe
            </Link>
          ) : null}
        </View>
      );
    }

    default: {
      // Exhaustiveness guard: a new BlockType must add a case above, or the build
      // fails here — so the PDF can never silently drop a block kind.
      const _never: never = block;
      void _never;
      return null;
    }
  }
}

/**
 * The full EmailDoc → PDF document. `asOf` (optional) prints a provenance line
 * at the foot (consumption-contract rule 5 — state the as-of date once).
 */
export function EmailDocPdf({ doc, asOf }: { doc: EmailDoc; asOf?: string }) {
  return (
    <Document>
      <Page size="LETTER" style={s.page} wrap>
        {doc.blocks.map((block) => (
          <PdfBlock key={block.id} block={block} gs={doc.globalStyle} />
        ))}
        {asOf ? <Text style={s.asOf}>As of {asOf}</Text> : null}
      </Page>
    </Document>
  );
}
