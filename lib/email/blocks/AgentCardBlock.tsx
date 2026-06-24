// lib/email/blocks/AgentCardBlock.tsx — PURE. Circular headshot + name + bio.
import { Section, Row, Column, Img, Text, Link } from "@react-email/components";
import type { AgentCardProps, EmailGlobalStyle } from "../doc/types";
import { fontStack, SECTION_PAD, MUTED, BORDER, CARD_BG } from "./styles";

export function AgentCardBlock({
  props,
  globalStyle,
}: {
  props: AgentCardProps;
  globalStyle: EmailGlobalStyle;
}) {
  const font = fontStack(globalStyle.fontFamily);
  return (
    <Section
      style={{
        backgroundColor: CARD_BG,
        padding: SECTION_PAD,
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      <Row>
        {props.photoUrl ? (
          <Column style={{ width: "76px", verticalAlign: "top" }}>
            <Img
              src={props.photoUrl}
              alt={props.name ?? ""}
              width={64}
              height={64}
              style={{ borderRadius: "50%", display: "block", objectFit: "cover" }}
            />
          </Column>
        ) : null}
        <Column style={{ verticalAlign: "top" }}>
          {props.name ? (
            <Text
              style={{
                fontFamily: font,
                fontSize: "15px",
                fontWeight: 700,
                color: globalStyle.primaryColor,
                margin: 0,
              }}
            >
              {props.name}
            </Text>
          ) : null}
          {props.title ? (
            <Text style={{ fontFamily: font, fontSize: "12px", color: MUTED, margin: "2px 0 0" }}>
              {props.title}
            </Text>
          ) : null}
          {props.bio ? (
            <Text
              style={{
                fontFamily: font,
                fontSize: "13px",
                lineHeight: "1.6",
                color: globalStyle.textColor,
                margin: "8px 0 0",
              }}
            >
              {props.bio}
            </Text>
          ) : null}
          {props.phone ? (
            <Text style={{ fontFamily: font, fontSize: "12px", color: MUTED, margin: "8px 0 0" }}>
              {props.phone}
            </Text>
          ) : null}
          {props.ctaLabel && props.ctaUrl ? (
            <Text style={{ margin: "8px 0 0" }}>
              <Link
                href={props.ctaUrl}
                style={{
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 600,
                  color: globalStyle.accentColor,
                }}
              >
                {props.ctaLabel} →
              </Link>
            </Text>
          ) : null}
        </Column>
      </Row>
    </Section>
  );
}
