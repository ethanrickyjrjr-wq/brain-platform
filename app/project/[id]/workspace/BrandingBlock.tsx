"use client";

import { useState } from "react";
import { PLATFORMS } from "@/lib/email/social/platforms";
import {
  type BrandPalette,
  PALETTE_SLOT_KEYS,
  newPaletteId,
  normalizeHex,
  schemeFromBranding,
  schemeHasColor,
  schemesEqual,
} from "@/lib/brand/palette";

const AGENT_FIELDS: { key: string; label: string; span?: "full" }[] = [
  { key: "agent_name", label: "Name" },
  { key: "agent_title", label: "Title / Role" },
  { key: "brokerage", label: "Brokerage" },
  { key: "license", label: "License #" },
];

const CONTACT_FIELDS: { key: string; label: string }[] = [
  { key: "contact_email", label: "Email" },
  { key: "contact_phone", label: "Phone" },
  { key: "website_url", label: "Website" },
];

const MEDIA_FIELDS: { key: string; label: string }[] = [
  { key: "photo_url", label: "Headshot URL" },
  { key: "logo_url", label: "Logo URL" },
];

// The three saved-color slots. The first two map onto the canonical theme
// fields (`primary_color` / `accent_color`) read by brand-theme.ts, so saving
// them actually themes deliverables; the third is a free extra swatch. Keys
// come from PALETTE_SLOT_KEYS so the slots and the palette colors stay aligned.
const COLOR_SLOTS: { key: string; label: string }[] = [
  { key: PALETTE_SLOT_KEYS[0], label: "Primary" },
  { key: PALETTE_SLOT_KEYS[1], label: "Accent" },
  { key: PALETTE_SLOT_KEYS[2], label: "Extra" },
];

// The color chart — a fixed palette you can pick from instead of typing a hex.
const COLOR_CHART: string[] = [
  "#3DC9C0",
  "#0ea5e9",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#0f172a",
  "#334155",
  "#64748b",
  "#cbd5e1",
  "#ffffff",
];

const INPUT_CLS =
  "rounded-lg border border-white/10 bg-[#04121b] px-2 py-1.5 text-sm text-white outline-none focus:border-gulf-teal/40";

/**
 * Branding panel — rendered inside the Brand pill popover.
 * Two save modes:
 *   "Save"               → writes to user's account default + current project
 *   "Save To This Project" → writes to current project only
 * Auto-closes on successful save; the × button closes without saving.
 *
 * Saved palettes (`palettes` / `onPalettesChange`) are an account-level library
 * of color schemes: pick a chip to apply it to THIS project, or "Save as new
 * palette" to snapshot the current colors into the library so they carry to new
 * projects. Applying never rewrites past projects (project.branding is saved
 * per-project via the buttons below).
 */
