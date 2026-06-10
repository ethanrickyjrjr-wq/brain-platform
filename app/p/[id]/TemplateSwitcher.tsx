"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Restyle switcher (S6 task-06): swap the deliverable's template with NO new LLM
 * call. The /p/[id] server page rebuilds the RenderModel from
 * (template, narrative, items_snapshot) on every load, so POSTing the new
 * template + `router.refresh()` re-renders the same facts under a new structure
 * instantly and for free. `.print-hide` keeps it out of the printed PDF.
 */

const TEMPLATES = [
  { id: "market-overview", label: "Market overview" },
  { id: "bov-lite", label: "BOV-lite" },
  { id: "client-email", label: "Client email" },
  { id: "one-pager", label: "One-pager" },
] as const;

export function TemplateSwitcher({ id, current }: { id: string; current: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function restyle(template: string) {
    if (template === current || pending) return;
    setPending(template);
    try {
      const res = await fetch(`/api/deliverables/${id}/restyle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template }),
      });
      if (res.ok) router.refresh(); // re-renders the new template — no LLM, instant
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="print-hide flex flex-wrap items-center gap-2">
      {TEMPLATES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => restyle(t.id)}
          disabled={pending !== null}
          aria-pressed={t.id === current}
          className={`rounded-full px-3 py-1 text-xs transition-colors ${
            t.id === current
              ? "bg-[#00d4aa] text-black"
              : "bg-white/10 text-gray-300 hover:bg-white/20"
          } ${pending === t.id ? "opacity-50" : ""}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
