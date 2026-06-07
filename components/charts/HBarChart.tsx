"use client";

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { formatChartValue } from "@/refinery/lib/chart-adapter.mts";
import type { ChartValueFormat } from "@/refinery/validate/chart-block-lint.mts";

export type HBarTier = "bullish" | "neutral" | "bearish";

export type HBarCorridor = {
  name: string;
  /** Optional secondary label shown below `name` (e.g. city name under a ZIP). */
  subLabel?: string;
  value: number;
  tier: HBarTier;
};

export type HBarTierColors = {
  bullish?: string;
  neutral?: string;
  bearish?: string;
};

export type HBarChartProps = {
  title: string;
  corridors: HBarCorridor[];
  median: number;
  range: { min: number; max: number };
  eyebrow?: string;
  separatorAfter?: number;
  separatorLabel?: string;
  detailHref?: string;
  detailLabel?: string;
  /** Override tier fill colors. Defaults to platform teal/amber. */
  tierColors?: HBarTierColors;
  /**
   * Format the numeric value for display. Defaults to $X.XX.
   * NOTE: a function prop can only be passed from another Client Component.
   * Server Components (e.g. the /embed/charts page) must use `valueFormat`
   * instead — a function cannot cross the RSC→client boundary at prerender.
   */
  formatValue?: (v: number) => string;
  /**
   * Serializable formatter selector for Server-Component callers, mapped by
   * `formatChartValue`: "currency" → $X.XX (default), "usd" → $X,XXX,
   * "aal" → $X,XXX/yr, "percent" → X.X%, "count" → X,XXX, "number" → X.XX.
   * Ignored when `formatValue` is supplied.
   */
  valueFormat?: ChartValueFormat;
  /** Label shown in tooltip for the primary metric row. Defaults to "Asking Rent". */
  tooltipMetricLabel?: string;
};

type TooltipState = {
  visible: boolean;
  x: number;
  y: number;
  corridor: HBarCorridor | null;
};

const ANIM_DURATION = 0.75;
const ANIM_STAGGER = 0.11;

