// composeChartFromRequest — Tier C of the chart engine: the user-DIRECTED custom
// chart. When someone says "chart median price for these 3 ZIPs", "plot vacancy vs
// asking rent", "graph permits by corridor", the canned producers can't honor the
// exact ask — this one can. The model SELECTS which held figures to plot and the
// shape; it NEVER writes a number.
//
// THE MOAT (structural, not trust — "select rows, never emit cells"):
//   The model is handed a DATA MENU where every chartable figure is a point with a
//   stable id, its REAL entity label, the metric it measures, and its REAL value
//   (all from the audited brain outputs). The model returns a list of point IDS +
//   a title + a shape — and NOTHING ELSE numeric. Our code reads each selected
//   point's (entity, value) straight from the menu and assembles the cells. Because
//   the number AND its label travel together from one source point, a value can
//   NEVER land under the wrong entity OR the wrong metric — mispairing (gross or
//   column-level) is impossible by construction, not caught after the fact. The
//   old "model emits cells, we verify them" design could plot a real Estero number
//   in the rent column; this design cannot express that.
//
// `lintChartBlock` stays as a cheap belt-and-suspenders (every plotted number is a
// held number — trivially true here) so a future regression in the assembler can't
// ship a fabricated cell.
//
// A number we DON'T hold is the live cited gap-fill (Increment B) — layered on top
// via `external_points`; until then a request we can't satisfy returns null and the
// caller falls back to the canned chart (or text-only). Never throws.
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, TRIAGE_MODEL } from "@/refinery/agents/anthropic.mts";
import { resolveReachTargets } from "@/lib/highlighter/reach";
import { fetchBrain } from "@/lib/fetch-brain";
import {
  lintChartBlock,
  type ChartBlock,
  type ChartValueFormat,
} from "@/refinery/validate/chart-block-lint.mts";
import { summarizeChartForGrounding } from "@/lib/build-chart-for-intent.mts";
import {
  fillExternalPoint,
  valueAppearsInText,
  type ExternalPoint,
  type ExternalRequest,
} from "@/lib/assistant/gap-fill";
import type {
  BrainOutput,
  BrainOutputMetricDisplayFormat,
} from "@/refinery/types/brain-output.mts";
import type { ChartSpec } from "@/components/charts/registry/chart-spec";
import type { ChartForQuestion } from "@/lib/assistant/chart-for-question";

const MAX_TOKENS = 900;
const MAX_MENU_CHARS = 12_000; // bound the data menu so the LLM call stays cheap
const MAX_TABLE_ROWS = 40; // per detail_table, into the menu
const MAX_POINTS = 240; // hard cap on selectable points (menu size guard)
const MAX_BARS = 12; // cap rendered bars (mirrors computeMetricChart)
const MAX_EXTERNAL = 4; // cap live gap-fill lookups per chart (cost/latency guard)
const MAX_UPLOADS_CHARS = 20_000; // bound the uploaded-document text fed to the model

/** The user is explicitly asking us to build a chart (vs. an analytical question
 *  that may auto-chart). Only then do we pay for the compose LLM call. */
export function wantsCustomChart(question: string): boolean {
  return /\b(charts?|charting|plots?|plotting|graphs?|graphing|visuali[sz]e[sd]?|visuali[sz]ation|bar chart|line chart|pie chart|trend\s+line)\b/i.test(
    question || "",
  );
}

/** Map a source `display_format` to the chart renderer's numeric formatter
 *  (mirrors chart-from-metrics.valueFormatFor — kept local to avoid widening
 *  that module's export surface). */
function valueFormatFor(fmt: BrainOutputMetricDisplayFormat | undefined): ChartValueFormat {
  switch (fmt) {
    case "currency":
      return "usd";
    case "percent":
      return "percent";
    case "count":
      return "count";
    default:
      return "number";
  }
}

/** One selectable figure in the data menu. The number and its labels travel
 *  TOGETHER from a single audited source — the model only references it by id. */
export interface MenuPoint {
  id: string; // "p0", "p1", … — what the model selects
  entity: string; // category-axis label (corridor / ZIP / metric name)
  metric: string; // what the value measures (column / metric label)
  value: number;
  unit: string; // normalized units ("" when none)
  format: ChartValueFormat;
  brain: string; // source slug (for citation)
}

