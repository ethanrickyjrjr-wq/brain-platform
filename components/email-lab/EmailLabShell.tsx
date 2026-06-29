"use client";
// components/email-lab/EmailLabShell.tsx
// Shared block-canvas surface for BOTH Email Lab routes (Card 40). Holds all the
// state: EmailDoc + undo/redo history, selection, AI content-fill, brand colors
// (→ globalStyle), export, and the "Start from" seed picker. The two route
// clients are thin wrappers that pass brand/scope/header config.
//
// Layout mirrors EmailLabGridShell: canvas left (1fr), dark AI panel right (380px).
// Shared accordions (Brand, Seeds, Blocks, Photos) live in SharedEmailPanel so a
// single fix reaches both shells — import it there, not here.
//
// • Click a block → right panel switches to "Now editing" + Block Inspector.
// • "Fill with AI" → content-patch (words/numbers only; never restyles).
// • Brand colors here own globalStyle (sticky; the AI can't touch them).
// • Classic templates stay reachable as a preview-only legacy rail.
import { useEffect, useRef, useState } from "react";
import { CHART_TYPE_OPTIONS, type ChartType } from "@/lib/email/reshape-chart-type";
import type { ChangeEvent, ReactNode } from "react";
import type {
  BlockType,
  EmailBlock,
  EmailDoc,
  FontFamily,
  SocialPlatformEntry,
} from "@/lib/email/doc/types";
import { EmailDocSchema } from "@/lib/email/doc/schema";
import { PLATFORMS, platformMeta } from "@/lib/email/social/platforms";
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
import { BLOCK_MENU } from "./AddBlockPanel";
import { EmailPreviewFrame } from "@/app/p/[id]/EmailPreviewFrame";
import { ContactPickerModal } from "@/components/contacts/ContactPickerModal";
import { ScheduleSendModal } from "./ScheduleSendModal";
import { createBlock } from "@/lib/email/doc/default-docs";
import { BrandingBlock } from "@/components/brand/BrandingBlock";
import { brandingToTokens } from "@/lib/email/brand/branding-to-tokens";
import { SocialCalendarPanel } from "./SocialCalendarPanel";
import { formatForClipboard } from "@/lib/email/social-calendar/week";
import type { CalendarDay, SocialDraft, WeeklyCalendar } from "@/lib/email/social-calendar/types";
import { capabilitiesFor } from "@/lib/email/lab/capabilities";
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
  { value: "PLAYFAIR_SERIF", label: "Playfair Display" },
  { value: "LATO_SANS", label: "Lato" },
  { value: "MONTSERRAT_SANS", label: "Montserrat" },
];

/** Map project brand tokens onto a doc's globalStyle + brand-bearing blocks.
 *  Preserves the existing branding→email bridge under the block model. */
