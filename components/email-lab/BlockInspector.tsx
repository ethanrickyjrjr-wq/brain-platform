"use client";
// components/email-lab/BlockInspector.tsx (Card 31)
// The left-panel form for the selected block. Controlled: every field change
// calls onChange with the updated block; the client owns doc state + history
// (it coalesces keystroke edits into meaningful undo frames). Colors/links are
// USER-OWNED here — this is the one surface that edits them (the AI never does).
import type { ReactNode } from "react";
import type { EmailBlock, StatItem, TextAlign } from "@/lib/email/doc/types";

const LABELS: Record<EmailBlock["type"], string> = {
  header: "Header",
  hero: "Big Number",
  stats: "Stats",
  signal: "Callout",
  text: "Text",
  image: "Image",
  "agent-card": "Agent Card",
  "agent-hero": "Agent Feature",
  button: "Button",
  divider: "Divider",
  footer: "Footer",
};

export function BlockInspector({
  block,
  onChange,
  onDelete,
  onClose,
}: {
  block: EmailBlock;
  onChange: (next: EmailBlock) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const props = block.props as Record<string, unknown>;
  const set = (key: string, value: unknown) =>
    onChange({ ...block, props: { ...props, [key]: value } } as EmailBlock);
  const str = (key: string) => (typeof props[key] === "string" ? (props[key] as string) : "");

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{LABELS[block.type]}</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Done
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {block.type === "header" && (
          <>
            <TextField
              label="Company name"
              value={str("companyName")}
              onChange={(v) => set("companyName", v)}
            />
            <TextField label="Tagline" value={str("tagline")} onChange={(v) => set("tagline", v)} />
            <TextField
              label="Logo URL"
              value={str("logoUrl")}
              onChange={(v) => set("logoUrl", v)}
              placeholder="https://…"
            />
            <ColorField
              label="Background"
              value={str("bgColor")}
              onChange={(v) => set("bgColor", v)}
            />
          </>
        )}

        {block.type === "hero" && (
          <>
            <TextField
              label="Kicker"
              value={str("kicker")}
              onChange={(v) => set("kicker", v)}
              placeholder="Market Spotlight"
            />
            <TextField
              label="Big value"
              value={str("value")}
              onChange={(v) => set("value", v)}
              placeholder="$485K"
            />
            <TextField
              label="Label"
              value={str("label")}
              onChange={(v) => set("label", v)}
              placeholder="Median Sale Price"
            />
            <TextAreaField label="Prose" value={str("prose")} onChange={(v) => set("prose", v)} />
          </>
        )}

        {block.type === "stats" && (
          <StatsEditor
            stats={(props.stats as StatItem[]) ?? []}
            onChange={(s) => set("stats", s)}
          />
        )}

        {block.type === "signal" && (
          <>
            <TextField
              label="Kicker"
              value={str("kicker")}
              onChange={(v) => set("kicker", v)}
              placeholder="Signal to Watch"
            />
            <TextField label="Title" value={str("title")} onChange={(v) => set("title", v)} />
            <TextAreaField label="Body" value={str("body")} onChange={(v) => set("body", v)} />
            <ColorField
              label="Box color"
              value={str("bgColor")}
              onChange={(v) => set("bgColor", v)}
            />
          </>
        )}

        {block.type === "text" && (
          <>
            <TextAreaField
              label="Body"
              value={str("body")}
              onChange={(v) => set("body", v)}
              rows={6}
            />
            <SelectField
              label="Align"
              value={(props.align as TextAlign) ?? "left"}
              options={["left", "center", "right"]}
              onChange={(v) => set("align", v)}
            />
          </>
        )}

        {block.type === "image" && (
          <>
            <TextField
              label="Image URL"
              value={str("url")}
              onChange={(v) => set("url", v)}
              placeholder="https://…"
            />
            <TextField label="Alt text" value={str("alt")} onChange={(v) => set("alt", v)} />
            <TextField label="Caption" value={str("caption")} onChange={(v) => set("caption", v)} />
          </>
        )}

        {block.type === "agent-card" && (
          <>
            <TextField
              label="Photo URL"
              value={str("photoUrl")}
              onChange={(v) => set("photoUrl", v)}
              placeholder="https://…"
            />
            <TextField label="Name" value={str("name")} onChange={(v) => set("name", v)} />
            <TextField
              label="Title"
              value={str("title")}
              onChange={(v) => set("title", v)}
              placeholder="Realtor®"
            />
            <TextAreaField label="Bio" value={str("bio")} onChange={(v) => set("bio", v)} />
            <TextField label="Phone" value={str("phone")} onChange={(v) => set("phone", v)} />
            <TextField
              label="CTA label"
              value={str("ctaLabel")}
              onChange={(v) => set("ctaLabel", v)}
            />
            <TextField
              label="CTA URL"
              value={str("ctaUrl")}
              onChange={(v) => set("ctaUrl", v)}
              placeholder="https://…"
            />
          </>
        )}

        {block.type === "button" && (
          <>
            <TextField label="Label" value={str("label")} onChange={(v) => set("label", v)} />
            <TextField
              label="URL"
              value={str("url")}
              onChange={(v) => set("url", v)}
              placeholder="https://…"
            />
            <ColorField
              label="Button color"
              value={str("bgColor")}
              onChange={(v) => set("bgColor", v)}
            />
          </>
        )}

        {block.type === "divider" && (
          <ColorField label="Line color" value={str("color")} onChange={(v) => set("color", v)} />
        )}

        {block.type === "agent-hero" && (
          <>
            <TextField
              label="Photo URL"
              value={str("photoUrl")}
              onChange={(v) => set("photoUrl", v)}
              placeholder="https://…"
            />
            <TextField label="Name" value={str("name")} onChange={(v) => set("name", v)} />
            <TextField
              label="Designation"
              value={str("designation")}
              onChange={(v) => set("designation", v)}
              placeholder="Realtor® · Your Market"
            />
            <TextAreaField
              label="Tagline"
              value={str("tagline")}
              onChange={(v) => set("tagline", v)}
              rows={2}
            />
            <TextField
              label="CTA label"
              value={str("ctaLabel")}
              onChange={(v) => set("ctaLabel", v)}
            />
            <TextField
              label="CTA URL"
              value={str("ctaUrl")}
              onChange={(v) => set("ctaUrl", v)}
              placeholder="https://…"
            />
          </>
        )}

        {block.type === "footer" && (
          <>
            <TextField
              label="Company name"
              value={str("companyName")}
              onChange={(v) => set("companyName", v)}
            />
            <TextAreaField
              label="Address"
              value={str("address")}
              onChange={(v) => set("address", v)}
              rows={2}
            />
            <TextField
              label="Phone"
              value={str("phone")}
              onChange={(v) => set("phone", v)}
              placeholder="(239) 555-0100"
            />
            <TextField
              label="Email"
              value={str("email")}
              onChange={(v) => set("email", v)}
              placeholder="hello@yourcompany.com"
            />
            <TextField
              label="Website URL"
              value={str("websiteUrl")}
              onChange={(v) => set("websiteUrl", v)}
              placeholder="https://…"
            />
            <TextField
              label="Instagram URL"
              value={str("instagramUrl")}
              onChange={(v) => set("instagramUrl", v)}
              placeholder="https://instagram.com/…"
            />
            <TextField
              label="Facebook URL"
              value={str("facebookUrl")}
              onChange={(v) => set("facebookUrl", v)}
              placeholder="https://facebook.com/…"
            />
            <TextField
              label="LinkedIn URL"
              value={str("linkedinUrl")}
              onChange={(v) => set("linkedinUrl", v)}
              placeholder="https://linkedin.com/…"
            />
            <TextField
              label="Unsubscribe URL"
              value={str("unsubscribeUrl")}
              onChange={(v) => set("unsubscribeUrl", v)}
              placeholder="https://…/unsubscribe"
            />
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="mt-3 w-full rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50"
      >
        Delete block
      </button>
    </div>
  );
}

// ── Field controls ──────────────────────────────────────────────────────────

function FieldShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900 focus:border-gulf-teal focus:outline-none focus:ring-1 focus:ring-gulf-teal";

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <FieldShell label={label}>
      <input
        type="text"
        className={inputCls}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <FieldShell label={label}>
      <textarea
        className={`${inputCls} resize-y`}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <FieldShell label={label}>
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const picker = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <FieldShell label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          className="h-8 w-10 cursor-pointer rounded border border-gray-200"
          value={picker}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          className={inputCls}
          value={value}
          placeholder="#3DC9C0"
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </FieldShell>
  );
}

