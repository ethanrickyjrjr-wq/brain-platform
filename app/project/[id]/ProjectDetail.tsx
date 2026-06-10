"use client";

import { useState } from "react";
import Link from "next/link";
import type { ProjectItem } from "@/lib/project/items";
import type { ChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import { ChartBlockView } from "@/components/charts/ChartBlockView";
import { asOfFromToken } from "@/lib/project/as-of";

export interface SavedChart {
  block: ChartBlock;
  freshness_token: string | null;
}

interface Props {
  id: string;
  title: string | null;
  branding: Record<string, string> | null;
  items: ProjectItem[];
  charts: Record<string, SavedChart>;
}

const BRANDING_FIELDS: { key: string; label: string }[] = [
  { key: "agent_name", label: "Agent name" },
  { key: "photo_url", label: "Photo URL" },
  { key: "license", label: "License #" },
  { key: "brokerage", label: "Brokerage" },
];

/** A plain "as of {date}" citation line — the only v1 freshness surface (no badge). */
function AsOf({ token }: { token: string | null | undefined }) {
  const date = asOfFromToken(token);
  if (!date) return null;
  return <p className="mt-1 text-[11px] font-mono text-gray-500">as of {date}</p>;
}

export function ProjectDetail({
  id,
  title: initialTitle,
  branding: initialBranding,
  items: initialItems,
  charts,
}: Props) {
  const [items, setItems] = useState<ProjectItem[]>(initialItems);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [branding, setBranding] = useState<Record<string, string>>(initialBranding ?? {});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  function mutate(next: ProjectItem[]) {
    setItems(next);
    setDirty(true);
  }
  function removeAt(i: number) {
    mutate(items.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    mutate(next);
  }

  async function patch(body: Record<string, unknown>, okMsg: string) {
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSavedMsg(okMsg);
        if ("items" in body || "title" in body) setDirty(false);
      } else {
        setSavedMsg("Save failed");
      }
    } catch {
      setSavedMsg("Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/project" className="text-xs text-[#00d4aa] underline underline-offset-2">
        ← All projects
      </Link>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          placeholder="Untitled project"
          className="flex-1 rounded-lg border border-white/10 bg-[#0d1e2b]/80 px-3 py-2 text-lg font-semibold text-white outline-none focus:border-[#00d4aa]/40"
        />
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => patch({ items, title: title || null }, "Saved")}
          className="rounded-full bg-[#00d4aa] px-4 py-2 text-sm font-medium text-[#04121b] disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {savedMsg && <p className="mt-2 text-xs text-gray-400">{savedMsg}</p>}

      {/* Items */}
      <ul className="mt-6 flex flex-col gap-3">
        {items.length === 0 && (
          <li className="text-sm text-gray-400">No items in this project yet.</li>
        )}
        {items.map((item, i) => (
          <li key={item.id} className="rounded-xl border border-white/10 bg-[#0d1e2b]/80 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">{item.kind}</span>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="disabled:opacity-30"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === items.length - 1}
                  className="disabled:opacity-30"
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="text-red-400 hover:text-red-300"
                  aria-label="Remove"
                >
                  Remove
                </button>
              </div>
            </div>
            {renderItem(item, charts)}
          </li>
        ))}
      </ul>

      {/* Branding */}
      <section className="mt-8 rounded-xl border border-white/10 bg-[#0d1e2b]/50 p-4">
        <h2 className="text-sm font-semibold text-white">Branding</h2>
        <p className="mt-1 text-xs text-gray-500">Appears on shared deliverables.</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {BRANDING_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-xs text-gray-400">
              {f.label}
              <input
                value={branding[f.key] ?? ""}
                onChange={(e) => setBranding({ ...branding, [f.key]: e.target.value })}
                className="rounded-lg border border-white/10 bg-[#0d1e2b] px-2 py-1.5 text-sm text-white outline-none focus:border-[#00d4aa]/40"
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => patch({ branding }, "Branding saved")}
          className="mt-3 rounded-full border border-[#00d4aa]/40 px-4 py-1.5 text-xs font-medium text-[#00d4aa] disabled:opacity-40"
        >
          Save branding
        </button>
      </section>

      {/* Deliverable actions — wired in later sessions */}
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          disabled
          title="Coming soon"
          className="rounded-full border border-white/10 px-4 py-2 text-sm text-gray-500"
        >
          Save as PDF
        </button>
        {/* TODO(S5): window.print() with print-frame CSS */}
        <button
          type="button"
          disabled
          title="Coming soon"
          className="rounded-full border border-white/10 px-4 py-2 text-sm text-gray-500"
        >
          Build deliverable
        </button>
        {/* TODO(S6): POST /api/projects/[id]/build (forced-tool LLM) → /p/[id] */}
      </div>
    </main>
  );
}

function renderItem(item: ProjectItem, charts: Record<string, SavedChart>) {
  switch (item.kind) {
    case "chart": {
      const saved = charts[item.chart_id];
      if (!saved) return <p className="text-sm text-gray-400">{item.title} (chart unavailable)</p>;
      return (
        <div className="overflow-hidden rounded-lg">
          <ChartBlockView
            block={saved.block}
            asOf={asOfFromToken(saved.freshness_token) ?? undefined}
          />
        </div>
      );
    }
    case "metric":
      return (
        <div>
          <p className="text-sm text-gray-300">{item.label}</p>
          <p className="text-lg font-semibold text-white">{item.value}</p>
          {item.source_url && (
            <a
              href={item.source_url}
              className="text-xs text-[#00d4aa] underline underline-offset-2"
            >
              {item.source_label || "Source"}
            </a>
          )}
          <AsOf token={item.freshness_token} />
        </div>
      );
    case "qa":
      return (
        <div>
          <p className="text-sm font-medium text-white">{item.question}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-300">{item.answer}</p>
          <AsOf token={item.freshness_token} />
        </div>
      );
    case "report":
      return (
        <Link
          href={`/r/${item.slug}`}
          className="text-sm text-[#00d4aa] underline underline-offset-2"
        >
          {item.title || item.slug}
        </Link>
      );
    case "source":
      return (
        <a href={item.url} className="text-sm text-[#00d4aa] underline underline-offset-2">
          {item.label}
        </a>
      );
    case "note":
      return <p className="whitespace-pre-wrap text-sm text-gray-300">{item.text}</p>;
    case "table_slice":
      return (
        <div>
          <p className="mb-2 text-sm font-medium text-white">{item.title}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-300">
              <thead>
                <tr>
                  {item.columns.map((c) => (
                    <th
                      key={c}
                      className="border-b border-white/10 px-2 py-1 font-medium text-gray-400"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {item.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="border-b border-white/5 px-2 py-1">
                        {cell ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AsOf token={item.freshness_token} />
        </div>
      );
    case "file":
      return (
        <p className="text-sm text-gray-400">
          {item.caption || "Attachment"}{" "}
          <span className="text-xs text-gray-600">({item.mime})</span>
          {/* S8 renders uploaded images/PDFs; placeholder until then. */}
        </p>
      );
  }
}
