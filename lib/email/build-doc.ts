// lib/email/build-doc.ts
//
// THE ONE Email Lab build pipeline. Extracted from app/api/email-lab/ai/route.ts
// so (a) the route is a thin wrapper, and (b) a script/test runs the EXACT same
// path. Pipeline: fetch the full lake context + best-effort inject a REAL market
// chart, pick the model by mode, ask the model to fill CONTENT only, apply +
// re-validate. No-invention (every SWFL number is cited) and no-restyle (the
// ContentPatch schema strips style/link/identity keys) are preserved.

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/refinery/agents/anthropic.mts";
import {
  EmailDocSchema,
  BlockContentPatchSchema,
  AuthorDocSchema,
  type ContentPatch,
  type AuthoredDoc,
} from "@/lib/email/doc/schema";
import type { EmailDoc } from "@/lib/email/doc/types";
import { DEFAULT_BLOCK_PROPS } from "@/lib/email/doc/default-docs";
import {
  loadMarketFigures,
  figuresToPromptBlock,
  type MarketFigure,
} from "@/lib/email/market-context";
import {
  resolveEmailModel,
  EMAIL_MODEL_OPUS,
  EMAIL_MODEL_SONNET,
  EMAIL_MODEL_HAIKU,
} from "@/lib/email/model-router";
import { chartImageBlock, upsertChartBlock } from "@/lib/email/inject-chart";
import { extractUrls, fetchOgImage, type OgImageResult } from "@/lib/email/og-image";
import { brandWebsiteUrl, heroPhotoBlock, upsertHeroPhoto } from "@/lib/email/inject-photo";
import { loadListingContext, renderListingsBlock } from "@/lib/listings/select";
import { isListingIntent } from "@/lib/email/listing-intent";
import { fetchListingFacts } from "@/lib/email/listing-scrape";
import { buildListingFlyer } from "@/lib/email/listing-flyer";
import { fetchAreaComps, buildCompsSpec, deriveAreaUrl } from "@/lib/email/listing-comps";
import { chartSpecToEmailImage, type EmailChartImage } from "@/lib/email/spec-to-png";
import { buildChartForQuestion } from "@/lib/assistant/chart-for-question";
import { reshapeChartToType, chartTypeFits, type ChartType } from "@/lib/email/reshape-chart-type";
import { staleFigures } from "@/lib/assistant/freshness";
import {
  webFallback,
  staleFiguresToRequests,
  renderWebFallbackBlock,
  looksLikeFigureAsk,
  type WebFallbackResult,
} from "@/lib/assistant/web-fallback";
import {
  AUTHOR_TOOL,
  authorSystem,
  assembleAuthoredDoc,
  buildFigureMenu,
  figureMenuById,
  collectAnchorNumbers,
  lintAuthoredProse,
} from "@/lib/email/author-doc";
import { extractNumbers } from "@/lib/deliverable/narrative-lint";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.swfldatagulf.com";
const MAX_TOKENS = 4096;

export interface BuildScope {
  kind?: string;
  value?: string;
}

// ── Lake context (the builder's data feed — EVERYTHING, every time) ──────────
async function fetchMasterDossier(scope?: BuildScope): Promise<string> {
  try {
    const params = new URLSearchParams({ view: "speak", tier: "2", v: "5" });
    if (scope?.kind === "zip" && scope.value) params.set("zip", scope.value);
    else if (scope?.kind === "county" && scope.value) params.set("county", scope.value);
    const res = await fetch(`${BASE_URL}/api/b/master?${params}`, { next: { revalidate: 3600 } });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 12000);
  } catch {
    return "";
  }
}

/** The raw parts of the lake feed: cited figures (each with its as-of) + the master
 *  dossier. Split out from fetchLakeContext so buildContentDoc can refresh STALE figures
 *  via the web lane and drop the superseded held ones BEFORE composing the prompt. */
export async function fetchLakeParts(
  scope?: BuildScope,
): Promise<{ figures: MarketFigure[]; dossier: string }> {
  const [figures, dossier] = await Promise.all([
    loadMarketFigures(scope).catch(() => []),
    fetchMasterDossier(scope).catch(() => ""),
  ]);
  return { figures, dossier };
}

