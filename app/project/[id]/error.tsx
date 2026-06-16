"use client";

import Link from "next/link";

export default function ProjectError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm text-gray-400">Unable to load this project.</p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-full border border-white/20 px-4 py-1.5 text-sm text-gray-300 hover:border-white/40 hover:text-white"
        >
          Try again
        </button>
        <Link
          href="/project"
          className="rounded-full border border-white/20 px-4 py-1.5 text-sm text-gray-300 hover:border-white/40 hover:text-white"
        >
          All projects
        </Link>
      </div>
    </div>
  );
}
