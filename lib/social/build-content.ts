// lib/social/build-content.ts
//
// Build the per-target social post content (caption + hashtags + freshness + image)
// from the live brain dossier. Enforces the MOAT .in_scope gate: if the brain has
// no data at the requested scope, returns null and the target is skipped — NEVER
// invents or halluculates a number.
//
// Mirrored from: lib/email/recurring-report.ts (the "build content per scope" seam)
// and lib/deliverable/schedule-recipe.ts:42-71 (fresh-data-every-run bridge).
//
// KEY RULES:
//   - Honors place/county/ZIP via parseDeliverableScope (SCOPE_KINDS = {zip, place, county})
//   - Does NOT hard-lock to ZIP — the spec says "honor place/county/ZIP via parse-scope"
//   - MOAT gate: in_scope must be true in the brain payload; if false → return null
//   - Never invents numbers — all values come verbatim from the brain dossier

import { parseDeliverableScope } from "@/lib/deliverable/parse-scope";
import type { SocialTarget, SocialContent } from "./types";

/**
 * Minimal brain payload shape we read. The real payload has more fields;
 * this is the slice we need for social content generation.
 */
export interface BrainDossier {
  in_scope: boolean;
  freshness_token: string;
  conclusion?: string | null;
  key_metrics?: Array<{ label: string; value: string | number }>;
  brain_id?: string;
}

export interface BuildSocialContentDeps {
  /**
   * Fetch a brain dossier for the given scope. Injectable for tests.
   * Returns null when the API is unavailable or the scope has no data.
   */
  fetchBrain: (scopeKind: string | null, scopeValue: string | null) => Promise<BrainDossier | null>;
}

/**
 * Build social post content for one target.
 *
 * Returns null when:
 *   - The brain fetch fails (unreachable / no data)
 *   - The brain payload says in_scope=false (MOAT gate — never invent)
 *   - The scope_kind is unrecognized (parse-scope returns {})
 *
 * Returns SocialContent when there is in-scope, fresh data to post.
 */
export async function buildSocialContent(
  target: SocialTarget,
  deps: BuildSocialContentDeps,
): Promise<SocialContent | null> {
  // 1. Canonicalize the scope (mirrors parseDeliverableScope — same contract).
  const { scope_kind, scope_value } = parseDeliverableScope(
    target.scopeKind ?? undefined,
    target.scopeValue ?? undefined,
  );

  // 2. Fetch fresh brain data for this scope.
  const dossier = await deps.fetchBrain(scope_kind ?? null, scope_value ?? null);

  // 3. MOAT gate: null fetch or in_scope=false → skip this target.
  if (!dossier || !dossier.in_scope) return null;

  // 4. Compose caption from verbatim brain data (no invented numbers).
  //    The caption is a short summary of the conclusion + key metric.
  //    Build 05 (the deliverable template) owns the styled social template;
  //    here we produce a content-correct baseline.
  const caption = buildCaption(dossier, target);

  // 5. Hashtags: schedule-level defaults + topic-aware additions.
  const hashtags = buildHashtags(target, dossier);

  return {
    caption,
    hashtags,
    freshness: dossier.freshness_token,
    // image: injected by build 02 (renderer); undefined here in build 01
  };
}

/** Build the social caption from verbatim brain dossier fields. */
function buildCaption(dossier: BrainDossier, target: SocialTarget): string {
  const scopeLabel = target.scopeValue
    ? `${target.scopeValue.charAt(0).toUpperCase()}${target.scopeValue.slice(1)}`
    : "Southwest Florida";

  const lines: string[] = [];

  // Lead with the conclusion when available (verbatim from brain).
  if (dossier.conclusion) {
    lines.push(dossier.conclusion);
  } else {
    lines.push(`${scopeLabel} market update`);
  }

  // Append the top key metric when present.
  if (dossier.key_metrics && dossier.key_metrics.length > 0) {
    const top = dossier.key_metrics[0];
    lines.push(`${top.label}: ${top.value}`);
  }

  // Attribution.
  lines.push("Data: SWFL Data Gulf");

  return lines.join("\n\n");
}

/** Build hashtag list: schedule defaults + context-aware additions. */
function buildHashtags(target: SocialTarget, _dossier: BrainDossier): string[] {
  const base = [...(target.hashtags ?? [])];

  // Scope-derived hashtags.
  if (target.scopeKind === "county" && target.scopeValue) {
    const countyBase = target.scopeValue.replace(/\s+county$/i, "").trim();
    const county = countyBase.replace(/\s+/g, "").replace(/^./, (c) => c.toUpperCase());
    base.push(`#${county}County`, "#SWFLRealEstate");
  } else if (target.scopeKind === "place" && target.scopeValue) {
    const place = target.scopeValue.replace(/\s+/g, "");
    base.push(`#${place}`, "#SWFLRealEstate");
  } else {
    base.push("#SWFLRealEstate", "#SWFL");
  }

  // Dedup while preserving order.
  return [...new Set(base)];
}