/** Compose the prompt-context string the fill AI reads from cited figures + the dossier. */
export function composeLakeContext(figures: MarketFigure[], dossier: string): string {
  const parts: string[] = [];
  if (figures.length)
    parts.push(
      `CITED FIGURES (quote verbatim — value · source · as-of):\n${figuresToPromptBlock(figures)}`,
    );
  if (dossier)
    parts.push(`FULL SWFL MARKET DOSSIER (all site data — choose what's relevant):\n${dossier}`);
  return parts.join("\n\n");
}

/** Back-compat string API (legacy token route still calls this). */
export async function fetchLakeContext(scope?: BuildScope): Promise<string> {
  const { figures, dossier } = await fetchLakeParts(scope);
  return composeLakeContext(figures, dossier);
}

/** Drop held figures the web lane refreshed (EXACT-label match — the forced request reuses
 *  the figure's label, so the verified web point carries the same label back). The AI then
 *  sees only the fresh cited value, never the stale held one beside it. */
export function dropSuperseded(figures: MarketFigure[], refreshedLabels: string[]): MarketFigure[] {
  const drop = new Set(refreshedLabels);
  return figures.filter((f) => !drop.has(f.label));
}

export interface FreshLakeContext {
  lakeContext: string;
  web: WebFallbackResult;
  webRefreshed: string[];
}

/** THE freshness root (shared by the email build AND the social calendar): refresh any
 *  stale held figure to its current web-cited value, drop the superseded held copy, and
 *  compose the clean context the AI reads. `includeGapProbe` true reproduces buildContentDoc's
 *  figure-ask gap probe; false (calendar) does forced stale-refresh only. Best-effort: any
 *  web failure → held data. */
export async function refreshStaleLakeContext(opts: {
  scope?: BuildScope;
  figures: MarketFigure[];
  dossier: string;
  prompt: string;
  today: Date;
  includeGapProbe: boolean;
}): Promise<FreshLakeContext> {
  const { scope, figures, dossier, prompt, today, includeGapProbe } = opts;
  const stale = staleFigures(figures, today);
  const placeHint = scope?.value
    ? scope.kind === "county"
      ? `${scope.value} County Florida`
      : `${scope.value} Florida`
    : "";
  const forced = staleFiguresToRequests(stale, placeHint);
  const isFigureAsk = includeGapProbe && looksLikeFigureAsk(prompt);
  const heldSummary = composeLakeContext(figures, dossier);
  const web =
    forced.length > 0 || isFigureAsk
      ? await webFallback(prompt, heldSummary, {
          forced,
          probe: isFigureAsk ? undefined : async () => [],
        }).catch(() => ({ verified: [], unfound: [] }))
      : { verified: [], unfound: [] };
  const webRefreshed = web.verified.map((v) => v.label);
  const survivingFigures = dropSuperseded(figures, webRefreshed);
  const lakeContext = composeLakeContext(survivingFigures, dossier);
  return { lakeContext, web, webRefreshed };
}

// ── Chart selection — the SHARED root (the same producer chat uses) ──────────
// buildChartForQuestion picks the chart for the PROMPT — any chartable brain, not a
// hardcoded ZHVI scope — moat-safe (the LLM never touches a figure). It returns a
// ChartSpec + the chart's real figures (groundingNote). spec-to-png rasterizes that
// spec to a hosted PNG for email (the registry's React frames can't run in email).
// This replaces the old one-city ZHVI fork. NEVER throws — a chart is a bonus.
async function buildPromptChart(
  prompt: string,
  doc: EmailDoc,
  scope?: BuildScope,
  chartType?: ChartType,
): Promise<{ image: EmailChartImage; groundingNote: string; note?: string } | null> {
  try {
    const question = scope?.value ? `${prompt} (${scope.kind ?? "scope"}: ${scope.value})` : prompt;
    const cfq = await buildChartForQuestion(question, BASE_URL);
    if (!cfq?.chart) {
      console.log("[email-lab/chart] no chart matched for prompt:", prompt.slice(0, 80));
      return null;
    }
    // The "pick your chart type" control re-shapes the SAME routed figures into the
    // requested frame (bar/donut/dot vs avg/bar+change). No requested type → the
    // producer's auto choice. Reshaping relabels, never invents (reshape-chart-type.ts).
    // GUARDRAIL: a requested shape the data can't honor falls back to a bar; tell the user why.
    const note =
      chartType && !chartTypeFits(cfq.chart, chartType)
        ? chartType === "donut"
          ? "A donut needs share-style data (counts that add to a whole) — showed a bar for this metric."
          : "This data has no period-over-period change — showed a plain bar instead."
        : undefined;
    const chart = chartType ? reshapeChartToType(cfq.chart, chartType) : cfq.chart;
    const accent = doc.globalStyle.accentColor || "#3DC9C0";
    // The accent is part of the cache key so a brand-color change yields a NEW url —
    // otherwise the browser serves the stale (old-color) PNG from the same address.
    const tint = accent.replace(/[^0-9a-fA-F]/g, "").slice(0, 6) || "x";
    const key = `email-charts/${chart.frameId}-${scope?.value ?? "swfl"}-${chart.asOf ?? "x"}-${tint}.png`;
    const image = await chartSpecToEmailImage(chart, accent, key);
    if (!image) console.log("[email-lab/chart] spec-to-png failed for frameId:", chart.frameId);
    return image ? { image, groundingNote: cfq.groundingNote, note } : null;
  } catch (e) {
    console.error("[email-lab/chart] chart build threw:", e);
    return null;
  }
}

