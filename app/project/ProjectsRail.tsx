"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface RailProject {
  id: string;
  title: string | null;
  itemCount: number;
}

/**
 * The persistent left projects rail (Piece 1 §A — the master-detail spine). Lives
 * in `app/project/layout.tsx` so it survives `/project ↔ /project/[id]` nav: only
 * the right side swaps, the rail + the root-mounted AI never unmount. Each row is a
 * real `/project/[id]` link (shareable, back-button) — `Link` prefetches the route
 * on hover ("time to load during click-over"). Desktop-only; mobile navigates via
 * the `/project` list page. The active project is highlighted from the pathname.
 */
export function ProjectsRail({ projects }: { projects: RailProject[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Your projects"
      className="hidden w-64 shrink-0 flex-col gap-1 border-r border-white/10 px-3 py-6 md:flex"
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Projects
        </span>
        <Link href="/project" className="text-xs text-gray-400 hover:text-[#00d4aa]">
          All
        </Link>
      </div>
      {projects.length === 0 ? (
        <p className="px-1 text-xs text-gray-500">No projects yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5 overflow-y-auto">
          {projects.map((p) => {
            const href = `/project/${p.id}`;
            const active = pathname === href;
            return (
              <li key={p.id}>
                <Link
                  href={href}
                  prefetch
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-[#00d4aa]/15 text-white"
                      : "text-gray-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span className="truncate">{p.title || "Untitled project"}</span>
                  <span className="shrink-0 text-[10px] text-gray-500">{p.itemCount}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
