"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { ProjectItem } from "@/lib/project/items";
import { dispatchAddItem } from "@/lib/project/add-item-event";
import type { SearchEntry } from "@/app/project/[id]/workspace/types";

/**
 * The pinned bottom-bar search (Piece 1 §F) — "Add to project". Lives in
 * `app/project/layout.tsx` so it persists across project switches (north star).
 * Searches reports (BRAIN_CATALOG) + saved charts (both indexed server-side).
 *
 * Add does NOT write the DB itself — it dispatches the item to the open workspace
 * (`add-item-event`), which appends to its OWN items + persists. That keeps the
 * workspace the SOLE writer of the items array (no dual read-modify-write that could
 * lose items last-writer-wins). Per-project ephemeral state (`added`, `q`) is reset
 * when the active project changes (the component never unmounts) via the React
 * "adjust state during render" pattern — never a props→state effect.
 */
export function ProjectSearch({ entries }: { entries: SearchEntry[] }) {
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());

  const m = pathname?.match(/^\/project\/([^/]+)/);
  const activeId = m ? decodeURIComponent(m[1]) : null;

  // Reset query + "added" markers when switching projects (component is persistent).
  const [lastActiveId, setLastActiveId] = useState(activeId);
  if (activeId !== lastActiveId) {
    setLastActiveId(activeId);
    setAdded(new Set());
    setQ("");
  }

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    return entries.filter((e) => e.haystack.includes(needle)).slice(0, 8);
  }, [q, entries]);

  function add(entry: SearchEntry) {
    if (!activeId) return;
    const item: ProjectItem =
      entry.kind === "report"
        ? {
            id: crypto.randomUUID(),
            added_at: new Date().toISOString(),
            origin: "web",
            kind: "report",
            slug: entry.ref,
            title: entry.label,
          }
        : {
            id: crypto.randomUUID(),
            added_at: new Date().toISOString(),
            origin: "web",
            kind: "chart",
            chart_id: entry.ref,
            title: entry.label,
          };
    dispatchAddItem({ projectId: activeId, item });
    setAdded((prev) => new Set(prev).add(entry.ref));
  }

  return (
    <div className="sticky bottom-0 z-40 border-t border-white/10 bg-[#04121b]/95 px-4 py-2 backdrop-blur">
      <div className="mx-auto max-w-2xl">
        {results.length > 0 && (
          <ul className="mb-2 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-[#0d1e2b] p-1 shadow-2xl">
            {results.map((e) => {
              const isAdded = added.has(e.ref);
              return (
                <li
                  key={`${e.kind}:${e.ref}`}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-gray-400">
                      {e.kind}
                    </span>
                    <span className="truncate text-sm text-white">{e.label}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => add(e)}
                    disabled={!activeId || isAdded}
                    title={activeId ? undefined : "Open a project to add"}
                    className="shrink-0 rounded-full border border-[#00d4aa]/40 px-2.5 py-1 text-xs font-medium text-[#00d4aa] disabled:opacity-40"
                  >
                    {isAdded ? "Added ✓" : "Add"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            activeId ? "Add to this project — search reports & charts…" : "Open a project to add…"
          }
          aria-label="Search reports and charts to add to the project"
          className="w-full rounded-full border border-white/10 bg-[#0d1e2b] px-4 py-2 text-sm text-white outline-none placeholder:text-gray-500 focus:border-[#00d4aa]/40"
        />
      </div>
    </div>
  );
}
