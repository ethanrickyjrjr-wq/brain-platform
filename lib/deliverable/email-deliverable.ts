/**
 * lib/deliverable/email-deliverable.ts — freeze a briefcase "email" deliverable into
 * the Task-2 grounded spine (`GroundedReportModel`).
 *
 * PURE + DETERMINISTIC: same row → same model → same output every render. No I/O, no
 * `new Date()`, no live brain fetch — the model is reconstructed entirely from the
 * frozen `items_snapshot` + `narrative` + the persisted ZIP scope. That is the moat:
 * the email and PDF skins can never drift from what the deliverable froze.
 *
 * Scope is ZIP-only (the recurring lane's `resolveReportZip` guard, shared so the two
 * lanes can never diverge). A non-ZIP / blank scope returns null → the caller renders
 * the global digest fallback rather than inventing sub-grain precision.
 */

import { resolveReportZip } from "../email/recurring-report";
import type { ActivationSnapshot } from "../email/activation/types";
import type { GroundedReportModel } from "../email/grounded-report";
import type { ReportMetric, ReportLine } from "../email/activation/snapshot";
import type { SnapshotItem, Narrative } from "./templates";

/**
 * The frozen deliverable fields the email model reads. The DB `deliverables` row (and
 * the `/p/[id]` page's `DeliverableRow`) is a structural SUPERSET, so callers pass
 * their row directly — no shared types module needed.
 */
export interface EmailDeliverableRow {
  template: string;
  created_at: string;
  scope_kind: string | null;
  scope_value: string | null;
  items_snapshot: SnapshotItem[];
  narrative: Narrative;
}

/**
 * A render-irrelevant placeholder snapshot. `delta` is never computed for a briefcase
 * email (there is no prior snapshot to diff), so the renderer never reads these fields
 * — but we still satisfy the full `ActivationSnapshot` contract. `captured_at` derives
 * from the deliverable's freeze time (deterministic), never `new Date()`.
 */
function emptyActivationSnapshot(zip: string, capturedAt: string): ActivationSnapshot {
  return { zip, freshness_token: null, captured_at: capturedAt, metrics: [], lines: [] };
}

/**
 * The first `freshness_token` carried by any snapshot item (metric / qa / report /
 * table_slice / chart / frame may each carry one). The token is the ONE piece of
 * provenance the email skin actually renders, so we surface it even for a deliverable
 * whose metrics happen to lack one.
 */
function firstFreshnessToken(items: SnapshotItem[]): string | null {
  for (const item of items) {
    const t = (item as { freshness_token?: unknown }).freshness_token;
    if (typeof t === "string" && t.length > 0) return t;
  }
  return null;
}

export function buildEmailDeliverableModel(
  row: EmailDeliverableRow,
  opts?: { ctaUrl?: string; siteOrigin?: string },
): GroundedReportModel | null {
  const zip = resolveReportZip(row.scope_kind, row.scope_value);
  if (!zip) return null;

  const metricItems = row.items_snapshot.filter(
    (item): item is Extract<SnapshotItem, { kind: "metric" }> => item.kind === "metric",
  );

  // Numbers: the metric item stores a pre-formatted string (e.g. "$412,000"); the raw
  // number isn't kept, so the string is the `display` and `value` stays null. The
  // renderer reads `display`, never `value`.
  const metrics: ReportMetric[] = metricItems.map((item) => ({
    key: item.metric_slug ?? item.id,
    label: item.label,
    value: null,
    display: item.value,
  }));

  // Reads: the deliverable's PROSE (exec_summary + section intros) — NOT a second copy
  // of the metrics. `renderGroundedReport` renders only `line.text`; `source_url` /
  // `source_citation` are type-required but never rendered in this skin, so they are
  // safe placeholders. The visible provenance is the freshness token, surfaced below.
  const lines: ReportLine[] = [];
  const pushLine = (label: string, text: string) => {
    if (!text) return;
    lines.push({
      brain_id: row.template,
      grain: "zip",
      is_true_zip: true,
      label,
      text,
      source_url: "",
      source_citation: "",
    });
  };
  pushLine("Summary", row.narrative.exec_summary ?? "");
  for (const s of row.narrative.sections ?? []) {
    pushLine(s.title, [s.title, s.intro].filter(Boolean).join(" — "));
  }

  return {
    in_scope: true,
    zip,
    primaryPlace: null,
    countyName: null,
    freshness_token: firstFreshnessToken(row.items_snapshot),
    metrics,
    lines,
    coverage_caveats: [],
    snapshot: emptyActivationSnapshot(zip, row.created_at),
    delta: null,
    scope: { kind: "zip", value: zip, grain: "zip" },
    cta_url: opts?.ctaUrl,
    site_origin: opts?.siteOrigin,
  };
}
