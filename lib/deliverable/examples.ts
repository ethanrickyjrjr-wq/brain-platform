/**
 * lib/deliverable/examples.ts — A-4 live example deliverables.
 *
 * Seeds the logged-out pill panel with REAL, never-stale example deliverables at
 * stable /p/example-* URLs. Each is built through the REAL engine
 * (freezeSnapshot + buildDeliverableNarrative — the same path the web/MCP build
 * uses) from a brain's LIVE key_metrics, so re-running the rebuild after a data
 * refresh restamps every value + freshness_token. NO fixture fork. The example
 * build emits NO usage event (the engine path never calls recordUse), so it can
 * never pollute uid-attribution (A-8.5).
 *
 * Identity/safety: written via service_role under a reserved sentinel user_id +
 * is_example=true (deliverables.user_id is uuid NOT NULL, no FK, public SELECT),
 * so examples FK-safely coexist with user rows and filter out of user analytics.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDeliverableNarrative, freezeSnapshot } from "./build";
import type { TemplateId } from "./templates";
import type { ProjectItem } from "../project/items";
import type { BrainOutputMetric } from "../../refinery/types/brain-output.mts";
import { loadParsedBrain } from "../fetch-brain";

/** Reserved owner uid for seeded examples — a fixed, non-user UUID. Never a real
 *  auth.uid; lets examples filter out of every per-account query. */
export const EXAMPLE_SENTINEL_USER_ID = "00000000-0000-0000-0000-0000000e9a11";

export interface ExampleScenario {
  /** Stable public slug → /p/<id>. */
  id: string;
  template: TemplateId;
  /** brains/<brainId>.md to harvest live key_metrics from. */
  brainId: string;
  instruction: string;
}

/**
 * The data-driven scenario set — adding a 5th example is a data change here, not a
 * code edit. Brains chosen for clean, broker-relevant headline numbers (verified to
 * carry real key_metrics): housing, macro labor, CRE, workforce demand.
 */
export const EXAMPLE_SCENARIOS: ExampleScenario[] = [
  {
    id: "example-one-pager",
    template: "one-pager",
    brainId: "housing-swfl",
    instruction:
      "Build a one-page SWFL residential market brief a broker can hand a client — lead with the median price and what the velocity and supply signals mean together.",
  },
  {
    id: "example-market-overview",
    template: "market-overview",
    brainId: "macro-swfl",
    instruction:
      "Summarize the SWFL macro labor picture — county unemployment and wages — for an investor sizing the regional economy.",
  },
  {
    id: "example-bov-lite",
    template: "bov-lite",
    brainId: "cre-swfl",
    instruction:
      "Draft a light broker-opinion-of-value backdrop for SWFL commercial — cap rates, vacancy, absorption, and asking rent.",
  },
  {
    id: "example-client-email",
    template: "client-email",
    brainId: "labor-demand-swfl",
    instruction:
      "Write a short client email on SWFL workforce demand — the largest sectors and where construction labor concentration sits.",
  },
];

interface HarvestCtx {
  brainId: string;
  freshnessToken: string;
  addedAt: string;
}

/**
 * Turn a brain's key_metrics into cited `kind:"metric"` ProjectItems carrying the
 * brain's live freshness_token. Pure — the never-stale core: re-harvesting after a
 * brain refresh restamps every value + token. Caps at `max` for a clean one-pager.
 */
export function harvestMetricItems(
  metrics: BrainOutputMetric[],
  ctx: HarvestCtx,
  max = 6,
): ProjectItem[] {
  return metrics.slice(0, max).map(
    (m, i): ProjectItem => ({
      id: `${ctx.brainId}-m${i}`,
      added_at: ctx.addedAt,
      origin: "web",
      kind: "metric",
      report_id: ctx.brainId,
      label: m.label,
      value: String(m.value),
      freshness_token: ctx.freshnessToken,
      ...(m.source?.url ? { source_url: m.source.url } : {}),
      ...(m.source?.citation ? { source_label: m.source.citation } : {}),
    }),
  );
}

export interface ExampleBuildResult {
  id: string;
  itemCount: number;
  freshnessToken: string;
}

/**
 * Build (or rebuild) ONE example deliverable through the real engine: load the
 * brain, harvest its key_metrics into cited metric items, freeze the snapshot, run
 * the forced-tool narrative pass, and UPSERT the row under the stable example id +
 * sentinel owner + is_example. Throws on a missing brain or empty metric set so the
 * cron surfaces it (rather than seeding a mock/empty deliverable).
 */
export async function buildExampleDeliverable(
  db: SupabaseClient,
  scenario: ExampleScenario,
): Promise<ExampleBuildResult> {
  const parsed = await loadParsedBrain(scenario.brainId);
  if (!parsed) throw new Error(`brain not found: ${scenario.brainId}`);

  const items = harvestMetricItems(parsed.output.key_metrics, {
    brainId: parsed.brain_id,
    freshnessToken: parsed.freshness_token,
    addedAt: parsed.refined_at,
  });
  if (items.length === 0) throw new Error(`no key_metrics to harvest for ${scenario.brainId}`);

  const itemsSnapshot = await freezeSnapshot(db, items);
  const { narrative } = await buildDeliverableNarrative({
    instruction: scenario.instruction,
    items: itemsSnapshot,
    template: scenario.template,
  });

  const { error } = await db.from("deliverables").upsert(
    {
      id: scenario.id,
      project_id: "example",
      user_id: EXAMPLE_SENTINEL_USER_ID,
      template: scenario.template,
      instruction: scenario.instruction || null,
      narrative,
      items_snapshot: itemsSnapshot,
      branding: null,
      status: "ready",
      is_example: true,
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`upsert failed for ${scenario.id}: ${error.message}`);

  return { id: scenario.id, itemCount: items.length, freshnessToken: parsed.freshness_token };
}
