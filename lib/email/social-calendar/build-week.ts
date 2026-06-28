// lib/email/social-calendar/build-week.ts
//
// THE social-calendar builder. Reuses the email pipeline's lake fetch + freshness
// root + content-patch fill: ONE shared lake call, ONE shared stale-refresh, 5
// parallel Haiku fills. Pure helpers are unit-tested; the network functions
// (buildSocialPost / buildWeek) are live-verified. No-invention holds (same
// applyPatch, four-lane prompt); no-staleness holds (refreshStaleLakeContext).
import Anthropic from "@anthropic-ai/sdk";
import { EmailDocSchema, ContentPatchSchema } from "@/lib/email/doc/schema";
import { DEFAULT_GLOBAL_STYLE, createBlock } from "@/lib/email/doc/default-docs";
import {
  fetchLakeParts,
  refreshStaleLakeContext,
  applyPatch,
  docSkeleton,
  type BuildScope,
} from "@/lib/email/build-doc";
import { resolveEmailModel } from "@/lib/email/model-router";
import { DAY_THEMES } from "./themes";
import type { DayTheme, SocialDraft, WeeklyCalendar } from "./types";
import type { EmailDoc } from "@/lib/email/doc/types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export function seedSocialCard(theme: DayTheme): EmailDoc {
  return {
    globalStyle: { ...DEFAULT_GLOBAL_STYLE },
    blocks: theme.cardBlocks.map((t) => createBlock(t)),
  };
}

export function socialPostSystem(lakeContext: string, addendum: string): string {
  const dataBlock = lakeContext
    ? `\n\nREAL LAKE DATA (cite verbatim — value · source · as-of):\n${lakeContext}\n`
    : "";
  return `You are a social media copywriter for a Southwest Florida real estate agent.

Return ONLY valid JSON with exactly these keys (no markdown fences, no prose outside the object):
  captionText: string   (<=280 words, hook-first, ONE CTA at the end, NO hashtags inline, NO em-dashes)
  hashtags: string[]    (5-8 items, NO "#" prefix; mix: 2 local, 2 topical, 1 brand "SWFLDataGulf")
  patch: object         (block id -> updated text fields ONLY, same shape as the email content patch)
${dataBlock}
Allowed text fields per block: kicker, value, label, prose, title, body, caption, alt, stats (array of AT MOST 3 {value, label}; keep each value short).

DATA SOURCING — four lanes, in order. NEVER leave a requested field empty because you "don't have the number":
1. LAKE DATA above — use verbatim (value · source · as-of).
2. User's uploaded doc or figure — if the user pasted a number, use it exactly.
3. Internet / publicly known figure — use it; note the source inline (e.g. "per Realtor.com").
4. Can't source it at all — write [Need: brief description of the exact figure] so the user can supply it.
ONLY block: an invented number with no real source. Build is NEVER blocked.

Block rules:
- Only the allowed text fields — no colors, urls, logos, photos, company name, agent names, or brand settings.
- Only include block ids and fields you are actually changing.

DAY-SPECIFIC: ${addendum}`;
}

export function tryParseSocial(
  text: string,
): { caption: string; hashtags: string[]; patch: unknown } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const caption = typeof o.captionText === "string" ? o.captionText.trim() : "";
  if (!caption) return null;
  const hashtags = Array.isArray(o.hashtags)
    ? o.hashtags.filter((h): h is string => typeof h === "string").slice(0, 8)
    : [];
  return { caption, hashtags, patch: o.patch ?? {} };
}

export function assembleDraft(
  theme: DayTheme,
  card: EmailDoc,
  parsed: { caption: string; hashtags: string[]; patch: unknown },
): SocialDraft | null {
  const patch = ContentPatchSchema.safeParse(parsed.patch);
  const filledRaw = patch.success ? applyPatch(card, patch.data) : card;
  const filled = EmailDocSchema.safeParse(filledRaw);
  if (!filled.success) return null;
  return {
    day: theme.day,
    theme: theme.label,
    caption: parsed.caption,
    hashtags: parsed.hashtags,
    card: filled.data,
  };
}

export async function buildSocialPost(
  theme: DayTheme,
  lakeContext: string,
): Promise<SocialDraft | null> {
  const card = seedSocialCard(theme);
  try {
    const msg = await client.messages.create({
      model: resolveEmailModel("interactive"), // Haiku
      max_tokens: 512,
      system: socialPostSystem(lakeContext, theme.systemAddendum),
      messages: [
        { role: "user", content: `CARD (block id -> current text):\n${docSkeleton(card)}` },
      ],
    });
    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const parsed = tryParseSocial(text);
    if (!parsed) return null;
    return assembleDraft(theme, card, parsed);
  } catch {
    return null;
  }
}

export async function buildWeek(
  scope: BuildScope | undefined,
  weekOf: string,
): Promise<WeeklyCalendar> {
  const { figures, dossier } = await fetchLakeParts(scope);
  const fresh = await refreshStaleLakeContext({
    scope,
    figures,
    dossier,
    prompt: scope?.value
      ? `${scope.value} Southwest Florida real estate market`
      : "Southwest Florida real estate market",
    today: new Date(),
    includeGapProbe: false, // forced stale-refresh only — no per-post gap probe
  });
  const results = await Promise.all(DAY_THEMES.map((t) => buildSocialPost(t, fresh.lakeContext)));
  const posts = results.filter((p): p is SocialDraft => p !== null);
  return {
    scope,
    weekOf,
    posts,
    webRefreshed: fresh.webRefreshed,
    webSources: fresh.web.verified.map((v) => ({
      label: v.label,
      value: String(v.value),
      url: v.url,
    })),
  };
}
