"use client";

/**
 * CitationList — THE one collapsible "Sources" box. Every page and deliverable routes
 * its sources through this component so citations look the same and clean the same way
 * everywhere. All URL strip/label rules live in the shared root `lib/citations/clean-url`.
 *
 * Behavior (locked by operator):
 *   • Always opens COLLAPSED. One main source is previewed in the header while collapsed.
 *   • Linkable citations → clean anchor (domain/short label, never a raw URL or query string).
 *   • Internal (our lake) citations → branded "SWFL Data Gulf", no link.
 *   • Generic non-linkable citations → plain label.
 *   • Can never overflow into a wall of raw text (every label truncates).
 */
import { useState } from "react";

import { cleanCitations, type CleanCitation, type RawCitation } from "@/lib/citations/clean-url";

/** Back-compat alias for the retired SourcesAccordion shape ({ label, url }). */
export type SourceEntry = RawCitation;

function CitationLine({ c }: { c: CleanCitation }) {
  if (c.linkable && c.href) {
    return (
      <a
        href={c.href}
        target="_blank"
        rel="noopener noreferrer"
        title={c.label}
        className="block max-w-full truncate text-xs text-[#0a8078] underline decoration-[#0a8078]/40 underline-offset-2 hover:decoration-[#0a8078]"
      >
        {c.label}
      </a>
    );
  }
  if (c.is_internal) {
    // Our lake — brand it so the user knows the data came from us; no outbound link.
    return (
      <span title={c.label} className="flex max-w-full items-center gap-1.5 text-xs text-gray-300">
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[#0a8078]" aria-hidden />
        <span className="truncate">{c.label}</span>
      </span>
    );
  }
  // Generic non-linkable external citation.
  return (
    <span title={c.label} className="block max-w-full truncate text-xs text-gray-500">
      {c.label}
    </span>
  );
}

export function CitationList({
  sources,
  className = "",
}: {
  sources: RawCitation[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const cited = cleanCitations(sources ?? []);
  if (cited.length === 0) return null;

  const main = cited[0];

  return (
    <section id="section-sources" className={`mt-10 ${className}`}>
      <div className="overflow-hidden rounded-xl border border-white/10 glass-card-modern">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="section-sources-list"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-gray-300 hover:text-white"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">Sources ({cited.length})</span>
            {/* one main source shown while collapsed — keeps the page clean */}
            {!open && (
              <span className="min-w-0 truncate font-normal text-gray-500" title={main.label}>
                · {main.label}
              </span>
            )}
          </span>
          <svg
            className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M8 10.94L1.53 4.47l1.06-1.06L8 8.82l5.41-5.41 1.06 1.06z" />
          </svg>
        </button>
        {open && (
          <ul
            id="section-sources-list"
            className="divide-y divide-white/[0.06] border-t border-white/10"
          >
            {cited.map((c, i) => (
              <li key={c.href ?? `${c.label}-${i}`} className="px-4 py-2.5">
                <CitationLine c={c} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
