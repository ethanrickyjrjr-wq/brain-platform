"use client";
// components/email-lab/EmailLabShell.tsx
// Shared block-canvas surface for BOTH Email Lab routes (Card 40). Holds all the
// state: EmailDoc + undo/redo history, selection, AI content-fill, brand colors
// (→ globalStyle), export, and the "Start from" seed picker. The two route
// clients are thin wrappers that pass brand/scope/header config.
//
// • Click a block → left panel switches to the Block Inspector.
// • "Fill with AI" → content-patch (words/numbers only; never restyles).
// • Brand colors here own globalStyle (sticky; the AI can't touch them).
// • Classic templates stay reachable as a preview-only legacy rail (no silent
//   capability loss — spec → Template regression).
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import type { EmailBlock, EmailDoc, FontFamily } from "@/lib/email/doc/types";
import { EmailDocSchema } from "@/lib/email/doc/schema";
import { SEED_DOCS } from "@/lib/email/doc/default-docs";
import {
  initHistory,
  pushDoc,
  undo as undoHistory,
  redo as redoHistory,
  canUndo,
  canRedo,
  HISTORY_LIMIT,
  type DocHistory,
} from "@/lib/email/doc/history";
import { BlockCanvas } from "./BlockCanvas";
import { BlockInspector } from "./BlockInspector";
import { EmailPreviewFrame } from "@/app/p/[id]/EmailPreviewFrame";

// Legacy templates kept on the preview-only "classic" rail.
const CLASSIC_TEMPLATES = [
  { id: "email/shell-two-col", label: "Two Column", icon: "⊞" },
  { id: "email/email-compare", label: "Compare", icon: "↔" },
  { id: "email/email-hbar", label: "Bar Chart", icon: "📊" },
  { id: "email/email-table", label: "Data Table", icon: "📈" },
  { id: "email/email-ranked", label: "Ranked List", icon: "🏆" },
  { id: "email/email-report", label: "Full Report", icon: "📋" },
  { id: "email/email-listing", label: "New Listing", icon: "🏠" },
  { id: "email/email-just-sold", label: "Just Sold", icon: "✅" },
  { id: "email/email-open-house", label: "Open House", icon: "🔑" },
  { id: "email/email-price-drop", label: "Price Drop", icon: "📉" },
  { id: "email/email-listing-digest", label: "Listing Digest", icon: "🏘" },
  { id: "email/email-investment-spotlight", label: "Investment", icon: "💼" },
  { id: "email/email-welcome-onboard", label: "Welcome", icon: "👋" },
  { id: "email/email-neighborhood", label: "Neighborhood", icon: "📍" },
  { id: "email/email-outreach", label: "Outreach", icon: "✉" },
];

const FONT_OPTIONS: { value: FontFamily; label: string }[] = [
  { value: "MODERN_SANS", label: "Modern Sans" },
  { value: "BOOK_SERIF", label: "Book Serif" },
  { value: "GEOMETRIC_SANS", label: "Geometric Sans" },
];

/** Map project brand tokens onto a doc's globalStyle + brand-bearing blocks.
 *  Preserves the existing branding→email bridge under the block model. */
export function applyBrand(doc: EmailDoc, t?: Record<string, string>): EmailDoc {
  if (!t) return doc;
  const globalStyle = {
    ...doc.globalStyle,
    primaryColor: t.PRIMARY || doc.globalStyle.primaryColor,
    accentColor: t.ACCENT || doc.globalStyle.accentColor,
  };
  const cta = t.CTA_URL || t.WEBSITE_URL;
  const blocks = doc.blocks.map((b) => {
    const props = { ...(b.props as Record<string, unknown>) };
    if (b.type === "header") {
      if (t.COMPANY_NAME) props.companyName = t.COMPANY_NAME;
      if (t.TAGLINE) props.tagline = t.TAGLINE;
      if (t.LOGO_URL) props.logoUrl = t.LOGO_URL;
    } else if (b.type === "footer") {
      if (t.COMPANY_NAME) props.companyName = t.COMPANY_NAME;
      if (t.WEBSITE_URL) props.websiteUrl = t.WEBSITE_URL;
    } else if (b.type === "agent-card") {
      if (t.AGENT_NAME) props.name = t.AGENT_NAME;
      if (t.AGENT_TITLE) props.title = t.AGENT_TITLE;
      if (t.AGENT_BIO) props.bio = t.AGENT_BIO;
      if (t.AGENT_PHOTO_URL) props.photoUrl = t.AGENT_PHOTO_URL;
      if (t.CONTACT_PHONE) props.phone = t.CONTACT_PHONE;
      if (cta) props.ctaUrl = cta;
    } else if (b.type === "button") {
      if (cta) props.url = cta;
    } else if (b.type === "hero") {
      if (t.HERO_LABEL) props.label = t.HERO_LABEL;
    }
    return { ...b, props } as EmailBlock;
  });
  return { globalStyle, blocks };
}