export interface Menu {
  points: MenuPoint[];
  byId: Map<string, MenuPoint>;
  numbers: Set<number>; // every held value (belt-and-suspenders lint anchor)
  asOf: string; // newest brain refined_at (ISO YYYY-MM-DD)
  citation: string;
}

/** Collect a compact, bounded data menu of selectable points from the brains most
 *  relevant to the question (master + reach targets). Every numeric key_metric and
 *  every numeric detail_table cell becomes one point. */
async function buildMenu(question: string, origin: string): Promise<Menu | null> {
  const slugs = ["master", ...resolveReachTargets(question, "master")].filter(
    (s, i, a) => a.indexOf(s) === i,
  );
  const points: MenuPoint[] = [];
  const numbers = new Set<number>();
  const brains: string[] = [];
  let asOf = "";
  let pid = 0;

  for (const slug of slugs) {
    if (points.length >= MAX_POINTS) break;
    let output: BrainOutput;
    try {
      ({ output } = await fetchBrain(slug, { tier: 2, origin }));
    } catch {
      continue;
    }
    if (output.refined_at && output.refined_at.slice(0, 10) > asOf)
      asOf = output.refined_at.slice(0, 10);

    let added = 0;

    for (const m of output.key_metrics) {
      if (typeof m.value !== "number") continue;
      if (points.length >= MAX_POINTS) break;
      points.push({
        id: `p${pid++}`,
        entity: m.label,
        metric: m.label,
        value: m.value,
        unit: (m.units ?? "").trim().toLowerCase(),
        format: valueFormatFor(m.display_format),
        brain: slug,
      });
      numbers.add(m.value);
      added++;
    }

    for (const t of output.detail_tables ?? []) {
      for (const col of t.columns) {
        for (const r of t.rows.slice(0, MAX_TABLE_ROWS)) {
          const v = r.cells[col.id];
          if (typeof v !== "number") continue;
          if (points.length >= MAX_POINTS) break;
          points.push({
            id: `p${pid++}`,
            entity: r.label || r.key,
            metric: col.label,
            value: v,
            unit: (col.units ?? "").trim().toLowerCase(),
            format: valueFormatFor(col.display_format),
            brain: slug,
          });
          numbers.add(v);
          added++;
        }
      }
    }

    if (added > 0) brains.push(slug);
  }

  if (points.length === 0) return null; // nothing to chart honestly
  const byId = new Map(points.map((p) => [p.id, p]));
  return {
    points,
    byId,
    numbers,
    asOf: asOf || new Date(0).toISOString().slice(0, 10),
    citation: `SWFL Data Gulf — ${brains.join(", ")}`,
  };
}

