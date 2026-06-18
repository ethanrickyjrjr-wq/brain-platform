"use client";

import { useState } from "react";
import type { ProjectItem } from "@/lib/project/items";
import { summarizeItem } from "@/lib/project/summarize-item";
import { templateLabel } from "@/lib/deliverable/template-labels";
import type { DeliverableRow, DeliverableEditPatch } from "./types";

// "email" is intentionally excluded: it renders through a scope-bound path, so swapping
// a deliverable to/from it would break a frozen /p/[id] link (mirrors the restyle set).
const NON_EMAIL_TEMPLATES = ["market-overview", "bov-lite", "client-email", "one-pager"] as const;
const DEFAULT_COLOR = "#00d4aa";

/**
 * Guided edit (FINAL BOSS Piece 4). The broker adjusts INPUTS only — pick items,
 * template, brand colors, an optional one-line steer — and Rebuild runs them through
 * the SAME gated assemble pipeline. NEVER free-text prose (that would be the hole that
 * lets unsourced claims in). Cosmetic-only changes (template/color) update in place;
 * an item or steer change forks a new version. Only changed fields are sent.
 */
export function DeliverableEditPanel({
  deliverable: d,
  items,
  projectBranding,
  disabled,
  onCancel,
  onRebuild,
}: {
  deliverable: DeliverableRow;
  items: ProjectItem[];
  projectBranding: Record<string, string> | null;
  /** True while another modal action (refresh/delete) is in flight — locks Rebuild. */
  disabled?: boolean;
  onCancel: () => void;
  onRebuild: (patch: DeliverableEditPatch) => Promise<{ id: string; inPlace: boolean } | null>;
}) {
  const initialBranding = d.branding ?? projectBranding ?? {};
  const initialPrimary = initialBranding.primary_color ?? DEFAULT_COLOR;
  const initialAccent = initialBranding.accent_color ?? DEFAULT_COLOR;

  // An email deliverable keeps its template (a swap would break its scope-bound page);
  // others can restyle among the 4 non-email templates.
  const canChangeTemplate = d.template !== "email";

  const [selected, setSelected] = useState<Set<string>>(() => new Set(d.item_ids));
  const [template, setTemplate] = useState<string>(d.template);
  const [primary, setPrimary] = useState<string>(initialPrimary);
  const [accent, setAccent] = useState<string>(initialAccent);
  const [steer, setSteer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const origItems = new Set(d.item_ids);
  const itemsChanged =
    selected.size !== origItems.size || [...selected].some((id) => !origItems.has(id));
  const templateChanged = template !== d.template;
  const colorChanged = primary !== initialPrimary || accent !== initialAccent;
  const steerProvided = steer.trim().length > 0;
  const dirty = itemsChanged || templateChanged || colorChanged || steerProvided;
  const willFork = itemsChanged || steerProvided; // content change → new version
  // A deliverable needs at least one item (mirrors the build action's guard) — block a
  // rebuild that would drop every item.
  const emptied = selected.size === 0;
  const canRebuild = dirty && !emptied;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function rebuild() {
    if (!canRebuild || submitting) return;
    setSubmitting(true);
    setError(null);
    const patch: DeliverableEditPatch = {};
    if (itemsChanged) patch.items = items.filter((i) => selected.has(i.id));
    if (templateChanged) patch.template = template;
    if (colorChanged)
      patch.branding = { ...initialBranding, primary_color: primary, accent_color: accent };
    if (steerProvided) patch.instruction = steer.trim();
    const result = await onRebuild(patch);
    setSubmitting(false);
    if (!result) setError("Rebuild failed — please try again.");
    // Success → the parent closes the panel and swaps the modal to the new version.
  }

  const inputCls =
    "rounded-md border border-white/10 bg-[#0a1722] px-2 py-1 text-sm text-white focus:border-[#00d4aa] focus:outline-none";

  return (
    <div className="max-h-[78vh] space-y-5 overflow-y-auto bg-[#0a1722] p-4 text-sm text-gray-200">
      <p className="text-xs text-gray-400">
        Adjust the inputs and rebuild. The narrative is regenerated from your filed data — you
        can&apos;t type into the report, so it stays sourced. A shared link to the current version
        keeps working.
      </p>

      {/* Template (not offered for email deliverables — their render path is scope-bound) */}
      {canChangeTemplate && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-300">Template</label>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className={inputCls}
          >
            {NON_EMAIL_TEMPLATES.map((t) => (
              <option key={t} value={t}>
                {templateLabel(t)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Items */}
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-gray-300">
          Items ({selected.size} selected)
        </legend>
        {items.length === 0 ? (
          <p className="text-xs text-gray-500">This project has no items to include.</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((it) => (
              <li key={it.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md p-1 hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={selected.has(it.id)}
                    onChange={() => toggle(it.id)}
                    className="mt-0.5 accent-[#00d4aa]"
                  />
                  <span className="text-xs leading-snug text-gray-300">{summarizeItem(it)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {/* Brand colors */}
      <div className="flex items-center gap-5">
        <label className="flex items-center gap-2 text-xs text-gray-300">
          Primary
          <input
            type="color"
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            className="h-7 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-300">
          Accent
          <input
            type="color"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            className="h-7 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
          />
        </label>
      </div>

      {/* Optional steer */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-300">
          One-line steer{" "}
          <span className="text-gray-500">(optional — regenerates the narrative)</span>
        </label>
        <input
          type="text"
          value={steer}
          onChange={(e) => setSteer(e.target.value)}
          placeholder="e.g. lead with the rent trend"
          className={`${inputCls} w-full`}
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
        <span className="text-[11px] text-gray-500">
          {emptied
            ? "Select at least one item"
            : willFork
              ? "Rebuilds as a new version"
              : dirty
                ? "Updates this version in place"
                : "No changes yet"}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-3 py-1.5 text-xs text-gray-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void rebuild()}
            disabled={!canRebuild || submitting || disabled}
            className="btn-gradient rounded-full px-4 py-1.5 text-xs font-semibold text-navy-dark disabled:opacity-40"
          >
            {submitting ? "Rebuilding…" : willFork ? "Rebuild" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
