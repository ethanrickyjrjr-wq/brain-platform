import type { ChartBlock } from "@/refinery/validate/chart-block-lint.mts";

/** A chart ref resolved to its frozen `chart_block` (from `saved_charts`). */
export interface SavedChart {
  block: ChartBlock;
  freshness_token: string | null;
}

/** A built deliverable row for the Built lane. */
export interface DeliverableRow {
  id: string;
  template: string;
  status: string;
  created_at: string;
  scope_kind: string | null;
  scope_value: string | null;
}
