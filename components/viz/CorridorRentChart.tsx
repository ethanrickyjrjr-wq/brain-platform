"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import * as echarts from "echarts";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  MapPin,
  TrendingUp,
  Info,
  Activity,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import type { JoinedCorridorRow } from "@/types/viz";

export type { JoinedCorridorRow };

// Narrowed view for the rent chart: rent + vacancy non-null. Permits / centroid
// stay optional — side-panel render handles missing values.
type RentChartRow = JoinedCorridorRow & {
  nnn_asking_rent_per_sqft: number;
  vacancy_pct: number;
};

// Register ScrollTrigger safely
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export interface CorridorRentChartProps {
  data: JoinedCorridorRow[];
  loading?: boolean;
  className?: string;
}

// Utility to parse and interpolate colors between cool teal (#2A8C85) and warm amber (#D4B370)
function interpolateColor(
  color1: string,
  color2: string,
  factor: number,
): string {
  const parseHex = (hex: string) => {
    const val = parseInt(hex.replace("#", ""), 16);
    return {
      r: (val >> 16) & 255,
      g: (val >> 8) & 255,
      b: val & 255,
    };
  };

  const c1 = parseHex(color1);
  const c2 = parseHex(color2);

  const r = Math.round(c1.r + factor * (c2.r - c1.r));
  const g = Math.round(c1.g + factor * (c2.g - c1.g));
  const b = Math.round(c1.b + factor * (c2.b - c1.b));

  return `rgb(${r}, ${g}, ${b})`;
}