function StatsEditor({
  stats,
  onChange,
}: {
  stats: StatItem[];
  onChange: (s: StatItem[]) => void;
}) {
  const update = (i: number, key: keyof StatItem, v: string) => {
    const next = stats.map((s, j) => (j === i ? { ...s, [key]: v } : s));
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {stats.map((s, i) => (
        <div key={i} className="rounded-md border border-gray-200 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Stat {i + 1}</span>
            {stats.length > 1 ? (
              <button
                type="button"
                onClick={() => onChange(stats.filter((_, j) => j !== i))}
                className="text-xs text-red-400 hover:text-red-600"
              >
                Remove
              </button>
            ) : null}
          </div>
          <input
            type="text"
            className={`${inputCls} mb-1.5`}
            value={s.value}
            placeholder="Value (e.g. $485K)"
            onChange={(e) => update(i, "value", e.target.value)}
          />
          <input
            type="text"
            className={inputCls}
            value={s.label}
            placeholder="Label (e.g. Median Price)"
            onChange={(e) => update(i, "label", e.target.value)}
          />
        </div>
      ))}
      {stats.length < 3 ? (
        <button
          type="button"
          onClick={() => onChange([...stats, { value: "", label: "" }])}
          className="w-full rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
        >
          + Add stat
        </button>
      ) : null}
    </div>
  );
}
