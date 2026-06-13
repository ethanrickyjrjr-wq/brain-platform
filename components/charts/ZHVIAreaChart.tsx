"use client";

import React, { useState, useMemo, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { motion, useInView, useReducedMotion } from "motion/react";
import { Calendar, HelpCircle, Eye, EyeOff, LineChart as ChartIcon, Sparkles } from "lucide-react";
import type { ZHVITrendEntry, MetroTrendEntry, ChartRow, ChartSeriesDef } from "@/types/viz";
import { formatChartValue, formatAsOf, type ValueFormat } from "@/lib/charts/format";
import { SWFL_METRO_SERIES } from "@/lib/charts/series";

export type { ZHVITrendEntry };

export interface MetroAreaChartProps {
  /**
   * Wide rows: a `month` ("YYYY-MM") plus one numeric column per series key.
   * Accepts the legacy 3-metro `MetroTrendEntry` too (recharts reads each
   * series by `dataKey` at runtime, so the component never indexes a row by
   * an arbitrary key in type-checked code).
   */
  data: Array<ChartRow | MetroTrendEntry>;
  /** Which lines to plot (key/label/color/dash). Defaults to the 3 SWFL metros. */
  series?: ChartSeriesDef[];
  loading?: boolean;
  className?: string;
  asOf?: string;
  /** Small uppercase eyebrow above the title. */
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  /**
   * Y-axis + tooltip value format, as a SERIALIZABLE TOKEN — never a function.
   * A Server Component renders this chart, and a function prop cannot cross the
   * RSC boundary (it aborts `next build`). See 07-charts-and-dataviz.md §6.
   */
  valueFormat?: ValueFormat;
  /** Trailing note in the "as of …" caption (e.g. "Sample data"). */
  asOfNote?: string;
  /** Empty-state heading + body. */
  emptyTitle?: string;
  emptyHint?: string;
  /** Root element id — must be unique so multiple charts on one page don't collide. */
  rootId?: string;
}

/** @deprecated Prefer {@link MetroAreaChart}; alias kept so ZHVI call sites are unchanged. */
export type ZHVIAreaChartProps = MetroAreaChartProps;

type TimeRangeOption = "6M" | "1Y" | "2Y" | "ALL";

const GRID = "#22414f"; // --gulf-haze
const AXIS_TEXT = "#807e76"; // --text-tertiary

export function MetroAreaChart({
  data,
  series = SWFL_METRO_SERIES,
  loading = false,
  className = "",
  asOf,
  eyebrow = "Southwest Florida",
  title = "Typical home value",
  subtitle = "Cape Coral · Fort Myers · Naples",
  valueFormat = "usd",
  asOfNote,
  emptyTitle = "No data yet",
  emptyHint = "Check back after the next refresh.",
  rootId = "metro-area-chart",
}: MetroAreaChartProps) {
  const [range, setRange] = useState<TimeRangeOption>("ALL");
  const containerRef = useRef<HTMLDivElement>(null);

  // Per-series visibility (toggle a line on/off). Keyed by series key so this
  // generalizes from 1 line (airport) to N (the metros).
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  // Draw-in reveal; respects prefers-reduced-motion (number is in the DOM
  // immediately, motion is the flourish — 02-motion-rules / 07 §4).
  const isInView = useInView(containerRef, { once: true, amount: 0.1 });
  const prefersReducedMotion = useReducedMotion();
  const revealed = isInView || prefersReducedMotion;

  // Unique clip id per chart instance — a shared id collides when several charts
  // render on one page (only the first would animate).
  const clipId = `drawin-${rootId}`;

  const formatValue = (value: number) => formatChartValue(valueFormat, value);

  // Sort chronologically and slice to the selected range.
  const sortedAndFilteredData = useMemo(() => {
    if (!data || data.length === 0) return [] as ChartRow[];
    const sorted = [...data].sort((a, b) => String(a.month).localeCompare(String(b.month)));
    switch (range) {
      case "6M":
        return sorted.slice(-6);
      case "1Y":
        return sorted.slice(-12);
      case "2Y":
        return sorted.slice(-24);
      case "ALL":
      default:
        return sorted;
    }
  }, [data, range]);

  // "YYYY-MM" → "Mon 'YY" axis tick.
  const formatXAxis = (tickItem: string) => {
    try {
      const [year, month] = String(tickItem).split("-");
      const date = new Date(parseInt(year), parseInt(month) - 1, 1);
      return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    } catch {
      return tickItem;
    }
  };

  // Loading skeleton.
  if (loading) {
    return (
      <div
        className={`p-4 sm:p-6 rounded-2xl bg-[#0f1d24] border border-[#22414f] flex flex-col gap-4 animate-pulse ${className}`}
      >
        <div className="flex justify-between items-center">
          <div className="space-y-2">
            <div className="h-6 w-52 bg-[#152832] rounded"></div>
            <div className="h-4 w-72 bg-[#152832] rounded"></div>
          </div>
          <div className="h-9 w-40 bg-[#152832] rounded"></div>
        </div>
        <div className="h-[280px] sm:h-[380px] w-full bg-[#0a1419] rounded border border-[#22414f]/40 mt-4"></div>
      </div>
    );
  }

  // Empty state.
  if (!data || data.length === 0) {
    return (
      <div
        className={`p-12 rounded-2xl bg-[#0f1d24] border border-[#22414f] flex flex-col items-center justify-center text-center gap-3 ${className}`}
      >
        <ChartIcon className="h-10 w-10 text-[#807e76]" />
        <h3 className="text-[#f0ede6] font-medium text-lg">{emptyTitle}</h3>
        <p className="text-[#807e76] text-sm max-w-sm">{emptyHint}</p>
      </div>
    );
  }

  const toggle = (key: string) => setHidden((prev) => ({ ...prev, [key]: !prev[key] }));
  const visibleSeries = series.filter((s) => !hidden[s.key]);
  const lastIndex = sortedAndFilteredData.length - 1;
  const captionParts = [asOf ? `as of ${formatAsOf(asOf)}` : null, asOfNote || null].filter(
    Boolean,
  );

  return (
    <div
      ref={containerRef}
      id={rootId}
      className={`p-4 sm:p-6 rounded-2xl bg-[#0f1d24] border border-[#22414f] text-[#f0ede6] shadow-xl select-none ${className}`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono font-medium uppercase tracking-wider text-[#3dc9c0]">
            <Sparkles className="h-3 w-3 text-[#3dc9c0]" />
            <span>{eyebrow}</span>
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-[#f0ede6] mt-1">{title}</h2>
          <p className="text-sm text-[#807e76] mt-0.5">{subtitle}</p>
        </div>

        {/* Time-range selector */}
        <div className="flex items-center bg-[#0a1419]/80 rounded-lg p-1 border border-[#22414f] select-none text-xs font-mono">
          {(["6M", "1Y", "2Y", "ALL"] as TimeRangeOption[]).map((opt) => (
            <button
              key={opt}
              onClick={() => setRange(opt)}
              className={`px-3 py-1.5 rounded transition-all duration-200 font-medium cursor-pointer ${
                range === opt
                  ? "bg-[#1c3340] text-[#f0ede6] shadow"
                  : "text-[#807e76] hover:text-[#f0ede6] hover:bg-[#152832]/40"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive legend — only when there is more than one line to toggle. */}
      {series.length > 1 && (
        <div className="flex flex-wrap gap-2 sm:gap-2.5 mb-6 bg-[#0a1419]/25 p-2 sm:p-3 rounded-xl border border-[#22414f]/40">
          {series.map((s) => {
            const on = !hidden[s.key];
            return (
              <button
                key={s.key}
                onClick={() => toggle(s.key)}
                className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border text-[10px] sm:text-xs font-mono font-medium transition-all duration-200 cursor-pointer"
                style={
                  on
                    ? {
                        backgroundColor: `${s.color}1a`,
                        borderColor: `${s.color}4d`,
                        color: s.color,
                      }
                    : {
                        backgroundColor: "transparent",
                        borderColor: "#22414f",
                        color: "#807e76",
                        textDecoration: "line-through",
                      }
                }
              >
                {on ? (
                  <Eye className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                ) : (
                  <EyeOff className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                )}
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Chart canvas */}
      <div className="w-full h-[280px] sm:h-[380px] bg-[#0a1419]/20 rounded-xl border border-[#22414f]/40 p-3 pt-6 relative overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={sortedAndFilteredData}
            margin={{ top: 10, right: 16, left: -10, bottom: 0 }}
          >
            <defs>
              {/* Framer Motion clipPath: a left-to-right draw-in reveal. */}
              <clipPath id={clipId}>
                <motion.rect
                  x="0"
                  y="0"
                  height="100%"
                  initial={{ width: 0 }}
                  animate={revealed ? { width: "100%" } : { width: 0 }}
                  transition={{ duration: 1.4, ease: "easeInOut" }}
                />
              </clipPath>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />

            <XAxis
              dataKey="month"
              tickFormatter={formatXAxis}
              stroke={GRID}
              tick={{ fill: AXIS_TEXT, fontSize: 10, fontFamily: "monospace" }}
              dy={10}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
            />

            <YAxis
              tickFormatter={formatValue}
              stroke={GRID}
              tick={{ fill: AXIS_TEXT, fontSize: 10, fontFamily: "monospace" }}
              dx={-5}
              domain={["auto", "auto"]}
              width={56}
              tickLine={false}
              axisLine={false}
            />

            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-[#0f1d24] border border-[#22414f] p-3 shadow-2xl rounded-lg text-xs space-y-1.5 font-mono">
                      <p className="text-[#807e76] font-semibold mb-1 flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-[#3dc9c0]" />
                        <span>{formatXAxis(String(label ?? ""))}</span>
                      </p>
                      <div className="h-px bg-[#22414f]" />
                      {payload.map((item: unknown, i) => {
                        const it = item as { stroke: string; name: string; value: number };
                        return (
                          <div key={i} className="flex items-center justify-between gap-6">
                            <span
                              style={{ color: it.stroke }}
                              className="font-sans flex items-center gap-1.5"
                            >
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: it.stroke }}
                              />
                              {it.name}
                            </span>
                            <span className="font-bold text-[#f0ede6] tracking-tight">
                              {formatValue(it.value)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                }
                return null;
              }}
            />

            {/* One clean line per visible series. Color + dash double-encode so
                the near-iso-luminant gulf palette stays distinguishable for
                colorblind readers (07 §2). No fill — a level is not a total. */}
            {visibleSeries.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                name={s.label}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dash ? s.dash : undefined}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                isAnimationActive={false}
                clipPath={`url(#${clipId})`}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Footer */}
      <div className="flex items-start gap-2 mt-4 bg-[#0a1419]/20 p-3 rounded-lg border border-[#22414f]/30 text-xs text-[#807e76]">
        <HelpCircle className="h-4 w-4 text-[#807e76] mt-0.5 flex-shrink-0" />
        <span>
          {series.length > 1
            ? "Lines are interactive — toggle a place above to isolate it. "
            : "Hover any point for the exact figure. "}
          Showing <strong className="text-[#f0ede6]">{range}</strong>.
        </span>
      </div>
      {lastIndex >= 0 && captionParts.length > 0 && (
        <p className="mt-2 font-mono text-[11px] tracking-wide" style={{ color: AXIS_TEXT }}>
          {captionParts.join(" · ")}
        </p>
      )}
    </div>
  );
}

// Back-compat alias: existing call sites (embed/demo/registry frame) import
// `ZHVIAreaChart` and pass only data/loading/asOf; the prop defaults above
// reproduce the 3-metro SWFL look (now in the gulf palette).
export const ZHVIAreaChart = MetroAreaChart;
