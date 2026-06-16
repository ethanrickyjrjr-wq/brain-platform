/**
 * lib/deliverable/templates.ts
 *
 * Deterministic template layer for client-ready deliverables.
 *
 * Separates CONTENT (LLM narrative + filed items) from TEMPLATE (visual
 * structure). buildRenderModel is a pure function — same inputs → same output,
 * no I/O, no Date.now(), no randomness. A "restyle" operation swaps the
 * TemplateId and re-calls buildRenderModel with the SAME narrative + items
 * with zero new LLM calls.
 */

import type { ProjectItem } from "../project/items";
import type { ChartBlock } from "../../refinery/validate/chart-block-lint.mts";
import type { ChartSpec } from "../../components/charts/registry/chart-spec";

// ---------------------------------------------------------------------------
// Re-export ChartBlock so downstream importers of this module don't need a
// direct refinery import for the narrow case where they only need the type via
// ResolvedChartItem.
// ---------------------------------------------------------------------------

export type { ChartBlock };

// ---------------------------------------------------------------------------
// Snapshot item types
// ---------------------------------------------------------------------------

/**
 * A chart ref that has been resolved into an embedded ChartBlock.
 * The deliverable snapshot stores this — never the bare ref.
 */
export type ResolvedChartItem = {
  kind: "chart";
  id: string;
  added_at: string;
  origin: "web" | "mcp";
  chart_id: string;
  title: string;
  chart_block: ChartBlock;
  freshness_token?: string;
};

/**
 * A live `frame` recipe that has been bound to live brain data at build time
 * and frozen into an embedded `ChartSpec`. The deliverable snapshot stores this
 * — never the bare recipe — so `/p/[id]` renders the exact numbers as of build.
 */
export type ResolvedFrameItem = {
  kind: "frame";
  id: string;
  added_at: string;
  origin: "web" | "mcp";
  brain_id: string;
  title: string;
  chart_spec: ChartSpec;
  freshness_token?: string;
};

/**
 * ProjectItem with the unresolved chart/frame recipes replaced by their resolved
 * forms. buildRenderModel operates on SnapshotItem[].
 */
export type SnapshotItem =
  | Exclude<ProjectItem, { kind: "chart" } | { kind: "frame" }>
  | ResolvedChartItem
  | ResolvedFrameItem;

// ---------------------------------------------------------------------------
// Narrative — the LLM produces exactly this shape; build route imports it.
// ---------------------------------------------------------------------------

export interface Narrative {
  exec_summary: string;
  sections: { title: string; intro: string }[];
  inference_notes: string[];
}

// ---------------------------------------------------------------------------
// Template IDs
// ---------------------------------------------------------------------------

export type TemplateId = "market-overview" | "bov-lite" | "client-email" | "one-pager" | "email";

// ---------------------------------------------------------------------------
// Slot discriminated union
// ---------------------------------------------------------------------------

/** The compiled executive summary paragraph. */
export type ExecSummarySlot = {
  kind: "exec_summary";
  text: string;
};

/** One narrative section — carries its own exhibit/stat backing slots. */
export type SectionSlot = {
  kind: "section";
  title: string;
  intro: string;
  /** Exhibit slots that logically belong to this section (may be empty). */
  exhibits: ExhibitSlot[];
  /** Stat slots that logically belong to this section (may be empty). */
  stats: StatSlot[];
};

/** A single visual exhibit — a chart block, a live-bound frame, or a table slice. */
export type ExhibitSlot = {
  kind: "exhibit";
  /** "chart" | "frame" | "table_slice" | "file" */
  exhibit_kind: "chart" | "frame" | "table_slice" | "file";
  id: string;
  title: string;
  /** The resolved chart block (present for chart exhibits). */
  chart_block?: ChartBlock;
  /** The live-bound presentation frame spec (present for frame exhibits). */
  chart_spec?: ChartSpec;
  /** Table columns (present for table_slice exhibits). */
  columns?: string[];
  /** Table rows (present for table_slice exhibits). */
  rows?: (string | number | null)[][];
  /** MIME type (present for file exhibits). */
  mime?: string;
  /** Storage path (present for file exhibits). */
  storage_path?: string;
  /** Short-lived signed URL for a file exhibit, attached at render time
   *  (the private object path is never rendered directly; URLs expire). */
  signed_url?: string;
  caption?: string;
  source_url?: string;
  freshness_token?: string;
};

/** A single key metric / stat. */
export type StatSlot = {
  kind: "stat";
  id: string;
  label: string;
  value: string;
  source_url?: string;
  source_label?: string;
  freshness_token?: string;
};

