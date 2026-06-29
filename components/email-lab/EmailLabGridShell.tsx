"use client";
// components/email-lab/EmailLabGridShell.tsx
//
// THE NORTH STAR, made real. The PAID-tier grid email shell: a true 2D resizable
// canvas (GridCanvas) with a context-aware AI panel on the right. Click a block →
// the AI + inspector re-target to THAT block ("NOW EDITING"). "Build with AI"
// lays out the whole email (author engine). Width presets (Full/⅔/½/⅓) snap the
// selected block; the 12-col grid is internal plumbing the user never counts.
// Add/duplicate happen straight on the grid; neighbors auto-reflow.
//
// Strict SUPERSET of the free tier (EmailLabShell) — it inherits the same brand
// bridge (applyBrand, ONE root), seeds, blocks, photos, save/send/schedule/PDF,
// undo-redo — and ADDS the grid + author + width presets on top. The free shell
// is left untouched; it copies what it needs from here later.
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { CHART_TYPE_OPTIONS, type ChartType } from "@/lib/email/reshape-chart-type";
import type {
  BlockLayout,
  BlockType,
  EmailBlock,
  EmailDoc,
  FontFamily,
} from "@/lib/email/doc/types";
import { EmailDocSchema, mintBlockId } from "@/lib/email/doc/schema";
import { SEED_DOCS, createBlock } from "@/lib/email/doc/default-docs";
import { GRID_COLS, WIDTH_PRESETS, widthPresetLabel } from "@/lib/email/grid-schema";
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
import { GridCanvas, DEFAULT_H } from "./GridCanvas";
import { BlockInspector } from "./BlockInspector";
import { BLOCK_MENU } from "./AddBlockPanel";
import { applyBrand } from "./EmailLabShell";
import { ContactPickerModal } from "@/components/contacts/ContactPickerModal";
import { ScheduleSendModal } from "./ScheduleSendModal";
import { BrandingBlock } from "@/components/brand/BrandingBlock";
import { brandingToTokens } from "@/lib/email/brand/branding-to-tokens";
import {
  type BrandPalette,
  PALETTE_SLOT_KEYS,
  defaultScheme,
  newPaletteId,
  sanitizePalettes,
  schemeFromBranding,
  schemeHasColor,
  schemesEqual,
} from "@/lib/brand/palette";

const FONT_OPTIONS: { value: FontFamily; label: string }[] = [
  { value: "MODERN_SANS", label: "Modern Sans" },
  { value: "BOOK_SERIF", label: "Book Serif" },
  { value: "GEOMETRIC_SANS", label: "Geometric Sans" },
];

// Friendly block-type labels for the "Now editing" header.
const LABELS: Partial<Record<BlockType, string>> = {
  header: "Header",
  hero: "Headline",
  stats: "Stats",
  signal: "Signal",
  text: "Text",
  image: "Image",
  listing: "Listing card",
  "multi-column": "Columns",
  "agent-card": "Agent card",
  "agent-hero": "Agent banner",
  "social-icons": "Social icons",
  button: "Button",
  divider: "Divider",
  footer: "Footer",
};

// Only the grid seeds (every block carries a `layout`) belong on the grid shell.
const GRID_SEEDS = SEED_DOCS.filter((s) => s.build().blocks.every((b) => b.layout != null));

async function renderDocHtml(doc: EmailDoc): Promise<string> {
  const res = await fetch("/api/email-lab/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc }),
  });
  return (await res.json()).html ?? "";
}

/** y of the first free row under everything (incl. a static footer). */
function nextBottomY(blocks: EmailBlock[]): number {
  let max = 0;
  for (const b of blocks) {
    if (b.layout) max = Math.max(max, b.layout.y + b.layout.h);
  }
  return max;
}

/** A block's layout, or a synthesized full-width one stacked at the bottom. */
function ensureLayout(block: EmailBlock, blocks: EmailBlock[]): BlockLayout {
  return (
    block.layout ?? { x: 0, y: nextBottomY(blocks), w: GRID_COLS, h: DEFAULT_H[block.type] ?? 4 }
  );
}

/** The author engine derives bounds-correct {x,y,w} but a uniform advisory h=1
 *  (email height is content-driven). On the fixed-cell grid that clips to 30px,
 *  so give each ROW a real height (max default of its members) and re-stack y.
 *  Only fires when every block is thin (h≤1) → never touches a real grid doc. */
