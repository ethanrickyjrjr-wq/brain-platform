import { z } from "zod";

/**
 * The shared `ProjectItem` union — the spine of the Projects/Briefcase feature.
 *
 * Created once here (Session 1), zod-validated, unit-tested, and never re-declared
 * elsewhere — import it. S2/S4/S6/S9 all depend on this exact shape.
 *
 * Invariant: every item is a SNAPSHOT pinned at save time. The value, citation,
 * and (where available) `freshness_token` are copied in at the moment of filing
 * and are never re-fetched. Fixture-backed items (charts, fixture-sourced metrics)
 * carry an as-of date from their own data; live-brain items (`qa`, `metric`,
 * `report`, `table_slice`) carry the brain's `freshness_token`.
 */

const base = z.object({
  id: z.string(),
  added_at: z.string(),
  origin: z.enum(["web", "mcp"]),
});

const kinds = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("qa"),
    report_id: z.string(),
    question: z.string(),
    answer: z.string(),
    fact: z.string().optional(),
    selection_type: z.string().optional(),
    reach: z.array(z.string()).optional(),
    freshness_token: z.string().optional(),
  }),
  z.object({
    // ref → saved_charts (the linted chart_block lives there)
    kind: z.literal("chart"),
    chart_id: z.string(),
    title: z.string(),
  }),
  z.object({
    kind: z.literal("metric"),
    report_id: z.string(),
    label: z.string(),
    value: z.string(),
    source_url: z.string().optional(),
    source_label: z.string().optional(),
    freshness_token: z.string(),
    // Plan C (reconciliation): the lake metric slug this value came from, when
    // the filing surface knows it. Optional + non-breaking — items filed before
    // this lift omit it, and C-3's lane bridge falls back to label resolution.
    metric_slug: z.string().optional(),
  }),
  z.object({
    kind: z.literal("source"),
    table: z.string(),
    url: z.string(),
    label: z.string(),
  }),
  z.object({
    kind: z.literal("note"),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("report"),
    slug: z.string(),
    title: z.string().optional(),
    freshness_token: z.string().optional(),
  }),
  z.object({
    kind: z.literal("file"),
    storage_path: z.string(),
    mime: z.string(),
    size: z.number(),
    caption: z.string().optional(),
  }),
  z.object({
    kind: z.literal("table_slice"),
    report_id: z.string(),
    title: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
    source_url: z.string().optional(),
    freshness_token: z.string(),
    // Plan C: forward-compat slug hint when a slice carries a single metric.
    // C-3's `toAssertion` reconciles `metric` items only; table_slice is Tier-3
    // (cross-metric) — this keeps the schema ready without widening C's scope.
    metric_slug: z.string().optional(),
  }),
  z.object({
    // A LIVE frame recipe (Phase 3): NOT a snapshot — it names a brain + frame +
    // metrics, and is bound to live data at BUILD time (`bindFrameSpec`), then
    // frozen into the deliverable as a resolved ChartSpec. This is what lets a
    // template re-bind for a new place without re-saving (the flywheel).
    kind: z.literal("frame"),
    brain_id: z.string(),
    /** Registry frame id; absent → auto-pick from the brain's data shape. */
    frame_id: z.string().optional(),
    /** Metric slugs to pull (composition segments / the gauge value). */
    metric_keys: z.array(z.string()).optional(),
    /** Reserved for table-driven frames. */
    table_id: z.string().optional(),
    title: z.string(),
  }),
]);

export const projectItemSchema = z.intersection(base, kinds);
export const projectItemsSchema = z.array(projectItemSchema);
export type ProjectItem = z.infer<typeof projectItemSchema>;
