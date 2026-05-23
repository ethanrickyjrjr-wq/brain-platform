"use client";

/**
 * CorridorRentChart
 *
 * Horizontal bar chart — 26 SWFL corridors ranked by NNN asking rent ($/sqft).
 * Bars animate left-to-right on scroll-enter using Anime.js v4 onscroll.
 * Color gradient: cool blue (low rent) → warm amber (high rent).
 * Clicking a bar reveals a detail card below.
 *
 * DEV: implement using echarts-for-react.
 * Install: npm install echarts echarts-for-react
 *
 * Animation: Anime.js v4 onScroll — fire animateIn() when the chart
 * container enters the viewport. Respect the ANIMATE flag from
 * localStorage("swfl.animations") and prefers-reduced-motion.
 *
 * Stagger: 30ms per bar via ECharts animationDelay callback.
 */

import type { CorridorEntry } from "@/types/viz";

export interface CorridorRentChartProps {
  data: CorridorEntry[];
  loading?: boolean;
  className?: string;
}

export function CorridorRentChart({
  data,
  loading = false,
  className,
}: CorridorRentChartProps) {
  // TODO: implement
  // 1. Sort data by nnn_asking_rent_per_sqft descending
  // 2. Build ECharts option with horizontal bar series
  // 3. animationDelay: (idx) => idx * 30
  // 4. Color: interpolate between #2A8C85 (low) and #D4B370 (high)
  // 5. Wrap in anime.js onScroll trigger on the container ref
  // 6. On bar click: set selected corridor id, render detail card below chart
  // 7. Handle loading state with a skeleton that matches chart height

  if (loading) {
    return (
      <div
        className={`h-96 animate-pulse rounded bg-[#152832] ${className ?? ""}`}
      />
    );
  }

  return (
    <div className={className}>
      <p className="font-mono text-xs text-[#807E76]">
        CorridorRentChart — awaiting implementation
      </p>
      <p className="font-mono text-xs text-[#807E76]">
        {data.length} corridors loaded
      </p>
    </div>
  );
}
