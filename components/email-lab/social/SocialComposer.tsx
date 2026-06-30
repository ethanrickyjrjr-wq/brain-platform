// components/email-lab/social/SocialComposer.tsx
"use client";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import type Konva from "konva";
import { SOCIAL_FORMATS, type SocialFormat } from "@/lib/social/formats";
import { newDesign, designToSkeleton, applyDesignPatch } from "@/lib/social/design/serialize";
import type { SocialDesign, SocialElement } from "@/lib/social/design/types";
import { brandingToTokens } from "@/lib/email/brand/branding-to-tokens";
import { mintBlockId } from "@/lib/email/doc/schema";
import { ScheduleSocialModal } from "@/components/email-lab/ScheduleSocialModal";
import type { SocialDraft } from "@/lib/email/social-calendar/types";

// react-konva is browser-only (it touches `window`); never server-render it.
const KonvaStage = dynamic(() => import("./KonvaStage"), {
  ssr: false,
  loading: () => <div className="p-6 text-xs text-white/40">Loading composer…</div>,
});

export interface SocialComposerProps {
  scope?: { kind?: string; value?: string };
  projectId?: string;
  branding: Record<string, string>;
}

const FORMAT_LABEL: Record<SocialFormat, string> = {
  square: "Square 1:1",
  portrait: "Portrait 4:5",
  landscape: "Landscape 1.91:1",
  story: "Story 9:16",
};

const PALETTE: { type: SocialElement["type"]; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "stat", label: "Stat" },
  { type: "cta", label: "Button + link" },
  { type: "image", label: "Image" },
  { type: "logo", label: "Logo" },
];

