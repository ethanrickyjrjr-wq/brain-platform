import type { ChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import type { ProjectItem } from "@/lib/project/items";

/**
 * P4 guided-edit payload. The edit panel sends ONLY the fields the user changed:
 * cosmetic-only ({template?, branding?}) updates the row in place; any content
 * change ({items?, instruction?}) forks a new gated version. Never free-text prose.
 */
export interface DeliverableEditPatch {
  items?: ProjectItem[];
  template?: string;
  branding?: Record<string, string> | null;
  instruction?: string;
}

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
  /** This deliverable's own branding (pre-fills the P4 edit panel's color pickers so a
   *  color edit merges into it rather than clobbering name/logo). */
  branding: Record<string, string> | null;
  /** P4 soft-trash: non-null → trashed (shown in "Recently deleted", not the lane). */
  deleted_at: string | null;
  /** P4 version lineage: the deliverable id this row replaced (null = an original). */
  supersedes_id: string | null;
  /** P4 edit panel: the snapshot's item ids, so the guided edit pre-checks the
   *  items this deliverable was built from. Extracted server-side. */
  item_ids: string[];
  /** P4: older LIVE versions this head superseded (newest-first), attached by the
   *  page server component via `splitDeliverableVersions`. Absent on non-heads. */
  versions?: DeliverableRow[];
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
  /** The freshness token the user last acknowledged — drives `freshnessChangedSinceSeen`. */
  last_freshness_token_seen?: string;
  /** Overlap dedupe keys suppressed from cross-project prompts (dismissed by user). */
  dismissed_overlap_keys?: string[];
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
