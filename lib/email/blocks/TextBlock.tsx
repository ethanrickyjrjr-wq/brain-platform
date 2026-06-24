// lib/email/blocks/TextBlock.tsx — PURE. A paragraph of prose.
import { Section, Text } from "@react-email/components";
import type { EmailGlobalStyle, TextProps } from "../doc/types";
import { fontStack, SECTION_PAD, CARD_BG, BORDER } from "./styles";

export function TextBlock({
  props,
  globalStyle,
}: {
  props: TextProps;
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
      {props.body ? (
        <Text
          style={{
            fontFamily: font,
            fontSize: "15px",
            lineHeight: "1.7",
            color: globalStyle.textColor,
            textAlign: props.align ?? "left",
            margin: 0,
            whiteSpace: "pre-line",
          }}
        >
          {props.body}
        </Text>
      ) : null}
    </Section>
  );
}