// ── Hero photo — auto-resolve a real property/agent photo from a URL ─────────
// If the prompt carries a listing / agent-website URL, pull that page's og:image
// (the hero photo every site sets for link previews) and drop it in as the lead
// image — so emails get a real picture, not a manual upload. Best-effort, like
// the chart: the og:image lane works for an agent's own site + fetchable listing
// pages; Zillow/Realtor block bots, so those fall through to no photo (the RESO
// Media feed is the next layer). NEVER throws.
async function resolveHeroPhoto(
  prompt: string,
  doc: EmailDoc,
): Promise<(OgImageResult & { source: string }) | null> {
  // Priority: a specific listing/site URL in the prompt → that property's photo.
  // Fallback: the agent's saved brand website → a default hero, nothing to paste.
  const site = brandWebsiteUrl(doc);
  const candidates = site ? [...extractUrls(prompt), site] : extractUrls(prompt);
  try {
    for (const u of candidates.slice(0, 4)) {
      const r = await fetchOgImage(u);
      if (r) return { ...r, source: u };
    }
  } catch {
    /* a photo is a bonus — never block the fill on it */
  }
  return null;
}

// ── Content patch (the AI fills CONTENT into the fixed skeleton) ─────────────
const TEXT_KEYS = ["kicker", "value", "label", "prose", "title", "body", "caption", "alt"] as const;

export function docSkeleton(doc: EmailDoc): string {
  const lines = doc.blocks.map((b) => {
    const props = b.props as Record<string, unknown>;
    const text: Record<string, unknown> = {};
    for (const k of TEXT_KEYS) {
      if (props[k] !== undefined && props[k] !== "") text[k] = props[k];
    }
    if (b.type === "stats") text.stats = props.stats;
    return `  "${b.id}" (${b.type}): ${JSON.stringify(text)}`;
  });
  return lines.join("\n");
}

function contentPatchSystem(lakeContext: string, hasChart: boolean): string {
  const dataBlock = lakeContext
    ? `\n\nREAL LAKE DATA (cite verbatim — value · source · as-of):\n${lakeContext}\n`
    : "";
  const chartLine = hasChart
    ? `\n- A real market CHART image is ALREADY placed in the doc (an "image" block). Write its caption and refer to the trend in your prose — never say a chart can't be made; one is already there.`
    : `\n- If a chart would help but none is present, express the data in the closest blocks (stats for key numbers, text for a list). Always produce a valid patch; never error out.`;
  return `You are an email content writer for SWFL Data Gulf, a Southwest Florida real estate intelligence platform.

You receive an EmailDoc skeleton (block ids + current text) and real lake data. Return ONLY a JSON content patch — a flat object mapping block id → updated text fields. No markdown fences, no commentary outside the JSON object.${dataBlock}

Allowed text fields per block: kicker, value, label, prose, title, body, caption, alt, tagline, stats (array of AT MOST 3 {value, label}; keep each value short — a number/figure, not a sentence).

DATA SOURCING — four lanes, in order. NEVER leave a requested field empty because you "don't have the number":
1. LAKE DATA above — use verbatim (value · source · as-of).
2. User's uploaded doc or figure — if the user pasted a number in their request, use it exactly.
3. Internet / publicly known figure — use it; note the source inline (e.g. "per Realtor.com", "per Census Bureau").
4. Can't source it at all — write [Need: brief description of the exact figure] so the user can supply it.
ONLY block: an invented number with no real source. Build is NEVER blocked.

Block rules:
- Do NOT add, remove, or reorder blocks. Do NOT change block types.
- Only the allowed text fields — no colors, urls, logos, photos, company name, agent names, or brand settings.
- Only include block ids and fields you are actually changing.
- Tight prose, no jargon, no internal ids in the copy.${chartLine}`;
}

