// lib/email/blocks/StatsBlock.tsx — PURE. 2–3 KPI cells side by side.
import { Section, Row, Column, Text } from "@react-email/components";
import type { EmailGlobalStyle, StatsProps } from "../doc/types";
import { fontStack, SECTION_PAD, MUTED, BORDER, CARD_BG } from "./styles";

export function StatsBlock({
  props,
  globalStyle,
}: {
  props: StatsProps;
  globalStyle: EmailGlobalStyle;
}) {
  const font = fontStack(globalStyle.fontFamily);
  const stats = props.stats ?? [];
  return (
    <Section
      style={{
        backgroundColor: CARD_BG,
        padding: SECTION_PAD,
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      <Row>
        {stats.map((s, i) => (
          <Column key={i} style={{ textAlign: "center", padding: "8px" }}>
            <Text
              style={{
                fontFamily: font,
                fontSize: "26px",
                fontWeight: 700,
                color: globalStyle.primaryColor,
                margin: 0,
              }}
            >
              {s.value}
            </Text>
            <Text style={{ fontFamily: font, fontSize: "11px", color: MUTED, margin: "4px 0 0" }}>
              {s.label}
            </Text>
          </Column>
        ))}
      </Row>
    </Section>
  );
}
