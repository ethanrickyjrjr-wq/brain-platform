// lib/email/blocks/DividerBlock.tsx — PURE. Horizontal rule.
import { Section, Hr } from "@react-email/components";
import type { DividerProps, EmailGlobalStyle } from "../doc/types";
import { CARD_BG, BORDER } from "./styles";

export function DividerBlock({ props }: { props: DividerProps; globalStyle: EmailGlobalStyle }) {
  return (
    <Section style={{ backgroundColor: CARD_BG, padding: "8px 24px" }}>
      <Hr style={{ borderColor: props.color ?? BORDER, margin: 0 }} />
    </Section>
  );
}
