/**
 * lib/deliverable/project-template.ts — the Phase 5 template layer (the flywheel).
 *
 * A ProjectTemplate is a project's ordered frame list with the session-specific
 * fields (id, added_at, origin) stripped out, leaving only the structural recipe
 * (brain + frame type + metrics + title). Instantiating a template for a new scope
 * produces fresh ProjectItems with new ids and the caller's timestamp — the old
 * ChartSpecs are NEVER carried forward. Each build re-binds from the live brain,
 * re-stamping asOf from the brain's refined_at.
 *
 * PRIMARY USE CASE — "Listing PDF maker":
 *   Template "flood-risk-sheet" stores: flood composition + market comps + rent trajectory.
 *   User input: one ZIP or address.
 *   System: instantiateTemplate → POST /api/projects → POST .../build → returns /p/[id] + PDF.
 *
 * Pure functions only; no I/O, no Date.now(), no randomness. Callers supply `now`
 * (ISO timestamp) and an optional `idGen` so tests stay deterministic.
 */

import { z } from "zod";
import type { ProjectItem } from "../project/items";

// ---------------------------------------------------------------------------
// FrameRecipe — the structural blueprint for one frame slot in a template.
// Stripped of session-specific fields (id, added_at, origin, kind).
// ---------------------------------------------------------------------------

export const frameRecipeSchema = z.object({
  brain_id: z.string(),
  /** Registry frame id. Absent → auto-pick from the brain's data shape. */
  frame_id: z.string().optional(),
  /** Metric slugs (composition segments / gauge value). */
  metric_keys: z.array(z.string()).optional(),
  /** Reserved for table-driven frames. */
  table_id: z.string().optional(),
  /** Display title for this frame slot. */
  title: z.string(),
});

export type FrameRecipe = z.infer<typeof frameRecipeSchema>;

// ---------------------------------------------------------------------------
// ProjectTemplate — the persisted template row.
// scope_type is a hint for the user-facing prompt ("Enter a ZIP" vs "corridor").
// ---------------------------------------------------------------------------

export const projectTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  recipes: z.array(frameRecipeSchema),
  /** Hint for the user-facing input prompt. */
  scope_type: z.enum(["zip", "corridor", "county", "region"]).optional(),
  created_at: z.string().optional(),
});

export type ProjectTemplate = z.infer<typeof projectTemplateSchema>;

// ---------------------------------------------------------------------------
// extractRecipes — "save as template" from a built project.
//
// Filters the project's items to {kind:"frame"} entries and strips session-specific
// fields. Non-frame items (chart blocks, table slices, filed Q&A, metrics, notes,
// source refs) are snapshot-specific — they cannot be re-bound for a new scope and
// are intentionally dropped.
// ---------------------------------------------------------------------------

export function extractRecipes(items: ProjectItem[]): FrameRecipe[] {
  return items
    .filter((i): i is Extract<ProjectItem, { kind: "frame" }> => i.kind === "frame")
    .map(({ brain_id, frame_id, metric_keys, table_id, title }) => {
      const recipe: FrameRecipe = { brain_id, title };
      if (frame_id !== undefined) recipe.frame_id = frame_id;
      if (metric_keys !== undefined) recipe.metric_keys = metric_keys;
      if (table_id !== undefined) recipe.table_id = table_id;
      return recipe;
    });
}

// ---------------------------------------------------------------------------
// instantiateTemplate — "new project from template" for a fresh scope.
//
// Produces ProjectItems with:
//   - Fresh ids (caller-controlled for testability)
//   - Fresh added_at (the caller's `now` ISO timestamp — NOT the template's date)
//   - The recipe's brain_id / frame_id / metric_keys / title preserved verbatim
//
// The resulting items carry NO ChartSpec. They are raw {kind:"frame"} recipes that
// freezeSnapshot will re-bind to the brain's live data at BUILD time, stamping each
// frame's asOf from the brain's refined_at at that moment. This is the guarantee:
// every instantiation re-binds from scratch — no stale snapshot leaks through.
//
// @param template  The saved template to instantiate.
// @param now       ISO timestamp for added_at (e.g. new Date().toISOString() — caller
//                  provides so this function is deterministic in tests).
// @param idGen     Optional id generator called with the item index. Defaults to
//                  crypto.randomUUID(). Pass `(i) => \`t\${i}\`` in tests.
// ---------------------------------------------------------------------------

export function instantiateTemplate(
  template: ProjectTemplate,
  now: string,
  idGen?: (i: number) => string,
): ProjectItem[] {
  const gen = idGen ?? (() => crypto.randomUUID());
  return template.recipes.map((recipe, i): ProjectItem => {
    const item: Extract<ProjectItem, { kind: "frame" }> = {
      kind: "frame",
      id: gen(i),
      added_at: now,
      origin: "web",
      brain_id: recipe.brain_id,
      title: recipe.title,
    };
    if (recipe.frame_id !== undefined) item.frame_id = recipe.frame_id;
    if (recipe.metric_keys !== undefined) item.metric_keys = recipe.metric_keys;
    if (recipe.table_id !== undefined) item.table_id = recipe.table_id;
    return item;
  });
}
