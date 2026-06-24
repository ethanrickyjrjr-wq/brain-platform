// lib/email/blocks/FooterBlock.tsx — PURE. Company + address + website.
import { Section, Text, Link, Hr } from "@react-email/components";
import type { EmailGlobalStyle, FooterProps } from "../doc/types";
import { fontStack, SECTION_PAD, MUTED, BORDER } from "./styles";

export function FooterBlock({
  props,
  globalStyle,
}: {
  props: FooterProps;
  globalStyle: EmailGlobalStyle;
}) {
  const font = fontStack(globalStyle.fontFamily);
  return (
    <Section style={{ backgroundColor: "#F9FAFB", padding: SECTION_PAD }}>
      <Hr style={{ borderColor: BORDER, margin: "0 0 14px" }} />
      {props.companyName ? (
        <Text
          style={{
            fontFamily: font,
            fontSize: "11px",
            color: MUTED,
            margin: "0 0 4px",
            lineHeight: "1.6",
          }}
        >
          {props.companyName}
          {props.address ? (
            <>
              <br />
              {props.address}
            </>
          ) : null}
        </Text>
      ) : null}
      {props.websiteUrl ? (
        <Text style={{ fontFamily: font, fontSize: "11px", margin: "8px 0 0" }}>
          <Link href={props.websiteUrl} style={{ color: globalStyle.accentColor }}>
            {props.websiteUrl.replace(/^https?:\/\//, "")}
          </Link>
        </Text>
      ) : null}
    </Section>
  );
}
