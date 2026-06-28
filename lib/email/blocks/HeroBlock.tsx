// lib/email/blocks/HeroBlock.tsx — PURE. Big number / kicker / prose.
import { Link, Section, Text } from "@react-email/components";
import type { EmailGlobalStyle, HeroProps } from "../doc/types";
import { fontStack, MUTED, BORDER, CARD_BG } from "./styles";

export function HeroBlock({
  props,
  globalStyle,
}: {
  props: HeroProps;
  globalStyle: EmailGlobalStyle;
}) {
  const font = fontStack(globalStyle.fontFamily);
  const inner = (
    <Section
      style={{
        backgroundColor: CARD_BG,
        padding: "28px 24px",
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      {props.kicker ? (
        <Text
          style={{
            fontFamily: font,
            fontSize: "11px",
            fontWeight: 700,
            color: globalStyle.accentColor,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            margin: "0 0 8px",
          }}
        >
          {props.kicker}
        </Text>
      ) : null}
      {props.value ? (
        <Text
          style={{
            fontFamily: font,
            fontSize: "40px",
            lineHeight: "1.1",
            fontWeight: 700,
            color: globalStyle.primaryColor,
            margin: 0,
          }}
        >
          {props.value}
        </Text>
      ) : null}
      {props.label ? (
        <Text style={{ fontFamily: font, fontSize: "13px", color: MUTED, margin: "6px 0 0" }}>
          {props.label}
        </Text>
      ) : null}
      {props.prose ? (
        <Text
          style={{
            fontFamily: font,
            fontSize: "15px",
            lineHeight: "1.6",
            color: globalStyle.textColor,
            margin: "14px 0 0",
          }}
        >
          {props.prose}
        </Text>
      ) : null}
    </Section>
  );
  if (!props.linkUrl) return inner;
  return (
    <Link href={props.linkUrl} style={{ display: "block", textDecoration: "none" }}>
      {inner}
    </Link>
  );
}