/** The aggregated source list for the deliverable. */
export type SourcesSlot = {
  kind: "sources";
  sources: Array<{
    label: string;
    url: string;
    /** "source" | "report" | "metric" */
    origin_kind: string;
  }>;
};

/** Brand colours / logo to be rendered by the template. */
export type BrandingSlot = {
  kind: "branding";
  branding: Record<string, unknown>;
};

/** Pass-through of the LLM's inference notes (tagged [INFERENCE] items). */
export type InferenceNotesSlot = {
  kind: "inference_notes";
  notes: string[];
};

/** A filed Q&A — the user's question + the cited answer. Carries its own
 *  provenance (the source brain + freshness_token) so it renders as a cited
 *  callout. Never dropped: a filed answer must survive into the deliverable. */
export type QaSlot = {
  kind: "qa";
  id: string;
  question: string;
  answer: string;
  report_id: string;
  fact?: string;
  freshness_token?: string;
};

/** A filed free-text note — inline context the user added. */
export type NoteSlot = {
  kind: "note";
  id: string;
  text: string;
};

export type Slot =
  | ExecSummarySlot
  | SectionSlot
  | ExhibitSlot
  | StatSlot
  | SourcesSlot
  | BrandingSlot
  | InferenceNotesSlot
  | QaSlot
  | NoteSlot;

// ---------------------------------------------------------------------------
// RenderModel
// ---------------------------------------------------------------------------