export function SocialComposer({ scope, projectId, branding }: SocialComposerProps) {
  const tokens = brandingToTokens(branding);
  const primary = tokens.PRIMARY ?? "#0f1d24";
  const accent = tokens.ACCENT ?? "#0ea5b7";
  const text = tokens.TEXT ?? "#ffffff";
  const logoUrl = tokens.LOGO_URL;

  const [design, setDesign] = useState<SocialDesign>(() => ({
    ...newDesign("square"),
    background: primary,
  }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // exposed for the export task (Task 7): toDataURL off this stage.
  const stageRef = useRef<Konva.Stage | null>(null);

  // Generate state
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  // variants keyed by platform — stored for downstream scheduling; displayed as platform list
  const [variants, setVariants] = useState<Record<string, string>>({});

  function setFormat(format: SocialFormat) {
    setDesign((d) => ({ ...d, format }));
  }

  function updateElement(next: SocialElement) {
    setDesign((d) => ({ ...d, elements: d.elements.map((e) => (e.id === next.id ? next : e)) }));
  }

  function addElement(type: SocialElement["type"]) {
    const id = mintBlockId();
    const base = { id, x: 80, y: 80, width: 400, height: 120 };
    let el: SocialElement;
    switch (type) {
      case "text":
        // brandingToTokens emits no FONT token; "Arial" is the v1 default (Task-6 #4).
        el = {
          ...base,
          type: "text",
          text: "Your text",
          fontSize: 56,
          fontFamily: "Arial",
          fill: text,
        };
        break;
      case "stat":
        el = {
          ...base,
          type: "stat",
          height: 200,
          value: "",
          label: "label",
          valueFontSize: 120,
          labelFontSize: 32,
          fill: text,
          accent,
        };
        break;
      case "cta":
        el = {
          ...base,
          type: "cta",
          height: 70,
          text: "Learn more →",
          url: "",
          fill: accent,
          textFill: primary,
          fontSize: 30,
        };
        break;
      case "image":
        el = { ...base, type: "image", height: 400, src: "" };
        break;
      case "logo":
        el = { ...base, type: "logo", width: 240, height: 90, src: logoUrl ?? "" };
        break;
      default:
        // chart is seeded by AI fill in a later task, not from the palette.
        // Note: chart elements render a placeholder today (no v1 chart-from-brain flow);
        // full chart support in the canvas is a follow-up task.
        return;
    }
    setDesign((d) => ({ ...d, elements: [...d.elements, el] }));
    setSelectedId(id);
  }

  async function generate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      // If the canvas is empty, seed a text + stat element first so there is something to fill.
      // We build workingDesign locally so the skeleton reflects the seeded elements immediately
      // (we can't await a setDesign batch before the fetch).
      let workingDesign = design;
      if (design.elements.length === 0) {
        const id1 = mintBlockId();
        const id2 = mintBlockId();
        workingDesign = {
          ...design,
          elements: [
            {
              id: id1,
              type: "text" as const,
              x: 80,
              y: 80,
              width: 400,
              height: 120,
              text: "Your text",
              fontSize: 56,
              fontFamily: "Arial",
              fill: text,
            },
            {
              id: id2,
              type: "stat" as const,
              x: 80,
              y: 220,
              width: 400,
              height: 200,
              value: "",
              label: "label",
              valueFontSize: 120,
              labelFontSize: 32,
              fill: text,
              accent,
            },
          ],
        };
      }
      const skeleton = designToSkeleton(workingDesign);
      const res = await fetch("/api/email-lab/social/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, skeleton }),
      });
      if (!res.ok) {
        setGenerateError("Generate failed — try again.");
        return;
      }
      const data = (await res.json()) as {
        patch?: Record<string, Record<string, unknown>>;
        caption?: string;
        hashtags?: string[];
        variants?: Record<string, string>;
      };
      setDesign(applyDesignPatch(workingDesign, data.patch ?? {}));
      setCaption(data.caption ?? "");
      setHashtags(data.hashtags ?? []);
      setVariants(data.variants ?? {});
    } finally {
      setGenerating(false);
    }
  }

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  async function exportPng(): Promise<string | null> {
    const stage = stageRef.current;
    if (!stage) return null;
    setExporting(true);
    setExportError(null);
    try {
      // 1) Fonts must be loaded before raster or the export diverges from the preview.
      if (typeof document !== "undefined" && document.fonts?.ready) {
        await document.fonts.ready;
      }
      // 2) pixelRatio = target platform width ÷ on-screen stage width → pixel-exact output.
      const targetW = SOCIAL_FORMATS[design.format].width;
      const pixelRatio = targetW / stage.width();
      // 3) toDataURL throws SECURITY_ERR on a tainted (cross-origin, non-CORS) canvas.
      let dataUrl: string;
      try {
        dataUrl = stage.toDataURL({ pixelRatio, mimeType: "image/png" });
      } catch {
        setExportError(
          "An image on the canvas blocks export (it's hosted somewhere that doesn't allow it). Use an uploaded photo or one from your library.",
        );
        return null;
      }
      const blob = await (await fetch(dataUrl)).blob();
      const fd = new FormData();
      fd.append("file", blob, "post.png");
      const res = await fetch("/api/email-lab/social/upload", { method: "POST", body: fd });
      if (!res.ok) {
        setExportError("Couldn't save the image — try again.");
        return null;
      }
      const { url } = (await res.json()) as { url: string };
      setMediaUrl(url);
      return url;
    } finally {
      setExporting(false);
    }
  }

  async function openSchedule() {
    // Reuse the already-exported image, or export now; the modal needs a frozen media_url.
    const url = mediaUrl ?? (await exportPng());
    if (!url) return; // export error already surfaced
    setScheduleOpen(true);
  }

  function deleteSelected() {
    if (!selectedId) return;
    setDesign((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== selectedId) }));
    setSelectedId(null);
  }

  const displayWidth = design.format === "story" ? 320 : design.format === "portrait" ? 380 : 460;

  return (
    <div className="flex h-full">
      {/* left tools */}
      <div className="w-48 shrink-0 space-y-3 overflow-y-auto border-r border-white/8 bg-[#0b1620] p-3">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-[0.15em] text-white/35">Size</p>
          <div className="space-y-1">
            {(Object.keys(SOCIAL_FORMATS) as SocialFormat[]).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`w-full rounded border px-2 py-1 text-left text-[11px] ${
                  design.format === f
                    ? "border-gulf-teal text-gulf-teal"
                    : "border-white/10 text-white/55"
                }`}
              >
                {FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-[0.15em] text-white/35">Add</p>
          <div className="grid grid-cols-2 gap-1">
            {PALETTE.map((p) => (
              <button
                key={p.type}
                onClick={() => addElement(p.type)}
                className="rounded border border-white/10 px-2 py-1 text-[11px] text-white/60 hover:text-white/90"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {selectedId && (
          <button
            onClick={deleteSelected}
            className="w-full rounded border border-red-400/30 px-2 py-1 text-[11px] text-red-300"
          >
            Delete selected
          </button>
        )}
        <div className="border-t border-white/8 pt-3">
          <button
            onClick={() => void generate()}
            disabled={generating}
            className="w-full rounded-lg bg-gulf-teal py-2 text-xs font-semibold text-[#070f14] disabled:opacity-40"
          >
            {generating ? "Generating…" : "Generate"}
          </button>
          {generateError && <p className="mt-1 text-[10px] text-amber-300/80">{generateError}</p>}
        </div>
        <div className="border-t border-white/8 pt-3">
          <button
            onClick={() => void exportPng()}
            disabled={exporting || design.elements.length === 0}
            className="w-full rounded-lg bg-gulf-teal py-2 text-xs font-semibold text-[#070f14] disabled:opacity-40"
          >
            {exporting ? "Exporting…" : "Export PNG"}
          </button>
          {exportError && <p className="mt-1 text-[10px] text-amber-300/80">{exportError}</p>}
          {mediaUrl && <p className="mt-1 text-[10px] text-gulf-teal/80">Image saved ✓</p>}
        </div>
        <button
          onClick={() => void openSchedule()}
          disabled={design.elements.length === 0}
          className="w-full rounded-lg border border-gulf-teal/40 py-2 text-xs font-semibold text-gulf-teal hover:bg-gulf-teal/10 disabled:opacity-40"
        >
          Schedule post
        </button>
      </div>

      {/* canvas + caption editor */}
      <div className="flex flex-1 flex-col overflow-auto">
        <div className="flex flex-1 items-center justify-center bg-[#0a141a] p-6">
          <div className="shadow-2xl">
            <KonvaStage
              design={design}
              displayWidth={displayWidth}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={updateElement}
              stageRef={stageRef}
            />
          </div>
        </div>

        {/* Caption editor — appears after Generate */}
        {caption !== "" && (
          <div className="shrink-0 border-t border-white/8 bg-[#0b1620] p-4">
            <p className="mb-1 text-[10px] uppercase tracking-[0.15em] text-white/35">Caption</p>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              className="w-full resize-none rounded bg-[#0a141a] p-2 text-[12px] text-white/80 ring-1 ring-white/10 focus:outline-none focus:ring-1 focus:ring-gulf-teal/50"
            />
            {hashtags.length > 0 && (
              <p className="mt-1 text-[10px] text-white/40">
                {hashtags.map((h) => `#${h}`).join(" ")}
              </p>
            )}
            {Object.keys(variants).length > 0 && (
              <p className="mt-1 text-[10px] text-white/30">
                Variants: {Object.keys(variants).join(", ")}
              </p>
            )}
          </div>
        )}
      </div>

      {scheduleOpen && (
        <ScheduleSocialModal
          draft={
            {
              day: "mon",
              theme: "composed",
              caption,
              hashtags,
              card: { globalStyle: {}, blocks: [] },
              variants,
            } as unknown as SocialDraft
          }
          projectId={projectId}
          scopeKind={scope?.kind ?? null}
          scopeValue={scope?.value ?? null}
          mediaUrl={mediaUrl}
          design={design}
          onClose={() => setScheduleOpen(false)}
        />
      )}
    </div>
  );
}
