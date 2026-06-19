/**
 * brain-snapshot — batch-fetches current brain values for all metric items
 * in a project and evaluates which have moved significantly since the snapshot
 * was filed.
 *
 * Server-side only: uses lookupLakeFact (loadParsedBrain disk reads).
 * Called from app/project/[id]/page.tsx before buildProjectDigest.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { ProjectItem } from "@/lib/project/items";
import type { SignificantChange, SignificanceRegistry } from "./types";
import { evaluateChange } from "./change-evaluator";
import { lookupLakeFact } from "@/lib/reconcile/lane1";

let _registry: SignificanceRegistry | null = null;

/**
 * Load and cache the significance registry from ingest/significance-registry.yaml.
 * Parsed once per process; subsequent calls return the cached object.
 */
export function loadSignificanceRegistry(): SignificanceRegistry {
  if (_registry) return _registry;
  const path = join(process.cwd(), "ingest", "significance-registry.yaml");
  const raw = readFileSync(path, "utf-8");
  _registry = parse(raw) as SignificanceRegistry;
  return _registry;
}

/**
 * Batch-fetch current brain values for all metric items, run the significance
 * evaluator on each snapshot→current pair, and return changes that cleared their
 * registry thresholds, ranked by priority desc.
 *
 * @param items     All project items (only kind==="metric" are evaluated)
 * @param registry  Loaded via loadSignificanceRegistry()
 * @param zip       Optional ZIP for scope-matched brain lookups
 * @param limit     Max results returned (default 5)
 */
export async function computeSignificantChanges(
  items: ProjectItem[],
  registry: SignificanceRegistry,
  zip?: string,
  limit = 5,
): Promise<SignificantChange[]> {
  const metrics = items.filter(
    (i): i is Extract<ProjectItem, { kind: "metric" }> => i.kind === "metric",
  );
  if (metrics.length === 0) return [];

  // Per-call dedup: cache the Promise so concurrent Promise.all branches that share
  // the same key get the same in-flight request, not N separate disk reads.
  const cache = new Map<string, ReturnType<typeof lookupLakeFact>>();

  const changes: SignificantChange[] = [];

  await Promise.all(
    metrics.map(async (item) => {
      const slug = item.metric_slug ?? item.label;
      const key = `${item.report_id}|${slug}|${zip ?? ""}`;

      if (!cache.has(key)) {
        cache.set(key, lookupLakeFact(item.report_id, slug, zip));
      }
      const fact = await cache.get(key)!;

      if (!fact) return;

      const currentValue = String(fact.value);
      const change = evaluateChange(slug, item.label, item.value, currentValue, registry);
      if (change) changes.push(change);
    }),
  );

  return changes.sort((a, b) => b.priority - a.priority).slice(0, limit);
}
