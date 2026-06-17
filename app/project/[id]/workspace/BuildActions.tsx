"use client";

import type { TemplateId } from "@/lib/deliverable/templates";
import { PrintButton } from "@/components/PrintButton";

/** The deliverable templates the Build button offers (ids mirror
 *  DELIVERABLE_TEMPLATES in lib/deliverable/assemble.ts; the build route
 *  re-validates via isTemplateId, so this list can't drift unchecked). */
const DELIVERABLE_TEMPLATE_OPTIONS: { id: TemplateId; label: string }[] = [
  { id: "market-overview", label: "Market overview" },
  { id: "bov-lite", label: "Broker opinion (BOV lite)" },
  { id: "client-email", label: "Client email" },
  { id: "one-pager", label: "One-pager" },
];

/** Template select + Build + Print. State owned by the orchestrator. */
export function BuildActions({
  projectId,
  template,
  onTemplate,
  onBuild,
  building,
  buildError,
  itemCount,
}: {
  projectId: string;
  template: TemplateId;
  onTemplate: (t: TemplateId) => void;
  onBuild: () => void;
  building: boolean;
  buildError: string | null;
  itemCount: number;
}) {
  return (
    <div className="print-hide mt-6 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <PrintButton reportId={projectId} />
        <select
          value={template}
          onChange={(e) => onTemplate(e.target.value as TemplateId)}
          disabled={building}
          aria-label="Deliverable template"
          className="rounded-full border border-white/10 bg-transparent px-3 py-2 text-sm text-[#f0ede6] disabled:opacity-50"
        >
          {DELIVERABLE_TEMPLATE_OPTIONS.map((t) => (
            <option key={t.id} value={t.id} className="bg-[#0f1d24]">
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onBuild}
          disabled={building || itemCount === 0}
          title={itemCount === 0 ? "File at least one answer, chart, or figure first" : undefined}
          className="btn-gradient rounded-full px-4 py-2 text-sm font-semibold text-navy-dark disabled:opacity-50"
        >
          {building ? "Building…" : "Build deliverable"}
        </button>
      </div>
      {itemCount === 0 && (
        <p className="text-xs text-gray-500">
          File at least one answer, chart, or figure to build a deliverable.
        </p>
      )}
      {buildError && <p className="text-xs text-red-400">{buildError}</p>}
    </div>
  );
}
