// lib/email/social-calendar/build-week.ts
//
// THE social-calendar builder. Reuses the email pipeline's lake fetch + freshness
// root + content-patch fill: ONE shared lake call, ONE shared stale-refresh, 5
// parallel Haiku fills. Pure helpers are unit-tested; the network functions
// (buildSocialPost / buildWeek) are live-verified. No-invention holds (same
// applyPatch, four-lane prompt); no-staleness holds (refreshStaleLakeContext).
import { getAnthropic } from "@/refinery/agents/anthropic.mts";
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
import type {
  DayTheme,
  GoalTone,
  SocialDraft,
  SocialGoal,
  SocialTone,
  WeeklyCalendar,
} from "./types";
import type { EmailDoc } from "@/lib/email/doc/types";
import type { Platform } from "@/lib/social/types";
import {
  loadListingContext,
  renderListingsBlock,
  featuredContextLine,
  attachFeaturedAerial,
} from "@/lib/listings/select";
import type { Listing } from "@/lib/listings/rentcast";
import { resolveArtifactLink } from "@/lib/listings/artifact-link";
import { deriveListingPhoto } from "@/lib/media/listing-photo";

// X (Twitter) hard limit — verified in-session 06/30/2026 against
// docs.x.com/fundamentals/counting-characters ("Posts on X can contain up to 280 characters").
const X_CHAR_LIMIT = 280;

// The 5 PUBLISHABLE platforms (schedule targets) = the `Platform` union, NOT the 8
// display platforms in lib/email/social/platforms.ts. Built off a full Record so a
// new Platform member is a compile error here until it is listed.
const PUBLISHABLE_SET: Record<Platform, true> = {
  x: true,
  facebook: true,
  instagram: true,
  linkedin: true,
  google_business: true,
};
export const PUBLISHABLE_PLATFORMS = Object.keys(PUBLISHABLE_SET) as Platform[];

// The four-lane no-invention sourcing rules — ONE source of truth, shared by the
// social-card builder (socialPostSystem) and the canvas author (authorSocialSystem).
// Keep verbatim; the moat lives here.
export const SOCIAL_SOURCING_RULES = `DATA SOURCING — four lanes, in order. NEVER leave a requested field empty because you "don't have the number":
1. LAKE DATA above — use verbatim (value · source · as-of).
2. User's uploaded doc or figure — if the user pasted a number, use it exactly.
3. Internet / publicly known figure — use it; note the source inline (e.g. "per Realtor.com").
4. Can't source it at all — write [Need: brief description of the exact figure] so the user can supply it.
ONLY block: an invented number with no real source. Build is NEVER blocked.`;

// Per-network caption SHAPE rules (the Buffer "content tailoring" pattern). These change
// only the shape; figures + citations are reused verbatim — the four-lane moat is untouched.
const PLATFORM_RULES: Record<Platform, string> = {
  x: `<=${X_CHAR_LIMIT} CHARACTERS total (hard limit), one punchy hook, at most 1-2 hashtags`,
  linkedin: "longer-form and professional, 2-3 short paragraphs, insight-led, few or no hashtags",
  instagram: "caption first, then a block of 5-8 hashtags on their own line at the end",
  facebook: "conversational and community-oriented, invite a reply or comment",
  google_business:
    "local and action-first, lead with the place, end with one clear CTA, no hashtags",
};

const GOAL_RULES: Record<SocialGoal, string> = {
  awareness: "Goal is awareness: broad, shareable framing.",
  leads: "Goal is leads: end with a clear next step (DM, link, or call).",
  engagement: "Goal is engagement: ask a question that invites replies.",
};

const TONE_RULES: Record<SocialTone, string> = {
  professional: "Tone is professional: credible and precise.",
  casual: "Tone is casual: warm and plain-spoken.",
  bold: "Tone is bold: confident and punchy.",
};

export function seedSocialCard(theme: DayTheme): EmailDoc {
  return {
    globalStyle: { ...DEFAULT_GLOBAL_STYLE },
    blocks: theme.cardBlocks.map((t) => createBlock(t)),
  };
}

