"use client";
import { useState } from "react";

export interface SourceEntry {
  label: string;
  url: string;
}

export function SourcesAccordion({ sources }: { sources: SourceEntry[] }) {
  const [open, setOpen] = useState(false);
  const validSources = sources.filter((s) => s.url);
  if (validSources.length === 0) return null;

  return (
    <section id="section-sources" className="mt-10">
      <div className="overflow-hidden rounded-xl border border-white/10 glass-card-modern">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-300 hover:text-white"
          aria-expanded={open}
        >
          <span>Sources ({validSources.length})</span>
          <svg
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M8 10.94L1.53 4.47l1.06-1.06L8 8.82l5.41-5.41 1.06 1.06z" />
          </svg>
        </button>
        {open && (
          <ul className="divide-y divide-white/[0.06] border-t border-white/10">
            {validSources.map((s, i) => (
              <li key={i} className="px-4 py-2.5">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#0a8078] underline decoration-[#0a8078]/40 underline-offset-2 hover:decoration-[#0a8078]"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
