// lib/email/author-doc.ts
//
// The PURE half of the Email Lab AUTHOR engine (paid tier — build 03). The model
// AUTHORS a whole document — which blocks, in what order, grouped into rows — from
// a bounded real-data MENU. The orchestration (lake fetch, chart/photo resolve,
// the model call, the repair loop) lives in build-doc.ts beside buildContentDoc;
// everything HERE is pure (no I/O) so the moat is unit-testable in isolation.
//
// THE MOAT — the platform's two existing guarantees, composed (no third mechanism):
//   1. id-selection (mirrors lib/assistant/compose-chart.ts): a numeric field
//      carries a `value_figure` id into the MENU; assembleAuthoredDoc writes that
//      figure's verbatim value. The model never types a headline/stat number, so a
//      figure can never land mis-paired or invented in a number-bearing field.
//   2. no-invention prose lint (mirrors lib/deliverable/build.ts gateNarrative):
//      every numeric token in authored PROSE must anchor verbatim to the data feed
//      (menu values + the on-screen chart's figures). Reuses narrative-lint's ONE
//      tokenizer/normalizer — never a fork.
// Brand is never authored: assembly starts each block from default (non-content)
// props and the caller overlays applyBrand AFTER (brand stays canonical, ONE root).
//
// LAYOUT IS SEMANTIC, NOT ABSOLUTE — see AuthorDocSchema in ./doc/schema.ts: the
// model emits `span` + `new_row`; THIS module derives bounds-correct {x,y,w,h}.

import { DEFAULT_BLOCK_PROPS, defaultPropsFor } from "./doc/default-docs";
import { mintBlockId } from "./doc/schema";
import type { AuthoredBlock, AuthoredDoc } from "./doc/schema";
import type { BlockLayout, BlockType, EmailBlock, EmailDoc, EmailGlobalStyle } from "./doc/types";
import { GRID_COLS } from "./grid-schema";
import type { MarketFigure } from "./market-context";
import { chartImageBlock } from "./inject-chart";
import { heroPhotoBlock } from "./inject-photo";
import { extractNumbers, normalizeNumber, anchorsExactly } from "@/lib/deliverable/narrative-lint";

// ── The data MENU (the email's native cited figures, given selectable ids) ─────
// MarketFigure already carries a formatted, cited value ("$485,000", "+4.2%",
// "34") — so id-selection is trivial: the model picks [fN], the engine writes
// that figure's `value` verbatim. No re-formatting, no number ever authored.

export interface MenuFigure {
  id: string; // "f0", "f1", … — what the model selects
  figure: MarketFigure;
}

export function buildFigureMenu(figures: MarketFigure[]): MenuFigure[] {
  return figures.map((figure, i) => ({ id: `f${i}`, figure }));
}

export function figureMenuById(menu: MenuFigure[]): Map<string, MarketFigure> {
  return new Map(menu.map((m) => [m.id, m.figure]));
}

/** Render the menu as the compact, id-tagged block the author selects from. */
export function renderFigureMenu(menu: MenuFigure[]): string {
  if (!menu.length) return "(no held figures for this scope — write a cited-figure-free email)";
  return menu
    .map((m) => {
      const f = m.figure;
      const prov = f.as_of ? `${f.source}, ${f.as_of}` : f.source;
      return `  [${m.id}] ${f.label} = ${f.value} (${prov})`;
    })
    .join("\n");
}

// ── The forced tool — the author SELECTS structure + content, never numbers ────

