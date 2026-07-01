// lib/email/social-calendar/build-canvas-fill.ts
//
// AI fill for the canvas composer. Reuses the shipped four-lane social prompt + parser
// (socialPostSystem / tryParseSocial) — the patch keyed by element id maps 1:1 onto canvas
// element ids via applyDesignPatch. The no-invention moat lives in the prompt; nothing is
// scrubbed here.
//
// Note: chart elements render a placeholder today (no v1 chart-from-brain flow exists);
// full chart support in the canvas is a follow-up task.
import { getAnthropic } from "@/refinery/agents/anthropic.mts";
import {
  socialPostSystem,
  tryParseSocial,
  buildVariants,
} from "@/lib/email/social-calendar/build-week";
import { fetchLakeParts, refreshStaleLakeContext, type BuildScope } from "@/lib/email/build-doc";
import { resolveEmailModel } from "@/lib/email/model-router";
import type { GoalTone } from "@/lib/email/social-calendar/types";
import type { Platform } from "@/lib/social/types";

// ADDENDUM pins the exact field names the patch must use — load-bearing because
// socialPostSystem's allowed-fields list (prose/body/title/caption/kicker/…) does NOT
// include "text", and applyDesignPatch's whitelist is text→["text"], stat→["value","label"],
// cta→["text"]. Without the pin, the model writes body/caption and the patch is silently
// dropped, leaving elements unfilled.
const ADDENDUM =
  'A single social post. Fill the listed ELEMENTS with cited SWFL figures; keep each value short. In your patch, key by the EXACT element ids shown and use ONLY the field names each element lists: text and button elements use "text"; stat elements use "value" and "label". Do NOT use any other field names (no prose, body, title, caption, kicker).';

/** The user message: element id -> current text fields (mirrors docSkeleton's shape for the email path). */
export function canvasFillPrompt(skeleton: Record<string, Record<string, string>>): string {
  const lines = Object.entries(skeleton).map(([id, fields]) => `${id}: ${JSON.stringify(fields)}`);
  return `ELEMENTS (id -> current text fields):\n${lines.join("\n")}`;
}

export interface CanvasFillResult {
  caption: string;
  hashtags: string[];
  patch: Record<string, Record<string, unknown>>;
  variants: Partial<Record<Platform, string>>;
  webSources: { label: string; value: string; url: string }[];
}

export async function buildSocialCanvasFill(
  scope: BuildScope | undefined,
  skeleton: Record<string, Record<string, string>>,
  opts?: { platforms?: Platform[]; goalTone?: GoalTone },
): Promise<CanvasFillResult | null> {
  const { figures, dossier } = await fetchLakeParts(scope);
  const fresh = await refreshStaleLakeContext({
    scope,
    figures,
    dossier,
    prompt: scope?.value
      ? `${scope.value} Southwest Florida real estate market`
      : "Southwest Florida real estate market",
    today: new Date(),
    includeGapProbe: false,
  });
  try {
    const msg = await getAnthropic("other").messages.create({
      model: resolveEmailModel("interactive"),
      max_tokens: opts?.platforms?.length ? Math.min(512 + opts.platforms.length * 320, 2048) : 700,
      system: socialPostSystem(fresh.lakeContext, ADDENDUM, opts),
      messages: [{ role: "user", content: canvasFillPrompt(skeleton) }],
    });
    const txt = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const parsed = tryParseSocial(txt);
    if (!parsed) return null;
    return {
      caption: parsed.caption,
      hashtags: parsed.hashtags,
      patch: (parsed.patch as Record<string, Record<string, unknown>>) ?? {},
      variants: opts?.platforms?.length
        ? buildVariants(parsed.caption, parsed.variants, opts.platforms)
        : parsed.variants,
      webSources: fresh.web.verified.map((v) => ({
        label: v.label,
        value: String(v.value),
        url: v.url,
      })),
    };
  } catch {
    return null;
  }
}
