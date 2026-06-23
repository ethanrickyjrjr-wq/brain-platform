"use client";

import { useState } from "react";
import { useFiler } from "@/lib/briefcase/file-routing";
import { toast } from "sonner";
import { Plus, Check, Loader2 } from "lucide-react";

interface Props {
  rootId: string;
  title: string;
}

export function AddChartToProject({ rootId, title }: Props) {
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const { file } = useFiler();

  async function handleClick() {
    if (state !== "idle") return;
    setState("saving");
    try {
      const res = await fetch("/api/charts/save-gallery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { id } = (await res.json()) as { id: string };
      file({
        id: crypto.randomUUID(),
        added_at: new Date().toISOString(),
        origin: "web",
        kind: "chart",
        chart_id: id,
        title,
      });
      setState("done");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      toast.error("Couldn't add chart to project");
      setState("idle");
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={state !== "idle"}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-all duration-200 cursor-pointer disabled:cursor-default ${
        state === "done"
          ? "bg-[#0a8078]/20 border-[#0a8078]/50 text-[#0a8078]"
          : "bg-[#0a1419]/80 border-[#22414f] text-[#807e76] hover:border-[#0a8078]/50 hover:text-[#0a8078]"
      }`}
    >
      {state === "saving" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : state === "done" ? (
        <Check className="h-3 w-3" />
      ) : (
        <Plus className="h-3 w-3" />
      )}
      {state === "saving" ? "Saving…" : state === "done" ? "Added" : "Add to project"}
    </button>
  );
}
