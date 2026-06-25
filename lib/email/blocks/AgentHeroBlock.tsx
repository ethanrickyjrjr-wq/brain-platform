// lib/email/blocks/AgentHeroBlock.tsx — PURE.
// Full-bleed rectangular agent photo (banner height) + brand-colored name strip below.
// Designed for browser canvas + PDF print — NOT circle, not sidebar.
import { Section, Img, Text, Link } from "@react-email/components";
import type { AgentHeroProps, EmailGlobalStyle } from "../doc/types";
import { fontStack, CARD_BG, BORDER, MUTED } from "./styles";

const PHOTO_HEIGHT = 300;
const PLACEHOLDER_BG = "#1a2e35";

export function AgentHeroBlock({
  props,
  globalStyle,
}: {
  props: AgentHeroProps;
  globalStyle: EmailGlobalStyle;
}) {
  const font = fontStack(globalStyle.fontFamily);
  return (
    <Section style={{ backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}` }}>
      {/* Photo banner — full 600px wide, fixed height, object-fit cover */}
      {props.photoUrl ? (
        <Img
          src={props.photoUrl}
          alt={props.alt ?? props.name ?? ""}
          style={{
            width: "100%",
            maxWidth: "600px",
            height: `${PHOTO_HEIGHT}px`,
            display: "block",
            margin: 0,
            objectFit: "cover",
            objectPosition: "center top",
          }}
        />
      ) : (
        <Section
          style={{
            height: `${PHOTO_HEIGHT}px`,
            backgroundColor: PLACEHOLDER_BG,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: font, fontSize: "13px", color: "#ffffff50", margin: 0 }}>
            Agent photo
          </Text>
        </Section>
      )}

      {/* Brand-colored name strip */}
      <Section
        style={{
          backgroundColor: globalStyle.primaryColor,
          padding: "18px 24px",
          borderTop: `3px solid ${globalStyle.accentColor}`,
        }}
      >
        {props.name ? (
          <Text
            style={{
              fontFamily: font,
              fontSize: "22px",
              fontWeight: 800,
              color: "#ffffff",
              margin: "0 0 4px",
              letterSpacing: "-0.3px",
            }}
          >
            {props.name}
          </Text>
        ) : null}
        {props.designation ? (
          <Text
            style={{
              fontFamily: font,
              fontSize: "12px",
              fontWeight: 600,
              color: globalStyle.accentColor,
              margin: 0,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {props.designation}
          </Text>
        ) : null}
      </Section>

      {/* Tagline + CTA */}
      {props.tagline || (props.ctaLabel && props.ctaUrl) ? (
        <Section style={{ padding: "16px 24px", borderBottom: `1px solid ${BORDER}` }}>
          {props.tagline ? (
            <Text
              style={{
                fontFamily: font,
                fontSize: "14px",
                lineHeight: "1.6",
                color: MUTED,
                margin: "0 0 10px",
              }}
            >
              {props.tagline}
            </Text>
          ) : null}
          {props.ctaLabel && props.ctaUrl ? (
            <Text style={{ margin: 0 }}>
              <Link
                href={props.ctaUrl}
                style={{
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 700,
                  color: globalStyle.accentColor,
                  textDecoration: "none",
                }}
              >
                {props.ctaLabel} →
              </Link>
            </Text>
          ) : null}
        </Section>
      ) : null}
    </Section>
  );
}