export function applyBrand(doc: EmailDoc, t?: Record<string, string>): EmailDoc {
  if (!t) return doc;
  const globalStyle = {
    ...doc.globalStyle,
    primaryColor: t.PRIMARY || doc.globalStyle.primaryColor,
    accentColor: t.ACCENT || doc.globalStyle.accentColor,
    textColor: t.TEXT || doc.globalStyle.textColor,
    backdropColor: t.BACKDROP || doc.globalStyle.backdropColor,
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
      if (t.CONTACT_PHONE) props.phone = t.CONTACT_PHONE;
      if (t.CONTACT_EMAIL) props.email = t.CONTACT_EMAIL;
      if (t.INSTAGRAM_URL) props.instagramUrl = t.INSTAGRAM_URL;
      if (t.FACEBOOK_URL) props.facebookUrl = t.FACEBOOK_URL;
      if (t.LINKEDIN_URL) props.linkedinUrl = t.LINKEDIN_URL;
      if (t.UNSUBSCRIBE_URL) props.unsubscribeUrl = t.UNSUBSCRIBE_URL;
    } else if (b.type === "agent-card") {
      if (t.AGENT_NAME) props.name = t.AGENT_NAME;
      if (t.AGENT_TITLE) props.title = t.AGENT_TITLE;
      if (t.AGENT_BIO) props.bio = t.AGENT_BIO;
      if (t.AGENT_PHOTO_URL) props.photoUrl = t.AGENT_PHOTO_URL;
      if (t.CONTACT_PHONE) props.phone = t.CONTACT_PHONE;
      if (cta) props.ctaUrl = cta;
    } else if (b.type === "agent-hero") {
      if (t.AGENT_PHOTO_URL) props.photoUrl = t.AGENT_PHOTO_URL;
      if (t.AGENT_NAME) props.name = t.AGENT_NAME;
      if (t.AGENT_TITLE) props.designation = t.AGENT_TITLE;
      if (cta) props.ctaUrl = cta;
    } else if (b.type === "social-icons") {
      const existing = (props.platforms as SocialPlatformEntry[] | undefined) ?? [];
      const present = new Set(existing.map((e) => e.type));
      const next: SocialPlatformEntry[] = existing.map((e) => {
        if (e.type === "custom") return e;
        const url = t[platformMeta(e.type).tokenKey];
        return url ? { ...e, url } : e;
      });
      for (const meta of PLATFORMS) {
        const url = t[meta.tokenKey];
        if (url && !present.has(meta.type)) next.push({ type: meta.type, url });
      }
      props.platforms = next;
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
  onSave?: (doc: EmailDoc, aiPrompt: string) => Promise<string | void>;
  saving?: boolean;
  autoOpenSchedule?: boolean;
  deliverableId?: string | null;
  projectId?: string;
  projectPhotos?: { storage_path: string; signedUrl: string; caption?: string }[];
  initialBranding?: Record<string, string>;
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
  autoOpenSchedule,
  deliverableId,
  projectId,
  projectPhotos,
  initialBranding,
}: EmailLabShellProps) {
  // Tier dial (lib/email/lab/capabilities.ts) — socials etc. are gated on this, never hardcoded.
  const caps = capabilitiesFor("free");
  const [history, setHistory] = useState<DocHistory>(() =>
    initHistory(applyBrand(initialDoc, brandTokens)),
  );
  const doc = history.present;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState(initialAiPrompt);
  const [chartType, setChartType] = useState<ChartType | "auto">("auto");
  const [aiLoading, setAiLoading] = useState<boolean>(autoGenerate);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendId, setSendId] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(Boolean(autoOpenSchedule && deliverableId));
  const [scheduleId, setScheduleId] = useState<string | null>(deliverableId ?? null);
  const [mode, setMode] = useState<"canvas" | "classic">("canvas");
  const [classicHtml, setClassicHtml] = useState("");
  const [classicId, setClassicId] = useState<string | null>(null);
  const [showClassic, setShowClassic] = useState(false);
  const [showBlocks, setShowBlocks] = useState(false);
  const [promotingPath, setPromotingPath] = useState<string | null>(null);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [branding, setBranding] = useState<Record<string, string>>(initialBranding ?? {});
  const [palettes, setPalettes] = useState<BrandPalette[]>([]);
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandSavedMsg, setBrandSavedMsg] = useState<string | null>(null);
  const brandPrefillAttempted = useRef(false);

  const [showBrand, setShowBrand] = useState(true);
  const [showSeeds, setShowSeeds] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calState, setCalState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [calendar, setCalendar] = useState<WeeklyCalendar | null>(null);
  const [expandedDay, setExpandedDay] = useState<CalendarDay | null>(null);

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

  async function runAi(text: string) {
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
        chart?: boolean;
        chartNote?: string;
        replacedLayout?: boolean;
      };
      if (data.doc) {
        const parsed = EmailDocSchema.safeParse(data.doc);
        if (parsed.success) commit(parsed.data);
      }
      if (data.applied === false && data.message) {
        setAiMessage(data.message);
      } else if (data.replacedLayout) {
        setAiMessage(
          "Built a property flyer from your listing — real photo, price, beds/baths/sqft, and the listing's own description. Hit undo to restore your previous email.",
        );
      } else if (data.chartNote) {
        setAiMessage(data.chartNote);
      } else if (data.chart === false && /chart/i.test(trimmed)) {
        setAiMessage(
          "Chart couldn't be generated — try describing the topic (e.g. home values, rent, vacancy).",
        );
      }
    } catch {
      setAiMessage("Something went wrong — try again.");
    } finally {
      setAiLoading(false);
    }
  }

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
      return parsed.data.blocks[0] ?? null;
    } catch {
      return null;
    }
  }

  const selectedBlock = selectedId ? (doc.blocks.find((b) => b.id === selectedId) ?? null) : null;

  function updateBlock(next: EmailBlock) {
    liveEdit({ ...doc, blocks: doc.blocks.map((b) => (b.id === next.id ? next : b)) });
  }

  function deleteSelected() {
    if (!selectedId || doc.blocks.length <= 1) return;
    commit({ ...doc, blocks: doc.blocks.filter((b) => b.id !== selectedId) });
    setSelectedId(null);
  }

  function addBlockToEnd(type: BlockType) {
    const block = createBlock(type);
    commit({ ...doc, blocks: [...doc.blocks, block] });
    setSelectedId(block.id);
  }

  function setGlobalStyle(patch: Partial<EmailDoc["globalStyle"]>) {
    liveEdit({ ...doc, globalStyle: { ...doc.globalStyle, ...patch } });
  }

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

  async function generateWeek() {
    setCalState("loading");
    try {
      const res = await fetch("/api/email-lab/social-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const data = (await res.json()) as { calendar?: WeeklyCalendar };
      if (data.calendar?.posts?.length) {
        setCalendar(data.calendar);
        setCalState("ready");
      } else {
        setCalState("error");
      }
    } catch {
      setCalState("error");
    }
  }

  function copyCaption(draft: SocialDraft) {
    void navigator.clipboard.writeText(formatForClipboard(draft));
  }

  function loadSocialCard(card: EmailDoc) {
    setMode("canvas");
    setSelectedId(null);
    commit(applyBrand(card, { ...(brandTokens ?? {}), ...brandingToTokens(branding) }));
  }

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
      if (mode === "canvas") {
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
      }
      printToPdf(mode === "classic" ? classicHtml : await renderDocHtml(doc));
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

  const busy = aiLoading || exporting;

  // ── RENDER ──────────────────────────────────────────────────────────────────
  // Layout: canvas (1fr) LEFT · dark AI panel (380px) RIGHT — mirrors /email-lab/grid.
  return (
    <div className="grid h-dvh grid-cols-[1fr_380px] overflow-hidden bg-[#e9edf0] text-[#242424]">
      {/* ══════════ CENTER: top bar + canvas ══════════ */}
      <main className="flex min-w-0 flex-col overflow-hidden">
        {/* top bar — dark, matches /grid */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black bg-[#111418] px-5 py-2.5">
          <div className="flex items-center gap-4">
            {headerSlot}
            {mode === "canvas" && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    editingRef.current = false;
                    setHistory((h) => undoHistory(h));
                    setSelectedId(null);
                  }}
                  disabled={!canUndo(history)}
                  className="rounded border border-[#f59e0b]/40 px-2 py-0.5 text-xs text-[#f59e0b] hover:text-[#fbbf24] disabled:opacity-25"
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
                  className="rounded border border-[#f59e0b]/40 px-2 py-0.5 text-xs text-[#f59e0b] hover:text-[#fbbf24] disabled:opacity-25"
                  title="Redo (⌘⇧Z)"
                >
                  ↷
                </button>
              </div>
            )}
            {mode === "classic" && (
              <button
                onClick={() => setMode("canvas")}
                className="rounded border border-white/10 px-2.5 py-1 text-xs text-white/40 hover:border-white/25 hover:text-white/70"
              >
                ← Back to editor
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadPdf}
              disabled={exporting}
              className="rounded border border-[#f59e0b]/40 px-2.5 py-1 text-xs text-[#f59e0b] transition-colors hover:border-[#f59e0b] hover:text-[#fbbf24] disabled:opacity-30"
            >
              Download PDF
            </button>
            <button
              onClick={copyHtml}
              disabled={exporting}
              className="rounded border border-[#f59e0b]/40 px-2.5 py-1 text-xs text-[#f59e0b] transition-colors hover:border-[#f59e0b] hover:text-[#fbbf24] disabled:opacity-30"
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

        {/* canvas */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {mode === "classic" ? (
            <div className="h-full overflow-y-auto px-8 py-8">
              <div className="mx-auto max-w-[660px]">
                {classicHtml ? (
                  <EmailPreviewFrame srcDoc={classicHtml} />
                ) : (
                  <div className="flex h-96 items-center justify-center text-sm text-gray-400">
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

      {/* ══════════ RIGHT: AI assistant (full height) — mirrors /grid panel ══════════ */}
      <aside className="flex flex-col overflow-hidden border-l border-[#0a141a] bg-[#0f1d24]">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/8 px-4 py-3">
          <span className="text-gulf-teal">✦</span>
          <span className="text-sm font-semibold text-white/85">AI assistant</span>
          {busy && (
            <span className="ml-auto inline-block h-3 w-3 animate-spin rounded-full border-2 border-gulf-teal/30 border-t-gulf-teal" />
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Fill with AI ── */}
          <div className="border-b border-white/8 px-4 pb-4 pt-4">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.15em] text-gulf-teal">
              Fill with AI
            </p>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runAi(aiPrompt);
              }}
              placeholder={aiPlaceholder}
              rows={3}
              className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white/80 placeholder:text-white/25 focus:border-gulf-teal/50 focus:outline-none focus:ring-1 focus:ring-gulf-teal"
            />
            <div className="mb-1.5 mt-2.5">
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
            <button
              onClick={() => runAi(aiPrompt)}
              disabled={aiLoading || !aiPrompt.trim()}
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg bg-gulf-teal py-2 text-sm font-semibold text-[#070f14] transition-colors hover:bg-[#17a3b3] disabled:opacity-40"
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

          {/* ── NOW EDITING (re-targets to the selected block) ── */}
          {selectedBlock ? (
            <div className="border-b border-white/8 px-4 pb-4 pt-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-[#f59e0b]">
                Now editing
              </p>
              <p className="mt-1 text-sm font-semibold text-white/85">{selectedBlock.type}</p>
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
                Click any block to edit it
              </p>
              <ul className="mt-2 space-y-1.5 text-[11px] text-white/45">
                <li>
                  <span className="text-gulf-teal">Any block</span> — click it to open the inspector
                  here, or ask the AI to rewrite it.
                </li>
                <li>
                  <span className="text-gulf-teal">Drag</span> — reorder blocks on the canvas.
                </li>
              </ul>
            </div>
          )}

          {/* ── Social Calendar — PAID-ONLY via the capabilities dial; hidden in free ── */}
          {caps.socialCalendar && (
            <div className="border-b border-white/8 px-4 pb-4 pt-3">
              <button
                onClick={() => setShowCalendar((v) => !v)}
                className="flex w-full items-center justify-between py-1 text-[10px] uppercase tracking-[0.15em] text-white/35 hover:text-white/60"
              >
                <span>Social calendar</span>
                <span className={`transition-transform ${showCalendar ? "rotate-180" : ""}`}>
                  ▾
                </span>
              </button>
              {showCalendar && (
                <SocialCalendarPanel
                  state={calState}
                  calendar={calendar}
                  expandedDay={expandedDay}
                  onGenerate={generateWeek}
                  onToggleDay={(d) => setExpandedDay((cur) => (cur === d ? null : d))}
                  onCopyCaption={copyCaption}
                  onLoadCard={loadSocialCard}
                />
              )}
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
                  headerColorClass="text-[#f59e0b]"
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

          {/* ── Start from a layout ── */}
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
            )}
          </div>

          {/* ── Add a block ── */}
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
                    onClick={() => addBlockToEnd(b.type)}
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
          <div className="border-b border-white/8 px-4 pb-4 pt-3">
            <button
              onClick={() => setShowPhotos((v) => !v)}
              className="flex w-full items-center justify-between py-1 text-[10px] uppercase tracking-[0.15em] text-white/35 hover:text-white/60"
            >
              <span>Photos</span>
              <span className={`transition-transform ${showPhotos ? "rotate-180" : ""}`}>▾</span>
            </button>
            {showPhotos && (
              <div className="mt-2 mb-2 flex gap-1.5">
                <input
                  type="text"
                  value={imageUrlInput}
                  onChange={(e) => setImageUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && imageUrlInput.trim()) {
                      applyPhotoUrl(imageUrlInput.trim());
                      setImageUrlInput("");
                    }
                  }}
                  placeholder="Paste image URL…"
                  className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 placeholder:text-white/25 focus:border-gulf-teal/50 focus:outline-none focus:ring-1 focus:ring-gulf-teal"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (imageUrlInput.trim()) {
                      applyPhotoUrl(imageUrlInput.trim());
                      setImageUrlInput("");
                    }
                  }}
                  disabled={!imageUrlInput.trim()}
                  className="shrink-0 rounded-md bg-gulf-teal px-3 py-1.5 text-xs font-semibold text-[#070f14] disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            )}
            {showPhotos && (
              <div className="grid grid-cols-2 gap-1.5">
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
                    {promotingPath === photo.storage_path && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-gulf-teal" />
                      </div>
                    )}
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

          {/* ── Classic templates (preview only) ── */}
          <div className="px-4 pb-6 pt-3">
            <button
              onClick={() => setShowClassic((v) => !v)}
              className="flex w-full items-center justify-between py-1 text-[10px] uppercase tracking-[0.15em] text-white/35 hover:text-white/60"
            >
              <span>Classic templates (preview)</span>
              <span className={`transition-transform ${showClassic ? "rotate-180" : ""}`}>▾</span>
            </button>
            {showClassic && (
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {CLASSIC_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => pickClassic(t.id)}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
                      mode === "classic" && classicId === t.id
                        ? "border-gulf-teal/40 bg-gulf-teal/15 text-gulf-teal"
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