export const AUTHOR_TOOL = {
  name: "author_email",
  description:
    "Author a complete marketing email as an ordered list of blocks. You choose " +
    "WHICH blocks, in WHAT order, and how they group into rows.\n\n" +
    "THE ONE HARD RULE — you never write a number. For any headline or KPI figure, " +
    "set `value_figure` (a [fN] id from the DATA MENU); the system fills that " +
    "figure's exact value. In prose you may ONLY mention a number that appears " +
    "verbatim in the DATA MENU (or in the on-screen chart) — quote it exactly, " +
    "digit-for-digit, never rounded ('$485,000', not '$485K' or 'about $485K'). " +
    "Any number you type that is not in the menu will be stripped. If the menu " +
    "lacks a figure, write around it — never invent one.\n\n" +
    "NOT YOURS — omit entirely: colors, fonts, logos, links/URLs, the company " +
    "name, the agent's name/photo, social handles, unsubscribe. The system applies " +
    "the user's saved brand and footer afterward. Just author the message.\n\n" +
    "LAYOUT — order blocks top to bottom. Set `new_row:false` to place a block " +
    "beside the previous one in the same row (e.g. two side-by-side stat callouts, " +
    "or a photo next to a text column); `new_row:true` (default) starts a new row. " +
    "`span` is the column width 1–12 (12 = full width); blocks in a row should sum " +
    "to about 12. Keep at most 3 blocks per row.\n\n" +
    "ASSETS — when the context says a CHART or a PHOTO is available, place an " +
    '`image` block with `image_role:"chart"` or `image_role:"photo"` where it ' +
    "best fits and write its caption/alt; the system drops in the real asset. Do " +
    "not place an image whose asset was not offered.\n\n" +
    "Lead with the answer, keep prose tight, no internal ids or jargon. Always " +
    "include a footer block.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      blocks: {
        type: "array",
        description: "Ordered blocks, top of the email first.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              description: "Block type — one of the BLOCK VOCABULARY listed in the prompt.",
            },
            span: {
              type: "integer",
              minimum: 1,
              maximum: 12,
              description: "Column width 1–12 (12 = full width).",
            },
            new_row: {
              type: "boolean",
              description: "true = start a new row; false = sit beside the previous block.",
            },
            value_figure: {
              type: "string",
              description:
                "A [fN] DATA MENU id whose verbatim value becomes this block's headline number.",
            },
            kicker: { type: "string" },
            label: { type: "string" },
            prose: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            caption: { type: "string" },
            alt: { type: "string" },
            tagline: { type: "string" },
            designation: { type: "string" },
            bio: { type: "string" },
            button_label: { type: "string" },
            align: { type: "string", enum: ["left", "center", "right"] },
            image_role: {
              type: "string",
              enum: ["chart", "photo"],
              description: "For an image block: which offered asset to place.",
            },
            stats: {
              type: "array",
              description: "KPI cells (max 3). Each number is a [fN] menu id via value_figure.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  value_figure: {
                    type: "string",
                    description: "A [fN] menu id; its verbatim value fills this cell.",
                  },
                  value: {
                    type: "string",
                    description:
                      "Only for a non-figure cell (e.g. 'Buyer\\'s market'); avoid raw numbers.",
                  },
                  label: { type: "string" },
                },
                required: ["label"],
              },
            },
          },
          required: ["type"],
        },
      },
      schedule_suggestion: {
        type: "object",
        additionalProperties: false,
        description:
          "OPTIONAL. Only if this content reads like a recurring digest (a weekly/monthly market " +
          "update, not a one-off announcement) — suggest a send cadence. Omit for a one-off email.",
        properties: {
          cadence: { type: "string", enum: ["weekly", "monthly"] },
          reason: { type: "string", description: "One sentence: why this cadence fits." },
        },
        required: ["cadence", "reason"],
      },
    },
    required: ["blocks"],
  },
} as const;

/** The dynamic system context: the data menu, qualitative framing, and which
 *  assets are on screen. Static rules live in AUTHOR_TOOL.description. */
