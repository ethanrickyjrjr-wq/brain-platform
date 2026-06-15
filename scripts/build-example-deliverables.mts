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

// Build every scenario concurrently — each is an independent LLM call, so a serial
// for-await loop wastes wall-clock (~4× on the cron). allSettled preserves per-item
// failure isolation: one bad scenario doesn't abort the others, and we still exit
// non-zero if ANY failed so the cron surfaces it.
const results = await Promise.allSettled(
  EXAMPLE_SCENARIOS.map((scenario) =>
    buildExampleDeliverable(db, scenario).then((r) => ({ scenario, r })),
  ),
);

let failures = 0;
for (let i = 0; i < results.length; i++) {
  const settled = results[i];
  if (settled.status === "fulfilled") {
    const { r } = settled.value;
    console.log(`[examples] ${r.id} OK — ${r.itemCount} metrics, token ${r.freshnessToken}`);
  } else {
    failures++;
    const reason = settled.reason;
    console.error(
      `[examples] ${EXAMPLE_SCENARIOS[i].id} FAILED: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  }
}

if (failures > 0) {
  console.error(`[examples] ${failures}/${EXAMPLE_SCENARIOS.length} scenario(s) failed`);
  process.exit(1);
}
console.log(`[examples] all ${EXAMPLE_SCENARIOS.length} example deliverables rebuilt`);
