/**
 * lib/deliverable/assemble.ts — the shared build orchestrator.
 *
 * ONE build path, two callers (R4 single-source-of-truth):
 *   - the web build route (`/api/projects/[id]/build`) — owner proven by cookie/RLS
 *   - the MCP `swfl_project_build` tool — project proven by capability key
 * Both prove WHO/WHICH first, then hand an already-authorized project here. This
 * function does NOT authenticate and does NOT meter — that is the caller's job.
 *
 * It validates the items, freezes the snapshot (resolving chart refs), runs the
 * one forced-tool narrative pass (linted — the moat), and inserts a `deliverables`
 * row under a full-entropy slug, returning `{ id }` → the caller builds `/p/[id]`.
 */

import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDeliverableNarrative, freezeSnapshot } from "./build";
import { projectItemsSchema } from "../project/items";
import { checkSocialGrain, type TemplateId } from "./templates";

export const DELIVERABLE_TEMPLATES = new Set<TemplateId>([
  "market-overview",
  "bov-lite",
  "client-email",
  "one-pager",
  "email",
  "social",
]);

export function isTemplateId(t: unknown): t is TemplateId {
  return typeof t === "string" && DELIVERABLE_TEMPLATES.has(t as TemplateId);
}

/** A typed failure the caller maps to its own surface (HTTP status / tool error). */
export class DeliverableError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DeliverableError";
  }
}

export async function assembleDeliverable(opts: {
  /** SERVICE-ROLE client — reads `saved_charts` (public-select) + inserts `deliverables`. */
  db: SupabaseClient;
  /** The SOLE write target — derived by the caller from proven ownership / the key. */
  projectId: string;
  /** Owner uid stamped onto the deliverable row. */
  ownerId: string;
  /** Raw `projects.items` (validated here defensively). */
  items: unknown;
  branding: unknown;
  template: TemplateId;
  instruction: string;
  /** ZIP scope for an `"email"` deliverable (same shape as `email_schedules`).
   *  Persisted so `/p/[id]` + the print route reconstruct the grounded model without
   *  re-fetching. Omitted/NULL for the other templates → no scope is written. */
  scope_kind?: string;
  scope_value?: string;
  /** Version lineage (FINAL BOSS Piece 4): the deliverable id this new row replaces.
   *  Set by the refresh + content-edit routes, which fork a NEW row (a fresh snapshot
   *  at today's data) so a shared `/p/[id]` stays frozen for an external holder. Omitted
   *  for an original build → NULL (a "head"). */
  supersedesId?: string;
}): Promise<{ id: string }> {
  const parsed = projectItemsSchema.safeParse(opts.items ?? []);
  if (!parsed.success) throw new DeliverableError("project items invalid", 422);

  // Social grain guard (the MOAT at the assemble layer): a single-visual card aimed
  // at an out-of-footprint scope is refused — we never substitute a "representative"
  // ZIP or fabricate a sub-grain number. Offer the grain we hold instead.
  if (opts.template === "social") {
    const grain = checkSocialGrain(opts.scope_kind, opts.scope_value);
    if (!grain.ok) throw new DeliverableError(grain.reason, 422);
  }

  const itemsSnapshot = await freezeSnapshot(opts.db, parsed.data);
  const { narrative } = await buildDeliverableNarrative({
    instruction: opts.instruction,
    items: itemsSnapshot,
    template: opts.template,
  });

  // Full-entropy slug (≥122 bits, [LB-R5]) — base64url of 16 random bytes = 128 bits.
  const slug = crypto.randomBytes(16).toString("base64url");

  const { error } = await opts.db.from("deliverables").insert({
    id: slug,
    project_id: opts.projectId,
    user_id: opts.ownerId,
    template: opts.template,
    instruction: opts.instruction || null,
    narrative,
    items_snapshot: itemsSnapshot,
    branding: opts.branding ?? null,
    status: "ready",
    scope_kind: opts.scope_kind ?? null,
    scope_value: opts.scope_value ?? null,
    supersedes_id: opts.supersedesId ?? null,
  });
  if (error) throw new DeliverableError("build failed", 500);

  return { id: slug };
}
