// scripts/email/DigestEmail.tsx
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Row,
  Column,
  Text,
  Link,
  Hr,
  Img,
  Preview,
} from "@react-email/components";
import type { DigestPayload, MetricDelta, BrandTheme } from "./types.ts";
import { ZIP_FOCUS, resolveTheme } from "./types.ts";

// Fixed neutrals — never themed. Brand colors (primary/accent) come from `theme`.
const NEUTRAL = {
  sand: "#F5E6C8",
  bg: "#F7F9FB",
  text: "#1A1A2E",
  muted: "#6B7280",
  border: "#E5E7EB",
};
const F = "Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif";
const fmtPrice = (v: number | null) => (v === null ? "—" : `$${Math.round(v / 1000)}k`);
const fmtDom = (v: number | null) => (v === null ? "—" : `${Math.round(v)}d`);
const fmtMos = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} mo`);

const TOPIC_BADGE: Record<string, string> = {
  breaking: "🔴 BREAKING",
  transactions: "📋 DEAL",
  development: "🏗 BUILD",
  business: "💼 BIZ",
  structural: "📊 DATA",
};

export interface DigestEmailProps {
  payload: DigestPayload;
  escalations: MetricDelta[];
  deltaText: string;
  subject: string;
  unsubscribeUrl: string;
  issue: number;
  senderName: string;
  senderAddress: string;
  senderContact: string;
  /**
   * White-label brand. Omit → SWFL house colors (navy/teal, no logo image).
   * Same shape as lib/deliverable/brand-theme.ts `BrandTheme`, so the funnel's
   * extractBrandTheme() output (Brandfetch / manual blob) drops in unchanged.
   */
  theme?: BrandTheme | null;
}

export function DigestEmail({
  payload,
  escalations,
  deltaText,
  subject,
  unsubscribeUrl,
  issue,
  senderName,
  senderAddress,
  senderContact,
  theme,
}: DigestEmailProps) {
  const { primary, accent, logoUrl } = resolveTheme(theme);
  const escMap = new Map(escalations.map((d) => [d.metric, d]));

  return (
    <Html lang="en">
      <Head />
      <Preview>{subject}</Preview>
      <Body style={{ backgroundColor: NEUTRAL.bg, margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: "600px", margin: "0 auto", backgroundColor: "#fff" }}>
          {/* 1. HEADER */}
          <Section
            style={{
              backgroundColor: primary,
              padding: "20px 24px",
              borderBottom: `3px solid ${accent}`,
            }}
          >
            {logoUrl && (
              <Img
                src={logoUrl}
                alt={senderName}
                style={{
                  maxHeight: "42px",
                  maxWidth: "160px",
                  margin: "0 0 8px",
                  display: "block",
                }}
              />
            )}
            <Text
              style={{
                fontFamily: F,
                fontSize: "18px",
                fontWeight: "700",
                color: "#fff",
                margin: 0,
              }}
            >
              SWFL DATA GULF INTEL
            </Text>
            <Text style={{ fontFamily: F, fontSize: "12px", color: accent, margin: "4px 0 0" }}>
              {payload.date} · Issue #{issue} · 33908 + Lee County
              {payload.freshness_manifest.source_env === "preview" ? " · [PREVIEW]" : ""}
            </Text>
          </Section>

          {/* 2. TOP LINE */}
          <Section style={{ padding: "20px 24px", borderBottom: `1px solid ${NEUTRAL.border}` }}>
            <Text
              style={{
                fontFamily: F,
                fontSize: "11px",
                fontWeight: "700",
                color: accent,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                margin: "0 0 8px",
              }}
            >
              Lee County Market Pulse
            </Text>
            <Text
              style={{
                fontFamily: F,
                fontSize: "15px",
                lineHeight: "1.6",
                color: NEUTRAL.text,
                margin: 0,
              }}
            >
              {payload.top_line}
            </Text>
            <Text
              style={{ fontFamily: F, fontSize: "10px", color: NEUTRAL.muted, margin: "6px 0 0" }}
            >
              master brain · as of {payload.freshness_manifest.master.as_of}
            </Text>
          </Section>

          {/* 3. ZIP FOCUS */}
          <Section style={{ padding: "20px 24px", borderBottom: `1px solid ${NEUTRAL.border}` }}>
            <Text
              style={{
                fontFamily: F,
                fontSize: "11px",
                fontWeight: "700",
                color: accent,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                margin: "0 0 12px",
              }}
            >
              ZIP Focus: 33908 + Nearby
            </Text>
            {/* Header row */}
            <Row style={{ backgroundColor: primary }}>
              {["ZIP", "Med Price", "DOM", "Mo Supply"].map((h) => (
                <Column
                  key={h}
                  style={{
                    padding: "5px 8px",
                    fontFamily: F,
                    fontSize: "11px",
                    fontWeight: "700",
                    color: "#fff",
                  }}
                >
                  {h}
                </Column>
              ))}
            </Row>
            {ZIP_FOCUS.map((zip, i) => {
              const m = payload.zip_metrics[zip];
              if (!m) return null;
              const priceEsc = escMap.get("median_sale_price");
              const bold = priceEsc?.is_escalation ? { fontWeight: "700" as const } : {};
              return (
                <Row
                  key={zip}
                  style={{
                    backgroundColor: i % 2 === 0 ? "#fff" : "#F9FAFB",
                    borderBottom: `1px solid ${NEUTRAL.border}`,
                  }}
                >
                  <Column
                    style={{
                      padding: "6px 8px",
                      fontFamily: F,
                      fontSize: "13px",
                      fontWeight: "600",
                    }}
                  >
                    {zip}
                  </Column>
                  <Column style={{ padding: "6px 8px", fontFamily: F, fontSize: "13px", ...bold }}>
                    {fmtPrice(m.median_sale_price)}
                  </Column>
                  <Column style={{ padding: "6px 8px", fontFamily: F, fontSize: "13px" }}>
                    {fmtDom(m.dom)}
                  </Column>
                  <Column style={{ padding: "6px 8px", fontFamily: F, fontSize: "13px" }}>
                    {fmtMos(m.months_of_supply)}
                  </Column>
                </Row>
              );
            })}
            <Text
              style={{ fontFamily: F, fontSize: "10px", color: NEUTRAL.muted, margin: "6px 0 0" }}
            >
              housing-swfl · period beginning {payload.freshness_manifest.housing_swfl.period_begin}
            </Text>
          </Section>

          {/* 4. LEE COUNTY SNAPSHOT */}
          <Section
            style={{
              padding: "20px 24px",
              backgroundColor: "#F0F9FA",
              borderBottom: `1px solid ${NEUTRAL.border}`,
            }}
          >
            <Text
              style={{
                fontFamily: F,
                fontSize: "11px",
                fontWeight: "700",
                color: accent,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                margin: "0 0 12px",
              }}
            >
              Lee County Snapshot
            </Text>
            <Row>
              {[
                { label: "Median Price", val: fmtPrice(payload.county_metrics.median_sale_price) },
                { label: "Median DOM", val: fmtDom(payload.county_metrics.dom) },
                { label: "Mo Supply", val: fmtMos(payload.county_metrics.months_of_supply) },
              ].map(({ label, val }) => (
                <Column key={label} style={{ textAlign: "center", padding: "8px" }}>
                  <Text
                    style={{
                      fontFamily: F,
                      fontSize: "22px",
                      fontWeight: "700",
                      color: primary,
                      margin: 0,
                    }}
                  >
                    {val}
                  </Text>
                  <Text
                    style={{
                      fontFamily: F,
                      fontSize: "11px",
                      color: NEUTRAL.muted,
                      margin: "2px 0 0",
                    }}
                  >
                    {label}
                  </Text>
                </Column>
              ))}
            </Row>
          </Section>

          {/* 5. CITY VOICES — omitted if empty (EMAIL.md Rule 2) */}
          {payload.city_voices.length > 0 && (
            <Section style={{ padding: "20px 24px", borderBottom: `1px solid ${NEUTRAL.border}` }}>
              <Text
                style={{
                  fontFamily: F,
                  fontSize: "11px",
                  fontWeight: "700",
                  color: accent,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  margin: "0 0 12px",
                }}
              >
                City Voices
              </Text>
              {payload.city_voices.map((s, i) => (
                <Row key={i} style={{ marginBottom: "8px" }}>
                  <Column>
                    <Text
                      style={{
                        fontFamily: F,
                        fontSize: "11px",
                        fontWeight: "700",
                        color: primary,
                        margin: "0 0 2px",
                      }}
                    >
                      {TOPIC_BADGE[s.topic] ?? s.topic.toUpperCase()} — {s.city}
                    </Text>
                    <Text
                      style={{ fontFamily: F, fontSize: "13px", color: NEUTRAL.text, margin: 0 }}
                    >
                      {s.title}{" "}
                      {s.source_url && (
                        <Link href={s.source_url} style={{ color: accent, fontSize: "11px" }}>
                          [source]
                        </Link>
                      )}
                    </Text>
                  </Column>
                </Row>
              ))}
              <Text
                style={{ fontFamily: F, fontSize: "10px", color: NEUTRAL.muted, margin: "6px 0 0" }}
              >
                city-pulse-swfl · as of {payload.freshness_manifest.city_pulse.as_of}
              </Text>
            </Section>
          )}

          {/* 6. DELTA */}
          {deltaText && (
            <Section
              style={{
                padding: "20px 24px",
                backgroundColor: "#FFFBEB",
                borderBottom: `1px solid ${NEUTRAL.border}`,
              }}
            >
              <Text
                style={{
                  fontFamily: F,
                  fontSize: "11px",
                  fontWeight: "700",
                  color: "#92400E",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  margin: "0 0 8px",
                }}
              >
                What Changed
              </Text>
              <Text
                style={{
                  fontFamily: F,
                  fontSize: "13px",
                  lineHeight: "1.6",
                  color: NEUTRAL.text,
                  margin: 0,
                  whiteSpace: "pre-line",
                }}
              >
                {deltaText}
              </Text>
            </Section>
          )}

          {/* HISTORICAL HOOK (old section 7) is CUT for V1 — revision #1.
              It returned a hardcoded string = invented data (EMAIL.md Rule 4).
              Re-add only when historical ZIP-grain rows exist and the value is
              READ from the lake, not written. */}

          {/* CTA */}
          <Section
            style={{
              padding: "20px 24px",
              textAlign: "center",
              borderBottom: `1px solid ${NEUTRAL.border}`,
            }}
          >
            <Link
              href="https://swfldatagulf.com/r/housing-swfl"
              style={{
                backgroundColor: primary,
                color: "#fff",
                padding: "12px 28px",
                borderRadius: "6px",
                fontFamily: F,
                fontSize: "14px",
                fontWeight: "600",
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              View Full Report →
            </Link>
          </Section>

          {/* 7. FOOTER */}
          <Section style={{ padding: "20px 24px", backgroundColor: "#F9FAFB" }}>
            <Hr style={{ borderColor: NEUTRAL.border, margin: "0 0 14px" }} />
            <Text
              style={{
                fontFamily: F,
                fontSize: "11px",
                color: NEUTRAL.muted,
                margin: "0 0 4px",
                lineHeight: "1.6",
              }}
            >
              {senderName}
              <br />
              {senderAddress}
              <br />
              {senderContact} · hello@swfldatagulf.com
            </Text>
            <Text
              style={{ fontFamily: F, fontSize: "11px", color: NEUTRAL.muted, margin: "8px 0 0" }}
            >
              Data sourced from{" "}
              <Link href="https://swfldatagulf.com" style={{ color: accent }}>
                swfldatagulf.com
              </Link>
              . You received this because you subscribed at swfldatagulf.com.
            </Text>
            <Text style={{ fontFamily: F, fontSize: "11px", margin: "6px 0 0" }}>
              <Link href={unsubscribeUrl} style={{ color: NEUTRAL.muted }}>
                Unsubscribe
              </Link>
              {" · "}
              <Link href="https://swfldatagulf.com/privacy" style={{ color: NEUTRAL.muted }}>
                Privacy Policy
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