function normalizeAuthorHeights(doc: EmailDoc): EmailDoc {
  const blocks = doc.blocks;
  if (blocks.length === 0 || !blocks.every((b) => b.layout && b.layout.h <= 1)) return doc;
  const rows = new Map<number, EmailBlock[]>();
  for (const b of blocks) {
    const y = b.layout!.y;
    (rows.get(y) ?? rows.set(y, []).get(y)!).push(b);
  }
  const ys = [...rows.keys()].sort((a, b) => a - b);
  const nextLayout = new Map<string, BlockLayout>();
  let cursorY = 0;
  for (const y of ys) {
    const row = rows.get(y)!;
    const rowH = Math.max(...row.map((b) => DEFAULT_H[b.type] ?? 4));
    for (const b of row) nextLayout.set(b.id, { ...b.layout!, y: cursorY, h: rowH });
    cursorY += rowH;
  }
  return {
    ...doc,
    blocks: blocks.map((b) => ({ ...b, layout: nextLayout.get(b.id) ?? b.layout })),
  };
}

export interface EmailLabGridShellProps {
  initialDoc: EmailDoc;
  brandTokens?: Record<string, string>;
  scope?: { kind?: string; value?: string };
  headerSlot: ReactNode;
  aiPlaceholder?: string;
  onSave?: (doc: EmailDoc, aiPrompt: string) => Promise<string | void>;
  saving?: boolean;
  autoOpenSchedule?: boolean;
  deliverableId?: string | null;
  projectId?: string;
  projectPhotos?: { storage_path: string; signedUrl: string; caption?: string }[];
  initialBranding?: Record<string, string>;
}

