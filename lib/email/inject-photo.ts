// lib/email/inject-photo.ts
//
// Pure EmailDoc photo-block helpers — the piece that drops an auto-resolved hero
// PHOTO (a listing / property / agent-site image) into an email. Sibling of
// inject-chart.ts. No I/O: callers pass a resolved image URL (from og-image.ts or
// a RESO Media URL); these only mint a valid `image` block tagged kind:"photo"
// and place it at the top. All functions are pure — they return a NEW doc and
// never mutate the input.
//
// The kind:"photo" tag is what lets a photo and a chart coexist as two `image`
// blocks: upsertChartBlock skips kind:"photo", so the chart never overwrites the
// hero photo and vice-versa.

import { mintBlockId } from "./doc/schema";
import type { BlockOf, EmailDoc } from "./doc/types";

/** A fully-formed hero `image` block tagged kind:"photo". `linkUrl` makes the
 *  photo clickable — typically back to the listing / website it was pulled from,
 *  so the email behaves like a webpage (and the click is tracked at send). */
export function heroPhotoBlock(opts: {
  url: string;
  alt?: string;
  caption?: string;
  linkUrl?: string;
}): BlockOf<"image"> {
  return {
    id: mintBlockId(),
    type: "image",
    props: {
      url: opts.url,
      kind: "photo",
      ...(opts.alt !== undefined ? { alt: opts.alt } : {}),
      ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
      ...(opts.linkUrl ? { linkUrl: opts.linkUrl } : {}),
    },
  };
}

/**
 * Place a hero PHOTO into the doc, returning a NEW doc (no mutation):
 *   • If a kind:"photo" image already exists, replace its props in place (a
 *     re-render updates, never stacks).
 *   • Otherwise insert immediately AFTER the first `header` (so the photo leads
 *     the email, like the reference newsletters); no header → prepend.
 */
export function upsertHeroPhoto(doc: EmailDoc, block: BlockOf<"image">): EmailDoc {
  const existingIdx = doc.blocks.findIndex((b) => b.type === "image" && b.props.kind === "photo");
  if (existingIdx !== -1) {
    const blocks = doc.blocks.map((b, i) =>
      i === existingIdx
        ? ({ id: b.id, type: "image", props: { ...block.props } } satisfies BlockOf<"image">)
        : b,
    );
    return { ...doc, blocks };
  }

  const headerIdx = doc.blocks.findIndex((b) => b.type === "header");
  const blocks = [...doc.blocks];
  blocks.splice(headerIdx + 1, 0, block); // headerIdx === -1 → splice at 0 (prepend)
  return { ...doc, blocks };
}

/** The agent's saved brand website, read from the footer's `websiteUrl` (where
 *  applyBrand lands the WEBSITE_URL brand token). Used as the DEFAULT hero-photo
 *  source — a saved brand site means every email can get a picture without
 *  pasting a URL; a listing URL in the prompt still takes priority. */
export function brandWebsiteUrl(doc: EmailDoc): string | undefined {
  for (const b of doc.blocks) {
    if (b.type === "footer" && b.props.websiteUrl && b.props.websiteUrl.trim()) {
      return b.props.websiteUrl.trim();
    }
  }
  return undefined;
}
