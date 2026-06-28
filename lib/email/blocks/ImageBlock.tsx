// lib/email/blocks/ImageBlock.tsx — PURE. Full-width photo + caption.
import { Img, Link, Section, Text } from "@react-email/components";
import type { EmailGlobalStyle, ImageProps } from "../doc/types";
import { fontStack, MUTED, CARD_BG, BORDER } from "./styles";

export function ImageBlock({
  props,
  globalStyle,
}: {
  props: ImageProps;
  globalStyle: EmailGlobalStyle;
}) {
  const font = fontStack(globalStyle.fontFamily);
  const imgEl = props.url ? (
    <Img
      src={props.url}
      alt={props.alt ?? ""}
      style={{ width: "100%", maxWidth: "600px", display: "block", margin: 0 }}
    />
  ) : (
    <Section
      style={{
        padding: "48px 24px",
        textAlign: "center",
        backgroundColor: "#F3F4F6",
        border: `1px dashed ${BORDER}`,
      }}
    >
      <Text style={{ fontFamily: font, fontSize: "13px", color: MUTED, margin: 0 }}>Image</Text>
    </Section>
  );
  return (
    <Section style={{ backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}` }}>
      {props.linkUrl ? (
        <Link href={props.linkUrl} style={{ display: "block" }}>
          {imgEl}
        </Link>
      ) : (
        imgEl
      )}
      {props.caption ? (
        <Text
          style={{
            fontFamily: font,
            fontSize: "12px",
            color: MUTED,
            textAlign: "center",
            margin: "8px 0",
            padding: "0 24px",
          }}
        >
          {props.caption}
        </Text>
      ) : null}
    </Section>
  );
}