export function EmailLabGridShell({
  initialDoc,
  brandTokens,
  scope,
  headerSlot,
  aiPlaceholder = "Describe the whole email — the AI lays it out on the grid with real SWFL numbers…",
  onSave,
  saving,
  autoOpenSchedule,
  deliverableId,
  projectId,
  projectPhotos,
  initialBranding,
}: EmailLabGridShellProps) {
  const [history, setHistory] = useState<DocHistory>(() =>
    initHistory(applyBrand(initialDoc, brandTokens)),
  );
  const doc = history.present;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [chartType, setChartType] = useState<ChartType | "auto">("auto");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  // The AI's last "what I just did" line, shown in the panel ("Built the whole email…").
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendId, setSendId] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(Boolean(autoOpenSchedule && deliverableId));
  const [scheduleId, setScheduleId] = useState<string | null>(deliverableId ?? null);
  const [promotingPath, setPromotingPath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Brand panel (ONE ROOT — same blob the project workspace edits).
  const [branding, setBranding] = useState<Record<string, string>>(initialBranding ?? {});
  const [palettes, setPalettes] = useState<BrandPalette[]>([]);
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandSavedMsg, setBrandSavedMsg] = useState<string | null>(null);
  const brandPrefillAttempted = useRef(false);

  // Right-panel accordions.
  const [showBrand, setShowBrand] = useState(false);
  const [showSeeds, setShowSeeds] = useState(false);
  const [showBlocks, setShowBlocks] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);

  // history helpers (coalesced field edits → meaningful undo frames)
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

  // ── AI: Build the whole email (author engine) ───────────────────────────────
  async function runAuthor(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setAiLoading(true);
    setAiMessage(null);
    try {
      const res = await fetch("/api/email-lab/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          doc,
          scope,
          build: true,
          chartType: chartType === "auto" ? undefined : chartType,
        }),
      });
      const data = (await res.json()) as { doc?: unknown; applied?: boolean; message?: string };
      if (data.doc) {
        const parsed = EmailDocSchema.safeParse(data.doc);
        if (parsed.success) {
          const normalized = normalizeAuthorHeights(applyBrand(parsed.data, brandTokens));
          commit(normalized);
          setSelectedId(null);
          setAiStatus(
            `Built the whole email from one line — ${normalized.blocks.length} blocks laid out on the grid.`,
          );
        }
      }
      if (data.applied === false && data.message) setAiMessage(data.message);
    } catch {
      setAiMessage("Something went wrong — try again.");
    } finally {
      setAiLoading(false);
    }
  }

  // ── AI: Fill content into the current layout (content patch — words/numbers) ──
  async function runFill(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setAiLoading(true);
    setAiMessage(null);
    try {
      const res = await fetch("/api/email-lab/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          doc,
          scope,
          chartType: chartType === "auto" ? undefined : chartType,
        }),
      });
      const data = (await res.json()) as {
        doc?: unknown;
        applied?: boolean;
        message?: string;
        chartNote?: string;
      };
      if (data.doc) {
        const parsed = EmailDocSchema.safeParse(data.doc);
        if (parsed.success) commit(parsed.data);
      }
      if (data.applied === false && data.message) setAiMessage(data.message);
      else if (data.chartNote) setAiMessage(data.chartNote);
    } catch {
      setAiMessage("Something went wrong — try again.");
    } finally {
      setAiLoading(false);
    }
  }

  // ── per-block AI (re-targets to the selected block) ─────────────────────────
  async function runBlockAi(block: EmailBlock, prompt: string): Promise<EmailBlock | null> {
    const miniDoc = { globalStyle: doc.globalStyle, blocks: [block] };
    try {
      const res = await fetch("/api/email-lab/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, doc: miniDoc, scope }),
      });
      const data = (await res.json()) as { doc?: unknown };
      if (!data.doc) return null;
      const parsed = EmailDocSchema.safeParse(data.doc);
      if (!parsed.success) return null;
      // Keep the block's grid position — per-block AI rewrites content, not layout.
      const next = parsed.data.blocks[0];
      return next ? ({ ...next, layout: block.layout } as EmailBlock) : null;
    } catch {
      return null;
    }
  }

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

  /** Snap the selected block to a width preset; clamp x so it never overflows. */
  function setSelectedWidth(w: number) {
    if (!selectedBlock) return;
    const cur = ensureLayout(selectedBlock, doc.blocks);
    const x = cur.x + w > GRID_COLS ? Math.max(0, GRID_COLS - w) : cur.x;
    commit({
      ...doc,
      blocks: doc.blocks.map((b) =>
        b.id === selectedBlock.id ? { ...b, layout: { ...cur, x, w } } : b,
      ),
    });
  }

  /** Add a block straight onto the grid (full-width, stacked at the bottom). */
  function addBlockToGrid(type: BlockType) {
    const block = createBlock(type);
    const layout: BlockLayout = {
      x: 0,
      y: nextBottomY(doc.blocks),
      w: GRID_COLS,
      h: DEFAULT_H[type] ?? 4,
    };
    commit({ ...doc, blocks: [...doc.blocks, { ...block, layout } as EmailBlock] });
    setSelectedId(block.id);
    setShowBlocks(false);
  }

  /** Duplicate a block — fresh id, content cloned, placed below; movable. */
  function duplicateBlock(id: string) {
    const src = doc.blocks.find((b) => b.id === id);
    if (!src) return;
    const layout: BlockLayout = {
      ...ensureLayout(src, doc.blocks),
      y: nextBottomY(doc.blocks),
      static: undefined,
    };
    const copy = {
      ...src,
      id: mintBlockId(),
      props: structuredClone(src.props),
      layout,
    } as EmailBlock;
    commit({ ...doc, blocks: [...doc.blocks, copy] });
    setSelectedId(copy.id);
  }

  function setGlobalStyle(patch: Partial<EmailDoc["globalStyle"]>) {
    liveEdit({ ...doc, globalStyle: { ...doc.globalStyle, ...patch } });
  }

  // ── Brand panel (one root) ──────────────────────────────────────────────────
  function applyBranding(next: Record<string, string>) {
    setBranding(next);
    liveEdit(applyBrand(doc, brandingToTokens(next)));
  }

  function persistPalettes(next: BrandPalette[]) {
    setPalettes(next);
    void fetch("/api/user/brand", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ color_palettes: next }),
    });
  }

  async function saveBrandToProject(): Promise<boolean> {
    if (!projectId) return false;
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branding }),
    });
    return res.ok;
  }

  async function saveBrandGlobal(): Promise<boolean> {
    setBrandSaving(true);
    setBrandSavedMsg(null);
    try {
      const scheme = schemeFromBranding(branding);
      let nextPalettes = palettes;
      if (schemeHasColor(scheme) && !palettes.some((p) => schemesEqual(p.colors, scheme))) {
        nextPalettes = [
          ...palettes,
          { id: newPaletteId(), name: `Palette ${palettes.length + 1}`, colors: scheme },
        ];
        setPalettes(nextPalettes);
      }
      void fetch("/api/user/brand", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...branding, color_palettes: nextPalettes }),
      });
      const ok = projectId ? await saveBrandToProject() : true;
      setBrandSavedMsg(ok ? "Brand saved" : "Save failed");
      return ok;
    } finally {
      setBrandSaving(false);
    }
  }

  async function saveBrandProjectOnly(): Promise<boolean> {
    setBrandSaving(true);
    setBrandSavedMsg(null);
    try {
      const ok = await saveBrandToProject();
      setBrandSavedMsg(ok ? "Saved to this project" : "Save failed");
      return ok;
    } finally {
      setBrandSaving(false);
    }
  }

  function pickSeed(seedId: string) {
    const seed = SEED_DOCS.find((s) => s.id === seedId);
    if (!seed) return;
    setSelectedId(null);
    setAiStatus(null);
    commit(applyBrand(seed.build(), brandTokens));
    setShowSeeds(false);
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
    } else if (sel?.type === "listing") {
      commit({
        ...doc,
        blocks: doc.blocks.map((b) =>
          b.id === sel.id ? { ...sel, props: { ...sel.props, photoUrl: url } } : b,
        ),
      });
    } else {
      const layout: BlockLayout = {
        x: 0,
        y: nextBottomY(doc.blocks),
        w: GRID_COLS,
        h: DEFAULT_H.image,
      };
      const newBlock = { id: mintBlockId(), type: "image", props: { url }, layout } as EmailBlock;
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
    setPromotingPath("__upload__");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const endpoint = projectId
        ? `/api/projects/${projectId}/email-media`
        : "/api/email-lab/media";
      const res = await fetch(endpoint, { method: "PUT", body: fd });
      if (!res.ok) return;
      const { url } = (await res.json()) as { url: string };
      applyPhotoUrl(url);
    } finally {
      setPromotingPath(null);
    }
  }

  // ── export ──────────────────────────────────────────────────────────────────
  async function copyHtml() {
    setExporting(true);
    try {
      const html = await renderDocHtml(doc);
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } finally {
      setExporting(false);
    }
  }

  function printToPdf(html: string) {
    const win = window.open("", "_blank");
    if (!win) return;
    win.onload = () => win.print();
    win.document.write(html);
    win.document.close();
  }

  async function downloadPdf() {
    setExporting(true);
    try {
      try {
        const res = await fetch(`/api/deliverables/${deliverableId ?? "live"}/pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doc }),
        });
        if (res.ok) {
          const blob = await res.blob();
          const href = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = href;
          a.download = "report.pdf";
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(href);
          return;
        }
      } catch {
        // fall through to print
      }
      printToPdf(await renderDocHtml(doc));
    } finally {
      setExporting(false);
    }
  }

  async function openSend() {
    let id = deliverableId ?? null;
    if (onSave) {
      const saved = await onSave(doc, aiPrompt);
      if (typeof saved === "string") id = saved;
    }
    if (id) {
      setSendId(id);
      setSendOpen(true);
    }
  }

  async function openSchedule() {
    let id = deliverableId ?? null;
    if (onSave) {
      const saved = await onSave(doc, aiPrompt);
      if (typeof saved === "string") id = saved;
    }
    if (id) {
      setScheduleId(id);
      setScheduleOpen(true);
    }
  }

  // On first Brand-accordion open, load the account brand profile (mirrors free).
  useEffect(() => {
    if (!showBrand || brandPrefillAttempted.current) return;
    brandPrefillAttempted.current = true;
    fetch("/api/user/brand")
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, unknown>) => {
        setPalettes(sanitizePalettes(data.color_palettes));
        setBranding((prev) => {
          const next = { ...prev };
          for (const k of ["agent_name", "photo_url", "license", "brokerage"]) {
            if (!next[k] && typeof data[k] === "string" && data[k]) next[k] = data[k] as string;
          }
          const scheme = defaultScheme(data);
          PALETTE_SLOT_KEYS.forEach((k, i) => {
            if (!prev[k] && scheme[i]) next[k] = scheme[i];
          });
          return next;
        });
      })
      .catch(() => {});
  }, [showBrand]);

  // Keyboard: ⌘Z / ⌘⇧Z undo-redo, Escape deselects.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        editingRef.current = false;
        if (e.shiftKey) setHistory((h) => redoHistory(h));
        else {
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

  const busy = aiLoading || exporting;
  const selectedWidth = selectedBlock ? (selectedBlock.layout?.w ?? GRID_COLS) : null;

  return (
    <div className="grid h-dvh grid-cols-[1fr_380px] overflow-hidden bg-[#070f14] text-white">
      {/* ══════════ CENTER: top bar + grid canvas ══════════ */}
      <main className="flex min-w-0 flex-col overflow-hidden">
        {/* top bar */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/8 bg-[#0b141a] px-5 py-2.5">
          <div className="flex items-center gap-4">
            {headerSlot}
            <span className="hidden text-[11px] text-white/30 lg:inline">
              <span className="text-gulf-teal/70">Auto-reflow on</span> · widths snap to Full/½/⅓/⅔
              · click to edit · click empty to add · drag a corner to resize
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="mr-1 flex items-center gap-1">
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
            <button
              onClick={downloadPdf}
              disabled={exporting}
              className="rounded border border-white/10 px-2.5 py-1 text-xs text-white/40 transition-colors hover:border-white/25 hover:text-white/70 disabled:opacity-30"
            >
              Download PDF
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
                onClick={openSend}
                disabled={busy}
                className="rounded-lg border border-gulf-teal/30 bg-gulf-teal/10 px-3 py-1.5 text-sm text-gulf-teal transition-colors hover:bg-gulf-teal/20 disabled:opacity-40"
              >
                Send to contacts
              </button>
            )}
            {onSave && projectId && (
              <button
                type="button"
                onClick={openSchedule}
                disabled={busy || saving}
                className="rounded-lg border border-gulf-teal/30 bg-gulf-teal/10 px-3 py-1.5 text-sm text-gulf-teal transition-colors hover:bg-gulf-teal/20 disabled:opacity-40"
              >
                Schedule
              </button>
            )}
            {onSave && (
              <button
                type="button"
                onClick={() => onSave(doc, aiPrompt)}
                disabled={saving}
                className="rounded-lg border border-gulf-teal/30 bg-gulf-teal/20 px-3 py-1.5 text-sm text-gulf-teal transition-colors hover:bg-gulf-teal/30 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>

        {/* width-preset bar (selected block) */}
        <div className="flex shrink-0 items-center gap-3 border-b border-white/8 bg-[#0d1920] px-5 py-2 text-xs">
          <span className="text-white/40">Selected block width</span>
          <div className="flex items-center gap-1">
            {WIDTH_PRESETS.map((p) => (
              <button
                key={p.w}
                type="button"
                disabled={!selectedBlock}
                onClick={() => setSelectedWidth(p.w)}
                className={`min-w-[42px] rounded-md border px-2 py-1 text-[11px] transition-colors ${
                  selectedWidth === p.w
                    ? "border-gulf-teal bg-gulf-teal/20 text-gulf-teal"
                    : "border-white/10 bg-white/5 text-white/50 hover:text-white/80 disabled:opacity-30 disabled:hover:text-white/50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-white/25">
            {selectedBlock
              ? "a fine grid underneath snaps it — you never count columns"
              : "click a block to set its width"}
          </span>
        </div>

        {/* the real grid */}
        <div className="min-h-0 flex-1">
          <GridCanvas
            doc={doc}
            selectedId={selectedId}
            onSelectBlock={setSelectedId}
            onChangeDoc={commit}
            onDuplicate={duplicateBlock}
            onAddBlock={() => setShowBlocks(true)}
          />
        </div>
      </main>

      {/* ══════════ RIGHT: AI assistant (full height) ══════════ */}
      <aside className="flex flex-col overflow-hidden border-l border-white/8 bg-[#0b141a]">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/8 px-4 py-3">
          <span className="text-gulf-teal">✦</span>
          <span className="text-sm font-semibold text-white/85">AI assistant</span>
          {busy && (
            <span className="ml-auto inline-block h-3 w-3 animate-spin rounded-full border-2 border-gulf-teal/30 border-t-gulf-teal" />
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Build the whole email ── */}
          <div className="border-b border-white/8 px-4 pb-4 pt-4">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.15em] text-gulf-teal">
              Build with AI
            </p>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runAuthor(aiPrompt);
              }}
              placeholder={aiPlaceholder}
              rows={3}
              className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white/80 placeholder:text-white/25 focus:border-gulf-teal/50 focus:outline-none focus:ring-1 focus:ring-gulf-teal"
            />
            <div className="mb-1.5 mt-2.5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.15em] text-white/35">
                Chart type
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {([{ type: "auto", label: "Auto" }, ...CHART_TYPE_OPTIONS] as const).map((o) => (
                <button
                  key={o.type}
                  type="button"
                  onClick={() => setChartType(o.type as ChartType | "auto")}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    chartType === o.type
                      ? "border-gulf-teal bg-gulf-teal/20 text-gulf-teal"
                      : "border-white/10 bg-white/5 text-white/50 hover:text-white/80"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={() => runAuthor(aiPrompt)}
                disabled={aiLoading || !aiPrompt.trim()}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gulf-teal py-2 text-sm font-semibold text-[#070f14] transition-colors hover:bg-[#17a3b3] disabled:opacity-40"
              >
                {aiLoading ? "Working…" : "Build the email"}
              </button>
              <button
                onClick={() => runFill(aiPrompt)}
                disabled={aiLoading || !aiPrompt.trim()}
                title="Fill content into the current layout (keeps your blocks)"
                className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 transition-colors hover:text-white/90 disabled:opacity-40"
              >
                Fill
              </button>
            </div>
            {aiStatus && (
              <p className="mt-2.5 rounded-md border border-gulf-teal/20 bg-gulf-teal/10 px-2.5 py-2 text-[11px] text-gulf-teal/90">
                ✓ {aiStatus}
              </p>
            )}
            {aiMessage && <p className="mt-2 text-[11px] text-amber-300/80">{aiMessage}</p>}
          </div>

          {/* ── NOW EDITING (re-targets to the selected block) ── */}
          {selectedBlock ? (
            <div className="border-b border-white/8 px-4 pb-4 pt-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/35">
                Now editing
              </p>
              <p className="mt-1 text-sm font-semibold text-white/85">
                {LABELS[selectedBlock.type] ?? selectedBlock.type} ·{" "}
                <span className="text-gulf-teal">
                  {widthPresetLabel(selectedWidth ?? GRID_COLS)} width
                </span>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                The AI sees the whole layout — every block and where it sits — so it changes this
                one and reflows the neighbors.
              </p>
              <div className="mt-3 rounded-lg bg-white p-3 text-gray-900">
                <BlockInspector
                  block={selectedBlock}
                  onChange={updateBlock}
                  onDelete={deleteSelected}
                  onClose={() => setSelectedId(null)}
                  onBlockAi={runBlockAi}
                />
              </div>
            </div>
          ) : (
            <div className="border-b border-white/8 px-4 pb-4 pt-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/35">
                It re-targets to whatever you click
              </p>
              <ul className="mt-2 space-y-1.5 text-[11px] text-white/45">
                <li>
                  <span className="text-gulf-teal">Any block</span> — click it, then tweak it here
                  or ask the AI to rewrite it.
                </li>
                <li>
                  <span className="text-gulf-teal">Width</span> — Full / ⅔ / ½ / ⅓ snaps the
                  selected block; neighbors reflow.
                </li>
                <li>
                  <span className="text-gulf-teal">Add</span> — the “add” tile on the canvas drops a
                  new block on the grid.
                </li>
              </ul>
            </div>
          )}

          {/* ── Brand ── */}
          <div className="border-b border-white/8 px-4 pb-4 pt-3">
            <button
              onClick={() => setShowBrand((v) => !v)}
              className="flex w-full items-center justify-between py-1 text-[10px] uppercase tracking-[0.15em] text-white/35 hover:text-white/60"
            >
              <span>Brand</span>
              <span className={`transition-transform ${showBrand ? "rotate-180" : ""}`}>▾</span>
            </button>
            {showBrand && (
              <div className="mt-3">
                <BrandingBlock
                  branding={branding}
                  onChange={applyBranding}
                  palettes={palettes}
                  onPalettesChange={persistPalettes}
                  onSaveGlobal={saveBrandGlobal}
                  onSaveProjectOnly={projectId ? saveBrandProjectOnly : undefined}
                  saving={brandSaving}
                  savedMsg={brandSavedMsg}
                  onClose={() => setShowBrand(false)}
                />
                <label className="mt-3 block border-t border-white/10 pt-3">
                  <span className="mb-1 block text-[10px] text-white/40">Font</span>
                  <select
                    value={doc.globalStyle.fontFamily}
                    onChange={(e) => setGlobalStyle({ fontFamily: e.target.value as FontFamily })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/75 focus:outline-none focus:ring-1 focus:ring-gulf-teal"
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value} className="text-black">
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          {/* ── Start from (grid seeds) ── */}
          <div className="border-b border-white/8 px-4 pb-4 pt-3">
            <button
              onClick={() => setShowSeeds((v) => !v)}
              className="flex w-full items-center justify-between py-1 text-[10px] uppercase tracking-[0.15em] text-white/35 hover:text-white/60"
            >
              <span>Start from a layout</span>
              <span className={`transition-transform ${showSeeds ? "rotate-180" : ""}`}>▾</span>
            </button>
            {showSeeds && (
              <div className="mt-2 space-y-1.5">
                {GRID_SEEDS.map((s) => (
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
            )}
          </div>

          {/* ── Add Blocks ── */}
          <div className="border-b border-white/8 px-4 pb-4 pt-3">
            <button
              onClick={() => setShowBlocks((v) => !v)}
              className="flex w-full items-center justify-between py-1 text-[10px] uppercase tracking-[0.15em] text-white/35 hover:text-white/60"
            >
              <span>Add a block</span>
              <span className={`transition-transform ${showBlocks ? "rotate-180" : ""}`}>▾</span>
            </button>
            {showBlocks && (
              <div className="mt-2 grid grid-cols-2 gap-1">
                {BLOCK_MENU.map((b) => (
                  <button
                    key={b.type}
                    type="button"
                    onClick={() => addBlockToGrid(b.type)}
                    className="flex items-center gap-2 rounded-md border border-white/8 bg-white/4 px-2.5 py-2 text-left transition-colors hover:bg-white/8"
                  >
                    <span className="w-4 text-center text-sm leading-none text-white/40">
                      {b.icon}
                    </span>
                    <span className="text-[11px] font-medium text-white/55">{b.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Photos ── */}
          <div className="px-4 pb-6 pt-3">
            <button
              onClick={() => setShowPhotos((v) => !v)}
              className="flex w-full items-center justify-between py-1 text-[10px] uppercase tracking-[0.15em] text-white/35 hover:text-white/60"
            >
              <span>Photos</span>
              <span className={`transition-transform ${showPhotos ? "rotate-180" : ""}`}>▾</span>
            </button>
            {showPhotos && (
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={promotingPath !== null}
                  className="flex aspect-square items-center justify-center rounded-md border border-dashed border-white/20 bg-white/3 text-white/30 transition-colors hover:border-gulf-teal/50 hover:text-gulf-teal/70 disabled:opacity-40"
                  title="Upload a photo"
                >
                  {promotingPath === "__upload__" ? (
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-gulf-teal" />
                  ) : (
                    <span className="text-lg leading-none">＋</span>
                  )}
                </button>
                {(projectPhotos ?? []).map((photo) => (
                  <button
                    key={photo.storage_path}
                    type="button"
                    onClick={() => pickFiledPhoto(photo.storage_path)}
                    disabled={promotingPath !== null}
                    title={photo.caption ?? photo.storage_path.split("/").pop()}
                    className={`relative aspect-square overflow-hidden rounded-md border-2 transition-all ${
                      promotingPath === photo.storage_path
                        ? "border-gulf-teal"
                        : "border-transparent hover:border-gulf-teal disabled:opacity-60"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.signedUrl}
                      alt={photo.caption ?? ""}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
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
        </div>
      </aside>

      {sendOpen && sendId && (
        <ContactPickerModal
          deliverableId={sendId}
          isBlockCanvas
          onClose={() => setSendOpen(false)}
        />
      )}

      {scheduleOpen && scheduleId && projectId && (
        <ScheduleSendModal
          deliverableId={scheduleId}
          projectId={projectId}
          scopeKind={scope?.kind ?? null}
          scopeValue={scope?.value ?? null}
          onClose={() => setScheduleOpen(false)}
        />
      )}
    </div>
  );
}
