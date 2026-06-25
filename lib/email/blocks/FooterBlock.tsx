// lib/email/blocks/FooterBlock.tsx — PURE. Company + address + contact + socials + unsubscribe.
import { Section, Text, Link, Hr } from "@react-email/components";
import type { EmailGlobalStyle, FooterProps } from "../doc/types";
import { PLATFORMS, platformMeta } from "../social/platforms";
import { SocialIcon } from "@/components/email-lab/social-icons";
import { fontStack, SECTION_PAD, MUTED, BORDER } from "./styles";

export function FooterBlock({
  props,
  globalStyle,
}: {
  props: FooterProps;
  globalStyle: EmailGlobalStyle;
}) {
  const font = fontStack(globalStyle.fontFamily);
  const hasContact = props.phone || props.email || props.websiteUrl;

  // Footer renders the 3 registry-mapped socials (IG/FB/LI) ordered by socialOrder
  // (registry default when unset), keeping those with a URL — same root the
  // standalone social-icons block uses. Footer is always icon+text.
  const order = props.socialOrder ?? PLATFORMS.filter((m) => m.footerPropKey).map((m) => m.type);
  const footerSocials = order
    .map((type) => {
      const meta = platformMeta(type);
      const url = meta.footerPropKey ? props[meta.footerPropKey] : undefined;
      return url && url.trim() ? { type, label: meta.label, url } : null;
    })
    .filter(
      (x): x is { type: (typeof PLATFORMS)[number]["type"]; label: string; url: string } =>
        x !== null,
    );

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

      {/* Social links — icon + text, ordered by socialOrder */}
      {footerSocials.length ? (
        <Text style={{ fontFamily: font, fontSize: "11px", margin: "0 0 8px" }}>
          {footerSocials.map((soc, i) => (
            <Link
              key={`${soc.type}-${i}`}
              href={soc.url}
              style={{
                color: globalStyle.accentColor,
                marginRight: "12px",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <SocialIcon
                type={soc.type}
                size={14}
                color={globalStyle.accentColor}
                label={soc.label}
              />
              {soc.label}
            </Link>
          ))}
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
