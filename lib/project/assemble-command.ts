import type { ProjectItem } from "./items";
import { inferScopeFromItems, deriveProjectName, type InferredScope } from "./derive-name";
import { identityKeyForItem } from "./identity-key";
import { scopesMatch, type ProjectItemsRow } from "./cross-project-index";

/**
 * Assemble-on-command (Piece 2 §E, the execution centerpiece): "build a project for
 * {ZIP/place}, pull the important data from my existing projects." This is the PURE,
 * free, deterministic planner — parse the scope from the command, then select
 * identity-deduped items from the user's *scope-matching* projects. The authed route
 * (`/api/projects/assemble`) creates the project from this plan (reusing the import path:
 * deriveProjectName + brand-follows-all) and lands it open. The LLM curation/ordering +
 * one-deliverable pre-build is the gated accelerator (deferred; flag-off → this path).
 *
 * Reuses the ONE scope root (`inferScopeFromItems`, run over the command as a note), the
 * ONE scope-match root (`scopesMatch`), and the ONE identity-key root (dedupe). Items are
 * COPIED (snapshots) — source projects are untouched.
 */

export interface AssemblePlan {
  /** Scope parsed from the command. */
  scope: InferredScope;
  /** Auto-name for the new project (from the selected items, else the command). */
  title: string;
  /** Identity-deduped items pulled from scope-matching projects. */
  items: ProjectItem[];
  /** Provenance: which existing projects contributed. */
  sourceProjectIds: string[];
  /** True when at least one item was pulled. */
  matched: boolean;
  /** True when no place/ZIP anchor was parsed — the caller should ask which place to
   *  build for rather than create an empty project. (Topic alone does NOT anchor, mirroring
   *  scopesMatch.) The ONE guard the route reads — so route + planner can't drift. */
  needsScope: boolean;
}

/** A synthetic note item so the command text flows through the ONE scope root. */
function commandAsItems(command: string): ProjectItem[] {
  return [{ id: "cmd", added_at: "", origin: "web", kind: "note", text: command }];
}

export function planAssembly(command: string, projects: ProjectItemsRow[]): AssemblePlan {
  const commandItems = commandAsItems(command);
  const scope = inferScopeFromItems(commandItems);

  // A place/ZIP is the anchor (topic alone does NOT, mirroring scopesMatch — otherwise a
  // bare vertical like "build a permits project" would silently create an empty named
  // project). No anchor → report needsScope so the route asks which place to build for.
  const needsScope = !scope.zip && !scope.place;
  if (needsScope) {
    return {
      scope,
      title: deriveProjectName(commandItems),
      items: [],
      sourceProjectIds: [],
      matched: false,
      needsScope: true,
    };
  }

  const selected: ProjectItem[] = [];
  const seen = new Set<string>();
  const sources = new Set<string>();
  for (const p of projects) {
    if (!scopesMatch(scope, inferScopeFromItems(p.items))) continue;
    for (const it of p.items) {
      const k = identityKeyForItem(it);
      if (seen.has(k)) continue; // first scope-matching project to hold a data point wins
      seen.add(k);
      selected.push(structuredClone(it)); // COPY — source projects are untouched
      sources.add(p.projectId);
    }
  }

  const title = selected.length ? deriveProjectName(selected) : deriveProjectName(commandItems);
  return {
    scope,
    title,
    items: selected,
    sourceProjectIds: [...sources],
    matched: selected.length > 0,
    needsScope: false,
  };
}
