"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DeliverableRow } from "@/app/project/[id]/workspace/types";
import { getMaterialStatus, getFormatBadge } from "@/lib/deliverable/material-status";

/** Derive a human-readable title from the material's doc or fallback fields. */
export function deriveTitle(d: DeliverableRow): string {
  // Precedence is by FIELD, not document order: hero.label → hero.value →
  // header.tagline. Seeds are header-first and the default header carries a brand
  // tagline, so a document-order scan would title every material with the same
  // tagline and hide the distinguishing hero headline.
  const blocks = d.doc?.blocks ?? [];
  for (const b of blocks) if (b.type === "hero" && b.props.label) return b.props.label;
  for (const b of blocks) if (b.type === "hero" && b.props.value) return b.props.value;
  for (const b of blocks) if (b.type === "header" && b.props.tagline) return b.props.tagline;
  if (d.exec_summary) return d.exec_summary;
  const badge = getFormatBadge(d.template);
  const dt = new Date(d.created_at);
  const mon = dt.toLocaleString("en-US", { month: "short", year: "numeric" });
  return `${badge.label} · ${mon}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function rowHref(d: { template: string; id: string }, projectId: string): string {
  return d.template === "block-canvas"
    ? `/project/${projectId}/email-lab?did=${d.id}`
    : `/p/${d.id}`;
}

interface Props {
  d: DeliverableRow & { versions: DeliverableRow[] };
  projectId: string;
  onRefresh: (id: string) => Promise<void>;
  onTrash?: (id: string) => Promise<void>;
}

export function MaterialRow({ d, projectId, onRefresh, onTrash }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const badge = getFormatBadge(d.template);
  const status = getMaterialStatus(d);
  const title = deriveTitle(d);
  const swatchColor = d.doc?.globalStyle?.accentColor ?? badge.color;
  const href = rowHref(d, projectId);

  async function handleRefresh(e: React.MouseEvent) {
    e.stopPropagation();
    setRefreshing(true);
    try {
      await onRefresh(d.id);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="group relative">
      {/* Main row */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => router.push(href)}
        onKeyDown={(e) => {
          // Only the row itself activates on Enter/Space — not keydowns bubbling up
          // from the inner buttons (accordion toggle, Update), whose click-time
          // stopPropagation does NOT stop keydown. Without this guard, pressing Enter
          // on those controls would navigate the row instead of acting on them.
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            router.push(href);
          }
        }}
        className="flex cursor-pointer items-center gap-3 border-b border-white/[0.08] py-3 pl-4 pr-3 hover:bg-white/[0.03] focus:outline-none focus:ring-inset focus:ring-1 focus:ring-[#1BB8C9]/40"
      >
        {/* 4px brand swatch bar */}
        <div
          className="absolute left-0 top-0 h-full w-1 rounded-l"
          style={{ backgroundColor: swatchColor }}
          aria-hidden="true"
        />

        {/* Title */}
        <span className="flex-1 truncate text-sm text-white/85">{title}</span>

        {/* Format badge */}
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.bg}`}
          style={{ color: badge.color }}
        >
          {badge.label}
        </span>

        {/* Status: amber update affordance */}
        {status === "needs_update" && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
          >
            {refreshing ? "Updating…" : "Update ↻"}
          </button>
        )}

        {/* Version accordion toggle */}
        {d.versions.length > 0 && (
          <button
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            className="shrink-0 text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            Updated {d.versions.length}× {open ? "⌃" : "⌄"}
          </button>
        )}
      </div>

      {/* Version accordion sub-rows */}
      {open && d.versions.length > 0 && (
        <div className="border-b border-white/[0.08]">
          {d.versions.map((v) => {
            const vHref = rowHref(v, projectId);
            return (
              <div
                key={v.id}
                className="ml-6 flex items-center gap-3 border-l border-white/10 py-1.5 pl-3 pr-3"
              >
                <span className="text-xs text-white/40">{formatDate(v.created_at)}</span>
                <button
                  onClick={() => router.push(vHref)}
                  className="text-xs text-white/50 hover:text-white/80 transition-colors"
                >
                  Open
                </button>
                {onTrash && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTrash(v.id);
                    }}
                    className="text-xs text-white/30 hover:text-red-400 transition-colors"
                  >
                    Trash
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
