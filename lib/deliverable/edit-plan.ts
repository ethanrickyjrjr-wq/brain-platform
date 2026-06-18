/**
 * lib/deliverable/edit-plan.ts — FINAL BOSS Piece 4 (edit a past deliverable).
 *
 * Classifies a guided-edit request into the two allowed shapes:
 *
 *   - COSMETIC (template and/or branding, no content change) → update in place, no
 *     new row, no LLM. A template swap re-renders from (template, narrative,
 *     items_snapshot) at view time (the `restyle` precedent); a branding change is
 *     a render-time theme injection. Neither changes a FACT.
 *   - CONTENT (items and/or instruction changed) → fork a NEW version through
 *     `assembleDeliverable` (freeze → narrative → insert) with
 *     `supersedes_id = <source id>`. The old /p/[id] stays frozen.
 *
 * The broker supplies the items they want in their OWN deliverable — that's the
 * feature, not an attack to police. The route applies one narrow boundary the
 * platform already enforces elsewhere (storage RLS): a `file` item must reference the
 * caller's own upload, so one client can't graft another client's private file.
 *
 * `email` is NOT an editable template target here — it renders through a scope-bound
 * path and is created via the email/scope build flow; switching to/from it in place
 * would break a frozen /p/[id] link (the email-boundary guard is completed in the route).
 *
 * Pure + total — no I/O — so the classify + validate is unit-testable. The route applies it.
 */

import { isTemplateId } from "./assemble";
import type { TemplateId } from "./templates";

export type Branding = Record<string, unknown>;

export type EditPlan =
  | { mode: "invalid"; status: number; error: string }
  | { mode: "noop" }
  | { mode: "cosmetic"; patch: { template?: TemplateId; branding?: Branding | null } }
  | {
      mode: "content";
      /** undefined → inherit the source row's template */
      template?: TemplateId;
      /** undefined → inherit; explicit null → clear; object → set */
      branding?: Branding | null;
      brandingProvided: boolean;
      /** undefined → inherit; "" → regenerate with no steer */
      instruction?: string;
      instructionProvided: boolean;
      /** undefined → refresh from the source snapshot/project; else the new set */
      items?: unknown;
      itemsProvided: boolean;
    };

export function planDeliverableEdit(body: unknown): EditPlan {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const hasTemplate = "template" in b && b.template !== undefined;
  const hasBranding = "branding" in b && b.branding !== undefined;
  const hasInstruction = "instruction" in b && b.instruction !== undefined;
  const hasItems = "items" in b && b.items !== undefined;

  let template: TemplateId | undefined;
  if (hasTemplate) {
    // Reject "email" as an edit target: it is a scope-bound render path created via the
    // email/scope build flow, never a cosmetic restyle (mirrors the restyle route's set).
    if (!isTemplateId(b.template) || b.template === "email")
      return { mode: "invalid", status: 400, error: "invalid template" };
    template = b.template;
  }

  let branding: Branding | null | undefined;
  if (hasBranding) {
    if (b.branding !== null && (typeof b.branding !== "object" || Array.isArray(b.branding)))
      return { mode: "invalid", status: 400, error: "invalid branding" };
    branding = b.branding as Branding | null;
  }

  let instruction: string | undefined;
  if (hasInstruction) {
    if (typeof b.instruction !== "string")
      return { mode: "invalid", status: 400, error: "invalid instruction" };
    instruction = b.instruction;
  }

  // A new item set or a changed instruction can alter the narrative → must regenerate
  // through the gated pipeline → fork a new version.
  if (hasItems || hasInstruction) {
    return {
      mode: "content",
      template,
      branding,
      brandingProvided: hasBranding,
      instruction,
      instructionProvided: hasInstruction,
      items: hasItems ? b.items : undefined,
      itemsProvided: hasItems,
    };
  }

  // No content change. A template and/or branding change is a cosmetic in-place update.
  if (hasTemplate || hasBranding) {
    const patch: { template?: TemplateId; branding?: Branding | null } = {};
    if (hasTemplate) patch.template = template;
    if (hasBranding) patch.branding = branding ?? null;
    return { mode: "cosmetic", patch };
  }

  return { mode: "noop" };
}
