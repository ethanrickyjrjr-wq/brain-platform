// lib/email/blocks/FooterBlock.tsx — PURE. Company + address + contact + socials + unsubscribe.
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
  const hasSocials = props.instagramUrl || props.facebookUrl || props.linkedinUrl;
  const hasContact = props.phone || props.email || props.websiteUrl;

  return (
    <Section style={{ backgroundColor: "#F9FAFB", padding: SECTION_PAD }}>
      <Hr style={{ borderColor: BORDER, margin: "0 0 14px" }} />

      {/* Company + address */}
      {props.companyName || props.address ? (
        <Text
          style={{
            fontFamily: font,
            fontSize: "11px",
            color: MUTED,
            margin: "0 0 6px",
            lineHeight: "1.6",
          }}
        >
          {props.companyName ?? ""}
          {props.address ? (
            <>
              <br />
              {props.address}
            </>
          ) : null}
        </Text>
      ) : null}

      {/* Contact line — phone · email · website */}
      {hasContact ? (
        <Text
          style={{
            fontFamily: font,
            fontSize: "11px",
            color: MUTED,
            margin: "0 0 6px",
            lineHeight: "1.6",
          }}
        >
          {[
            props.phone,
            props.email,
            props.websiteUrl ? props.websiteUrl.replace(/^https?:\/\//, "") : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}

      {/* Social links */}
      {hasSocials ? (
        <Text style={{ fontFamily: font, fontSize: "11px", margin: "0 0 8px" }}>
          {props.instagramUrl ? (
            <Link
              href={props.instagramUrl}
              style={{ color: globalStyle.accentColor, marginRight: "10px" }}
            >
              Instagram
            </Link>
          ) : null}
          {props.facebookUrl ? (
            <Link
              href={props.facebookUrl}
              style={{ color: globalStyle.accentColor, marginRight: "10px" }}
            >
              Facebook
            </Link>
          ) : null}
          {props.linkedinUrl ? (
            <Link href={props.linkedinUrl} style={{ color: globalStyle.accentColor }}>
              LinkedIn
            </Link>
          ) : null}
        </Text>
      ) : null}

      {/* Unsubscribe — always rendered when set; legally required */}
      <Text style={{ fontFamily: font, fontSize: "10px", color: MUTED, margin: "8px 0 0" }}>
        {props.unsubscribeUrl ? (
          <Link href={props.unsubscribeUrl} style={{ color: MUTED, textDecoration: "underline" }}>
            Unsubscribe
          </Link>
        ) : (
          <span style={{ opacity: 0.5 }}>
            Unsubscribe link required — add URL in footer settings
          </span>
        )}
      </Text>
    </Section>
  );
}
