// lib/social/formats.ts
//
// Client-safe platform formats. Carved out of render-social-image.ts (which imports
// the native @resvg/resvg-js binary) so the browser composer + AI-fill can import sizes
// + aspect ratios without pulling resvg into the client bundle.

export const SOCIAL_FORMATS = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  landscape: { width: 1200, height: 630 },
  story: { width: 1080, height: 1920 },
} as const;

export type SocialFormat = keyof typeof SOCIAL_FORMATS;

export function isSocialFormat(v: unknown): v is SocialFormat {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SOCIAL_FORMATS, v);
}

/** Aspect-ratio string per format — the cron passes this to the publish adapters. */
export const FORMAT_RATIO: Record<SocialFormat, string> = {
  square: "1:1",
  portrait: "4:5",
  landscape: "1.91:1",
  story: "9:16",
};
