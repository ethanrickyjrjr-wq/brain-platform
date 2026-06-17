"use client";

import { useState } from "react";

const BRANDING_FIELDS: { key: string; label: string }[] = [
  { key: "agent_name", label: "Agent name" },
  { key: "photo_url", label: "Photo URL" },
  { key: "license", label: "License #" },
  { key: "brokerage", label: "Brokerage" },
];

/**
 * Branding fields + Save, collapsible (Piece 1 §E). Collapsed by default when any
 * field is already filled — a freshly-created project copies `user_brand_profiles`
 * → branding (G2), so a branded project opens tidy; an empty one opens expanded so
 * the user fills it. Collapse state is local + lazily initialized (no effect).
 */
export function BrandingBlock({
  branding,
  onChange,
  onSave,
  saving,
}: {
  branding: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const hasBrand = BRANDING_FIELDS.some((f) => (branding[f.key] ?? "").trim() !== "");
  const [open, setOpen] = useState(() => !hasBrand);

  return (
    <section className="mt-8 rounded-xl border border-white/10 bg-[#0d1e2b]/50 p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span>
          <span className="text-sm font-semibold text-white">Branding</span>
          <span className="ml-2 text-xs text-gray-500">Appears on shared deliverables.</span>
        </span>
        <span className="text-xs text-gray-500">{open ? "Hide" : "Edit"}</span>
      </button>

      {open && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {BRANDING_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-xs text-gray-400">
                {f.label}
                <input
                  value={branding[f.key] ?? ""}
                  onChange={(e) => onChange({ ...branding, [f.key]: e.target.value })}
                  className="rounded-lg border border-white/10 bg-[#0d1e2b] px-2 py-1.5 text-sm text-white outline-none focus:border-[#00d4aa]/40"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onSave}
            className="mt-3 rounded-full border border-[#00d4aa]/40 px-4 py-1.5 text-xs font-medium text-[#00d4aa] disabled:opacity-40"
          >
            Save branding
          </button>
        </>
      )}
    </section>
  );
}