/** Render the menu as compact text the model selects from (grouped by brain). */
function renderMenu(menu: Menu): string {
  const byBrain = new Map<string, MenuPoint[]>();
  for (const p of menu.points) {
    const g = byBrain.get(p.brain);
    if (g) g.push(p);
    else byBrain.set(p.brain, [p]);
  }
  const blocks: string[] = [];
  for (const [brain, pts] of byBrain) {
    const lines = pts.map((p) => {
      const metricSuffix = p.metric && p.metric !== p.entity ? ` — ${p.metric}` : "";
      const unit = p.unit ? ` ${p.unit}` : "";
      return `  [${p.id}] ${p.entity}${metricSuffix}: ${p.value}${unit}`;
    });
    blocks.push(`BRAIN ${brain}:\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n").slice(0, MAX_MENU_CHARS);
}

// The forced tool. The model SELECTS point ids — it never writes a number.
const RECORD_CHART_TOOL = {
  name: "build_chart",
  description:
    "Build the chart the user asked for by SELECTING points from the DATA MENU. " +
    "You choose WHICH figures to plot (by their [pN] id) and the shape — you NEVER " +
    "write a number yourself; every value comes from the point you selected. Prefer " +
    "points that share one metric/unit for a clean comparison (e.g. all the vacancy " +
    "points across corridors). If the menu has nothing that answers the request, " +
    "return an empty point_ids array.\n\n" +
    "If a needed figure is NOT in the menu, look in PRIORITY ORDER:\n" +
    "(1) If YOUR UPLOADED DOCUMENTS (when present below) contain it, put it in " +
    "upload_points with the label, the exact number from the document, and the " +
    "source_doc — do NOT web-search for something the uploads already answer.\n" +
    "(2) Otherwise, use external_points to fetch it live from the web — this applies to " +
    "ANY figure the user explicitly asked for that is NOT in the menu, including SWFL " +
    "primary metrics (active listings, days on market, inventory, absorption rate, etc.) " +
    "AND peer/context figures (a comparable market's vacancy, a national average, a " +
    "current rate). Add it to external_points with a label and a focused web-search " +
    "query — the system fetches it live from authoritative sources (Redfin, Zillow, " +
    "Census, BLS, etc.), verifies it against a real cited source, and cites it. Do NOT " +
    "request a figure we already hold in the menu or in the uploads. Never put a number " +
    "in the query.\n\n" +
    "If the USER stated a figure themselves in their message (e.g. 'chart Tampa at " +
    "11%', 'add our Q2 absorption of 40,000 sqft'), put it in user_points with the " +
    "label and the exact number the user gave. These are charted as the user's own " +
    "data and footnoted 'Provided by you' — copy the user's number exactly; only ever " +
    "include a number the user actually stated.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", description: "Short, plain chart title (no internal ids/jargon)." },
      category_label: {
        type: "string",
        description: "Header for the label column, e.g. 'Corridor', 'ZIP', 'Area'.",
      },
      point_ids: {
        type: "array",
        items: { type: "string" },
        description: "Ordered list of [pN] ids from the DATA MENU to plot.",
      },
      chart_type: {
        type: "string",
        enum: ["bar", "table"],
        description: "bar renders a chart; table renders a labeled table.",
      },
      external_points: {
        type: "array",
        description:
          "Optional peer/context figures NOT in the menu, fetched live + cited. " +
          "Omit if held data fully answers the request.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string", description: "Bar label, e.g. 'Tampa office vacancy'." },
            search_query: {
              type: "string",
              description: "Focused query, e.g. 'Tampa office vacancy rate 2026'. No numbers.",
            },
          },
          required: ["label", "search_query"],
        },
      },
      upload_points: {
        type: "array",
        description:
          "Figures taken from the user's UPLOADED DOCUMENTS (when present below). Copy " +
          "the exact number from the document; only numbers actually in the documents.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string", description: "Bar label." },
            value: { type: "number", description: "The exact number from the document." },
            source_doc: { type: "string", description: "Which document, e.g. the filename." },
          },
          required: ["label", "value"],
        },
      },
      user_points: {
        type: "array",
        description:
          "Optional figures the USER stated in their own message. Charted as their " +
          "data, footnoted 'Provided by you'. Copy the user's number exactly; only " +
          "numbers the user actually stated.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string", description: "Bar label, e.g. 'Tampa office vacancy'." },
            value: { type: "number", description: "The exact number the user stated." },
            unit: {
              type: "string",
              description: "Unit if the user gave one, e.g. 'percent', 'usd'.",
            },
          },
          required: ["label", "value"],
        },
      },
    },
    required: ["title", "category_label", "point_ids", "chart_type"],
  },
} as const;

/** The held-data half of the model's selection — all `buildHeldChartBlock` needs. */
interface HeldSelection {
  title: string;
  category_label: string;
  point_ids: string[];
  chart_type: "bar" | "table";
}

/** A figure the user stated themselves — charted as their data, footnoted. */
export interface UserPoint {
  label: string;
  value: number;
  unit?: string;
}

/** A figure the model read out of the user's uploaded document(s). Verified to
 *  appear verbatim in the upload text before it's plotted. */
export interface UploadPoint {
  label: string;
  value: number;
  /** The document it came from, e.g. a filename — for the footnote. */
  source_doc?: string;
}

interface BuildChartInput extends HeldSelection {
  external_points: ExternalRequest[];
  upload_points: UploadPoint[];
  user_points: UserPoint[];
}

/** Pure assembler: resolve the model's selected ids against the menu and build a
 *  ChartBlock whose every cell is a REAL (entity, value) pair copied verbatim from
 *  a source point. Returns null when no valid point was selected. Exported for unit
 *  testing — this is where the structural moat lives, so it is tested directly. */
export function buildHeldChartBlock(input: HeldSelection, menu: Menu): ChartBlock | null {
  const seen = new Set<string>();
  const picked: MenuPoint[] = [];
  for (const id of Array.isArray(input.point_ids) ? input.point_ids : []) {
    const p = menu.byId.get(id);
    if (p && !seen.has(id)) {
      seen.add(id);
      picked.push(p);
    }
    if (picked.length >= MAX_BARS) break;
  }
  if (picked.length < 1) return null;

  // Series coherence: a single shared metric → clean single-series axis; mixed
  // metrics → label each bar by entity+metric and use a neutral numeric axis (we
  // never claim one $/% format across heterogeneous figures).
  const metrics = new Set(picked.map((p) => p.metric));
  const singleMetric = metrics.size === 1;

  let valueHeader: string;
  let valueFormat: ChartValueFormat;
  let rows: ChartBlock["rows"];
  if (singleMetric) {
    const m = picked[0];
    valueHeader = m.unit ? `${m.metric} (${m.unit})` : m.metric;
    valueFormat = m.format;
    rows = picked.map((p): [string, number] => [p.entity, p.value]);
  } else {
    valueHeader = "Value";
    valueFormat = "number";
    rows = picked.map((p): [string, number] => [
      p.entity === p.metric ? p.entity : `${p.entity} — ${p.metric}`,
      p.value,
    ]);
  }

  const block: ChartBlock = {
    title: typeof input.title === "string" && input.title ? input.title : "Chart",
    columns: [
      typeof input.category_label === "string" && input.category_label
        ? input.category_label
        : "Item",
      valueHeader,
    ],
    rows,
    chart_type: input.chart_type === "table" ? "table" : "bar",
    value_format: valueFormat,
    asOf: menu.asOf,
    source: { citation: menu.citation },
  };
  return block;
}

/** Host of a URL for the small-print footnote (no scheme/path), e.g.
 *  "https://gulfshorebusiness.com/x" → "gulfshorebusiness.com". */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Append verified external (gap-filled) rows to a held block: extra bars on the
 *  same axis, the external sources listed in the small-print caption, and the
 *  expanded number set so the belt lint accepts these cited-and-verified values.
 *  Pure — exported for unit testing. */
export function attachExternalPoints(
  block: ChartBlock,
  externals: ExternalPoint[],
  heldNumbers: ReadonlySet<number>,
): { block: ChartBlock; numbers: Set<number> } {
  const numbers = new Set(heldNumbers);
  if (externals.length === 0) return { block, numbers };

  const extraRows = externals.map((e): [string, number] => [e.label, e.value]);
  for (const e of externals) numbers.add(e.value);
  const rows = [...block.rows, ...extraRows].slice(0, MAX_BARS);

  const peerNote = externals.map((e) => `${e.label} — ${hostOf(e.url)}`).join("; ");
  const base = block.source?.citation ?? "";
  const citation = base ? `${base} · Peer data (web): ${peerNote}` : `Peer data (web): ${peerNote}`;

  return {
    block: {
      ...block,
      rows,
      source: { ...(block.source ?? { citation: "" }), citation },
    },
    numbers,
  };
}

/** Append UPLOAD-DERIVED rows: figures the model read out of the user's uploaded
 *  documents. THE MOAT: each is kept ONLY if its digits appear verbatim in the upload
 *  text (`valueAppearsInText`) — the model can't fabricate a number and attribute it
 *  to an upload. Footnoted "From your upload". Their values join the lint anchor.
 *  Pure — exported for unit testing. */
export function attachUploadPoints(
  block: ChartBlock,
  uploadPoints: UploadPoint[],
  uploadsText: string,
  baseNumbers: ReadonlySet<number>,
): { block: ChartBlock; numbers: Set<number> } {
  const numbers = new Set(baseNumbers);
  const verified = uploadPoints.filter(
    (u) => u && typeof u.value === "number" && u.label && valueAppearsInText(u.value, uploadsText),
  );
  if (verified.length === 0) return { block, numbers };

  const extraRows = verified.map((u): [string, number] => [u.label, u.value]);
  for (const u of verified) numbers.add(u.value);
  const rows = [...block.rows, ...extraRows].slice(0, MAX_BARS);

  const docs = [...new Set(verified.map((u) => u.source_doc).filter(Boolean))].join(", ");
  const note = `From your upload${docs ? ` (${docs})` : ""}: ${verified.map((u) => u.label).join("; ")}`;
  const base = block.source?.citation ?? "";
  const citation = base ? `${base} · ${note}` : note;

  return {
    block: { ...block, rows, source: { ...(block.source ?? { citation: "" }), citation } },
    numbers,
  };
}

/** Append USER-PROVIDED rows: the user's own figures, charted as their data and
 *  footnoted "Provided by you" so they are never mistaken for our cited numbers or a
 *  web peer. Their values join the lint anchor (the user supplied them — we mark
 *  them, we don't verify them; the no-invention moat is about the AI, not the user).
 *  Pure — exported for unit testing. */
export function attachUserPoints(
  block: ChartBlock,
  userPoints: UserPoint[],
  baseNumbers: ReadonlySet<number>,
): { block: ChartBlock; numbers: Set<number> } {
  const numbers = new Set(baseNumbers);
  const clean = userPoints.filter((u) => u && typeof u.value === "number" && u.label);
  if (clean.length === 0) return { block, numbers };

  const extraRows = clean.map((u): [string, number] => [u.label, u.value]);
  for (const u of clean) numbers.add(u.value);
  const rows = [...block.rows, ...extraRows].slice(0, MAX_BARS);

  const userNote = clean.map((u) => u.label).join("; ");
  const base = block.source?.citation ?? "";
  const citation = base ? `${base} · Provided by you: ${userNote}` : `Provided by you: ${userNote}`;

  return {
    block: { ...block, rows, source: { ...(block.source ?? { citation: "" }), citation } },
    numbers,
  };
}

export async function composeChartFromRequest(
  question: string,
  origin: string,
  opts: { uploadsText?: string } = {},
): Promise<ChartForQuestion | null> {
  if (!wantsCustomChart(question)) return null;

  // The user's uploaded-document text (bounded) — scanned BEFORE the internet for any
  // figure we don't hold. "" when there are no uploads (public / no project).
  const uploadsText = (opts.uploadsText ?? "").slice(0, MAX_UPLOADS_CHARS);

  let menu: Menu | null;
  try {
    menu = await buildMenu(question, origin);
  } catch {
    return null;
  }
  if (!menu) return null;

  let input: BuildChartInput | null = null;
  try {
    const client = getAnthropic("assistant_chart");
    const uploadsBlock = uploadsText
      ? `\n\n=== YOUR UPLOADED DOCUMENTS (the user's own files — prefer these over a web ` +
        `search; copy numbers exactly) ===\n${uploadsText}`
      : "";
    const msg = await client.messages.create({
      model: TRIAGE_MODEL,
      max_tokens: MAX_TOKENS,
      tools: [RECORD_CHART_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: "build_chart" },
      messages: [
        {
          role: "user",
          content:
            `The user asked: "${question}"\n\n` +
            `Build the chart they asked for by selecting point ids from this DATA MENU. ` +
            `Never write a number — only select [pN] ids. If the menu can't answer the ` +
            `request, return an empty point_ids array.\n` +
            `If the user names a comparison target (a place, market, rate, or metric) that ` +
            `is NOT in the menu: take it from YOUR UPLOADED DOCUMENTS if present there ` +
            `(upload_points), otherwise add it to external_points for a live cited web ` +
            `fetch.\n\n=== DATA MENU ===\n${renderMenu(menu)}${uploadsBlock}`,
        },
      ],
    });
    const tool = msg.content.find((b) => b.type === "tool_use") as
      Anthropic.ToolUseBlock | undefined;
    const raw = (tool?.input ?? {}) as Record<string, unknown>;
    const rawExternals = Array.isArray(raw.external_points) ? raw.external_points : [];
    const rawUploads = Array.isArray(raw.upload_points) ? raw.upload_points : [];
    const rawUser = Array.isArray(raw.user_points) ? raw.user_points : [];
    input = {
      title: typeof raw.title === "string" ? raw.title : "Chart",
      category_label: typeof raw.category_label === "string" ? raw.category_label : "Item",
      point_ids: Array.isArray(raw.point_ids) ? (raw.point_ids as string[]) : [],
      chart_type: raw.chart_type === "table" ? "table" : "bar",
      external_points: rawExternals
        .map((e) => e as Record<string, unknown>)
        .filter((e) => typeof e.label === "string" && typeof e.search_query === "string")
        .slice(0, MAX_EXTERNAL)
        .map((e) => ({ label: e.label as string, search_query: e.search_query as string })),
      upload_points: rawUploads
        .map((u) => u as Record<string, unknown>)
        .filter((u) => typeof u.label === "string" && typeof u.value === "number")
        .slice(0, MAX_BARS)
        .map((u) => ({
          label: u.label as string,
          value: u.value as number,
          source_doc: typeof u.source_doc === "string" ? u.source_doc : undefined,
        })),
      user_points: rawUser
        .map((u) => u as Record<string, unknown>)
        .filter((u) => typeof u.label === "string" && typeof u.value === "number")
        .slice(0, MAX_BARS)
        .map((u) => ({
          label: u.label as string,
          value: u.value as number,
          unit: typeof u.unit === "string" ? u.unit : undefined,
        })),
    };
  } catch {
    return null;
  }

  // Base block from held data. May be null when the user is charting ONLY external or
  // their own figures (e.g. "chart Tampa at 11%") — synthesize an empty base so those
  // lanes can still produce a chart.
  let block =
    buildHeldChartBlock(input, menu) ??
    ({
      title: input.title || "Chart",
      columns: [input.category_label || "Item", "Value"],
      rows: [],
      chart_type: input.chart_type === "table" ? "table" : "bar",
      value_format: "number",
      asOf: menu.asOf,
      source: { citation: "" },
    } satisfies ChartBlock);

  // Increment D — upload-fill (PRIORITY before the web). Keep only the figures the
  // model read from the uploaded docs that verify verbatim against the upload text.
  const withUpload = attachUploadPoints(block, input.upload_points, uploadsText, menu.numbers);
  const verifiedUploads = input.upload_points.filter((u) =>
    valueAppearsInText(u.value, uploadsText),
  );

  // Increment B — live cited gap-fill. Fetch each requested peer/context figure and
  // keep ONLY those verified verbatim against a real cited source (gap-fill.ts is the
  // moat). Best-effort: a failed/unverifiable lookup is dropped, never blocks.
  let externals: ExternalPoint[] = [];
  if (input.external_points.length > 0) {
    const settled = await Promise.all(
      input.external_points.map((req) =>
        fillExternalPoint(req).catch(() => null as ExternalPoint | null),
      ),
    );
    externals = settled.filter((e): e is ExternalPoint => e !== null);
  }
  const withExternal = attachExternalPoints(withUpload.block, externals, withUpload.numbers);
  // User-provided lane — the user's own figures, footnoted "Provided by you".
  const withUser = attachUserPoints(withExternal.block, input.user_points, withExternal.numbers);
  block = withUser.block;

  if (block.rows.length < 1) return null; // nothing to chart from any lane → canned fallback

  // BELT-AND-SUSPENDERS: every plotted number must trace to a held figure, an
  // upload-verified value, a citation-verified web value, or a user-supplied value.
  if (!lintChartBlock(block, withUser.numbers).ok) return null;

  const hasExtras =
    externals.length > 0 || verifiedUploads.length > 0 || input.user_points.length > 0;
  const chart: ChartSpec = {
    ...block,
    frameId: "bar-table",
    ...(hasExtras
      ? {
          options: {
            externalSources: externals,
            uploadSources: verifiedUploads,
            userSources: input.user_points,
          },
        }
      : {}),
  };
  // The grounding note lists every plotted row and the "state ONLY these" rule; name
  // the upload figures (attribute to the user's doc), the web sources (to cite), and
  // the user-provided figures (to attribute).
  let groundingNote = summarizeChartForGrounding(chart);
  if (verifiedUploads.length > 0) {
    groundingNote +=
      "\nFigures from the user's uploaded document(s) (attribute to their upload, not our data): " +
      verifiedUploads.map((u) => `${u.label} = ${u.value}`).join("; ") +
      ".";
  }
  if (externals.length > 0) {
    groundingNote +=
      "\nPeer/context figures fetched live and cited (state the source if you mention them): " +
      externals.map((e) => `${e.label} = ${e.value} (${hostOf(e.url)})`).join("; ") +
      ".";
  }
  if (input.user_points.length > 0) {
    groundingNote +=
      "\nUser-provided figures (attribute to the user — 'you provided', not our data): " +
      input.user_points.map((u) => `${u.label} = ${u.value}`).join("; ") +
      ".";
  }
  return { chart, groundingNote };
}
