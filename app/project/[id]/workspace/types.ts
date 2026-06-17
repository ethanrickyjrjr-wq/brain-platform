import type { ChartBlock } from "@/refinery/validate/chart-block-lint.mts";

/** A chart ref resolved to its frozen `chart_block` (from `saved_charts`). */
export interface SavedChart {
  block: ChartBlock;
  freshness_token: string | null;
}

/**
 * A built deliverable row for the Built lane. Beyond the kill-switch fields, P1 §D
 * adds the thumbnail seed — `exec_summary` (the narrative's first paragraph) + the
 * first chart in `items_snapshot` — both EXTRACTED server-side in `page.tsx` so the
 * client never ships the full (large) snapshot/narrative just to draw a card.
 */
export interface DeliverableRow {
  id: string;
  template: string;
  status: string;
  created_at: string;
  scope_kind: string | null;
  scope_value: string | null;
  /** narrative.exec_summary, for the thumbnail blurb (null when absent). */
  exec_summary: string | null;
  /** First chart in items_snapshot, for the thumbnail mini-render (null when none). */
  preview_chart: ChartBlock | null;
}

/**
 * An active email schedule for the Emailing lane (P1 §D). The lane is
 * SCHEDULE-driven, not deliverable-driven — `email_schedules` carries no
 * `deliverable_id`; a card is the recipe (cadence + scope + audience + last run).
 */
export interface EmailScheduleRow {
  id: number;
  cadence: string;
  day_of_week: number | null;
  day_of_month: number | null;
  send_hour_et: number;
  audience_slug: string | null;
  scope_kind: string | null;
  scope_value: string | null;
  topic: string | null;
  status: string;
  last_run_at: string | null;
  next_run_at: string | null;
}

/**
 * Per-project UI/agent state bag (`projects.ui_state jsonb`, P1 §E/§H). Additive
 * keys only — never repurpose one (cross-build contract; P2/P3/P4 extend it).
 */
export interface ProjectUiState {
  /** How many times the user dismissed the Connect-MCP block (collapses at ≥2). */
  mcp_dismissed_count?: number;
  [key: string]: unknown;
}

/** A row in the bottom-bar search index (reports from BRAIN_CATALOG, charts from
 *  saved_charts), built server-side in the project layout and filtered client-side. */
export interface SearchEntry {
  kind: "report" | "chart";
  /** report → brain slug; chart → saved_charts.id. */
  ref: string;
  label: string;
  /** Lowercased haystack for `includes` matching. */
  haystack: string;
}