export function authorSystem(opts: {
  menu: MenuFigure[];
  dossier: string;
  vocabulary: string[];
  hasChart: boolean;
  chartGrounding?: string;
  hasPhoto: boolean;
}): string {
  const parts: string[] = [
    "You are the design+copy author for SWFL Data Gulf, a Southwest Florida real " +
      "estate intelligence platform. You compose a complete, on-brand marketing " +
      "email from real data by calling the author_email tool.",
    `BLOCK VOCABULARY (use only these \`type\` values): ${opts.vocabulary.join(", ")}.`,
    `DATA MENU — the ONLY source of numbers. Select figures by their [fN] id; the\nsystem writes the exact value. Never type a number that is not here.\n${renderFigureMenu(opts.menu)}`,
    "SCHEDULING — if this content reads like a recurring digest (a weekly/monthly market update, not " +
      "a one-off), you MAY optionally set schedule_suggestion (cadence + a one-sentence reason). Omit " +
      "it for a one-off email.",
  ];
  if (opts.dossier) {
    parts.push(
      `CONTEXT — background for deciding WHAT is worth saying. Do NOT copy numbers\nout of this; every number must come from the DATA MENU above.\n${opts.dossier}`,
    );
  }
  if (opts.hasChart) {
    parts.push(
      `A market CHART is available — place ONE image block with image_role:"chart"\nand caption it from these real figures (never invent a caption number):\n${opts.chartGrounding ?? ""}`,
    );
  }
  if (opts.hasPhoto) {
    parts.push(
      `A property/agent PHOTO is available — place ONE image block with\nimage_role:"photo" as the lead visual and write its alt text.`,
    );
  }
  return parts.join("\n\n");
}

// ── Assembly: authored blocks → a positioned EmailDoc ─────────────────────────

const KNOWN_TYPES = new Set(Object.keys(DEFAULT_BLOCK_PROPS));

function isStructural(t: BlockType): boolean {
  return t === "header" || t === "footer" || t === "divider";
}

interface Entry {
  type: BlockType;
  span: number;
  newRow: boolean;
  props: Record<string, unknown>;
  isStatic?: boolean;
}

/** Fill a content block's text fields from the author's output, leaving identity/
 *  brand/structural defaults intact (applyBrand owns those). Number-bearing fields
 *  are resolved via the menu (`num`) — an unresolved id blanks the field rather
 *  than leaking the placeholder default number. */
function applyContent(
  type: BlockType,
  props: Record<string, unknown>,
  a: AuthoredBlock,
  num: (id?: string) => string | undefined,
): void {
  // Clamp to the TARGET prop-schema maxima (doc/schema.ts) so an over-long authored
  // field never fails EmailDocSchema and discards the whole doc. Authored maxima
  // already match for most fields; the exception is `signal.body` (author allows
  // 2000, SignalPropsSchema caps 500).
  switch (type) {
    // The model labels text fields loosely (it often puts a hero's headline in
    // `title` and its paragraph in `body`), so each field falls back across the
    // likely aliases before clamping to the TARGET prop maximum.
    case "hero":
      props.value = (num(a.value_figure) ?? "").slice(0, 24);
      props.kicker = (a.kicker ?? "").slice(0, 60);
      props.label = (a.label ?? a.title ?? "").slice(0, 80);
      props.prose = (a.prose ?? a.body ?? "").slice(0, 500);
      break;
    case "signal":
      props.kicker = (a.kicker ?? "").slice(0, 60);
      props.title = (a.title ?? a.label ?? "").slice(0, 120);
      props.body = (a.body ?? a.prose ?? "").slice(0, 500);
      break;
    case "text":
      props.body = (a.body ?? a.prose ?? "").slice(0, 2000);
      if (a.align) props.align = a.align;
      break;
    case "agent-card":
      if (a.bio !== undefined) props.bio = a.bio;
      break;
    case "agent-hero":
      if (a.tagline !== undefined) props.tagline = a.tagline;
      if (a.designation !== undefined) props.designation = a.designation;
      if (a.alt !== undefined) props.alt = a.alt;
      break;
    case "button":
      if (a.button_label) props.label = a.button_label;
      break;
    // header / footer / social-icons / divider: brand/structural — author writes none.
  }
}

interface AssetSlot {
  url: string;
  alt?: string;
  linkUrl?: string;
}

export interface AssembleArgs {
  authored: AuthoredDoc;
  figuresById: Map<string, MarketFigure>;
  globalStyle: EmailGlobalStyle;
  /** The same anchor strings the prose lint uses (menu values+labels + chart figures).
   *  A literal stat value carrying an UNanchored number is blanked here — closing the
   *  one number-field the prose lint can't see (stats is not a string field). */
  anchorNumbers: ReadonlyArray<string | number>;
  /** Resolved market chart image (alt is the auto alt; caption comes from the model). */
  chart?: AssetSlot | null;
  /** Resolved hero photo image. */
  photo?: AssetSlot | null;
}