export function applyPatch(doc: EmailDoc, patch: ContentPatch): unknown {
  return {
    globalStyle: doc.globalStyle,
    blocks: doc.blocks.map((b) => {
      const p = patch[b.id];
      if (!p) return b;
      return { ...b, props: { ...(b.props as Record<string, unknown>), ...p } };
    }),
  };
}

/** Extract the JSON object and validate it as a content patch — RESILIENTLY. A
 *  single over-limit field (a 4th stat, an over-long value) must NOT nuke the whole
 *  fill: parse PER BLOCK, clamp stats to the layout max, drop only the blocks that
 *  still don't fit, keep every valid one. No-restyle still holds (each block is
 *  strip-mode parsed by BlockContentPatchSchema). Returns null only when there is no
 *  usable patch at all. Handles a markdown-fenced ```json{...}``` response. */
export function tryParsePatch(text: string): ContentPatch | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(obj as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const candidate: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    // Clamp stats to the layout max so a 4th+ cell doesn't reject the whole block.
    if (Array.isArray(candidate.stats)) candidate.stats = candidate.stats.slice(0, 3);
    const r = BlockContentPatchSchema.safeParse(candidate);
    if (r.success) out[id] = r.data;
    // else: drop just THIS block's patch — keep the rest (never nuke the whole fill).
  }
  return Object.keys(out).length ? (out as ContentPatch) : null;
}

export interface BuildArgs {
  prompt: string;
  rawDoc: unknown;
  scope?: BuildScope;
  /** "interactive" (default, Haiku) | "quality"/"snicklefritz" (Sonnet) | "max" (Opus). */
  mode?: string;
  /** Optional user-chosen chart shape from the lab control; reshapes the routed chart. */
  chartType?: ChartType;
}

export interface BuildResult {
  httpStatus?: number;
  payload: Record<string, unknown>;
}

/** Run the full Email Lab content build. Returns the patched (and chart-injected)
 *  EmailDoc, or the current doc + a message on a parse miss — never garbage. */
