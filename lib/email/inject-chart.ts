// lib/email/inject-chart.ts
//
// Pure EmailDoc chart-block helpers (NO I/O) — the piece that lets the builder
// drop a rendered chart into an email. No fetching, no rendering: callers pass a
// resolved image URL; these helpers only mint a valid `image` block and place it
// in the doc. All functions are pure — `upsertChartBlock` returns a NEW doc and
// never mutates its input (the canvas state is treated as immutable).
//
// Shapes are taken verbatim from ./doc/types.ts + ./doc/schema.ts:
//   • An `image` block is { id, type: "image", props: ImageProps }
//   • ImageProps = { url?, alt?, caption? }
//   • mintBlockId() is the repo-canonical id generator (./doc/schema.ts).

import { mintBlockId } from "./doc/schema";
import type { BlockOf, EmailDoc } from "./doc/types";

/** A fully-formed `image` block carrying a chart. `caption` is included only
 *  when supplied (it is optional in ImageProps). */
export function chartImageBlock(opts: {
  url: string;
  alt: string;
  caption?: string;
  /** Optional click-through — makes the chart a link (e.g. to the agent's site
   *  or the full report). Rendered as an <a> by ImageBlock; tracked at send. */
  linkUrl?: string;
}): BlockOf<"image"> {
  return {
    id: mintBlockId(),
    type: "image",
    props: {
      url: opts.url,
      alt: opts.alt,
      kind: "chart",
      ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
      ...(opts.linkUrl ? { linkUrl: opts.linkUrl } : {}),
    },
  };
}

/**
 * Place a chart `image` block into the doc, returning a NEW doc (no mutation):
 *   • If an `image` block already exists, replace its props with `block.props`
 *     (id and position preserved — a re-render updates in place, never stacks).
 *   • Otherwise insert `block` immediately AFTER the first `hero` block; if there
 *     is no hero, after the first `header`; if neither, append to the end.
 */
export function upsertChartBlock(doc: EmailDoc, block: BlockOf<"image">): EmailDoc {
  // Target ONLY the chart's own slot: a kind:"chart" image, or a legacy untagged
  // chart PNG (url under /email-charts/). NEVER a photo — uploaded (untagged,
  // /email-media/), auto-pulled (kind:"photo"), or hand-placed — so a re-render
  // updates the chart in place and can never clobber a picture. None → insert.
  const existingIdx = doc.blocks.findIndex(
    (b) =>
      b.type === "image" &&
      (b.props.kind === "chart" ||
        (b.props.kind == null && (b.props.url ?? "").includes("/email-charts/"))),
  );

  if (existingIdx !== -1) {
    const blocks = doc.blocks.map((b, i) =>
      i === existingIdx
        ? ({ id: b.id, type: "image", props: { ...block.props } } satisfies BlockOf<"image">)
        : b,
    );
    return { ...doc, blocks };
  }

  const heroIdx = doc.blocks.findIndex((b) => b.type === "hero");
  const headerIdx = doc.blocks.findIndex((b) => b.type === "header");
  const anchorIdx = heroIdx !== -1 ? heroIdx : headerIdx;

  const blocks = [...doc.blocks];
  if (anchorIdx === -1) {
    blocks.push(block);
  } else {
    blocks.splice(anchorIdx + 1, 0, block);
  }
  return { ...doc, blocks };
}