export function BrandingBlock({
  branding,
  onChange,
  palettes,
  onPalettesChange,
  onSaveGlobal,
  onSaveProjectOnly,
  saving,
  savedMsg,
  onClose,
}: {
  branding: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  palettes: BrandPalette[];
  onPalettesChange: (next: BrandPalette[]) => void;
  onSaveGlobal: () => Promise<boolean>;
  onSaveProjectOnly: () => Promise<boolean>;
  saving: boolean;
  savedMsg: string | null;
  onClose: () => void;
}) {
  // The color currently held in the picker — typed as hex or picked from the
  // chart, then dropped into one of the three save slots.
  const [draft, setDraft] = useState("#3DC9C0");
  const [hexText, setHexText] = useState("#3DC9C0");

  function setColor(raw: string) {
    setHexText(raw);
    const hex = normalizeHex(raw);
    if (hex) setDraft(hex);
  }

  function saveToSlot(key: string) {
    onChange({ ...branding, [key]: draft });
  }

  // Apply a saved palette's three colors to this project's slots.
  function applyPalette(p: BrandPalette) {
    const next = { ...branding };
    PALETTE_SLOT_KEYS.forEach((key, i) => {
      next[key] = p.colors[i] ?? "";
    });
    onChange(next);
  }

  // Snapshot the current three slot colors into the account palette library.
  function saveAsPalette() {
    const colors = schemeFromBranding(branding);
    if (!schemeHasColor(colors)) return;
    if (palettes.some((p) => schemesEqual(p.colors, colors))) return; // already saved
    onPalettesChange([
      ...palettes,
      { id: newPaletteId(), name: `Palette ${palettes.length + 1}`, colors },
    ]);
  }

  const currentScheme = schemeFromBranding(branding);
  const canSavePalette =
    schemeHasColor(currentScheme) && !palettes.some((p) => schemesEqual(p.colors, currentScheme));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-white">Branding</span>
          <span className="ml-2 text-xs text-gray-500">Auto-fills Email Lab + deliverables.</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full px-2 text-lg leading-none text-gray-500 hover:text-gray-300"
        >
          ×
        </button>
      </div>

      {/* ── Agent identity ── */}
      <div className="grid grid-cols-2 gap-3">
        {AGENT_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-xs text-gray-400">
            {f.label}
            <input
              value={branding[f.key] ?? ""}
              onChange={(e) => onChange({ ...branding, [f.key]: e.target.value })}
              className={INPUT_CLS}
            />
          </label>
        ))}
      </div>

      {/* ── Bio ── */}
      <label className="mt-3 flex flex-col gap-1 text-xs text-gray-400">
        Bio
        <textarea
          value={branding.agent_bio ?? ""}
          onChange={(e) => onChange({ ...branding, agent_bio: e.target.value })}
          rows={2}
          placeholder="Short professional bio shown on listing and agent intro emails…"
          className={`${INPUT_CLS} resize-none`}
        />
      </label>

      {/* ── Contact ── */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        {CONTACT_FIELDS.map((f) => (
          <label
            key={f.key}
            className={`flex flex-col gap-1 text-xs text-gray-400 ${f.key === "website_url" ? "col-span-2" : ""}`}
          >
            {f.label}
            <input
              value={branding[f.key] ?? ""}
              onChange={(e) => onChange({ ...branding, [f.key]: e.target.value })}
              className={INPUT_CLS}
            />
          </label>
        ))}
      </div>

      {/* ── Media URLs ── */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        {MEDIA_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-xs text-gray-400">
            {f.label}
            <input
              value={branding[f.key] ?? ""}
              onChange={(e) => onChange({ ...branding, [f.key]: e.target.value })}
              className={INPUT_CLS}
            />
          </label>
        ))}
      </div>

      {/* ── Connect Socials ── */}
      <div className="mt-4 border-t border-white/10 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-white">Connect Socials</span>
          <span className="text-[10px] text-gray-500">Auto-fill the footer + social block.</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {PLATFORMS.map((m) => (
            <SocialField
              key={m.brandingKey}
              label={m.label}
              value={branding[m.brandingKey] ?? ""}
              placeholder={m.placeholder}
              onChange={(v) => onChange({ ...branding, [m.brandingKey]: v })}
              onClear={() => onChange({ ...branding, [m.brandingKey]: "" })}
            />
          ))}
          <div className="col-span-2">
            <SocialField
              label="Unsubscribe URL"
              value={branding.unsubscribe_url ?? ""}
              placeholder="https://…/unsubscribe"
              onChange={(v) => onChange({ ...branding, unsubscribe_url: v })}
              onClear={() => onChange({ ...branding, unsubscribe_url: "" })}
            />
          </div>
        </div>
      </div>

      {/* Brand colors — type a hex or pick from the chart, then save to a slot. */}
      <div className="mt-4 border-t border-white/10 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-white">Brand colors</span>
          <span className="text-[10px] text-gray-500">Type a hex or pick from the chart.</span>
        </div>

        <div className="flex items-center gap-2">
          <span
            aria-label="Selected color"
            className="h-8 w-8 shrink-0 rounded-lg border border-white/15"
            style={{ backgroundColor: draft }}
          />
          <input
            value={hexText}
            onChange={(e) => setColor(e.target.value)}
            onBlur={() => setHexText(draft)}
            placeholder="#3DC9C0"
            aria-label="Hex color"
            spellCheck={false}
            className="w-28 rounded-lg border border-white/10 bg-[#04121b] px-2 py-1.5 font-mono text-sm text-white outline-none focus:border-gulf-teal/40"
          />
          <input
            type="color"
            value={draft}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Color picker"
            className="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent"
          />
        </div>

        {/* The color chart */}
        <div className="mt-2 grid grid-cols-10 gap-1">
          {COLOR_CHART.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Pick ${c}`}
              title={c}
              className={`h-5 w-full rounded border ${
                draft.toLowerCase() === c.toLowerCase()
                  ? "border-white ring-1 ring-white"
                  : "border-white/15 hover:border-white/50"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        {/* Three save slots */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {COLOR_SLOTS.map((slot) => {
            const saved = branding[slot.key] ?? "";
            return (
              <div key={slot.key} className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-400">{slot.label}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => saved && setColor(saved)}
                    aria-label={saved ? `Load ${slot.label} (${saved})` : `${slot.label} empty`}
                    title={saved || "empty"}
                    className="h-7 w-7 shrink-0 rounded-md border border-white/15"
                    style={
                      saved
                        ? { backgroundColor: saved }
                        : {
                            backgroundImage:
                              "repeating-linear-gradient(45deg,#0c2330 0 4px,#04121b 4px 8px)",
                          }
                    }
                  />
                  <button
                    type="button"
                    onClick={() => saveToSlot(slot.key)}
                    className="flex-1 rounded-md border border-white/15 px-1 py-1 text-[10px] text-gray-300 hover:border-gulf-teal/50 hover:text-white"
                  >
                    Save
                  </button>
                  {saved && (
                    <button
                      type="button"
                      onClick={() => onChange({ ...branding, [slot.key]: "" })}
                      aria-label={`Clear ${slot.label}`}
                      className="rounded px-1 text-sm leading-none text-gray-500 hover:text-gray-300"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Saved palettes — account-level library. Pick a chip to apply to this
            project; "Save as new palette" snapshots the current colors. */}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Saved palettes
          </span>
          <button
            type="button"
            onClick={saveAsPalette}
            disabled={!canSavePalette}
            className="rounded-full border border-gulf-teal/40 px-2 py-0.5 text-[10px] text-gulf-teal hover:bg-gulf-teal/10 disabled:opacity-40"
          >
            + Save as new palette
          </button>
        </div>
        {palettes.length === 0 ? (
          <p className="mt-1 text-[10px] text-gray-600">
            No saved palettes yet — build one above, then &quot;Save as new palette&quot; to reuse
            it on future projects.
          </p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {palettes.map((p) => {
              const active = schemesEqual(p.colors, currentScheme);
              return (
                <div
                  key={p.id}
                  className={`group flex items-center gap-1 rounded-full border py-0.5 pl-1 pr-1.5 ${
                    active ? "border-gulf-teal" : "border-white/15 hover:border-white/40"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => applyPalette(p)}
                    title={`Apply ${p.name} (${p.colors.filter(Boolean).join(", ")})`}
                    aria-label={`Apply palette ${p.name}`}
                    className="flex items-center gap-1"
                  >
                    <span className="flex">
                      {p.colors.map((c, i) => (
                        <span
                          key={i}
                          className="h-4 w-3 border border-black/20 first:rounded-l-sm last:rounded-r-sm"
                          style={{ backgroundColor: c || "transparent" }}
                        />
                      ))}
                    </span>
                    <span className="text-[10px] text-gray-300">{p.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onPalettesChange(palettes.filter((x) => x.id !== p.id))}
                    aria-label={`Delete palette ${p.name}`}
                    className="text-xs leading-none text-gray-600 hover:text-gray-300"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              const ok = await onSaveGlobal();
              if (ok) onClose();
            }}
            className="rounded-full bg-gulf-teal px-4 py-1.5 text-xs font-medium text-[#04121b] disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              const ok = await onSaveProjectOnly();
              if (ok) onClose();
            }}
            className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-medium text-gray-300 hover:border-white/40 disabled:opacity-40"
          >
            Save To This Project
          </button>
          {savedMsg && <span className="text-xs text-gray-500">{savedMsg}</span>}
        </div>
        <p className="text-[10px] text-gray-600">
          &quot;Save&quot; also sets your default for new projects.
        </p>
      </div>
    </div>
  );
}

/** A social-URL input with an inline × clear button (clears to "" → saved as null). */
function SocialField({
  label,
  value,
  placeholder,
  onChange,
  onClear,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-400">
      {label}
      <div className="relative">
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLS} w-full pr-7`}
        />
        {value ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${label}`}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-sm leading-none text-gray-500 hover:text-gray-300"
          >
            ×
          </button>
        ) : null}
      </div>
    </label>
  );
}
