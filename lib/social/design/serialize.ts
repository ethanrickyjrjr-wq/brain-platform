// lib/social/design/serialize.ts
import type { SocialFormat } from "@/lib/social/formats";
import type { SocialDesign, SocialElement } from "@/lib/social/design/types";

export function newDesign(format: SocialFormat): SocialDesign {
  return { version: 1, format, background: "#0f1d24", elements: [] };
}

export function serializeDesign(d: SocialDesign): string {
  return JSON.stringify(d);
}

/** Parse + minimal shape-guard. Returns null on anything that isn't a v1 design. */
export function deserializeDesign(s: string): SocialDesign | null {
  let o: unknown;
  try {
    o = JSON.parse(s);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const d = o as Record<string, unknown>;
  if (d.version !== 1) return null;
  if (typeof d.format !== "string") return null;
  if (!Array.isArray(d.elements)) return null;
  return d as unknown as SocialDesign;
}

/** Text fields the AI may write, per element type. The ONLY surface the patch can touch. */
const TEXT_FIELDS: Partial<Record<SocialElement["type"], readonly string[]>> = {
  text: ["text"],
  stat: ["value", "label"],
  cta: ["text"],
};

/** element id -> { type, <current text fields> } — matches the email docSkeleton shape. */
export function designToSkeleton(d: SocialDesign): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const el of d.elements) {
    const fields = TEXT_FIELDS[el.type];
    if (!fields) continue;
    const rec: Record<string, string> = { type: el.type };
    for (const f of fields) {
      const v = (el as unknown as Record<string, unknown>)[f];
      if (typeof v === "string") rec[f] = v;
    }
    out[el.id] = rec;
  }
  return out;
}

/**
 * Apply an AI patch (element id -> { field: value }) to TEXT FIELDS ONLY. Geometry,
 * colors, images, urls, and unknown ids are never touched. Returns a new design.
 */
export function applyDesignPatch(
  d: SocialDesign,
  patch: Record<string, Record<string, unknown>>,
): SocialDesign {
  const elements = d.elements.map((el) => {
    const p = patch[el.id];
    const fields = TEXT_FIELDS[el.type];
    if (!p || !fields) return el;
    const next = { ...el } as Record<string, unknown>;
    for (const f of fields) {
      const v = p[f];
      if (typeof v === "string" && v.trim()) next[f] = v;
    }
    return next as unknown as SocialElement;
  });
  return { ...d, elements };
}
