import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PackDefinition } from "../types/pack.mts";

/**
 * In-memory DAG resolver over the pack registry.
 *
 * The graph is defined by `PackDefinition.input_brains` — every edge points
 * from a downstream pack to its upstream(s). Build order is reverse-postorder
 * over this graph. Cycle detection is three-color DFS; a back-edge throws
 * with the full cycle path so the author can see which input_brains chain
 * forms the loop.
 *
 * NO I/O for the topology operations — they are pure functions over the
 * in-memory PACKS record. `brainStatus()` reads the rendered .md file to
 * answer freshness questions, but that is the only thing on disk.
 */

const BRAINS_DIR = path.join(process.cwd(), "brains");

/**
 * Topologically sort the dependency closure of `targetId`. Result is the
 * full build order: every upstream appears before any pack that consumes it,
 * and `targetId` is the last element. Throws on cycles or missing pack ids.
 */
export function resolveBuildOrder(
  targetId: string,
  PACKS: Record<string, PackDefinition>,
): string[] {
  const visited = new Set<string>(); // fully processed
  const inStack = new Set<string>(); // currently in DFS path
  const order: string[] = [];

  function dfs(id: string, trail: string[]): void {
    if (visited.has(id)) return;
    if (inStack.has(id)) {
      const start = trail.indexOf(id);
      const cycle = [...trail.slice(start), id].join(" → ");
      throw new Error(`DAG: cycle detected — ${cycle}`);
    }
    const pack = PACKS[id];
    if (!pack) {
      const known = Object.keys(PACKS).join(", ") || "(none)";
      throw new Error(
        `DAG: pack "${id}" not found in registry. Known packs: ${known}`,
      );
    }
    inStack.add(id);
    for (const upstreamId of pack.input_brains) {
      dfs(upstreamId, [...trail, id]);
    }
    inStack.delete(id);
    visited.add(id);
    order.push(id);
  }

  dfs(targetId, []);
  return order;
}

/**
 * Reverse walk — every pack id that lists `brainId` in its `input_brains`.
 * Used by `--list-consumers` and by future staleness invalidation (when X
 * is rebuilt, downstream consumers may want a heads-up).
 */
export function walkConsumers(
  brainId: string,
  PACKS: Record<string, PackDefinition>,
): string[] {
  return Object.values(PACKS)
    .filter((p) => p.input_brains.includes(brainId))
    .map((p) => p.id)
    .sort();
}

/** Frontmatter scalar reader — matches the parser in master-source / spec-validator. */
function frontmatterValue(md: string, key: string): string | null {
  const fm = md.match(/^(?:<!--[\s\S]*?-->\s*)?---\n([\s\S]*?)\n---\n/);
  if (!fm) return null;
  for (const line of fm[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    if (line.slice(0, idx).trim() === key) return line.slice(idx + 1).trim();
  }
  return null;
}

export type BrainStatus =
  | { kind: "missing" }
  | { kind: "fresh"; expires_at: string; refined_at: string }
  | { kind: "stale"; expires_at: string; refined_at: string };

/**
 * Read `brains/{brainId}.md` and report freshness. Used by the CLI's DAG
 * walk to decide whether an upstream needs rebuilding before the target.
 *
 *   missing → hard error path (user must build it first, or `--force` triggers a build)
 *   stale   → warn + rebuild (or auto-append staleness caveat if not rebuilt)
 *   fresh   → skip rebuild (cached output is valid)
 */
export async function brainStatus(brainId: string): Promise<BrainStatus> {
  const filePath = path.join(BRAINS_DIR, `${brainId}.md`);
  let md: string;
  try {
    md = (await readFile(filePath, "utf-8")).replace(/\r\n/g, "\n");
  } catch {
    return { kind: "missing" };
  }
  const refinedAt = frontmatterValue(md, "refined_at");
  const ttlStr = frontmatterValue(md, "ttl_seconds");
  if (!refinedAt || !ttlStr) return { kind: "missing" };

  const ttl = parseInt(ttlStr, 10);
  const refinedMs = Date.parse(refinedAt);
  if (!Number.isFinite(ttl) || !Number.isFinite(refinedMs)) {
    return { kind: "missing" };
  }

  const expiresMs = refinedMs + ttl * 1000;
  const expiresAt = new Date(expiresMs).toISOString().slice(0, 10);
  const stale = Date.now() > expiresMs;
  return {
    kind: stale ? "stale" : "fresh",
    expires_at: expiresAt,
    refined_at: refinedAt,
  };
}
