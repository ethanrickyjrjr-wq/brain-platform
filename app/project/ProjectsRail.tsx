"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export interface RailProject {
  id: string;
  title: string | null;
  itemCount: number;
}

/**
 * The persistent left projects rail (Piece 1 §A). Each row is a real `/project/[id]`
 * link. Desktop-only; mobile navigates via the `/project` list page.
 *
 * Delete mode: the trash icon in the header puts every row into delete mode. Each row
 * shows an × button; clicking it opens a confirm modal. On confirm, the project is
 * deleted via `DELETE /api/projects/[id]` and the page refreshes (or redirects if the
 * deleted project was the currently-viewed one).
 */
export function ProjectsRail({ projects }: { projects: RailProject[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [deleteMode, setDeleteMode] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Untitled project" }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      if (res.ok && data.id) router.push(`/project/${data.id}`);
    } finally {
      setCreating(false);
    }
  }

  const confirmProject = projects.find((p) => p.id === confirmId);
  const confirmName = confirmProject?.title || "Untitled project";

  async function handleDelete() {
    if (!confirmId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/projects/${confirmId}`, { method: "DELETE" });
      if (res.ok) {
        const wasViewing = pathname.includes(confirmId);
        setConfirmId(null);
        setDeleteMode(false);
        if (wasViewing) {
          router.push("/project");
        } else {
          router.refresh();
        }
      } else {
        setDeleteError("Delete failed — please try again.");
      }
    } catch {
      setDeleteError("Network error — please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <nav
        aria-label="Your projects"
        className="hidden w-64 shrink-0 flex-col gap-1 border-r border-white/10 px-3 py-6 md:flex"
      >
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Projects
          </span>
          <div className="flex items-center gap-2">
            {deleteMode ? (
              <button
                type="button"
                onClick={() => setDeleteMode(false)}
                className="text-xs text-gray-400 hover:text-gray-200"
              >
                Done
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setDeleteMode(true)}
                aria-label="Delete a project"
                title="Delete a project"
                className="text-gray-500 transition-colors hover:text-red-400"
              >
                {/* Trash icon */}
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                  <path
                    d="M1.5 3.5h10M4.5 3.5V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M9.5 3.5v7a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-7"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M5.5 6v3M7.5 6v3"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
            <Link href="/project" className="text-xs text-gray-400 hover:text-[#00d4aa]">
              All
            </Link>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              aria-label="New project"
              title="New project"
              className="rounded-full bg-[#00d4aa]/15 px-2 py-0.5 text-xs font-semibold text-[#00d4aa] hover:bg-[#00d4aa]/30 disabled:opacity-40 transition-colors"
            >
              {creating ? "…" : "+ New"}
            </button>
          </div>
        </div>

        {projects.length === 0 ? (
          <p className="px-1 text-xs text-gray-500">No projects yet.</p>
        ) : (
          <ul className="flex flex-col gap-0.5 overflow-y-auto">
            {projects.map((p) => {
              const href = `/project/${p.id}`;
              const active = pathname === href;
              return (
                <li key={p.id} className="flex items-center gap-1">
                  <Link
                    href={href}
                    prefetch
                    aria-current={active ? "page" : undefined}
                    className={`flex flex-1 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-[#00d4aa]/15 text-white"
                        : "text-gray-300 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span className="truncate">{p.title || "Untitled project"}</span>
                    {!deleteMode && (
                      <span className="shrink-0 text-[10px] text-gray-500">{p.itemCount}</span>
                    )}
                  </Link>
                  {deleteMode && (
                    <button
                      type="button"
                      onClick={() => setConfirmId(p.id)}
                      aria-label={`Delete ${p.title || "untitled project"}`}
                      className="shrink-0 rounded-full p-1 text-sm text-red-400 transition-colors hover:bg-red-400/10"
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {/* Confirm delete modal — fixed overlay, outside the nav so z-index stacks cleanly */}
      {confirmId && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => {
              if (!deleting) {
                setConfirmId(null);
                setDeleteError(null);
              }
            }}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-72 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/15 bg-[#0d1e2b] p-5 shadow-2xl">
            <p className="text-sm font-semibold text-white">Delete &ldquo;{confirmName}&rdquo;?</p>
            <p className="mt-1 text-xs text-gray-400">
              All items and deliverables will be permanently removed.
            </p>
            {deleteError && <p className="mt-2 text-xs text-red-400">{deleteError}</p>}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="rounded-full bg-red-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setConfirmId(null);
                  setDeleteError(null);
                }}
                className="rounded-full border border-white/10 px-4 py-1.5 text-xs text-gray-300 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
