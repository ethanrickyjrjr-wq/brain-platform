"use client";
// components/email-lab/BlockInspector.tsx (Card 31)
// The left-panel form for the selected block. Controlled: every field change
// calls onChange with the updated block; the client owns doc state + history
// (it coalesces keystroke edits into meaningful undo frames). Colors/links are
// USER-OWNED here — this is the one surface that edits them (the AI never does).
import type { ReactNode } from "react";
import type {
  EmailBlock,
  FooterProps,
  KnownPlatform,
  SocialIconsProps,
  SocialPlatformEntry,
  StatItem,
  TextAlign,
} from "@/lib/email/doc/types";
import { KNOWN_PLATFORMS, PLATFORMS, platformMeta } from "@/lib/email/social/platforms";

const LABELS: Record<EmailBlock["type"], string> = {
  header: "Header",
  hero: "Big Number",
  stats: "Stats",
  signal: "Callout",
  text: "Text",
  image: "Image",
  "agent-card": "Agent Card",
  "agent-hero": "Agent Feature",
  "social-icons": "Social Icons",
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

        {block.type === "social-icons" && (
          <SocialIconsEditor
            props={block.props as SocialIconsProps}
            onChange={(next) => onChange({ ...block, props: next } as EmailBlock)}
          />
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
            <FooterSocialOrder
              props={block.props as FooterProps}
              onChange={(order) => set("socialOrder", order)}
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

// ── Social blocks ────────────────────────────────────────────────────────────

/** Small segmented toggle (Display / Layout / Size / Color). */
function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <FieldShell label={label}>
      <div className="flex gap-1">
        {options.map(([val, lab]) => (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            className={`flex-1 rounded-md border px-2 py-1 text-xs ${
              value === val
                ? "border-gulf-teal bg-gulf-teal/10 text-gray-900"
                : "border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}
          >
            {lab}
          </button>
        ))}
      </div>
    </FieldShell>
  );
}

/** Full editor for the standalone social-icons block (4 sections). */
function SocialIconsEditor({
  props,
  onChange,
}: {
  props: SocialIconsProps;
  onChange: (next: SocialIconsProps) => void;
}) {
  const platforms = props.platforms ?? [];
  const usedKnown = new Set(platforms.filter((p) => p.type !== "custom").map((p) => p.type));
  const available = KNOWN_PLATFORMS.filter((t) => !usedKnown.has(t));

  const setPlatforms = (next: SocialPlatformEntry[]) => onChange({ ...props, platforms: next });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= platforms.length) return;
    const next = platforms.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setPlatforms(next);
  };
  const update = (i: number, patch: Partial<SocialPlatformEntry>) =>
    setPlatforms(platforms.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => setPlatforms(platforms.filter((_, k) => k !== i));

  // Custom platforms: resolve a brand logo (Logo.dev / favicon) from the pasted
  // URL on blur. Best-effort — the render falls back to a globe glyph if unset.
  const resolveCustomLogo = async (i: number, url: string) => {
    if (!url.trim()) return;
    try {
      const res = await fetch("/api/email-lab/resolve-social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { logoUrl?: string };
      if (data.logoUrl) update(i, { logoUrl: data.logoUrl });
    } catch {
      /* best-effort */
    }
  };

  const labelOf = (p: SocialPlatformEntry) =>
    p.type === "custom" ? p.label || "Custom" : platformMeta(p.type).label;

  return (
    <div className="space-y-4">
      {/* 1 — Platforms */}
      <div className="space-y-2">
        <span className="text-xs font-semibold text-gray-700">Platforms</span>
        {platforms.length === 0 ? (
          <p className="text-xs text-gray-400">No platforms yet — add one below.</p>
        ) : (
          platforms.map((p, i) => (
            <div key={i} className="rounded-md border border-gray-200 p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600">{labelOf(p)}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                    className="px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === platforms.length - 1}
                    aria-label="Move down"
                    className="px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label="Remove platform"
                    className="px-1 text-red-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </div>
              </div>
              {p.type === "custom" ? (
                <input
                  className={`${inputCls} mb-1.5`}
                  value={p.label ?? ""}
                  placeholder="Label (e.g. Substack)"
                  onChange={(e) => update(i, { label: e.target.value })}
                />
              ) : null}
              <input
                className={inputCls}
                value={p.url}
                placeholder={p.type === "custom" ? "https://…" : platformMeta(p.type).placeholder}
                onChange={(e) => update(i, { url: e.target.value })}
                onBlur={
                  p.type === "custom" ? (e) => resolveCustomLogo(i, e.target.value) : undefined
                }
              />
            </div>
          ))
        )}
        <select
          className={inputCls}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            if (v === "custom")
              setPlatforms([...platforms, { type: "custom", url: "", label: "" }]);
            else setPlatforms([...platforms, { type: v as KnownPlatform, url: "" }]);
          }}
        >
          <option value="">+ Add platform…</option>
          {available.map((t) => (
            <option key={t} value={t}>
              {platformMeta(t).label}
            </option>
          ))}
          <option value="custom">Custom / other…</option>
        </select>
      </div>

      {/* 2 — Display mode */}
      <Segmented
        label="Display"
        value={props.displayMode ?? "icon+text"}
        options={[
          ["icon", "Icon"],
          ["text", "Text"],
          ["icon+text", "Icon + Text"],
        ]}
        onChange={(v) => onChange({ ...props, displayMode: v as SocialIconsProps["displayMode"] })}
      />

      {/* 3 — Layout */}
      <Segmented
        label="Layout"
        value={props.layout ?? "row"}
        options={[
          ["row", "Row"],
          ["column", "Column"],
        ]}
        onChange={(v) => onChange({ ...props, layout: v as SocialIconsProps["layout"] })}
      />

      {/* 4 — Style */}
      <Segmented
        label="Icon size"
        value={props.iconSize ?? "md"}
        options={[
          ["sm", "S"],
          ["md", "M"],
          ["lg", "L"],
        ]}
        onChange={(v) => onChange({ ...props, iconSize: v as SocialIconsProps["iconSize"] })}
      />
      <Segmented
        label="Icon color"
        value={props.iconColor ?? "original"}
        options={[
          ["original", "Original"],
          ["brand", "Brand"],
          ["custom", "Custom"],
        ]}
        onChange={(v) => onChange({ ...props, iconColor: v as SocialIconsProps["iconColor"] })}
      />
      {props.iconColor === "custom" ? (
        <ColorField
          label="Custom icon color"
          value={props.customIconColor ?? ""}
          onChange={(v) => onChange({ ...props, customIconColor: v })}
        />
      ) : null}
    </div>
  );
}

/** Footer mini reorder list for the 3 footer-capable socials (IG/FB/LI). */
function FooterSocialOrder({
  props,
  onChange,
}: {
  props: FooterProps;
  onChange: (order: KnownPlatform[]) => void;
}) {
  const footerPlatforms = PLATFORMS.filter((m) => m.footerPropKey).map((m) => m.type);
  const saved = (props.socialOrder ?? footerPlatforms).filter((t) => footerPlatforms.includes(t));
  // Always show all footer-capable platforms; append any missing in registry order.
  const full = [...saved, ...footerPlatforms.filter((t) => !saved.includes(t))];
  const urlOf = (t: KnownPlatform): string => {
    const key = platformMeta(t).footerPropKey;
    return key ? (props[key] ?? "") : "";
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= full.length) return;
    const next = full.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-1.5 border-t border-gray-100 pt-3">
      <span className="text-xs font-semibold text-gray-700">Social order</span>
      {full.map((t, i) => {
        const connected = urlOf(t).trim().length > 0;
        return (
          <div
            key={t}
            className={`flex items-center justify-between rounded-md border border-gray-200 px-2 py-1.5 ${
              connected ? "" : "opacity-40"
            }`}
          >
            <span className="text-xs text-gray-700">
              {platformMeta(t).label}
              {connected ? "" : " · not connected"}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                className="px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === full.length - 1}
                aria-label="Move down"
                className="px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
              >
                ↓
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