export interface RenderModel {
  template: TemplateId;
  branding?: Record<string, unknown>;
  slots: Slot[];
  inference_notes: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers — item classifiers
// ---------------------------------------------------------------------------

function isResolvedChart(item: SnapshotItem): item is ResolvedChartItem {
  return item.kind === "chart";
}

function toExhibitSlot(item: SnapshotItem): ExhibitSlot | null {
  if (isResolvedChart(item)) {
    return {
      kind: "exhibit",
      exhibit_kind: "chart",
      id: item.id,
      title: item.title,
      chart_block: item.chart_block,
      freshness_token: item.freshness_token,
    };
  }
  if (item.kind === "frame") {
    return {
      kind: "exhibit",
      exhibit_kind: "frame",
      id: item.id,
      title: item.title,
      chart_spec: item.chart_spec,
      freshness_token: item.freshness_token,
    };
  }
  if (item.kind === "table_slice") {
    return {
      kind: "exhibit",
      exhibit_kind: "table_slice",
      id: item.id,
      title: item.title,
      columns: item.columns,
      rows: item.rows,
      source_url: item.source_url,
      freshness_token: item.freshness_token,
    };
  }
  if (item.kind === "file") {
    return {
      kind: "exhibit",
      exhibit_kind: "file",
      id: item.id,
      title: item.caption ?? item.storage_path,
      mime: item.mime,
      storage_path: item.storage_path,
      caption: item.caption,
    };
  }
  return null;
}

function toStatSlot(item: SnapshotItem): StatSlot | null {
  if (item.kind !== "metric") return null;
  return {
    kind: "stat",
    id: item.id,
    label: item.label,
    value: item.value,
    source_url: item.source_url,
    source_label: item.source_label,
    freshness_token: item.freshness_token,
  };
}

function collectSources(items: SnapshotItem[]): SourcesSlot {
  const seen = new Set<string>();
  const sources: SourcesSlot["sources"] = [];

  const add = (url: string, label: string, origin_kind: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    sources.push({ label, url, origin_kind });
  };

  for (const item of items) {
    if (item.kind === "source") {
      add(item.url, item.label, "source");
    } else if (item.kind === "report") {
      // report slug becomes a relative reference
      const url = item.slug.startsWith("/") ? item.slug : `/r/${item.slug}`;
      add(url, item.title ?? item.slug, "report");
    } else if (item.kind === "metric" && item.source_url) {
      add(item.source_url, item.source_label ?? item.source_url, "metric");
    } else if (item.kind === "table_slice" && item.source_url) {
      add(item.source_url, item.source_url, "table_slice");
    } else if (item.kind === "frame" && item.chart_spec.source?.url) {
      add(item.chart_spec.source.url, item.chart_spec.source.citation, "frame");
    }
  }

  return { kind: "sources", sources };
}

/** Filed Q&A + notes → slots, in input order. These have no other home in any
 *  template, so without this they would be silently dropped from the
 *  deliverable. Deterministic — preserves input order. */
function collectFiledContext(items: SnapshotItem[]): (QaSlot | NoteSlot)[] {
  const out: (QaSlot | NoteSlot)[] = [];
  for (const item of items) {
    if (item.kind === "qa") {
      out.push({
        kind: "qa",
        id: item.id,
        question: item.question,
        answer: item.answer,
        report_id: item.report_id,
        fact: item.fact,
        freshness_token: item.freshness_token,
      });
    } else if (item.kind === "note") {
      out.push({ kind: "note", id: item.id, text: item.text });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// buildRenderModel — the public API
// ---------------------------------------------------------------------------

/**
 * Pure, deterministic function: maps (template, narrative, items, branding)
 * to a RenderModel whose slots a dumb renderer can walk to draw the page.
 *
 * No I/O, no Date.now(), no Math.random(). Same inputs → same output always.
 */
export function buildRenderModel(
  template: TemplateId,
  narrative: Narrative,
  items: SnapshotItem[],
  branding?: Record<string, unknown>,
): RenderModel {
  // Pre-classify items (deterministic — preserves input order)
  const exhibits: ExhibitSlot[] = items
    .map(toExhibitSlot)
    .filter((s): s is ExhibitSlot => s !== null);

  const stats: StatSlot[] = items.map(toStatSlot).filter((s): s is StatSlot => s !== null);

  const sourcesSlot = collectSources(items);
  const inferenceNotes = narrative.inference_notes;

  let model: RenderModel;
  switch (template) {
    case "market-overview":
      model = buildMarketOverview(
        narrative,
        items,
        exhibits,
        stats,
        sourcesSlot,
        inferenceNotes,
        branding,
      );
      break;
    case "bov-lite":
      model = buildBovLite(
        narrative,
        items,
        exhibits,
        stats,
        sourcesSlot,
        inferenceNotes,
        branding,
      );
      break;
    case "client-email":
      model = buildClientEmail(
        narrative,
        items,
        exhibits,
        stats,
        sourcesSlot,
        inferenceNotes,
        branding,
      );
      break;
    case "one-pager":
      model = buildOnePager(
        narrative,
        items,
        exhibits,
        stats,
        sourcesSlot,
        inferenceNotes,
        branding,
      );
      break;
    case "email":
      // The "email" template renders via the grounded email/PDF spine
      // (`buildEmailDeliverableModel` → `renderGroundedReport`), NOT the React slot
      // model. Every render surface special-cases it BEFORE calling buildRenderModel;
      // reaching here means a caller didn't — fail loud rather than emit slots.
      throw new Error(
        "email template renders via the grounded spine — call buildEmailDeliverableModel, not buildRenderModel",
      );
    default: {
      const _exhaustive: never = template;
      throw new Error(`unknown template: ${String(_exhaustive)}`);
    }
  }

  // Filed Q&A + notes have no home inside any template's own structure. Splice
  // them in immediately before the sources list so nothing the user filed is
  // silently dropped from the deliverable (deterministic — input order).
  const filed = collectFiledContext(items);
  if (filed.length > 0) {
    const srcIdx = model.slots.findIndex((s) => s.kind === "sources");
    const at = srcIdx === -1 ? model.slots.length : srcIdx;
    model.slots.splice(at, 0, ...filed);
  }

  return model;
}

// ---------------------------------------------------------------------------
// market-overview
//   exec_summary → one section per narrative.sections entry → ALL exhibits
//   → sources. inference_notes passed through.
// ---------------------------------------------------------------------------

function buildMarketOverview(
  narrative: Narrative,
  _items: SnapshotItem[],
  exhibits: ExhibitSlot[],
  _stats: StatSlot[],
  sourcesSlot: SourcesSlot,
  inferenceNotes: string[],
  branding?: Record<string, unknown>,
): RenderModel {
  const slots: Slot[] = [];

  slots.push({ kind: "exec_summary", text: narrative.exec_summary });

  for (const section of narrative.sections) {
    slots.push({
      kind: "section",
      title: section.title,
      intro: section.intro,
      exhibits: [],
      stats: [],
    });
  }

  // ALL exhibits follow the sections
  for (const exhibit of exhibits) {
    slots.push(exhibit);
  }

  slots.push(sourcesSlot);

  if (inferenceNotes.length > 0) {
    slots.push({ kind: "inference_notes", notes: inferenceNotes });
  }

  return { template: "market-overview", branding, slots, inference_notes: inferenceNotes };
}

// ---------------------------------------------------------------------------
// bov-lite (Broker Opinion of Value)
//   branding FIRST → subject context (exec_summary) → comparable data
//   (exhibits + stats) → value narrative (sections) → assumptions + sources.
// ---------------------------------------------------------------------------

function buildBovLite(
  narrative: Narrative,
  _items: SnapshotItem[],
  exhibits: ExhibitSlot[],
  stats: StatSlot[],
  sourcesSlot: SourcesSlot,
  inferenceNotes: string[],
  branding?: Record<string, unknown>,
): RenderModel {
  const slots: Slot[] = [];

  // Branding FIRST — required for BOV letterhead
  slots.push({ kind: "branding", branding: branding ?? {} });

  // Subject context
  slots.push({ kind: "exec_summary", text: narrative.exec_summary });

  // Comparable data — exhibits then stats
  for (const exhibit of exhibits) {
    slots.push(exhibit);
  }
  for (const stat of stats) {
    slots.push(stat);
  }

  // Value narrative — one section per entry
  for (const section of narrative.sections) {
    slots.push({
      kind: "section",
      title: section.title,
      intro: section.intro,
      exhibits: [],
      stats: [],
    });
  }

  // Assumptions + sources
  slots.push(sourcesSlot);

  if (inferenceNotes.length > 0) {
    slots.push({ kind: "inference_notes", notes: inferenceNotes });
  }

  return { template: "bov-lite", branding, slots, inference_notes: inferenceNotes };
}

// ---------------------------------------------------------------------------
// client-email
//   subject line + pyramid-first body (exec_summary → sections) + exhibit links.
//   Lean — no branding slot, no raw stats block.
// ---------------------------------------------------------------------------

function deriveSubjectLine(narrative: Narrative): string {
  // First sentence of exec_summary, or the first section title if exec_summary
  // is very long.
  const firstSentence = narrative.exec_summary.split(/[.!?]/)[0].trim();
  if (firstSentence.length > 0 && firstSentence.length <= 120) {
    return firstSentence;
  }
  if (narrative.sections.length > 0) {
    return narrative.sections[0].title;
  }
  return narrative.exec_summary.slice(0, 80);
}

function buildClientEmail(
  narrative: Narrative,
  _items: SnapshotItem[],
  exhibits: ExhibitSlot[],
  _stats: StatSlot[],
  sourcesSlot: SourcesSlot,
  inferenceNotes: string[],
  branding?: Record<string, unknown>,
): RenderModel {
  const slots: Slot[] = [];

  // Subject line as a section slot (title only, no intro needed)
  slots.push({
    kind: "section",
    title: deriveSubjectLine(narrative),
    intro: "",
    exhibits: [],
    stats: [],
  });

  // Answer first (pyramid structure)
  slots.push({ kind: "exec_summary", text: narrative.exec_summary });

  // Sections
  for (const section of narrative.sections) {
    slots.push({
      kind: "section",
      title: section.title,
      intro: section.intro,
      exhibits: [],
      stats: [],
    });
  }

  // Exhibit links (inline references, not full renders in an email)
  for (const exhibit of exhibits) {
    slots.push(exhibit);
  }

  // Sources (lean — just the list)
  slots.push(sourcesSlot);

  if (inferenceNotes.length > 0) {
    slots.push({ kind: "inference_notes", notes: inferenceNotes });
  }

  return { template: "client-email", branding, slots, inference_notes: inferenceNotes };
}

// ---------------------------------------------------------------------------
// one-pager
//   exec_summary + AT MOST 2 exhibits + EXACTLY 3 stats (or fewer if fewer
//   metrics exist). Must fit one print page — truncate deterministically
//   (first-N), never error.
// ---------------------------------------------------------------------------

const ONE_PAGER_MAX_EXHIBITS = 2;
const ONE_PAGER_MAX_STATS = 3;

function buildOnePager(
  narrative: Narrative,
  _items: SnapshotItem[],
  exhibits: ExhibitSlot[],
  stats: StatSlot[],
  sourcesSlot: SourcesSlot,
  inferenceNotes: string[],
  branding?: Record<string, unknown>,
): RenderModel {
  const slots: Slot[] = [];

  // Truncate to page budget — deterministic first-N
  const truncatedExhibits = exhibits.slice(0, ONE_PAGER_MAX_EXHIBITS);
  const truncatedStats = stats.slice(0, ONE_PAGER_MAX_STATS);

  slots.push({ kind: "exec_summary", text: narrative.exec_summary });

  // Exhibits (capped)
  for (const exhibit of truncatedExhibits) {
    slots.push(exhibit);
  }

  // Stats (capped)
  for (const stat of truncatedStats) {
    slots.push(stat);
  }

  // Sources
  slots.push(sourcesSlot);

  if (inferenceNotes.length > 0) {
    slots.push({ kind: "inference_notes", notes: inferenceNotes });
  }

  return { template: "one-pager", branding, slots, inference_notes: inferenceNotes };
}