export function socialPostSystem(
  lakeContext: string,
  addendum: string,
  opts?: { platforms?: Platform[]; goalTone?: GoalTone },
): string {
  const dataBlock = lakeContext
    ? `\n\nREAL LAKE DATA (cite verbatim — value · source · as-of):\n${lakeContext}\n`
    : "";

  const platforms = opts?.platforms ?? [];
  // Variants key requested ONLY for the chosen platforms (keeps the prompt tight).
  const variantsKeyLine = platforms.length
    ? `\n  variants: object      (keys EXACTLY: ${platforms.join(", ")} — the SAME post reshaped per network; reuse the SAME figures + citations as captionText, never invent)`
    : "";
  const networkBlock = platforms.length
    ? `\n\nPER-NETWORK VARIANTS — also return "variants" reshaping captionText for each requested network. Change only the SHAPE; keep the exact same figures and citations:\n${platforms
        .map((p) => `- ${p}: ${PLATFORM_RULES[p]}`)
        .join("\n")}`
    : "";
  const voiceBlock = opts?.goalTone
    ? `\n\nVOICE: ${GOAL_RULES[opts.goalTone.goal]} ${TONE_RULES[opts.goalTone.tone]}`
    : "";

  return `You are a social media copywriter for a Southwest Florida real estate agent.

Return ONLY valid JSON with exactly these keys (no markdown fences, no prose outside the object):
  captionText: string   (<=280 words, hook-first, ONE CTA at the end, NO hashtags inline, NO em-dashes)
  hashtags: string[]    (5-8 items, NO "#" prefix; mix: 2 local, 2 topical, 1 brand "SWFLDataGulf")
  patch: object         (block id -> updated text fields ONLY, same shape as the email content patch)${variantsKeyLine}
${dataBlock}
Allowed text fields per block: kicker, value, label, prose, title, body, caption, alt, stats (array of AT MOST 3 {value, label}; keep each value short).

${SOCIAL_SOURCING_RULES}

Block rules:
- Only the allowed text fields — no colors, urls, logos, photos, company name, agent names, or brand settings.
- Only include block ids and fields you are actually changing.${networkBlock}${voiceBlock}

DAY-SPECIFIC: ${addendum}`;
}

export function tryParseSocial(text: string): {
  caption: string;
  hashtags: string[];
  patch: unknown;
  variants: Partial<Record<Platform, string>>;
} | null {
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
  // Only keep variants for the 5 publishable platforms — unknown keys (e.g. tiktok) are dropped.
  const variants: Partial<Record<Platform, string>> = {};
  if (o.variants && typeof o.variants === "object") {
    const raw = o.variants as Record<string, unknown>;
    for (const p of PUBLISHABLE_PLATFORMS) {
      const v = raw[p];
      if (typeof v === "string" && v.trim()) variants[p] = v.trim();
    }
  }
  return { caption, hashtags, patch: o.patch ?? {}, variants };
}

/**
 * Trim `text` to at most `max` characters at a word boundary, so an inline citation
 * (e.g. "per Realtor.com") is never severed mid-token — a mid-string cut could orphan
 * a number from its source, which is the one thing the no-invention moat guards.
 */
