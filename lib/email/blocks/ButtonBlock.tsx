// lib/email/blocks/ButtonBlock.tsx — PURE. Single centered CTA.
import { Section, Button } from "@react-email/components";
import type { ButtonProps, EmailGlobalStyle } from "../doc/types";
import { fontStack, SECTION_PAD, CARD_BG, BORDER } from "./styles";

export function ButtonBlock({
  props,
  globalStyle,
}: {
  props: ButtonProps;
  globalStyle: EmailGlobalStyle;
}) {
  const font = fontStack(globalStyle.fontFamily);
  if (!props.label) return null;
  const bg = props.bgColor ?? globalStyle.primaryColor;
  return (
    <Section
      style={{
        backgroundColor: CARD_BG,
        padding: SECTION_PAD,
        textAlign: "center",
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      <Button
        href={props.url || "#"}
        style={{
          backgroundColor: bg,
          color: "#ffffff",
          padding: "12px 28px",
          borderRadius: "6px",
          fontFamily: font,
          fontSize: "14px",
          fontWeight: 600,
          textDecoration: "none",
          display: "inline-block",
        }}
      >
        {props.label}
      </Button>
    </Section>
  );
}
