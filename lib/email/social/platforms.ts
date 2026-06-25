// lib/email/social/platforms.ts
//
// THE one root for social platforms. PURE data — imports only the KnownPlatform
// type from ../doc/types (which imports from no one). Everything that renders,
// labels, colors, detects, or brand-fills a social link reads from here:
//   • FooterBlock's social row (lib/email/blocks/FooterBlock.tsx)
//   • the standalone social-icons block (lib/email/blocks/SocialIconsBlock.tsx)
//   • the icon registry (components/email-lab/social-icons/index.tsx)
//   • applyBrand token-fill (components/email-lab/EmailLabShell.tsx)
//   • the BrandingBlock "Connect Socials" form
//
// Add a platform in EXACTLY one place — append an entry below. The icon registry
// is keyed by `KnownPlatform`, so a new platform needs its icon component added
// there too (TypeScript flags the missing key).

import type { KnownPlatform } from "../doc/types";

export interface PlatformMeta {
  type: KnownPlatform;
  /** Display label ("X (Twitter)" etc.). */
  label: string;
  /** Brand color used for the "original" icon color and footer link color. */
  brandColor: string;
  /** applyBrand token key (uppercase) — see EmailLabShell.applyBrand. */
  tokenKey: string;
  /** projects.branding / user_brand_profiles column name (lowercase). */
  brandingKey: string;
  /** Footer holds only these three discrete URL props; the rest live only in the
   *  standalone social-icons block. undefined → not rendered by the footer. */
  footerPropKey?: "instagramUrl" | "facebookUrl" | "linkedinUrl";
  /** Hostnames that identify a pasted URL as this platform (for "add your own"). */
  domains: string[];
  /** Example URL shown as the form input placeholder. */
  placeholder: string;
}

// Registry order = the default render/listing order.
export const PLATFORMS: readonly PlatformMeta[] = [
  {
    type: "instagram",
    label: "Instagram",
    brandColor: "#E4405F",
    tokenKey: "INSTAGRAM_URL",
    brandingKey: "instagram_url",
    footerPropKey: "instagramUrl",
    domains: ["instagram.com"],
    placeholder: "https://instagram.com/yourhandle",
  },
  {
    type: "facebook",
    label: "Facebook",
    brandColor: "#1877F2",
    tokenKey: "FACEBOOK_URL",
    brandingKey: "facebook_url",
    footerPropKey: "facebookUrl",
    domains: ["facebook.com", "fb.com"],
    placeholder: "https://facebook.com/yourpage",
  },
  {
    type: "linkedin",
    label: "LinkedIn",
    brandColor: "#0A66C2",
    tokenKey: "LINKEDIN_URL",
    brandingKey: "linkedin_url",
    footerPropKey: "linkedinUrl",
    domains: ["linkedin.com", "lnkd.in"],
    placeholder: "https://linkedin.com/in/you",
  },
  {
    type: "x",
    label: "X (Twitter)",
    brandColor: "#000000",
    tokenKey: "X_URL",
    brandingKey: "x_url",
    domains: ["x.com", "twitter.com"],
    placeholder: "https://x.com/yourhandle",
  },
  {
    type: "tiktok",
    label: "TikTok",
    brandColor: "#000000",
    tokenKey: "TIKTOK_URL",
    brandingKey: "tiktok_url",
    domains: ["tiktok.com"],
    placeholder: "https://tiktok.com/@yourhandle",
  },
  {
    type: "youtube",
    label: "YouTube",
    brandColor: "#FF0000",
    tokenKey: "YOUTUBE_URL",
    brandingKey: "youtube_url",
    domains: ["youtube.com", "youtu.be"],
    placeholder: "https://youtube.com/@yourchannel",
  },
  {
    type: "pinterest",
    label: "Pinterest",
    brandColor: "#E60023",
    tokenKey: "PINTEREST_URL",
    brandingKey: "pinterest_url",
    domains: ["pinterest.com", "pin.it"],
    placeholder: "https://pinterest.com/yourname",
  },
  {
    type: "threads",
    label: "Threads",
    brandColor: "#000000",
    tokenKey: "THREADS_URL",
    brandingKey: "threads_url",
    domains: ["threads.net", "threads.com"],
    placeholder: "https://threads.net/@yourhandle",
  },
] as const;

/** Ordered list of the 8 known platform keys. */
export const KNOWN_PLATFORMS: readonly KnownPlatform[] = PLATFORMS.map((p) => p.type);

const BY_TYPE: Record<KnownPlatform, PlatformMeta> = Object.fromEntries(
  PLATFORMS.map((p) => [p.type, p]),
) as Record<KnownPlatform, PlatformMeta>;

/** Registry entry for a known platform. */
export function platformMeta(type: KnownPlatform): PlatformMeta {
  return BY_TYPE[type];
}

/** Bare hostname (lowercased, no `www.`) from a pasted URL, or null if unparseable. */
export function domainFromUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Match a pasted URL to a known platform by hostname, else null (→ "custom"). */
export function detectPlatform(url: string): KnownPlatform | null {
  const host = domainFromUrl(url);
  if (!host) return null;
  for (const p of PLATFORMS) {
    if (p.domains.some((d) => host === d || host.endsWith(`.${d}`))) return p.type;
  }
  return null;
}