export async function buildContentDoc({
  prompt,
  rawDoc,
  scope,
  mode,
  chartType,
}: BuildArgs): Promise<BuildResult> {
  const docParsed = EmailDocSchema.safeParse(rawDoc);
  if (!docParsed.success) {
    return { httpStatus: 400, payload: { error: "Invalid email document." } };
  }
  let doc = docParsed.data;

  // ── Listing flyer branch ───────────────────────────────────────────────────
  // A "describe THIS house" ask carrying a pasted listing URL: scrape the page
  // for REAL facts and rebuild the canvas as a property flyer (photo · price ·
  // beds/baths/sqft · the real remarks), preserving the user's brand + identity.
  // This is the layout transform the newsletter path can't do (it is forbidden to
  // restructure blocks). A scrape miss falls through to the newsletter path below,
  // so the build is never blocked — and a flyer is never built from invented data.
  if (isListingIntent(prompt)) {
    const url = extractUrls(prompt)[0];
    const facts = url ? await fetchListingFacts(url).catch(() => null) : null;
    if (facts) {
      let flyer = buildListingFlyer(facts, doc);

      // Comps chart — fetch active listings from the same area page and build a
      // bar chart with the subject highlighted. Best-effort: ships without chart
      // on any failure. Never fabricates a price; falls back to no chart, not
      // to a macro index.
      if (url) {
        const comps = await fetchAreaComps(url, facts).catch(() => []);
        const areaUrl = deriveAreaUrl(url);
        if (comps.length >= 2 && areaUrl) {
          const accent = doc.globalStyle?.accentColor ?? "#2563eb";
          const spec = buildCompsSpec(comps, facts, areaUrl);
          if (spec) {
            const chartImg = await chartSpecToEmailImage(
              spec,
              accent,
              `comps-${facts.zip ?? "swfl"}-${Date.now()}`,
            ).catch(() => null);
            if (chartImg) {
              flyer = upsertChartBlock(flyer, chartImageBlock(chartImg));
            }
          }
        }
      }

      const reparsed = EmailDocSchema.safeParse(flyer);
      if (reparsed.success) {
        return {
          payload: {
            doc: reparsed.data,
            applied: true,
            replacedLayout: true,
            listing: { sourceUrl: facts.sourceUrl },
          },
        };
      }
    }
  }

  const model = resolveEmailModel(mode);

  // Lake parts + chart in parallel. We pull the raw figures (each with its as-of) so a
  // STALE one can be refreshed from the web BEFORE the AI ever sees it (G28 + freshness).
  const [lakeParts, chartRes, photoRes, listingCtx] = await Promise.all([
    fetchLakeParts(scope),
    buildPromptChart(prompt, doc, scope, chartType),
    resolveHeroPhoto(prompt, doc),
    loadListingContext(scope, new Date()),
  ]);

  // FRESHNESS — delegated to the shared root so the email path and the social calendar
  // run exactly ONE freshness implementation. includeGapProbe=true preserves the
  // figure-ask gap probe that was previously inline here.
  const today = new Date();
  const {
    lakeContext,
    web,
    webRefreshed: refreshedLabels,
  } = await refreshStaleLakeContext({
    scope,
    figures: lakeParts.figures,
    dossier: lakeParts.dossier,
    prompt,
    today,
    includeGapProbe: true,
  });
  const webBlock = renderWebFallbackBlock(web); // "" when no gap; starts with \n\n otherwise

  // Chart owns the kind:"chart" slot; a brand website (if set) makes it clickable
  // ("if a chart interests you, it brings them to a site") — tracked at send.
  if (chartRes)
    doc = upsertChartBlock(
      doc,
      chartImageBlock({ ...chartRes.image, linkUrl: brandWebsiteUrl(doc) }),
    );
  // Hero photo links back to the listing/site it was pulled from — the email
  // behaves like a webpage, and the click is tracked.
  if (photoRes)
    doc = upsertHeroPhoto(
      doc,
      heroPhotoBlock({
        url: photoRes.image,
        alt: photoRes.title ?? "Featured property",
        linkUrl: photoRes.source,
      }),
    );
  const chartGroundingPart = chartRes?.groundingNote
    ? `\n\nCHART ON SCREEN (caption it from THESE real figures, never invent):\n${chartRes.groundingNote}`
    : "";
  // When we refreshed a stale figure, the WEB-VERIFIED value IS the current one. Stop the
  // model captioning the chart's last (past) monthly point as "now" — the chart is history,
  // the web figure is now. This is the freshness fix the operator demanded for the display.
  const freshnessDirective =
    web.verified.length > 0
      ? `\n\nFRESHNESS — the WEB-VERIFIED figures are CURRENT (fetched live just now). For any metric they cover, state THAT value as the current/"now" figure and attribute it to its named source. If a chart on screen shows the same metric, describe the chart as the historical trajectory THROUGH its labeled date — never call the chart's last (past) point "now".`
      : "";
  // Real current inventory rides into the prompt as cited figures (four-lane safe).
  const listingsBlock = renderListingsBlock(listingCtx.figures);
  const listingsPart = listingsBlock ? `\n\n${listingsBlock}` : "";
  const fullContext =
    lakeContext + listingsPart + chartGroundingPart + webBlock + freshnessDirective;

  let msg: Anthropic.Message;
  try {
    msg = await getAnthropic("email_build").messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: contentPatchSystem(fullContext, !!chartRes),
      messages: [
        {
          role: "user",
          content: `CURRENT DOC (block id → current text):\n${docSkeleton(doc)}\n\nUser request: ${prompt}`,
        },
      ],
    });
  } catch {
    return {
      payload: {
        doc,
        applied: false,
        message: "The AI couldn't respond — check your API key or try again.",
      },
    };
  }

  const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
  if (process.env.EMAIL_LAB_DEBUG === "1") {
    console.log("[email-lab/ai] raw model response:", text.slice(0, 500));
  }
  const patch = tryParsePatch(text);
  if (!patch) {
    return {
      payload: {
        doc,
        applied: false,
        message: "The AI returned an invalid response — try rephrasing.",
      },
    };
  }

  const candidate = applyPatch(doc, patch);
  const reparsed = EmailDocSchema.safeParse(candidate);
  if (!reparsed.success) {
    return {
      payload: {
        doc,
        applied: false,
        message: "The AI response didn't fit the layout — try rephrasing.",
      },
    };
  }

  return {
    payload: {
      doc: reparsed.data,
      applied: true,
      patch,
      chart: Boolean(chartRes),
      chartNote: chartRes?.note,
      photo: Boolean(photoRes),
      // Freshness: which stale held figures the AI replaced with a current web-cited value,
      // and the sources it cited — so the UI can show "found fresher data" + the citations.
      webRefreshed: refreshedLabels,
      webSources: web.verified.map((v) => ({ label: v.label, value: v.value, url: v.url })),
    },
  };
}

