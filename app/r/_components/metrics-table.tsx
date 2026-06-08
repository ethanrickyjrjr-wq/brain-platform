"use client";

import type { ReactNode } from "react";
import { classifyFact } from "@/lib/highlighter/use-highlight";
import { useHighlighterContext } from "@/lib/highlighter/context";
import { FactChip } from "@/components/highlighter/FactChip";

/**
 * Shared metric rendering + the color system for every /r/ report.
 *
 * TWO rules, locked by the operator:
 *  1. VALUE wears its DIRECTION color, so the number and its trend read as one
 *     unit. A figure with no trend signal = teal — it's ours (SWFL Data Gulf).
 *       rising / bullish  → mangrove      #5bc97a
 *       falling / bearish → sunset coral  #e08158
 *       mixed             → mixed gold    #d4b370
 *       stable            → muted gray    #b8b4a8
 *       no signal         → teal (ours)   #00d4aa
 *  2. SOURCE links are colored by ORIGIN: teal = SWFL Data Gulf (our own /r/
 *     pages / data), blue #60a5fa = an outside website (City Pulse, news,
 *     FRED, Census, …). Identical rule for metric provenance AND WEB-N
 *     citations, so "ours vs outside" never crosses wires.
 *
 * The ColorLegend at the page foot states it: SWFL Data Gulf (teal) · Websites
 * (blue). Hexes live here so a swap is one place.
 */

const DIRECTION_CONFIG: Record<string, { label: string; className: string }> = {
  rising: { label: "↑ Rising", className: "text-[#5bc97a]" },
  bullish: { label: "↑ Bullish", className: "text-[#5bc97a]" },
  falling: { label: "↓ Falling", className: "text-[#e08158]" },
  bearish: { label: "↓ Bearish", className: "text-[#e08158]" },
  mixed: { label: "→ Mixed", className: "text-[#d4b370]" },
  stable: { label: "→ Stable", className: "text-[#b8b4a8]" },
  neutral: { label: "→ Neutral", className: "text-[#b8b4a8]" },
};

/** The one state color a metric's value and its trend badge share. No
 *  direction signal → teal: it's our own SWFL Data Gulf figure. */
export function directionClassName(direction: string | null): string {
  if (!direction) return "text-[#00d4aa]";
  return DIRECTION_CONFIG[direction]?.className ?? "text-[#00d4aa]";
}

export interface MetricRow {
  label: string;
  value: ReactNode;
  direction: string | null;
  /** Source the figure is verified against. */
  sourceUrl?: string | null;
  /** Link text (defaults to "Source"). */
  sourceLabel?: ReactNode;
}

/** Trend pill — same color the value wears. Unknown values fall back to the
 *  raw string so we never blank out a real trend. */
export function DirectionBadge({ direction }: { direction: string | null }) {
  if (!direction) return <span className="text-[#807e76]">—</span>;
  const cfg = DIRECTION_CONFIG[direction];
  if (!cfg) return <span className="text-[#b8b4a8]">{direction}</span>;
  return <span className={`text-xs font-medium ${cfg.className}`}>{cfg.label}</span>;
}

/** One source-link style, colored by where the data comes FROM:
 *  - TEAL (default) = data we INGEST into the lake — FRED, permits, Census,
 *    FDOT, NFIP, CRE, … i.e. SWFL Data Gulf data. Every metric's provenance.
 *  - BLUE (`web`) = City Pulse / LLM current-data sources we do NOT ingest.
 *  Same rule for metric provenance and City-Pulse citations. */
export function SourceLink({
  url,
  label = "Source",
  web = false,
}: {
  url?: string | null;
  label?: ReactNode;
  web?: boolean;
}) {
  if (!url) return <span className="text-[#807e76]">—</span>;
  const cls = web
    ? "text-[#60a5fa] decoration-[#60a5fa]/40 hover:decoration-[#60a5fa]"
    : "text-[#00d4aa] decoration-[#00d4aa]/40 hover:decoration-[#00d4aa]";
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`underline underline-offset-2 ${cls}`}
    >
      {label}
    </a>
  );
}

/**
 * Renders the value cell for one metric row.
 *
 * When HighlighterContext is available (HighlighterProvider is an ancestor) and
 * the value is a plain string, wraps it in a FactChip so mobile users get a
 * large tap target. The chip passes the row label as `context` so the popup
 * shows e.g. "Arts, Entertainment & Recreation — 100.00%" not bare "100.00%".
 *
 * Falls back to a plain <span> when the provider is absent (Highlighter flag
 * off) or when the value is already a ReactNode (not a string).
 */
function MetricValueCell({
  value,
  direction,
  label,
}: {
  value: ReactNode;
  direction: string | null;
  label: string;
}) {
  const ctx = useHighlighterContext();
  const colorCls = directionClassName(direction);

  if (ctx && typeof value === "string") {
    return (
      // Outer span carries font-mono + direction color; FactChip (a <button>)
      // sits inline and adds the dotted teal underline + tap-target padding.
      // The button's default padding gives ~36px height; adding py-1 lifts it
      // to ≥44px on mobile to meet the WCAG 2.5.5 touch-target guidance.
      <span className={`font-mono ${colorCls}`}>
        <FactChip
          value={value}
          factType={classifyFact(value)}
          context={label}
          onActivate={ctx.onActivate}
        />
      </span>
    );
  }

  return <span className={`font-mono ${colorCls}`}>{value}</span>;
}

/** Metric · Value · Trend · Source table. The value cell inherits the row's
 *  direction color; the source link colors itself by origin. */
export function MetricsTable({
  metrics,
  trendLabel = "Direction",
}: {
  metrics: MetricRow[];
  trendLabel?: string;
}) {
  if (metrics.length === 0) return null;
  return (
    <div className="mt-4 overflow-x-auto rounded-xl glass-card-modern border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-gray-400">
          <tr>
            <th className="px-4 py-3">Metric</th>
            <th className="px-4 py-3 text-right">Value</th>
            <th className="px-4 py-3">{trendLabel}</th>
            <th className="px-4 py-3">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {metrics.map((m, i) => (
            <tr key={i}>
              <td className="px-4 py-3 align-top font-medium text-white">{m.label}</td>
              <td className="px-4 py-3 text-right align-top">
                <MetricValueCell value={m.value} direction={m.direction} label={m.label} />
              </td>
              <td className="px-4 py-3 align-top">
                <DirectionBadge direction={m.direction} />
              </td>
              <td className="px-4 py-3 align-top text-xs text-gray-500">
                <SourceLink url={m.sourceUrl} label={m.sourceLabel ?? "Source"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Label / value row for compact stat lists (the per-ZIP report). The value
 *  wears the color of its trend, passed as `valueClassName` (computed from the
 *  same polarity the badge uses); no trend → teal (ours). An optional trailing
 *  `badge` node keeps its own color. */
export function DataRow({
  label,
  value,
  badge,
  valueClassName = "text-[#00d4aa]",
}: {
  label: string;
  value: ReactNode;
  badge?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <dt className="text-gray-400">{label}</dt>
      <dd className="flex items-center gap-2 text-right font-mono">
        <span className={valueClassName}>{value}</span>
        {badge}
      </dd>
    </div>
  );
}
