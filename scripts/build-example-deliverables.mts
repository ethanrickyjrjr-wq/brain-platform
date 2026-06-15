/**
 * scripts/build-example-deliverables.mts — A-4 example-deliverable rebuild.
 *
 * Rebuilds every /p/example-* deliverable through the real engine from live brain
 * key_metrics (see lib/deliverable/examples.ts). Run on a daily cron AFTER the brain
 * rebuild so the examples carry the current freshness_token (matching live /r/*).
 * Idempotent: each scenario upserts under its stable example id. Exits non-zero if
 * any scenario fails so the cron surfaces it.
 *
 *   bun run scripts/build-example-deliverables.mts
 */

import { createServiceRoleClient } from "../utils/supabase/service-role";
import { EXAMPLE_SCENARIOS, buildExampleDeliverable } from "../lib/deliverable/examples";

const db = createServiceRoleClient();
let failures = 0;

for (const scenario of EXAMPLE_SCENARIOS) {
  try {
    const r = await buildExampleDeliverable(db, scenario);
    console.log(`[examples] ${r.id} OK — ${r.itemCount} metrics, token ${r.freshnessToken}`);
  } catch (e) {
    failures++;
    console.error(
      `[examples] ${scenario.id} FAILED: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

if (failures > 0) {
  console.error(`[examples] ${failures}/${EXAMPLE_SCENARIOS.length} scenario(s) failed`);
  process.exit(1);
}
console.log(`[examples] all ${EXAMPLE_SCENARIOS.length} example deliverables rebuilt`);