/** A literal (non-figure) stat value is allowed ONLY if it invents no number: a
 *  value with no digits (e.g. "Buyer's market") passes; a value whose every numeric
 *  token anchors verbatim passes; anything else is blanked. This is the structural
 *  guard behind the schema's "a number here cannot be invented" promise — the prose
 *  lint never walks `stats`, so the check lives at assembly. */
function anchoredStatValue(raw: string, anchors: ReadonlySet<string>): string {
  const nums = extractNumbers(raw).filter((t) => !isBareYear(t));
  if (nums.length === 0) return raw; // qualitative — no figure to invent
  return nums.every((t) => anchorsExactly(t, anchors)) ? raw : "";
}

function buildEntry(
  a: AuthoredBlock,
  figuresById: Map<string, MarketFigure>,
  anchors: ReadonlySet<string>,
  chart: AssetSlot | null | undefined,
  photo: AssetSlot | null | undefined,
): { entry: Entry; placedChart: boolean; placedPhoto: boolean } | null {
  const type = a.type as BlockType;
  if (!KNOWN_TYPES.has(type)) return null; // unknown block type (drives off the ONE root) — skip
  const num = (id?: string) => (id ? figuresById.get(id)?.value : undefined);
  const span = a.span ?? GRID_COLS;
  const newRow = a.new_row ?? true;
  let placedChart = false;
  let placedPhoto = false;
  let props: Record<string, unknown>;

  if (type === "image") {
    if (a.image_role === "chart") {
      if (!chart) return null; // reserved a chart slot but none resolved — drop the empty block
      props = {
        ...chartImageBlock({
          url: chart.url,
          alt: a.alt ?? chart.alt ?? "Market chart",
          caption: a.caption,
          linkUrl: chart.linkUrl,
        }).props,
      };
      placedChart = true;
    } else if (a.image_role === "photo") {
      if (!photo) return null;
      props = {
        ...heroPhotoBlock({
          url: photo.url,
          alt: a.alt ?? photo.alt,
          caption: a.caption,
          linkUrl: photo.linkUrl,
        }).props,
      };
      placedPhoto = true;
    } else {
      return null; // image with no offered asset — skip (never emit an empty image)
    }
  } else if (type === "stats") {
    const cells = (a.stats ?? [])
      .map((s) => ({
        // id-selected figure value (always anchored) OR a literal that invents no
        // number (anchoredStatValue blanks an unanchored figure) — never raw model digits.
        value: num(s.value_figure) ?? anchoredStatValue(s.value ?? "", anchors),
        label: s.label ?? "",
      }))
      .filter((c) => c.value !== "" || c.label !== "")
      .slice(0, 3);
    if (cells.length === 0) return null; // no resolvable cells — skip (never ship placeholder stats)
    props = defaultPropsFor("stats") as unknown as Record<string, unknown>;
    props.stats = cells;
  } else {
    props = defaultPropsFor(type) as unknown as Record<string, unknown>;
    applyContent(type, props, a, num);
  }

  return {
    entry: { type, span, newRow, props, isStatic: type === "footer" },
    placedChart,
    placedPhoto,
  };
}

/** Group entries into rows (structural blocks + new_row force a break; ≤3 per row)
 *  and derive bounds-correct {x,y,w,h}: each row fills 12 columns, y increments by
 *  row, height is a uniform advisory 1 (email height is content-driven). Footer is
 *  marked static. This is what makes a no-react-grid-layout engine sound. */