// ── The AUTHOR path (paid tier — build 03) ───────────────────────────────────
// Beside buildContentDoc (which only re-fills a FIXED skeleton), authorDoc lets the
// model compose the WHOLE document — which blocks, in what order, grouped into rows,
// with content — from the data MENU. The engine then derives the grid layout, gates
// the prose against invention, and returns a positioned EmailDoc. Brand is never
// authored (the incoming globalStyle carries through; applyBrand still overlays
// after); the content-patch + per-block fill paths above are untouched.
//
// MENU vs DOSSIER: the figures menu is the ONLY number source (id-selection); the
// master dossier rides along as QUALITATIVE context ("what's worth saying"), and
// the prose lint anchors on menu + chart figures — so a number lifted out of the
// dossier text is stripped, never silently shipped.
//
// FOLLOW-UPS (documented, not regressions — the free content-patch path keeps all
// of these): the author does not yet run the stale-figure web refresh or the
// model-driven external/upload/user gap-fill lanes; those join the menu + anchor
// set in a later increment.

/** Author quality defaults to Sonnet (the "connect it better" baseline); `max`/
 *  `opus` lifts to Opus, `interactive`/`haiku` drops to Haiku. Reuses the router ids. */
function resolveAuthorModel(mode?: string): string {
  const m = (mode ?? "").trim().toLowerCase();
  if (m === "max" || m === "opus") return EMAIL_MODEL_OPUS;
  if (m === "interactive" || m === "haiku") return EMAIL_MODEL_HAIKU;
  return EMAIL_MODEL_SONNET;
}

/** One forced-tool author call → a validated AuthoredDoc, or null on a miss. */
// Authoring a full multi-block doc (tool call) needs more headroom than a content
// patch — too small truncates the tool_use and the safeParse misses. 8192 covers a
// ~20-block email comfortably.
const AUTHOR_MAX_TOKENS = 8192;

