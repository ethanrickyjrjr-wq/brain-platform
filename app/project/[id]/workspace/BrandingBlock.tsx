"use client";

import { useState } from "react";

const BRANDING_FIELDS: { key: string; label: string }[] = [
  { key: "agent_name", label: "Agent name" },
  { key: "photo_url", label: "Photo URL" },
  { key: "license", label: "License #" },
  { key: "brokerage", label: "Brokerage" },
];

// The keys `applyUserBrandToProject` copies from `user_brand_profiles` (a project
// branded by ANY creation path carries these, not the editable text fields). Counts
// toward "already branded" so a copy-branded project also opens collapsed (§E).
const COPY_KEYS = ["primary_color", "accent_color", "logo_url"];

/**
 * Branding fields + Save, collapsible (Piece 1 §E). Collapsed by default when the
 * project is already branded — either via the editable fields OR the colors/logo a
 * fresh project copies from `user_brand_profiles` (G2). Collapses on a SUCCESSFUL
 * save (a failed save stays open with the error). Collapse state is local + lazily
 * initialized (no props→state effect).
 */
export function BrandingBlock({
  branding,
  onChange,
  onSave,
  saving,
  savedMsg,
}: {
  branding: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  onSave: () => Promise<boolean>;
  saving: boolean;
  savedMsg: string | null;
}) {
  const filled = (k: string) => (branding[k] ?? "").trim() !== "";
  const hasBrand = BRANDING_FIELDS.some((f) => filled(f.key)) || COPY_KEYS.some(filled);
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
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                const ok = await onSave();
                if (ok) setOpen(false); // collapse only on success (§E)
              }}
              className="rounded-full border border-[#00d4aa]/40 px-4 py-1.5 text-xs font-medium text-[#00d4aa] disabled:opacity-40"
            >
              Save branding
            </button>
            {savedMsg && <span className="text-xs text-gray-500">{savedMsg}</span>}
          </div>
        </>
      )}
    </section>
  );
}