function deriveLayout(entries: Entry[]): EmailBlock[] {
  const rows: Entry[][] = [];
  let cur: Entry[] = [];
  const flush = () => {
    if (cur.length) {
      rows.push(cur);
      cur = [];
    }
  };
  for (const e of entries) {
    if (isStructural(e.type)) {
      flush();
      rows.push([e]);
      continue;
    }
    if (e.newRow) flush();
    cur.push(e);
    if (cur.length >= 3) flush();
  }
  flush();

  const out: EmailBlock[] = [];
  let y = 0;
  for (const row of rows) {
    let spans: number[];
    if (row.length === 1) {
      spans = [GRID_COLS];
    } else {
      spans = row.map((e) => Math.max(1, Math.min(GRID_COLS, Math.round(e.span))));
      // trim down to ≤12
      while (spans.reduce((a, b) => a + b, 0) > GRID_COLS) {
        const idx = spans.indexOf(Math.max(...spans));
        spans[idx] = Math.max(1, spans[idx] - 1);
        if (spans[idx] === 1 && spans.every((s) => s === 1)) break;
      }
      // pad up to exactly 12 so columns butt edge-to-edge
      let rem = GRID_COLS - spans.reduce((a, b) => a + b, 0);
      let i = 0;
      while (rem > 0) {
        spans[i % spans.length] += 1;
        rem -= 1;
        i += 1;
      }
    }
    let x = 0;
    row.forEach((e, idx) => {
      const w = spans[idx];
      const layout: BlockLayout = { x, y, w, h: 1, ...(e.isStatic ? { static: true } : {}) };
      out.push({
        id: mintBlockId(),
        type: e.type,
        props: e.props,
        layout,
      } as unknown as EmailBlock);
      x += w;
    });
    y += 1;
  }
  return out;
}

const MAX_BLOCKS = 20; // mirrors EmailDocSchema blocks .max(20)

/** Trim to the schema's block cap while ALWAYS preserving the footer (CAN-SPAM). */
function capBlocks(entries: Entry[]): Entry[] {
  if (entries.length <= MAX_BLOCKS) return entries;
  const footer = entries.find((e) => e.type === "footer");
  const rest = entries.filter((e) => e !== footer);
  const kept = rest.slice(0, footer ? MAX_BLOCKS - 1 : MAX_BLOCKS);
  return footer ? [...kept, footer] : kept;
}

/** Assemble a positioned EmailDoc from the model's authored output. PURE. Brand is
 *  never authored — globalStyle is the incoming (branded) style, untouched. */
export function assembleAuthoredDoc(args: AssembleArgs): EmailDoc {
  const { authored, figuresById, globalStyle, anchorNumbers, chart, photo } = args;
  const anchors = buildAnchorSet(anchorNumbers); // for the stat-literal number guard
  const entries: Entry[] = [];
  let chartPlaced = false;
  let photoPlaced = false;

  for (const a of authored.blocks) {
    const r = buildEntry(a, figuresById, anchors, chart, photo);
    if (!r) continue;
    entries.push(r.entry);
    if (r.placedChart) chartPlaced = true;
    if (r.placedPhoto) photoPlaced = true;
  }

  // Reserve any offered-but-unplaced asset so a chart/photo NEVER bottom-dumps:
  // photo leads (after a header if present); chart sits just above the footer.
  if (photo && !photoPlaced) {
    const at = entries[0]?.type === "header" ? 1 : 0;
    entries.splice(at, 0, {
      type: "image",
      span: GRID_COLS,
      newRow: true,
      props: {
        ...heroPhotoBlock({ url: photo.url, alt: photo.alt, linkUrl: photo.linkUrl }).props,
      },
    });
  }
  if (chart && !chartPlaced) {
    const entry: Entry = {
      type: "image",
      span: GRID_COLS,
      newRow: true,
      props: {
        ...chartImageBlock({
          url: chart.url,
          alt: chart.alt ?? "Market chart",
          linkUrl: chart.linkUrl,
        }).props,
      },
    };
    const footerIdx = entries.findIndex((e) => e.type === "footer");
    if (footerIdx === -1) entries.push(entry);
    else entries.splice(footerIdx, 0, entry);
  }

  // CAN-SPAM: a footer always survives, even if the model omitted one.
  if (!entries.some((e) => e.type === "footer")) {
    entries.push({
      type: "footer",
      span: GRID_COLS,
      newRow: true,
      props: defaultPropsFor("footer") as unknown as Record<string, unknown>,
      isStatic: true,
    });
  }
  // Schema requires ≥1 block.
  if (entries.length === 0) {
    entries.push({ type: "text", span: GRID_COLS, newRow: true, props: { body: "" } });
  }

  return { globalStyle, blocks: deriveLayout(capBlocks(entries)) };
}

