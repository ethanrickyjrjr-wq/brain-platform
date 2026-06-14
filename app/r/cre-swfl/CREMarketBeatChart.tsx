"use client";

import { Component, useMemo, useState, type ReactNode } from "react";
import { HBarChart, type HBarCorridor } from "@/components/charts/HBarChart";
import type { ChartValueFormat } from "@/refinery/validate/chart-block-lint.mts";
import { medianOf } from "@/lib/stats";
import { tierFor } from "@/refinery/lib/chart-adapter.mts";
import {
  MARKET_BEAT_CITIES,
  METRIC_TYPES,
  SECTORS,
  type CREMetricType,
  type CRESector,
  type MBCityMetric,
} from "./cre-metrics";

/** Local boundary: a chart render fault degrades to nothing, never the page. */
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const VALUE_FORMAT: Record<CREMetricType, ChartValueFormat> = {
  vacancy: "percent",
  rent: "currency",
  absorption: "count",
};

/**
 * CREMarketBeatChart — the "Market Beat" bar chart.
 *
 * Title reads "Market Beat" (large); the eyebrow names the inputs MarketBeat
 * reports (Vacancy · Asking Rent NNN · Net Absorption). Sector tabs flip the
 * whole chart between Retail / Office / Industrial; a metric toggle picks which
 * of the three inputs is plotted. The left axis is always the six city totals
 * (Naples, Bonita Springs, Estero, Fort Myers, Cape Coral, Lehigh Acres) — never
 * individual corridors.
 */
export function CREMarketBeatChart({ metrics }: { metrics: MBCityMetric[] }) {
  const [sector, setSector] = useState<CRESector>("retail");
  const [metricType, setMetricType] = useState<CREMetricType>("vacancy");

  const corridors: HBarCorridor[] = useMemo(() => {
    // Pull each city's value for the active sector + metric…
    const picked: { city: string; value: number }[] = [];
    for (const city of MARKET_BEAT_CITIES) {
      const hit = metrics.find(
        (m) =>
          m.city === city &&
          m.sector === sector &&
          m.metricType === metricType &&
          m.valueNum !== null,
      );
      if (hit && hit.valueNum !== null) picked.push({ city, value: hit.valueNum });
    }
    // …then rank by the number (largest on top) so the order actually changes
    // when you flip sector / metric — it is NOT a fixed city list.
    picked.sort((a, b) => b.value - a.value);
    const median = medianOf(picked.map((p) => p.value)) ?? 0;
    return picked.map((p) => ({
      name: p.city,
      value: p.value,
      tier: tierFor(p.value, median),
    }));
  }, [metrics, sector, metricType]);

  const values = corridors.map((c) => c.value);
  const median = medianOf(values) ?? 0;
  const range = {
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
  };

  const metricMeta = METRIC_TYPES.find((m) => m.key === metricType)!;
  // Eyebrow = the equation inputs MarketBeat uses to read each sector.
  const eyebrow = "Vacancy · Asking Rent NNN · Net Absorption";

  return (
    <section className="mt-10" aria-label="Market Beat chart">
      {/* Sector tabs — interactive chrome, hidden in print */}
      <div role="tablist" aria-label="Sector" className="mb-3 flex flex-wrap gap-2 print-hide">
        {SECTORS.map((s) => {
          const active = s.key === sector;
          return (
            <button
              key={s.key}
              role="tab"
              aria-selected={active}
              onClick={() => setSector(s.key)}
              className={[
                "rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
                active
                  ? "border-[#0a8078] bg-[#0a8078]/10 text-[#0a8078]"
                  : "border-white/15 bg-white/[0.04] text-gray-400 hover:text-gray-200 hover:border-white/30",
              ].join(" ")}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Metric toggle — interactive chrome, hidden in print */}
      <div role="tablist" aria-label="Metric" className="mb-4 flex flex-wrap gap-2 print-hide">
        {METRIC_TYPES.map((m) => {
          const active = m.key === metricType;
          return (
            <button
              key={m.key}
              role="tab"
              aria-selected={active}
              onClick={() => setMetricType(m.key)}
              className={[
                "rounded-md border px-3 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "border-[#0a8078]/60 bg-[#0a8078]/[0.08] text-[#0a8078]"
                  : "border-white/10 bg-white/[0.02] text-gray-500 hover:text-gray-300",
              ].join(" ")}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <ChartBoundary>
        {corridors.length > 0 ? (
          <HBarChart
            key={`${sector}-${metricType}`}
            title="Market Beat"
            eyebrow={eyebrow}
            corridors={corridors}
            median={median}
            range={range}
            valueFormat={VALUE_FORMAT[metricType]}
            tooltipMetricLabel={metricMeta.short}
          />
        ) : (
          <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-6 text-center text-sm text-gray-500">
            No {SECTORS.find((s) => s.key === sector)!.label.toLowerCase()}{" "}
            {metricMeta.short.toLowerCase()} data for these cities this period.
          </p>
        )}
      </ChartBoundary>
    </section>
  );
}

export default CREMarketBeatChart;