async function renderDocHtml(doc: EmailDoc): Promise<string> {
  const res = await fetch("/api/email-lab/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc }),
  });
  return (await res.json()).html ?? "";
}

async function renderLegacyHtml(template: string, tokens: Record<string, string>): Promise<string> {
  const res = await fetch("/api/email-lab/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template, tokens }),
  });
  return (await res.json()).html ?? "";
}

export interface EmailLabShellProps {
  initialDoc: EmailDoc;
  brandTokens?: Record<string, string>;
  scope?: { kind?: string; value?: string };
  initialAiPrompt?: string;
  autoGenerate?: boolean;
  headerSlot: ReactNode;
  aiPlaceholder?: string;
  /** When provided, renders a Save button that calls back with the current doc. */
  onSave?: (doc: EmailDoc) => Promise<void>;
  saving?: boolean;
  /** Project id — required when projectPhotos is provided; used to call /api/projects/[id]/email-media. */
  projectId?: string;
  /** Filed image items from the project. When provided, a Photos panel is shown. */
  projectPhotos?: { storage_path: string; signedUrl: string; caption?: string }[];
}

export function EmailLabShell({
  initialDoc,
  brandTokens,
  scope,
  initialAiPrompt = "",
  autoGenerate = false,
  headerSlot,
  aiPlaceholder = "Describe the email — the AI fills real SWFL numbers into the layout…",
  onSave,
  saving,
  projectId,
  projectPhotos,
}: EmailLabShellProps) {
  const [history, setHistory] = useState<DocHistory>(() =>
    initHistory(applyBrand(initialDoc, brandTokens)),
  );
  const doc = history.present;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState(initialAiPrompt);
  const [aiLoading, setAiLoading] = useState<boolean>(autoGenerate);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [mode, setMode] = useState<"canvas" | "classic">("canvas");
  const [classicHtml, setClassicHtml] = useState("");
  const [classicId, setClassicId] = useState<string | null>(null);
  const [showClassic, setShowClassic] = useState(false);
  const [promotingPath, setPromotingPath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── history helpers (coalesced field edits → meaningful undo frames) ────────
  const editingRef = useRef(false);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commit(next: EmailDoc) {
    editingRef.current = false;
    if (idleRef.current) clearTimeout(idleRef.current);
    setHistory((h) => pushDoc(h, next));
  }

  function liveEdit(next: EmailDoc) {
    const wasEditing = editingRef.current;
    setHistory((h) =>
      wasEditing
        ? { ...h, present: next }
        : { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] },
    );
    editingRef.current = true;
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => {
      editingRef.current = false;
    }, 500);
  }

  // ── AI content-fill ─────────────────────────────────────────────────────────
  async function runAi(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setAiLoading(true);
    setAiMessage(null);
    try {
      const res = await fetch("/api/email-lab/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed, doc, scope }),
      });
      const data = (await res.json()) as { doc?: unknown; applied?: boolean; message?: string };
      if (data.doc) {
        const parsed = EmailDocSchema.safeParse(data.doc);
        if (parsed.success) commit(parsed.data);
      }
      if (data.applied === false && data.message) setAiMessage(data.message);
    } catch {
      setAiMessage("Something went wrong — try again.");
    } finally {
      setAiLoading(false);
    }
  }

  // Auto-fill on mount (project route lands on a real, brand-applied email).
  // Promise-chain form so no setState runs synchronously in the effect body
  // (keeps clear of react-hooks/set-state-in-effect) — aiLoading already inits
  // true when autoGenerate, mirroring the prior project client's mount pattern.
  useEffect(() => {
    if (!autoGenerate) return;
    fetch("/api/email-lab/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: initialAiPrompt.trim(), doc, scope }),
    })
      .then((r) => r.json())
      .then((data: { doc?: unknown; applied?: boolean; message?: string }) => {
        if (data.doc) {
          const parsed = EmailDocSchema.safeParse(data.doc);
          if (parsed.success) commit(parsed.data);
        }
        if (data.applied === false && data.message) setAiMessage(data.message);
      })
      .catch(() => setAiMessage("Something went wrong — try again."))
      .finally(() => setAiLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard: ⌘Z / ⌘⇧Z undo-redo, Escape deselects.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        editingRef.current = false;
        if (e.shiftKey) {
          setHistory((h) => redoHistory(h));
        } else {
          setHistory((h) => undoHistory(h));
          setSelectedId(null);
        }
      } else if (e.key === "Escape") {
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── block ops ───────────────────────────────────────────────────────────────
  const selectedBlock = selectedId ? (doc.blocks.find((b) => b.id === selectedId) ?? null) : null;

  function updateBlock(next: EmailBlock) {
    liveEdit({ ...doc, blocks: doc.blocks.map((b) => (b.id === next.id ? next : b)) });
  }

  function deleteSelected() {
    if (!selectedId || doc.blocks.length <= 1) return;
    commit({ ...doc, blocks: doc.blocks.filter((b) => b.id !== selectedId) });
    setSelectedId(null);
  }

  function setGlobalStyle(patch: Partial<EmailDoc["globalStyle"]>) {
    liveEdit({ ...doc, globalStyle: { ...doc.globalStyle, ...patch } });
  }

  function pickSeed(seedId: string) {
    const seed = SEED_DOCS.find((s) => s.id === seedId);
    if (!seed) return;
    setMode("canvas");
    setSelectedId(null);
    commit(applyBrand(seed.build(), brandTokens));
  }

  async function pickClassic(templateId: string) {
    setMode("classic");
    setClassicId(templateId);
    setSelectedId(null);
    setClassicHtml(await renderLegacyHtml(templateId, brandTokens ?? {}));
  }

  // ── Photos bridge ─────────────────────────────────────────────────────────
  function applyPhotoUrl(url: string) {
    const sel = selectedId ? doc.blocks.find((b) => b.id === selectedId) : null;
    if (sel?.type === "image") {
      commit({
        ...doc,
        blocks: doc.blocks.map((b) =>
          b.id === sel.id ? { ...sel, props: { ...sel.props, url } } : b,
        ),
      });
    } else {
      const newBlock: EmailBlock = { id: crypto.randomUUID(), type: "image", props: { url } };
      commit({ ...doc, blocks: [...doc.blocks, newBlock] });
      setSelectedId(newBlock.id);
    }
  }

  async function pickFiledPhoto(storagePath: string) {
    if (!projectId) return;
    setPromotingPath(storagePath);
    try {
      const res = await fetch(`/api/projects/${projectId}/email-media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_path: storagePath }),
      });
      if (!res.ok) return;
      const { url } = (await res.json()) as { url: string };
      applyPhotoUrl(url);
    } finally {
      setPromotingPath(null);
    }
  }

  async function uploadNewPhoto(file: File) {
    if (!projectId) return;
    setPromotingPath("__upload__");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/email-media`, {
        method: "PUT",
        body: fd,
      });
      if (!res.ok) return;
      const { url } = (await res.json()) as { url: string };
      applyPhotoUrl(url);
    } finally {
      setPromotingPath(null);
    }
  }

  // ── export ────────────────────────────────────────────────────────────────
  async function copyHtml() {
    setExporting(true);
    try {
      const html = mode === "classic" ? classicHtml : await renderDocHtml(doc);
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } finally {
      setExporting(false);
    }
  }

  async function exportPdf() {
    setExporting(true);
    try {
      const html = mode === "classic" ? classicHtml : await renderDocHtml(doc);
      const win = window.open("", "_blank");
      if (!win) return;
      // onload must be set BEFORE write()/close() so it fires when the document
      // and its resources finish loading — not after, when the event is already gone.
      win.onload = () => win.print();
      win.document.write(html);
      win.document.close();
    } finally {
      setExporting(false);
    }
  }

  const busy = aiLoading || exporting;

  return (
    <div className="grid h-dvh grid-cols-[340px_1fr] overflow-hidden bg-[#070f14] text-white">
      {/* ══════════ LEFT PANEL ══════════ */}
      <aside className="flex flex-col overflow-hidden border-r border-white/8">
        <div className="shrink-0 border-b border-white/8 px-4 pb-3 pt-4">{headerSlot}</div>

        <div className="flex-1 overflow-y-auto">
          {selectedBlock ? (
            <div className="px-4 py-4 text-gray-900">
              <div className="rounded-lg bg-white p-3">
                <BlockInspector
                  block={selectedBlock}
                  onChange={updateBlock}
                  onDelete={deleteSelected}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            </div>
          ) : (
            <>
              {/* ── AI Generate ── */}
              <div className="border-b border-white/8 px-4 pb-4 pt-4">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.15em] text-[#1BB8C9]">
                  Fill with AI
                </p>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runAi(aiPrompt);
                  }}
                  placeholder={aiPlaceholder}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white/80 placeholder:text-white/25 focus:border-[#1BB8C9]/50 focus:outline-none focus:ring-1 focus:ring-[#1BB8C9]"
                />
                <button
                  onClick={() => runAi(aiPrompt)}
                  disabled={aiLoading || !aiPrompt.trim()}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#1BB8C9] py-2 text-sm font-semibold text-[#070f14] transition-colors hover:bg-[#17a3b3] disabled:opacity-40"
                >
                  {aiLoading ? (
                    <>
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#070f14]/30 border-t-[#070f14]" />
                      Filling…
                    </>
                  ) : (
                    "Fill with AI"
                  )}
                </button>
                {aiMessage ? (
                  <p className="mt-2 text-[11px] text-amber-300/80">{aiMessage}</p>
                ) : (
                  <p className="mt-1.5 text-center text-[10px] text-white/20">
                    ⌘↵ · fills words & numbers, keeps your colors
                  </p>
                )}
              </div>

              {/* ── Brand ── */}
              <div className="border-b border-white/8 px-4 pb-4 pt-4">
                <p className="mb-2 text-[10px] uppercase tracking-[0.15em] text-white/35">Brand</p>
                <div className="grid grid-cols-2 gap-2">
                  <ColorControl
                    label="Primary"
                    value={doc.globalStyle.primaryColor}
                    onChange={(v) => setGlobalStyle({ primaryColor: v })}
                  />
                  <ColorControl
                    label="Accent"
                    value={doc.globalStyle.accentColor}
                    onChange={(v) => setGlobalStyle({ accentColor: v })}
                  />
                </div>
                <label className="mt-2 block">
                  <span className="mb-1 block text-[10px] text-white/40">Font</span>
                  <select
                    value={doc.globalStyle.fontFamily}
                    onChange={(e) => setGlobalStyle({ fontFamily: e.target.value as FontFamily })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/75 focus:outline-none focus:ring-1 focus:ring-[#1BB8C9]"
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value} className="text-black">
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* ── Start from (block-canvas seeds) ── */}
              <div className="border-b border-white/8 px-4 pb-4 pt-4">
                <p className="mb-2 text-[10px] uppercase tracking-[0.15em] text-white/35">
                  Start from
                </p>
                <div className="space-y-1.5">
                  {SEED_DOCS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => pickSeed(s.id)}
                      className="w-full rounded-md border border-white/8 bg-white/4 px-3 py-2 text-left transition-colors hover:bg-white/8"
                    >
                      <span className="block text-xs font-medium text-white/75">{s.name}</span>
                      <span className="block text-[10px] leading-tight text-white/35">
                        {s.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Photos (project context only) ── */}
              {projectPhotos !== undefined && (
                <div className="border-b border-white/8 px-4 pb-4 pt-4">
                  <p className="mb-2 text-[10px] uppercase tracking-[0.15em] text-white/35">
                    Photos
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {/* Upload tile — always first */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={promotingPath !== null}
                      className="flex aspect-square items-center justify-center rounded-md border border-dashed border-white/20 bg-white/3 text-white/30 transition-colors hover:border-[#1BB8C9]/50 hover:text-[#1BB8C9]/70 disabled:opacity-40"
                      title="Upload a new photo"
                    >
                      {promotingPath === "__upload__" ? (
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-[#1BB8C9]" />
                      ) : (
                        <span className="text-lg leading-none">＋</span>
                      )}
                    </button>

                    {/* Filed photo thumbnails */}
                    {projectPhotos.map((photo) => (
                      <button
                        key={photo.storage_path}
                        type="button"
                        onClick={() => pickFiledPhoto(photo.storage_path)}
                        disabled={promotingPath !== null}
                        title={photo.caption ?? photo.storage_path.split("/").pop()}
                        className={`relative aspect-square overflow-hidden rounded-md border-2 transition-all ${
                          promotingPath === photo.storage_path
                            ? "border-[#1BB8C9]"
                            : "border-transparent hover:border-[#1BB8C9] disabled:opacity-60"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.signedUrl}
                          alt={photo.caption ?? ""}
                          className="h-full w-full object-cover"
                        />
                        {promotingPath === photo.storage_path && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-[#1BB8C9]" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>

                  {projectPhotos.length === 0 && (
                    <p className="mt-3 text-center text-[10px] leading-relaxed text-white/20">
                      File an image in your project
                      <br />
                      to use it here
                    </p>
                  )}

                  {/* Hidden file input for new-upload flow */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadNewPhoto(f);
                      e.target.value = "";
                    }}
                  />
                </div>
              )}

              {/* ── Classic templates (preview only) ── */}
              <div className="px-4 pb-6 pt-3">
                <button
                  onClick={() => setShowClassic((v) => !v)}
                  className="flex w-full items-center justify-between py-1 text-[10px] uppercase tracking-[0.15em] text-white/35 hover:text-white/60"
                >
                  <span>Classic templates (preview)</span>
                  <span className={`transition-transform ${showClassic ? "rotate-180" : ""}`}>
                    ▾
                  </span>
                </button>
                {showClassic && (
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {CLASSIC_TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => pickClassic(t.id)}
                        className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
                          mode === "classic" && classicId === t.id
                            ? "border-[#1BB8C9]/40 bg-[#1BB8C9]/15 text-[#1BB8C9]"
                            : "border-white/8 bg-white/4 text-white/55 hover:bg-white/8"
                        }`}
                      >
                        <span className="text-sm leading-none">{t.icon}</span>
                        <span className="text-[11px] font-medium leading-tight">{t.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </aside>

      {/* ══════════ CANVAS ══════════ */}
      <main className="flex flex-col overflow-hidden bg-[#0d1920]">
        <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-6 py-3">
          <div className="flex items-center gap-3">
            <div
              className={`h-2 w-2 rounded-full ${busy ? "animate-pulse bg-[#1BB8C9]" : "bg-white/20"}`}
            />
            <span className="text-xs text-white/35">
              {aiLoading
                ? "AI filling…"
                : mode === "classic"
                  ? "Classic template · preview only"
                  : "600px email canvas"}
            </span>
            {mode === "canvas" && (
              <div className="ml-2 flex items-center gap-1">
                <button
                  onClick={() => {
                    editingRef.current = false;
                    setHistory((h) => undoHistory(h));
                    setSelectedId(null);
                  }}
                  disabled={!canUndo(history)}
                  className="rounded border border-white/10 px-2 py-0.5 text-xs text-white/40 hover:text-white/70 disabled:opacity-25"
                  title="Undo (⌘Z)"
                >
                  ↶
                </button>
                <button
                  onClick={() => {
                    editingRef.current = false;
                    setHistory((h) => redoHistory(h));
                  }}
                  disabled={!canRedo(history)}
                  className="rounded border border-white/10 px-2 py-0.5 text-xs text-white/40 hover:text-white/70 disabled:opacity-25"
                  title="Redo (⌘⇧Z)"
                >
                  ↷
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {mode === "classic" && (
              <button
                onClick={() => setMode("canvas")}
                className="rounded border border-white/10 px-2.5 py-1 text-xs text-white/40 hover:border-white/25 hover:text-white/70"
              >
                ← Back to editor
              </button>
            )}
            <button
              onClick={exportPdf}
              disabled={exporting}
              className="rounded border border-white/10 px-2.5 py-1 text-xs text-white/40 transition-colors hover:border-white/25 hover:text-white/70 disabled:opacity-30"
            >
              Export PDF
            </button>
            <button
              onClick={copyHtml}
              disabled={exporting}
              className="rounded border border-white/10 px-2.5 py-1 text-xs text-white/40 transition-colors hover:border-white/25 hover:text-white/70 disabled:opacity-30"
            >
              {copied ? "Copied ✓" : "Copy HTML"}
            </button>
            {onSave && (
              <button
                type="button"
                onClick={() => onSave(doc)}
                disabled={saving}
                className="px-3 py-1.5 text-sm rounded-lg bg-[#1BB8C9]/20 text-[#1BB8C9] border border-[#1BB8C9]/30 hover:bg-[#1BB8C9]/30 disabled:opacity-40 transition-colors focus-visible:ring-2 focus-visible:ring-[#1BB8C9]/40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {mode === "classic" ? (
            <div className="h-full overflow-y-auto px-8 py-8">
              <div className="mx-auto max-w-[660px]">
                {classicHtml ? (
                  <EmailPreviewFrame srcDoc={classicHtml} />
                ) : (
                  <div className="flex h-96 items-center justify-center text-sm text-white/25">
                    Loading…
                  </div>
                )}
              </div>
            </div>
          ) : (
            <BlockCanvas
              doc={doc}
              selectedId={selectedId}
              onSelectBlock={setSelectedId}
              onChangeDoc={commit}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function ColorControl({
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
    <label className="block">
      <span className="mb-1 block text-[10px] text-white/40">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={picker}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-white/75 focus:outline-none focus:ring-1 focus:ring-[#1BB8C9]"
        />
      </div>
    </label>
  );
}
