// lib/email/build-doc.ts
//
// THE ONE Email Lab build pipeline. Extracted from app/api/email-lab/ai/route.ts
// so (a) the route is a thin wrapper, and (b) a script/test runs the EXACT same
// path. Pipeline: fetch the full lake context + best-effort inject a REAL market
// chart, pick the model by mode, ask the model to fill CONTENT only, apply +
// re-validate. No-invention (every SWFL number is cited) and no-restyle (the
// ContentPatch schema strips style/link/identity keys) are preserved.

import Anthropic from "@anthropic-ai/sdk";
import { EmailDocSchema, BlockContentPatchSchema, type ContentPatch } from "@/lib/email/doc/schema";
import type { EmailDoc } from "@/lib/email/doc/types";
import {
  loadMarketFigures,
  figuresToPromptBlock,
  type MarketFigure,
} from "@/lib/email/market-context";
import { resolveEmailModel } from "@/lib/email/model-router";
import { chartImageBlock, upsertChartBlock } from "@/lib/email/inject-chart";
import { chartSpecToEmailImage, type EmailChartImage } from "@/lib/email/spec-to-png";
import { buildChartForQuestion } from "@/lib/assistant/chart-for-question";
import { reshapeChartToType, chartTypeFits, type ChartType } from "@/lib/email/reshape-chart-type";
import { staleFigures } from "@/lib/assistant/freshness";
import {
  webFallback,
  staleFiguresToRequests,
  renderWebFallbackBlock,
  looksLikeFigureAsk,
} from "@/lib/assistant/web-fallback";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

// ── Content patch (the AI fills CONTENT into the fixed skeleton) ─────────────
const TEXT_KEYS = ["kicker", "value", "label", "prose", "title", "body", "caption", "alt"] as const;

function docSkeleton(doc: EmailDoc): string {
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

function applyPatch(doc: EmailDoc, patch: ContentPatch): unknown {
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
  const model = resolveEmailModel(mode);

  // Lake parts + chart in parallel. We pull the raw figures (each with its as-of) so a
  // STALE one can be refreshed from the web BEFORE the AI ever sees it (G28 + freshness).
  const [lakeParts, chartRes] = await Promise.all([
    fetchLakeParts(scope),
    buildPromptChart(prompt, doc, scope, chartType),
  ]);

  // FRESHNESS — "we don't ship old data." Any held figure older than its source's publish
  // cadence is refreshed to the CURRENT cited value via the web lane (the SAME verbatim-
  // citation moat chat uses — gap-fill.ts). The stale held number is then dropped so the
  // AI writes from the fresh, cited one — never our month-old copy. Genuinely-missing
  // figure asks are fetched by the probe too. Best-effort: any web failure → held data.
  const today = new Date();
  const stale = staleFigures(lakeParts.figures, today);
  // Anchor every forced web query to the scope's place so a place-less figure label can't
  // drift to the wrong geography (a ZIP figure must not be refreshed with a metro number).
  const placeHint = scope?.value
    ? scope.kind === "county"
      ? `${scope.value} County Florida`
      : `${scope.value} Florida`
    : "";
  const forced = staleFiguresToRequests(stale, placeHint);
  const isFigureAsk = looksLikeFigureAsk(prompt);
  const heldSummary = composeLakeContext(lakeParts.figures, lakeParts.dossier);
  const web =
    forced.length > 0 || isFigureAsk
      ? await webFallback(prompt, heldSummary, {
          forced,
          // Skip the (LLM) gap probe when we're here only to refresh stale figures.
          probe: isFigureAsk ? undefined : async () => [],
        }).catch(() => ({ verified: [], unfound: [] }))
      : { verified: [], unfound: [] };
  const refreshedLabels = web.verified.map((v) => v.label);
  const survivingFigures = dropSuperseded(lakeParts.figures, refreshedLabels);
  const lakeContext = composeLakeContext(survivingFigures, lakeParts.dossier);
  const webBlock = renderWebFallbackBlock(web); // "" when no gap; starts with \n\n otherwise

  if (chartRes) doc = upsertChartBlock(doc, chartImageBlock(chartRes.image));
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
  const fullContext = lakeContext + chartGroundingPart + webBlock + freshnessDirective;

  const msg = await client.messages.create({
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
      // Freshness: which stale held figures the AI replaced with a current web-cited value,
      // and the sources it cited — so the UI can show "found fresher data" + the citations.
      webRefreshed: refreshedLabels,
      webSources: web.verified.map((v) => ({ label: v.label, value: v.value, url: v.url })),
    },
  };
}
