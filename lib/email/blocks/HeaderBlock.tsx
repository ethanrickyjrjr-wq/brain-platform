// lib/email/blocks/HeaderBlock.tsx — PURE (no "use client"). Logo + company name.
import { Section, Img, Text } from "@react-email/components";
import type { EmailGlobalStyle, HeaderProps } from "../doc/types";
import { fontStack, SECTION_PAD } from "./styles";

export function HeaderBlock({
  props,
  globalStyle,
}: {
  props: HeaderProps;
  globalStyle: EmailGlobalStyle;
}) {
  const font = fontStack(globalStyle.fontFamily);
  const bg = props.bgColor ?? globalStyle.primaryColor;
  return (
    <Section
      style={{
        backgroundColor: bg,
        padding: SECTION_PAD,
        borderBottom: `3px solid ${globalStyle.accentColor}`,
      }}
    >
      {props.logoUrl ? (
        <Img
          src={props.logoUrl}
          alt={props.companyName ?? ""}
          style={{ maxHeight: "42px", maxWidth: "180px", margin: "0 0 8px", display: "block" }}
        />
      ) : null}
      {props.companyName ? (
        <Text
          style={{
            fontFamily: font,
            fontSize: "18px",
            fontWeight: 700,
            color: "#ffffff",
            margin: 0,
          }}
        >
          {props.companyName}
        </Text>
      ) : null}
      {props.tagline ? (
        <Text
          style={{
            fontFamily: font,
            fontSize: "12px",
            color: globalStyle.accentColor,
            margin: "4px 0 0",
          }}
        >
          {props.tagline}
        </Text>
      ) : null}
    </Section>
  );
}
