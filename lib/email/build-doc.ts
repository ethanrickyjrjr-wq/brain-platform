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
import { loadMarketFigures, figuresToPromptBlock } from "@/lib/email/market-context";
import { resolveEmailModel } from "@/lib/email/model-router";
import { chartImageBlock, upsertChartBlock } from "@/lib/email/inject-chart";
import { buildTrendChartUrl, type TrendPoint } from "@/lib/email/chart-image";
import { loadMetroTrend } from "@/lib/charts/load-metro-trend";

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

export async function fetchLakeContext(scope?: BuildScope): Promise<string> {
  const [figs, dossier] = await Promise.all([
    loadMarketFigures(scope).catch(() => []),
    fetchMasterDossier(scope).catch(() => ""),
  ]);
  const parts: string[] = [];
  if (figs.length)
    parts.push(
      `CITED FIGURES (quote verbatim — value · source · as-of):\n${figuresToPromptBlock(figs)}`,
    );
  if (dossier)
    parts.push(`FULL SWFL MARKET DOSSIER (all site data — choose what's relevant):\n${dossier}`);
  return parts.join("\n\n");
}

// ── Best-effort market chart (never blocks the build) ────────────────────────
function cityForScope(scope?: BuildScope): "cape_coral" | "fort_myers" | "naples" {
  const v = (scope?.value ?? "").toLowerCase();
  if (v.includes("naples") || v.includes("collier") || v.startsWith("341")) return "naples";
  if (v.includes("cape")) return "cape_coral";
  return "fort_myers";
}

const CITY_LABEL: Record<string, string> = {
  cape_coral: "Cape Coral",
  fort_myers: "Fort Myers",
  naples: "Naples",
};

/** Render a real ZHVI home-value trend for the scope, host it, and return an image
 *  spec — or null on any miss (no creds / no data / too few points). NEVER throws:
 *  a chart is a bonus, the build is never blocked on it (RULE 0.7). */
async function buildScopeChart(
  doc: EmailDoc,
  scope?: BuildScope,
): Promise<{ url: string; alt: string; caption: string } | null> {
  try {
    const panel = await loadMetroTrend("zhvi_pivoted");
    if (panel.error || panel.data.length < 3) return null;
    const city = cityForScope(scope);
    const points: TrendPoint[] = panel.data
      .map((r) => ({ label: String(r.month), value: Number((r as Record<string, unknown>)[city]) }))
      .filter((p) => Number.isFinite(p.value));
    if (points.length < 3) return null;
    const trimmed = points.slice(-18); // last ~18 months reads cleanly at 600px
    const label = CITY_LABEL[city] ?? "Southwest Florida";
    const asOfPart = panel.asOf ? ` · as of ${panel.asOf}` : "";
    const url = await buildTrendChartUrl(trimmed, {
      title: `${label} home value trend`,
      accent: doc.globalStyle.accentColor || "#3DC9C0",
      valueFormat: "usd",
      source: "Zillow ZHVI · SWFL Data Gulf",
      asOf: panel.asOf,
      key: `email-charts/zhvi-${city}-${panel.asOf ?? "latest"}.png`,
    });
    return {
      url,
      alt: `${label} home value trend (monthly, Zillow ZHVI)`,
      caption: `${label} home value trend — Zillow ZHVI${asOfPart}`,
    };
  } catch {
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
}: BuildArgs): Promise<BuildResult> {
  const docParsed = EmailDocSchema.safeParse(rawDoc);
  if (!docParsed.success) {
    return { httpStatus: 400, payload: { error: "Invalid email document." } };
  }
  let doc = docParsed.data;
  const model = resolveEmailModel(mode);

  // Lake context + chart in parallel; the chart is best-effort and pre-injected so
  // the AI captions an already-present chart instead of refusing to make one.
  const [lakeContext, chart] = await Promise.all([
    fetchLakeContext(scope),
    buildScopeChart(doc, scope),
  ]);
  if (chart) doc = upsertChartBlock(doc, chartImageBlock(chart));

  const msg = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: contentPatchSystem(lakeContext, !!chart),
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

  return { payload: { doc: reparsed.data, applied: true, patch, chart: Boolean(chart) } };
}
