"use client";

import { useState } from "react";
import { useBriefcase } from "@/components/briefcase/BriefcaseProvider";
import type { ProjectItem } from "@/lib/project/items";

interface Props {
  chartId: string;
  title: string;
}

export function AddToProject({ chartId, title }: Props) {
  const [filed, setFiled] = useState(false);
  const briefcase = useBriefcase();

  function handleAdd() {
    const item: ProjectItem = {
      id: crypto.randomUUID(),
      added_at: new Date().toISOString(),
      origin: "web",
      kind: "chart",
      chart_id: chartId,
      title,
    };
    // File THROUGH the root BriefcaseProvider so the pill badge count updates
    // immediately (a direct localStorage write doesn't notify React → stale badge
    // same-tab; the provider's write-through persists to the same DRAFT_KEY).
    briefcase?.fileItem(item);
    setFiled(true);
    setTimeout(() => setFiled(false), 2000);
    void fetch("/api/meter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "item_add", report_id: "" }),
    }).catch(() => {});
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      className="text-xs text-[#00d4aa] underline underline-offset-2 transition-colors hover:text-[#00d4aa]/80"
    >
      {filed ? "Added ✓" : "Add to project"}
    </button>
  );
}
