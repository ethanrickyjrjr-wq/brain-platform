"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewProjectButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Untitled project" }),
      });
      if (res.ok) {
        const { id } = (await res.json()) as { id?: string };
        if (id) router.push(`/project/${id}`);
      }
    } catch {
      // surfaced by leaving the button enabled to retry
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={create}
      disabled={busy}
      className="rounded-full bg-[#00d4aa] px-4 py-2 text-sm font-medium text-[#04121b] transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {busy ? "Creating…" : "New project"}
    </button>
  );
}
