"use client";

import { useState } from "react";
import { useBriefcase } from "@/components/briefcase/BriefcaseProvider";
import { buildMetricItem } from "@/lib/briefcase/metric-item";
import { asOfFromToken } from "@/lib/project/as-of";
import type { StatSlot } from "@/lib/deliverable/templates";

export function StatCard({ slot, deliverableId }: { slot: StatSlot; deliverableId: string }) {
  const briefcase = useBriefcase();
  const [filed, setFiled] = useState(false);

  const asOf = asOfFromToken(slot.freshness_token);
  const hasSource = Boolean(slot.source_url || slot.source_label || asOf);

  function handleFile() {
    if (!briefcase) return;
    briefcase.fileItem(
      buildMetricItem({
        deliverable_id: deliverableId,
        label: slot.label,
        value: slot.value,
        source_url: slot.source_url,
        source_label: slot.source_label,
        freshness_token: slot.freshness_token,
      }),
    );
    setFiled(true);
    setTimeout(() => setFiled(false), 1800);
  }

  return (
    <div
      className="rounded-lg border border-white/10 bg-white/5 px-4 py-3"
      style={{ borderLeftColor: "var(--chart-accent, #00d4aa)", borderLeftWidth: "3px" }}
    >
      <p className="text-2xl font-bold leading-tight text-white">{slot.value}</p>
      <p className="mt-1 text-[10px] font-medium uppercase tracking-widest text-gray-400">
        {slot.label}
      </p>

      {hasSource && (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-[10px] text-gray-600 hover:text-gray-400">
            Source ▾
          </summary>
          <p className="mt-1 text-[10px] text-gray-500">
            {slot.source_url ? (
              <a
                href={slot.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#00d4aa] underline underline-offset-2"
              >
                {slot.source_label ?? slot.source_url}
              </a>
            ) : slot.source_label ? (
              slot.source_label
            ) : null}
            {slot.source_label || slot.source_url ? (asOf ? ` · ${asOf}` : null) : asOf}
          </p>
        </details>
      )}

      {briefcase && (
        <button
          type="button"
          onClick={handleFile}
          disabled={filed}
          className="mt-2 text-[10px] text-[#0a8078] transition-colors hover:text-[#00d4aa] disabled:opacity-60"
        >
          {filed ? "Filed ✓" : "+ File"}
        </button>
      )}
    </div>
  );
}