export function CorridorRentChart({
  data,
  loading = false,
  className = "",
}: CorridorRentChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Sort data by NNN asking rent descending. Rent + vacancy are the chart's
  // primary axes — null-filter on those. Permits / centroid stay optional;
  // side-panel rendering handles missing values per Collier rows.
  const sortedData = useMemo<RentChartRow[]>(() => {
    return [...data]
      .filter(
        (c): c is RentChartRow =>
          c.nnn_asking_rent_per_sqft != null && c.vacancy_pct != null,
      )
      .sort((a, b) => b.nnn_asking_rent_per_sqft - a.nnn_asking_rent_per_sqft);
  }, [data]);

  // Find currently selected corridor details
  const selectedCorridor = useMemo(() => {
    if (!selectedId) return sortedData[0] || null;
    return sortedData.find((c) => c.id === selectedId) || sortedData[0] || null;
  }, [selectedId, sortedData]);

  // Set default selected item once data loads
  useEffect(() => {
    if (sortedData.length > 0 && !selectedId) {
      setSelectedId(sortedData[0].id);
    }
  }, [sortedData, selectedId]);

  // 2. Initialize ECharts & orchestrate GSAP ScrollTrigger stagger animation
  useEffect(() => {
    if (loading || sortedData.length === 0 || !chartRef.current) return;

    // Dispose of any existing chart instance to avoid leaks
    if (chartInstance.current) {
      chartInstance.current.dispose();
    }

    // Colors mapping
    const lowColor = "#2A8C85"; // Cool teal
    const highColor = "#D4B370"; // Warm sand/amber
    const barColors = sortedData.map((_, index) => {
      // Map highest rent (index 0) to factor 1, lowest to 0
      const factor =
        sortedData.length > 1
          ? (sortedData.length - 1 - index) / (sortedData.length - 1)
          : 1;
      return interpolateColor(lowColor, highColor, factor);
    });

    const myChart = echarts.init(chartRef.current, "dark");
    chartInstance.current = myChart;

    // Initial silent options structure with 0 values for GSAP to animate up
    const initialChartOptions: echarts.EChartsOption = {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "#0f172a",
        borderColor: "#1e293b",
        borderWidth: 1,
        textStyle: { color: "#f8fafc", fontFamily: "inherit" },
        padding: [10, 14],
        formatter: (params: any) => {
          const idx = params[0].dataIndex;
          const entry = sortedData[idx];
          return `
            <div style="display:flex;flex-direction:column;gap:4px;">
              <p style="font-weight:600;font-size:13px;color:#f8fafc;margin:0;">${entry.name}</p>
              <p style="font-size:11px;color:#94a3b8;font-family:monospace;margin:0;">${entry.submarket}</p>
              <div style="height:1px;background:#1e293b;margin:2px 0;"></div>
              <p style="font-size:11px;color:rgb(212,179,112);font-family:monospace;margin:0;">NNN Rent: <strong>$${entry.nnn_asking_rent_per_sqft.toFixed(2)}</strong> / sqft</p>
              <p style="font-size:11px;color:#cbd5e1;font-family:monospace;margin:0;">Vacancy: <strong>${entry.vacancy_pct}%</strong></p>
            </div>
          `;
        },
      },
      grid: {
        left: "4%",
        right: "6%",
        bottom: "4%",
        top: "4%",
        containLabel: true,
      },
      xAxis: {
        type: "value",
        position: "bottom",
        splitLine: {
          lineStyle: {
            color: "#1e293b",
            type: "dashed",
          },
        },
        axisLabel: {
          formatter: "${value}",
          color: "#94a3b8",
          fontFamily: "monospace",
          fontSize: 11,
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: "category",
        data: sortedData.map((item) => item.name),
        inverse: true, // Display top rent at the top
        axisLine: {
          lineStyle: { color: "#334155" },
        },
        axisTick: { show: false },
        axisLabel: {
          color: "#cbd5e1",
          fontSize: 12,
          fontWeight: 500,
          formatter: (value: string) => {
            // Trim label if too long for responsiveness
            return value.length > 20 ? `${value.slice(0, 18)}...` : value;
          },
        },
      },
      series: [
        {
          name: "NNN Rent",
          type: "bar",
          data: new Array(sortedData.length).fill(0), // Initial state
          barWidth: "60%",
          itemStyle: {
            borderRadius: [0, 4, 4, 0],
            color: (params: any) => barColors[params.dataIndex],
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0,0,0,0.5)",
            },
          },
        },
      ],
    };

    myChart.setOption(initialChartOptions);

    // Create selection listener on bars
    myChart.on("click", (params: any) => {
      if (params.componentType === "series") {
        const index = params.dataIndex;
        const entry = sortedData[index];
        if (entry) {
          setSelectedId(entry.id);
        }
      }
    });

    // 3. GSAP ScrollTrigger to stagger-in bar sizes smoothly on viewport enter
    const targets = sortedData.map((_, i) => ({ val: 0, index: i }));

    // Detect user styling / accessibility preferences
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Set scrollTrigger
    const trigger = ScrollTrigger.create({
      trigger: chartRef.current,
      start: "top 85%",
      onEnter: () => {
        if (prefersReducedMotion) {
          // Instantly show final values if custom motion is reduced
          const finalValues = sortedData.map((d) => d.nnn_asking_rent_per_sqft);
          myChart.setOption({
            series: [{ data: finalValues }],
          });
          return;
        }

        // Beautiful custom GSAP staggered rollout
        gsap.to(targets, {
          val: 1,
          duration: 1.1,
          stagger: {
            each: 0.045,
            ease: "power1.out",
          },
          ease: "back.out(1.1)",
          onUpdate: () => {
            const currentRents = targets.map((t, i) => {
              const originalVal = sortedData[i].nnn_asking_rent_per_sqft;
              return Number((t.val * originalVal).toFixed(2));
            });
            myChart.setOption({
              series: [{ data: currentRents }],
            });
          },
        });
      },
      onLeaveBack: () => {
        // Option to reset values on leaving back so we see the entrance again on scroll
        if (!prefersReducedMotion) {
          targets.forEach((t) => (t.val = 0));
          myChart.setOption({
            series: [{ data: new Array(sortedData.length).fill(0) }],
          });
        }
      },
    });

    // 4. Implement ResizeObserver as recommended for accurate responsive bounding and dynamic label metrics
    const containerElement = containerRef.current;
    const resizeObserver = new ResizeObserver((entries) => {
      myChart.resize();
      for (const entry of entries) {
        const width = entry.contentRect.width;
        // On extremely small screens, reduce Font Size and trim the names further to preserve bar spacing
        const isMobile = width < 540;
        myChart.setOption({
          grid: {
            left: isMobile ? "2%" : "4%",
            right: isMobile ? "4%" : "6%",
          },
          yAxis: {
            axisLabel: {
              fontSize: isMobile ? 10 : 12,
              formatter: (value: string) => {
                const maxLen = isMobile ? 12 : 20;
                return value.length > maxLen
                  ? `${value.slice(0, maxLen - 2)}...`
                  : value;
              },
            },
          },
        });
      }
    });

    if (containerElement) {
      resizeObserver.observe(containerElement);
    }

    // 5. Cleanup function
    return () => {
      trigger.kill();
      gsap.killTweensOf(targets);
      resizeObserver.disconnect();
      myChart.dispose();
    };
  }, [sortedData, loading]);

  // Standard loading skeleton
  if (loading) {
    return (
      <div
        className={`p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col gap-4 animate-pulse ${className}`}
      >
        <div className="h-6 w-48 bg-slate-800 rounded"></div>
        <div className="h-4 w-72 bg-slate-800 rounded"></div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-2">
          <div className="lg:col-span-2 h-[350px] sm:h-[450px] bg-slate-900 rounded border border-slate-800/40 animate-pulse"></div>
          <div className="h-[350px] sm:h-[450px] bg-slate-900 rounded border border-slate-800/40 animate-pulse"></div>
        </div>
      </div>
    );
  }

  // Handle empty state beautifully
  if (sortedData.length === 0) {
    return (
      <div
        className={`p-12 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col items-center justify-center text-center gap-3 ${className}`}
      >
        <AlertCircle className="h-10 w-10 text-slate-500" />
        <h3 className="text-slate-200 font-medium text-lg">
          No Corridor Data Available
        </h3>
        <p className="text-slate-400 text-sm max-w-sm">
          Please supply a populated roster of Corridor entries to render this
          visualization.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      id="corridor-rent-chart-root"
      className={`p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 shadow-xl ${className}`}
    >
      {/* Header Info */}
      <div className="mb-4">
        <div className="flex items-center gap-2 text-xs font-mono font-medium text-[rgb(212,179,112)] uppercase tracking-wider">
          <Sparkles className="h-3 w-3 animate-pulse" />
          <span>Interactive Market Ranks</span>
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-white mt-1">
          Corridor Asking Rents (NNN)
        </h2>
        <p className="text-sm text-slate-400 mt-0.5">
          Southwest Florida’s primary commercial highways ranked from high to
          low. Hover columns for detail or click to analyze.
        </p>
      </div>

      {/* Main Grid View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
        {/* ECharts Area */}
        <div className="lg:col-span-2 relative flex flex-col justify-between bg-slate-950/40 rounded-xl border border-slate-800/50 p-4 min-h-[350px] sm:min-h-[460px]">
          <div className="flex items-center justify-between text-xs text-slate-500 font-mono px-2 pt-1 border-b border-slate-900 pb-2">
            <span>CORRIDOR LOCATION</span>
            <span>NNN ASKING RENT / SQFT</span>
          </div>
          <div
            ref={chartRef}
            id="corridor-echarts-container"
            className="w-full h-[300px] sm:h-[380px] flex-1"
          />
          <div className="text-[10px] text-slate-500 font-mono mt-1 flex items-start gap-1.5 px-1 bg-slate-900/30 py-1.5 rounded">
            <Info className="h-3 w-3 flex-shrink-0 text-slate-400 mt-0.5" />
            <span>
              Interactive bounds: Graph is fully responsive. Bar heights
              represent asking NNN rate.
            </span>
          </div>
        </div>

        {/* Detailed Disclosure Panel on click */}
        <div className="flex flex-col gap-4">
          <div className="bg-slate-950/40 p-5 rounded-xl border border-slate-800/50 flex flex-col justify-between h-full">
            {selectedCorridor ? (
              <div
                className="space-y-5"
                id={`disclosure-card-${selectedCorridor.id}`}
              >
                {/* Header submarket badge */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono tracking-widest text-[#2A8C85] bg-[#2A8C85]/10 px-2.5 py-1 rounded-full uppercase border border-[#2A8C85]/20">
                    {selectedCorridor.submarket}
                  </span>
                  <MapPin className="h-4 w-4 text-slate-400" />
                </div>

                {/* Corridor Primary Name */}
                <div>
                  <h3 className="text-2xl font-bold tracking-tight text-white">
                    {selectedCorridor.name}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono mt-1">
                    {selectedCorridor.centroid
                      ? `Latitude: ${selectedCorridor.centroid.center_lat.toFixed(4)} • Longitude: ${selectedCorridor.centroid.center_lon.toFixed(4)}`
                      : "Centroid not tracked (Collier corridor)"}
                  </p>
                </div>

                <div className="h-px bg-slate-800/60" />

                {/* KPI Metrics */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-800/30">
                    <p className="text-xs text-slate-400 font-mono">
                      Ask NNN Rent
                    </p>
                    <p className="text-lg font-bold text-[rgb(212,179,112)] mt-0.5">
                      ${selectedCorridor.nnn_asking_rent_per_sqft.toFixed(2)}
                      <span className="text-xs font-normal text-slate-400">
                        /sqft
                      </span>
                    </p>
                  </div>
                  <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-800/30">
                    <p className="text-xs text-slate-400 font-mono">
                      Vacancy Index
                    </p>
                    <p className="text-lg font-bold text-teal-400 mt-0.5">
                      {selectedCorridor.vacancy_pct}%
                    </p>
                  </div>
                  <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-800/30">
                    <p className="text-xs text-slate-400 font-mono">
                      Net Absorption
                    </p>
                    <p className="text-sm font-bold text-slate-200 mt-1">
                      {selectedCorridor.absorption_sqft !== null
                        ? `${selectedCorridor.absorption_sqft.toLocaleString()} sqft`
                        : "N/A"}
                    </p>
                  </div>
                  <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-800/30">
                    <p className="text-xs text-slate-400 font-mono">
                      Permits Sample (n)
                    </p>
                    <p className="text-sm font-bold text-slate-200 mt-1">
                      {selectedCorridor.permits
                        ? selectedCorridor.permits.n_current.toLocaleString()
                        : "—"}
                    </p>
                  </div>
                </div>

                <div className="h-px bg-slate-800/60" />

                {/* Score indicators */}
                {selectedCorridor.permits ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1.5 font-mono">
                        <Activity className="h-3.5 w-3.5 text-blue-400" />{" "}
                        Permit Z-Score
                      </span>
                      <span className="font-mono font-semibold text-blue-400">
                        {selectedCorridor.permits.headline_z > 0 ? "+" : ""}
                        {selectedCorridor.permits.headline_z.toFixed(2)}
                      </span>
                    </div>
                    {/* Visual scale */}
                    <div className="h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className="h-full bg-blue-500/80 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.max(0, (selectedCorridor.permits.headline_z + 2.5) * 20))}%`,
                        }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-500">
                      Z-Score measures building permit volumes normalized
                      relative to the trailing-365d baseline. Sample of{" "}
                      {selectedCorridor.permits.n_current} qualifying permits.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <span className="inline-block text-[10px] font-mono tracking-widest text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 uppercase">
                      No permits coverage
                    </span>
                    <p className="text-[10px] text-slate-500">
                      permits-swfl is Lee County only. Collier permit coverage
                      waits on a Collier permits pack — see
                      docs/data-coverage.md.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center h-full gap-2 text-slate-500 font-mono">
                <TrendingUp className="h-8 w-8 text-slate-600 animate-pulse" />
                <p className="text-xs">No corridors loaded.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