async function callAuthor(
  model: string,
  system: string,
  user: string,
): Promise<AuthoredDoc | null> {
  try {
    const msg = await getAnthropic("email_build").messages.create({
      model,
      max_tokens: AUTHOR_MAX_TOKENS,
      system,
      tools: [AUTHOR_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: AUTHOR_TOOL.name },
      messages: [{ role: "user", content: user }],
    });
    const tool = msg.content.find((b) => b.type === "tool_use") as
      Anthropic.ToolUseBlock | undefined;
    if (!tool) return null;
    const parsed = AuthorDocSchema.safeParse(tool.input);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Run the full Email Lab AUTHOR build. Returns a positioned (chart/photo-filled,
 *  brand-overlaid-later) EmailDoc, or the current doc + a message on a miss. */
export async function authorDoc({
  prompt,
  rawDoc,
  scope,
  mode,
  chartType,
}: BuildArgs): Promise<BuildResult> {
  const docParsed = EmailDocSchema.safeParse(rawDoc);
  if (!docParsed.success) {
    return { httpStatus: 400, payload: { error: "Invalid email document." } };
  }
  const currentDoc = docParsed.data;
  const globalStyle = currentDoc.globalStyle; // brand is canonical — never authored
  const model = resolveAuthorModel(mode);

  // Data feed + best-effort chart/photo, in parallel — the SAME producers the
  // content-patch path uses (each never throws; a chart/photo is a bonus).
  const [lakeParts, chartRes, photoRes] = await Promise.all([
    fetchLakeParts(scope),
    buildPromptChart(prompt, currentDoc, scope, chartType),
    resolveHeroPhoto(prompt, currentDoc),
  ]);

  const menu = buildFigureMenu(lakeParts.figures);
  const figuresById = figureMenuById(menu);
  const chartGroundingNumbers = chartRes?.groundingNote
    ? extractNumbers(chartRes.groundingNote)
    : [];
  const anchorStrings = collectAnchorNumbers(lakeParts.figures, chartGroundingNumbers);

  const chartSlot = chartRes
    ? { url: chartRes.image.url, alt: chartRes.image.alt, linkUrl: brandWebsiteUrl(currentDoc) }
    : null;
  const photoSlot = photoRes
    ? { url: photoRes.image, alt: photoRes.title ?? "Featured property", linkUrl: photoRes.source }
    : null;

  const system = authorSystem({
    menu,
    dossier: lakeParts.dossier,
    vocabulary: Object.keys(DEFAULT_BLOCK_PROPS),
    hasChart: !!chartRes,
    chartGrounding: chartRes?.groundingNote,
    hasPhoto: !!photoRes,
  });
  const baseUser = scope?.value
    ? `User request: ${prompt}\nScope: ${scope.kind ?? "area"} ${scope.value}`
    : `User request: ${prompt}`;

  const authored = await callAuthor(model, system, baseUser);
  if (!authored) {
    return {
      payload: {
        doc: currentDoc,
        applied: false,
        message: "The AI couldn't author this — try rephrasing.",
      },
    };
  }

  const assemble = (a: AuthoredDoc): EmailDoc =>
    assembleAuthoredDoc({
      authored: a,
      figuresById,
      globalStyle,
      anchorNumbers: anchorStrings,
      chart: chartSlot,
      photo: photoSlot,
    });

  const firstParse = EmailDocSchema.safeParse(assemble(authored));
  if (!firstParse.success) {
    return {
      payload: {
        doc: currentDoc,
        applied: false,
        message: "The authored layout didn't validate — try rephrasing.",
      },
    };
  }
  let doc: EmailDoc = firstParse.data;

  // No-invention gate (gateNarrative philosophy): lint prose → on a violation,
  // regenerate ONCE naming the offending sentences → still bad ⇒ hard-strip them.
  const lint = lintAuthoredProse(doc, anchorStrings);
  let regenerations = 0;
  let stripped = false;
  if (!lint.ok) {
    regenerations = 1;
    const retryUser =
      `${baseUser}\n\nYour previous draft used numbers that are NOT in the DATA MENU. ` +
      `Re-author so every number in prose is quoted verbatim from a [fN] figure, or removed:\n` +
      lint.offending.map((s) => `- "${s}"`).join("\n");
    const authored2 = await callAuthor(model, system, retryUser);
    const reparse2 = authored2 ? EmailDocSchema.safeParse(assemble(authored2)) : null;
    if (reparse2?.success) {
      const lint2 = lintAuthoredProse(reparse2.data, anchorStrings);
      if (lint2.ok) {
        doc = reparse2.data;
      } else {
        doc = lint2.stripped; // hard-strip the second draft's offenders
        stripped = true;
      }
    } else {
      doc = lint.stripped; // no usable second draft — strip the first
      stripped = true;
    }
  }

  // Stripping only shortens strings, so the doc still validates; parse once more
  // defensively and fall back to the current doc on the (unexpected) miss.
  const finalParse = EmailDocSchema.safeParse(doc);
  const finalDoc = finalParse.success ? finalParse.data : currentDoc;

  return {
    payload: {
      doc: finalDoc,
      applied: true,
      authored: true,
      chart: Boolean(chartRes),
      chartNote: chartRes?.note,
      photo: Boolean(photoRes),
      regenerations,
      stripped,
    },
  };
}