// ── The no-invention prose lint (gateNarrative philosophy, applied to blocks) ──

/** Free-text fields the author writes (number-bearing fields are id-selected, so
 *  they always anchor and are not linted here). */
const PROSE_FIELDS = [
  "kicker",
  "label",
  "prose",
  "title",
  "body",
  "caption",
  "alt",
  "tagline",
  "designation",
  "bio",
] as const;

/** Build the verbatim anchor set from the data feed — mirrors narrative-lint's own
 *  (non-exported) buildAnchorSet, reusing its tokenizer/normalizer. */
function buildAnchorSet(strings: ReadonlyArray<string | number>): Set<string> {
  const set = new Set<string>();
  for (const entry of strings) {
    const s = String(entry);
    for (const tok of extractNumbers(s)) {
      const n = normalizeNumber(tok);
      if (n) set.add(n);
    }
    const whole = normalizeNumber(s);
    if (whole) set.add(whole);
  }
  return set;
}

/** Every number string the prose is allowed to quote: the menu figures'
 *  values+labels plus any extra (the on-screen chart's plotted figures). */
export function collectAnchorNumbers(
  figures: MarketFigure[],
  extra: ReadonlyArray<string> = [],
): string[] {
  const out: string[] = [];
  for (const f of figures) {
    out.push(f.value);
    if (f.label) out.push(f.label);
  }
  out.push(...extra);
  return out;
}

function splitSentences(text: string): string[] {
  return (text.match(/[\s\S]+?(?:[.!?]+(?=\s|$)|$)/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** A bare 4-digit year (1900–2099) with no $/%/bps is a calendar reference, not a
 *  data figure — exempt it (mirrors narrative-lint.isBareYear). */
function isBareYear(token: string): boolean {
  if (/[$%]|bps|basis points/i.test(token)) return false;
  return /^(?:19|20)\d{2}$/.test(normalizeNumber(token));
}

export interface ProseLintResult {
  ok: boolean;
  /** The offending sentences (numbers not in the data feed) — named to the model on repair. */
  offending: string[];
  /** The doc with every offending sentence removed from its text field. */
  stripped: EmailDoc;
}

/**
 * Lint authored PROSE: every numeric token must appear verbatim in the data feed.
 * A sentence with any unanchored number is dropped from its field (the hard-strip
 * half of the gateNarrative loop). Returns the offending sentences so the caller
 * can name them in a single regeneration before stripping.
 */
export function lintAuthoredProse(
  doc: EmailDoc,
  anchorStrings: ReadonlyArray<string | number>,
): ProseLintResult {
  const anchors = buildAnchorSet(anchorStrings);
  const offending: string[] = [];

  const lintField = (text: string): string => {
    const kept: string[] = [];
    for (const sentence of splitSentences(text)) {
      let bad = false;
      for (const tok of extractNumbers(sentence)) {
        if (isBareYear(tok)) continue;
        if (!anchorsExactly(tok, anchors)) {
          bad = true;
          break;
        }
      }
      if (bad) offending.push(sentence);
      else kept.push(sentence);
    }
    return kept.join(" ");
  };

  const blocks = doc.blocks.map((b) => {
    const props = b.props as Record<string, unknown>;
    let changed = false;
    const next: Record<string, unknown> = { ...props };
    for (const field of PROSE_FIELDS) {
      const v = props[field];
      if (typeof v === "string" && v) {
        const cleaned = lintField(v);
        if (cleaned !== v) {
          next[field] = cleaned;
          changed = true;
        }
      }
    }
    return changed ? ({ ...b, props: next } as EmailBlock) : b;
  });

  return { ok: offending.length === 0, offending, stripped: { ...doc, blocks } };
}
