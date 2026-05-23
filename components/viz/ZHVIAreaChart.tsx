"use client";

/**
 * ZHVIAreaChart
 *
 * Multi-line area chart — Cape Coral, Fort Myers, Naples ZHVI over 36 months.
 * SVG path draws in left-to-right on scroll-enter using Anime.js v4 createDrawable.
 * Each line has a gradient fill (color → transparent downward).
 * A time-range slider below the chart filters the visible window (min 6 months).
 * On slider drag: chart transitions with 300ms eases.outCubic.
 *
 * DEV: implement using recharts ResponsiveContainer + AreaChart.
 * Install: npm install recharts
 *
 * Colors (from design system):
 *   cape_coral → #3DC9C0  (gulf-teal)
 *   fort_myers → #D4B370  (neutral-gold)
 *   naples     → #5BC97A  (mangrove)
 *
 * Animation: Anime.js v4 svg.createDrawable on the SVG path refs.
 * Scroll trigger: onScroll enter fires the draw sequence.
 * pathLength from 0 → 1, duration 1000ms, eases.outQuart.
 */

import type { ZHVIMonth } from "@/types/viz";

export interface ZHVIAreaChartProps {
  data: ZHVIMonth[];
  loading?: boolean;
  className?: string;
}

export function ZHVIAreaChart({
  data,
  loading = false,
  className,
}: ZHVIAreaChartProps) {
  // TODO: implement
  // 1. Default: show all 36 months. Slider controls start/end index.
  // 2. Three <Area> series: cape_coral, fort_myers, naples
  // 3. <defs><linearGradient> for each series fill
  // 4. Custom tooltip: format value as $XXX,XXX, show month label
  // 5. Handle null values in data (skip that point, don't break the line)
  // 6. Slider: range input or react-slider, updates state, chart re-renders
  //    with 300ms animated transition (recharts animationDuration prop)
  // 7. Source citation below: "Source: Zillow ZHVI · ZIP 33914 / 33908 / 34103 · Apr 2026"

  if (loading) {
    return (
      <div
        className={`h-72 animate-pulse rounded bg-[#152832] ${className ?? ""}`}
      />
    );
  }

  return (
    <div className={className}>
      <p className="font-mono text-xs text-[#807E76]">
        ZHVIAreaChart — awaiting implementation
      </p>
      <p className="font-mono text-xs text-[#807E76]">
        {data.length} months loaded
      </p>
    </div>
  );
}