export function HBarChart({
  title,
  corridors,
  median,
  range,
  eyebrow,
  separatorAfter,
  separatorLabel,
  detailHref,
  detailLabel,
  tierColors,
  formatValue,
  valueFormat = "currency",
  tooltipMetricLabel = "Asking Rent",
}: HBarChartProps) {
  const fmt = formatValue ?? ((v: number) => formatChartValue(valueFormat, v));
  const scopeRef = useRef<HTMLDivElement>(null);
  const fillRefs = useRef<(HTMLDivElement | null)[]>([]);
  const valueRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    corridor: null,
  });
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const fills = fillRefs.current.filter(
        (el): el is HTMLDivElement => el !== null,
      );
      const pcts = corridors.map((c) => (c.value / range.max) * 100);

      gsap.fromTo(
        fills,
        { width: 0 },
        {
          width: (i) => `${pcts[i]}%`,
          duration: ANIM_DURATION,
          ease: "power2.out",
          stagger: ANIM_STAGGER,
        },
      );

      corridors.forEach((c, i) => {
        const valEl = valueRefs.current[i];
        if (!valEl) return;
        const proxy = { v: 0 };
        gsap.to(proxy, {
          v: c.value,
          duration: ANIM_DURATION,
          ease: "power2.out",
          delay: i * ANIM_STAGGER,
          onUpdate: () => {
            valEl.textContent = fmt(proxy.v);
          },
        });
      });
    }, scopeRef);

    return () => ctx.revert();
  }, [corridors, range.max]);

  const handleEnter = (idx: number) => (e: React.MouseEvent) => {
    setHoveredIdx(idx);
    setTooltip({
      visible: true,
      x: e.clientX + 14,
      y: e.clientY - 48,
      corridor: corridors[idx],
    });
  };

  const handleMove = (e: React.MouseEvent) => {
    setTooltip((prev) =>
      prev.visible ? { ...prev, x: e.clientX + 14, y: e.clientY - 48 } : prev,
    );
  };

  const handleLeave = () => {
    setHoveredIdx(null);
    setTooltip((prev) => ({ ...prev, visible: false }));
  };

  const tipCorr = tooltip.corridor;
  const tipDiff = tipCorr ? tipCorr.value - median : 0;
  const tipSign = tipDiff >= 0 ? "+" : "−";

  const cssVars = {
    "--color-bullish": tierColors?.bullish ?? "#5bc97a",
    "--color-bullish-glow": tierColors?.bullish
      ? `${tierColors.bullish}72`
      : "rgba(91, 201, 122, 0.45)",
    "--color-neutral": tierColors?.neutral ?? "rgba(184, 180, 168, 0.45)",
    "--color-bearish": tierColors?.bearish ?? "#e08158",
    "--color-bearish-glow": tierColors?.bearish
      ? `${tierColors.bearish}72`
      : "rgba(224, 129, 88, 0.45)",
  } as React.CSSProperties;

  return (
    <div ref={scopeRef} className="hbarchart-root" style={cssVars}>
      <div className="hbarchart-card">
        <div className="hbarchart-eyebrow">
          {eyebrow ?? `${corridors.length} corridors`}
        </div>
        <div className="hbarchart-title">{title}</div>
        <div
          className={`hbarchart-list${hoveredIdx !== null ? " has-hover" : ""}`}
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
        >
          {corridors.map((c, i) => {
            const pct = (c.value / range.max) * 100;
            const showSeparator =
              typeof separatorAfter === "number" &&
              separatorLabel &&
              i + 1 === separatorAfter;
            return (
              <Fragment key={c.name}>
                <div
                  className={`hbarchart-row${hoveredIdx === i ? " hovered" : ""}`}
                  onMouseEnter={handleEnter(i)}
                >
                  <div className="hbarchart-label">
                    <span className="hbarchart-label-primary">{c.name}</span>
                    {c.subLabel && (
                      <span className="hbarchart-label-sub">{c.subLabel}</span>
                    )}
                  </div>
                  <div className="hbarchart-track">
                    <div
                      ref={(el) => {
                        fillRefs.current[i] = el;
                      }}
                      className={`hbarchart-fill hbarchart-fill-${c.tier}`}
                      data-pct={pct.toFixed(2)}
                    />
                  </div>
                  <div
                    ref={(el) => {
                      valueRefs.current[i] = el;
                    }}
                    className="hbarchart-value"
                  >
                    $0.00
                  </div>
                </div>
                {showSeparator && (
                  <div className="hbarchart-separator" aria-hidden="true">
                    <span className="hbarchart-separator-label">
                      {separatorLabel}
                    </span>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
        <div className="hbarchart-footer">
          <span>
            Median {fmt(median)} &nbsp;·&nbsp; range {fmt(range.min)}–
            {fmt(range.max)}
          </span>
          {detailHref && detailLabel && (
            <a className="hbarchart-detail-link" href={detailHref}>
              {detailLabel}
            </a>
          )}
        </div>
      </div>

      {tipCorr && (
        <div
          className={`hbarchart-tooltip${tooltip.visible ? " visible" : ""}`}
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="hbarchart-tooltip-name">{tipCorr.name}</div>
          <div className="hbarchart-tooltip-row">
            <span>{tooltipMetricLabel}</span>
            <span>{fmt(tipCorr.value)}</span>
          </div>
          <div className="hbarchart-tooltip-row">
            <span>Tier</span>
            <span>
              {tipCorr.tier.charAt(0).toUpperCase() + tipCorr.tier.slice(1)}
            </span>
          </div>
          <div className="hbarchart-tooltip-row">
            <span>vs Median</span>
            <span>
              {tipSign}
              {fmt(Math.abs(tipDiff))}
            </span>
          </div>
        </div>
      )}

      <style jsx>{`
        .hbarchart-root {
          --muted-txt: rgba(255, 255, 255, 0.38);
          --label-txt: #3ecfb2;
          --label-sub-txt: rgba(62, 207, 178, 0.62);
          --value-txt: #3ecfb2;
          --meta-txt: rgba(62, 207, 178, 0.6);
          width: 100%;
          display: flex;
          justify-content: center;
        }

        .hbarchart-card {
          background: #162030;
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 12px;
          /* Fluid padding so the card breathes on desktop but tightens on
             narrow phones; upper bounds equal the original 28/32/22. */
          padding: clamp(16px, 5vw, 28px) clamp(16px, 6vw, 32px)
            clamp(14px, 4vw, 22px);
          width: 100%;
          max-width: 620px;
          /* Was a hard 320px floor that clipped below it. Fluid now: the row
             grid (below) clamps its side columns so bars never clip < 320px. */
          min-width: 0;
          font-family:
            var(--font-plex-sans),
            "IBM Plex Sans",
            ui-sans-serif,
            system-ui,
            -apple-system,
            sans-serif;
        }

        .hbarchart-eyebrow {
          font-family:
            var(--font-plex-mono), "IBM Plex Mono", ui-monospace,
            SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          color: var(--muted-txt);
          text-transform: uppercase;
          margin-bottom: 6px;
        }

        .hbarchart-title {
          font-size: 20px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 24px;
          letter-spacing: -0.01em;
        }

        .hbarchart-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .hbarchart-row {
          display: grid;
          /* Side columns clamp down on narrow viewports so the bar track keeps
             room and never clips < 320px; upper bounds equal the original
             148px / 76px, so desktop layout is unchanged. */
          grid-template-columns:
            clamp(84px, 28vw, 148px) minmax(0, 1fr)
            clamp(52px, 18vw, 76px);
          align-items: center;
          gap: clamp(8px, 2vw, 12px);
          padding: 6px 0;
          border-radius: 4px;
          transition: opacity 0.2s;
        }

        .hbarchart-label {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
          transition: color 0.2s;
        }

        .hbarchart-label-primary {
          font-size: 13.5px;
          font-weight: 700;
          color: var(--label-txt);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: -0.01em;
          font-family:
            var(--font-plex-mono), "IBM Plex Mono", ui-monospace,
            SFMono-Regular, Menlo, monospace;
        }

        .hbarchart-label-sub {
          font-size: 10.5px;
          font-weight: 500;
          color: var(--label-sub-txt);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: 0.01em;
        }

        .hbarchart-track {
          position: relative;
          height: 24px;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 3px;
          overflow: hidden;
        }

        .hbarchart-fill {
          position: absolute;
          inset: 0 auto 0 0;
          width: 0%;
          border-radius: 3px;
          transition:
            filter 0.25s,
            opacity 0.25s;
        }

        .hbarchart-fill-bullish {
          background: var(--color-bullish);
          box-shadow: 0 0 10px var(--color-bullish-glow);
        }

        .hbarchart-fill-neutral {
          background: var(--color-neutral);
          box-shadow: none;
        }

        .hbarchart-fill-bearish {
          background: var(--color-bearish);
          box-shadow: 0 0 10px var(--color-bearish-glow);
        }

        .hbarchart-value {
          font-family:
            var(--font-plex-mono), "IBM Plex Mono", ui-monospace,
            SFMono-Regular, Menlo, monospace;
          font-size: 13.5px;
          font-weight: 700;
          color: var(--value-txt);
          text-align: right;
          letter-spacing: 0.01em;
          white-space: nowrap;
        }

        .hbarchart-list.has-hover .hbarchart-row {
          opacity: 0.35;
        }
        .hbarchart-list.has-hover .hbarchart-row.hovered {
          opacity: 1;
        }
        .hbarchart-list.has-hover .hbarchart-row.hovered .hbarchart-fill {
          filter: brightness(1.25);
        }
        .hbarchart-list.has-hover .hbarchart-separator {
          opacity: 0.35;
        }

        .hbarchart-separator {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 4px 0;
          transition: opacity 0.2s;
        }
        .hbarchart-separator::before,
        .hbarchart-separator::after {
          content: "";
          flex: 1;
          border-top: 1px dashed rgba(255, 255, 255, 0.12);
        }
        .hbarchart-separator-label {
          font-family:
            var(--font-plex-mono), "IBM Plex Mono", ui-monospace,
            SFMono-Regular, Menlo, monospace;
          font-size: 10.5px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted-txt);
          white-space: nowrap;
        }

        .hbarchart-tooltip {
          position: fixed;
          background: #1c2e3f;
          border: 1px solid rgba(62, 207, 178, 0.3);
          border-radius: 8px;
          padding: 10px 14px;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.15s;
          z-index: 100;
          min-width: 180px;
          font-family:
            var(--font-plex-sans),
            "IBM Plex Sans",
            ui-sans-serif,
            system-ui,
            -apple-system,
            sans-serif;
        }
        .hbarchart-tooltip.visible {
          opacity: 1;
        }
        .hbarchart-tooltip-name {
          font-size: 12px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 4px;
        }
        .hbarchart-tooltip-row {
          display: flex;
          justify-content: space-between;
          font-family:
            var(--font-plex-mono), "IBM Plex Mono", ui-monospace,
            SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          color: var(--muted-txt);
        }
        .hbarchart-tooltip-row span:last-child {
          color: var(--teal);
        }

        .hbarchart-footer {
          margin-top: 18px;
          padding-top: 14px;
          border-top: 1px dashed rgba(255, 255, 255, 0.1);
          font-family:
            var(--font-plex-mono), "IBM Plex Mono", ui-monospace,
            SFMono-Regular, Menlo, monospace;
          font-size: 11.5px;
          color: var(--meta-txt);
          letter-spacing: 0.02em;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .hbarchart-detail-link {
          color: var(--teal);
          text-decoration: none;
          font-weight: 600;
          transition: opacity 0.15s;
        }
        .hbarchart-detail-link:hover {
          opacity: 0.75;
        }
      `}</style>
    </div>
  );
}

export default HBarChart;
