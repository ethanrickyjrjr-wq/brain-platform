import { inferScopeFromItems, type InferredScope } from "./derive-name";
import { identityKeyForItem } from "./identity-key";
import { summarizeItem } from "./summarize-item";
import type { ProjectItem } from "./items";

/**
 * Cross-project intelligence (Piece 2 §B) — the broker's "you already have this / it's
 * missing there" layer. Deterministic, exact-identity, scope-anchored for v1 (no
 * embeddings — fuzzy/semantic pairing is deferred). Built on the fly from one
 * `select id, title, items` over the user's projects (no cached table in v1).
 *
 * Semantics (a deliberate, documented refinement of the muddled plan bullets — exact
 * identity match can't distinguish "the same data" from "complementary data", so the two
 * pull-in cases collapse and the genuinely-distinct push-out case stands on its own):
 *   • reuse — a data point a *scope-matching* OTHER project has that THIS one lacks
 *             → "you already pulled {label} into {Other} — add it here too?" (pull in)
 *   • gap   — a data point THIS project has that a *scope-matching* OTHER project lacks
 *             → "{Other} covers the same area but is missing {label} — add it there?" (push out)
 *   • pairing — reserved; true complementary-metric pairing needs semantic similarity
 *               (deferred with embeddings). v1 returns []. Kept in the shape so the
 *               prompt engine + callers don't change when it lands.
 *
 * Conservative on purpose (the priority is "don't nag"): an overlap fires only on an
 * EXACT identity key match AND a shared place/ZIP between the two projects. A shared
 * topic alone is too broad to anchor (every flood project would "match"), so it does not
 * count. Dismissed keys (`ui_state.dismissed_overlap_keys`) are suppressed.
 */

export interface IndexedProject {
  projectId: string;
  title: string;
  scope: InferredScope & { address?: string };
  keys: Set<string>;
  /** identityKey → a human label for prompt copy (first item wins per key). */
  labelByKey: Map<string, string>;
}

export interface CrossProjectIndex {
  projects: IndexedProject[];
}

export type OverlapType = "reuse" | "gap" | "pairing";

export interface OverlapHit {
  type: OverlapType;
  identityKey: string;
  /** Human label for the data point (drives the prompt copy). */
  label: string;
  otherProjectId: string;
  otherProjectTitle: string;
  /** Stable key for `ui_state.dismissed_overlap_keys`. */
  dedupeKey: string;
}

export interface Overlap {
  reuse: OverlapHit[];
  gap: OverlapHit[];
  pairing: OverlapHit[];
}

export interface ProjectItemsRow {
  projectId: string;
  title: string;
  items: ProjectItem[];
}

export function buildCrossProjectIndex(projects: ProjectItemsRow[]): CrossProjectIndex {
  return {
    projects: projects.map((p) => {
      const keys = new Set<string>();
      const labelByKey = new Map<string, string>();
      for (const it of p.items) {
        const k = identityKeyForItem(it);
        keys.add(k);
        if (!labelByKey.has(k)) labelByKey.set(k, summarizeItem(it));
      }
      return {
        projectId: p.projectId,
        title: p.title,
        scope: inferScopeFromItems(p.items),
        keys,
        labelByKey,
      };
    }),
  };
}

function normPlace(p: string): string {
  return p.trim().toLowerCase();
}

/** Two scopes match when they share a ZIP, or a place. Topic alone is too broad to
 *  anchor (it would nag / over-pull), so it never counts. The ONE scope-match root —
 *  the overlap finder AND assemble-on-command both use it. */
export function scopesMatch(a: IndexedProject["scope"], b: IndexedProject["scope"]): boolean {
  if (a.zip && b.zip) return a.zip === b.zip;
  if (a.place && b.place) return normPlace(a.place) === normPlace(b.place);
  return false;
}

/**
 * Find reuse / gap overlaps for the currently-open project against the user's other
 * projects. `currentProjectId` must be present in the index (it's built from all the
 * user's projects, including the open one). Dismissed dedupe keys are suppressed.
 */
export function findOverlap(
  currentProjectId: string,
  index: CrossProjectIndex,
  opts?: { dismissed?: string[] },
): Overlap {
  const dismissed = new Set(opts?.dismissed ?? []);
  const self = index.projects.find((p) => p.projectId === currentProjectId);
  if (!self) return { reuse: [], gap: [], pairing: [] };

  const others = index.projects.filter(
    (p) => p.projectId !== currentProjectId && scopesMatch(self.scope, p.scope),
  );

  const reuse: OverlapHit[] = [];
  const seenReuse = new Set<string>();
  for (const o of others) {
    for (const k of o.keys) {
      if (self.keys.has(k)) continue; // self already has it → not a reuse
      if (seenReuse.has(k)) continue; // already surfaced from another project
      const dedupeKey = `reuse:${k}`;
      if (dismissed.has(dedupeKey)) continue;
      seenReuse.add(k);
      reuse.push({
        type: "reuse",
        identityKey: k,
        label: o.labelByKey.get(k) ?? k,
        otherProjectId: o.projectId,
        otherProjectTitle: o.title,
        dedupeKey,
      });
    }
  }

  const gap: OverlapHit[] = [];
  for (const k of self.keys) {
    for (const o of others) {
      if (o.keys.has(k)) continue; // other has it → no gap
      const dedupeKey = `gap:${k}:${o.projectId}`;
      if (dismissed.has(dedupeKey)) continue;
      gap.push({
        type: "gap",
        identityKey: k,
        label: self.labelByKey.get(k) ?? k,
        otherProjectId: o.projectId,
        otherProjectTitle: o.title,
        dedupeKey,
      });
    }
  }

  return { reuse, gap, pairing: [] };
}