export function clampToChars(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/**
 * Build per-network caption variants for the requested platforms. The prompt asks the
 * model to write each variant; this layer (a) falls back to the generic caption for any
 * requested platform the model did not tailor — including google_business, which has no
 * registry entry in platforms.ts — and (b) enforces the X 280-char limit as a safety net.
 * SHAPE only; figures + citations are carried verbatim from what the model produced.
 */
export function buildVariants(
  caption: string,
  aiVariants: Partial<Record<Platform, string>>,
  platforms: readonly Platform[],
): Partial<Record<Platform, string>> {
  const out: Partial<Record<Platform, string>> = {};
  for (const p of platforms) {
    const text = aiVariants[p]?.trim() || caption;
    out[p] = p === "x" ? clampToChars(text, X_CHAR_LIMIT) : text;
  }
  return out;
}

export function assembleDraft(
  theme: DayTheme,
  card: EmailDoc,
  parsed: {
    caption: string;
    hashtags: string[];
    patch: unknown;
    variants?: Partial<Record<Platform, string>>;
  },
  platforms?: readonly Platform[],
): SocialDraft | null {
  const patch = ContentPatchSchema.safeParse(parsed.patch);
  const filledRaw = patch.success ? applyPatch(card, patch.data) : card;
  const filled = EmailDocSchema.safeParse(filledRaw);
  if (!filled.success) return null;
  const draft: SocialDraft = {
    day: theme.day,
    theme: theme.label,
    caption: parsed.caption,
    hashtags: parsed.hashtags,
    card: filled.data,
  };
  if (platforms && platforms.length) {
    draft.variants = buildVariants(parsed.caption, parsed.variants ?? {}, platforms);
  }
  return draft;
}

export async function buildSocialPost(
  theme: DayTheme,
  lakeContext: string,
  opts?: { platforms?: Platform[]; goalTone?: GoalTone; featured?: Listing },
): Promise<SocialDraft | null> {
  const card = seedSocialCard(theme);
  // A featured RentCast listing lets the post write about a SPECIFIC current home (still
  // cited, never invented); its lot aerial is code-set onto the card AFTER the fill (the
  // social prompt forbids the model from setting photos — same rule as the email path).
  const addendum = opts?.featured
    ? `${theme.systemAddendum}\n\n${featuredContextLine(opts.featured)}`
    : theme.systemAddendum;
  try {
    const msg = await getAnthropic("other").messages.create({
      model: resolveEmailModel("interactive"), // Haiku
      // Each requested platform adds another full caption; scale the budget by count so a
      // 5-platform request doesn't truncate the JSON (which would null the parse and silently
      // drop the day). Caption+hashtags+patch ~= the 512 base; ~320 tok per extra variant; capped.
      max_tokens: opts?.platforms?.length ? Math.min(512 + opts.platforms.length * 320, 2048) : 512,
      system: socialPostSystem(lakeContext, addendum, opts),
      messages: [
        { role: "user", content: `CARD (block id -> current text):\n${docSkeleton(card)}` },
      ],
    });
    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const parsed = tryParseSocial(text);
    if (!parsed) return null;
    const draft = assembleDraft(theme, card, parsed, opts?.platforms);
    if (draft && opts?.featured)
      draft.card = attachFeaturedAerial(
        draft.card,
        opts.featured,
        resolveArtifactLink({ listing: opts.featured }),
      );
    return draft;
  } catch {
    return null;
  }
}

export async function buildWeek(
  scope: BuildScope | undefined,
  weekOf: string,
  opts?: { platforms?: Platform[]; goalTone?: GoalTone },
): Promise<WeeklyCalendar> {
  const { figures, dossier } = await fetchLakeParts(scope);
  const today = new Date();
  // Lake freshness + the one RentCast call run in parallel; both degrade gracefully.
  const [fresh, listingCtx] = await Promise.all([
    refreshStaleLakeContext({
      scope,
      figures,
      dossier,
      prompt: scope?.value
        ? `${scope.value} Southwest Florida real estate market`
        : "Southwest Florida real estate market",
      today,
      includeGapProbe: false, // forced stale-refresh only — no per-post gap probe
    }),
    loadListingContext(scope, today, { derivePhoto: deriveListingPhoto }),
  ]);
  // Real current inventory rides into the shared context as cited figures (four-lane safe).
  const listingsBlock = renderListingsBlock(listingCtx.figures);
  const lakeContext = listingsBlock
    ? `${fresh.lakeContext}\n\n${listingsBlock}`
    : fresh.lakeContext;
  // Rotate a featured (aerial-able) listing across the weekday posts — each card gets a
  // real local lot's satellite view; days repeat only if fewer listings than days.
  const featurable = listingCtx.ranked.filter((l) => l.latitude != null && l.longitude != null);
  const results = await Promise.all(
    DAY_THEMES.map((t, i) => {
      const featured = featurable.length ? featurable[i % featurable.length] : undefined;
      const postOpts = opts || featured ? { ...opts, featured } : undefined;
      return buildSocialPost(t, lakeContext, postOpts);
    }),
  );
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
