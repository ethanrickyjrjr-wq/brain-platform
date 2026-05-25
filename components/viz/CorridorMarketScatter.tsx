"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import * as echarts from "echarts";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Info,
  AlertCircle,
  Sparkles,
  Sliders,
  BarChart3,
  Activity,
} from "lucide-react";
import type { JoinedCorridorRow, CorridorPermitsEntry } from "@/types/viz";

// Narrowed view for the scatter: rent + vacancy + permits all present. Centroid
// is optional and used only when available for tooltip / side-panel coords.
type ScatterRow = JoinedCorridorRow & {
  nnn_asking_rent_per_sqft: number;
  vacancy_pct: number;
  permits: CorridorPermitsEntry;
};

// Per-row "intensity" derived from headline_z. Renamed deliberately — the
// pack-level saturation_index is a county-level scalar that doesn't have a
// meaningful per-corridor projection. headline_z >= 2 ≈ saturated commercial
// flow; the visualMap colors map this band.
function intensityFromZ(z: number): number {
  // Map z in [-2.5, 2.5] → [0, 1] for color interpolation. Anything outside
  // clamps. Matches the visualMap min/max below.
  const clamped = Math.max(-2.5, Math.min(2.5, z));
  return (clamped + 2.5) / 5;
}

// Register ScrollTrigger safely for client environments
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export interface CorridorMarketScatterProps {
  data: JoinedCorridorRow[];
  loading?: boolean;
  className?: string;
}

export function CorridorMarketScatter({
  data,
  loading = false,
  className = "",
}: CorridorMarketScatterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Rows with permits coverage form the scatter dataset. Collier corridors
  // (permits === null) are intentionally excluded — they don't have permit
  // z-scores to plot. The page-level header above this chart shows the
  // "X plotted · Y no-coverage" split so the gap is visible even when
  // those rows aren't on the canvas.
  const cleanData = useMemo<ScatterRow[]>(() => {
    return data.filter(
      (c): c is ScatterRow =>
        c.nnn_asking_rent_per_sqft != null &&
        c.vacancy_pct != null &&
        c.permits != null,
    );
  }, [data]);

  const selectedCorridor = useMemo(() => {
    if (!selectedId) return cleanData[0] || null;
    return cleanData.find((c) => c.id === selectedId) || cleanData[0] || null;
  }, [selectedId, cleanData]);

  // Handle default initial select once data is populated
  useEffect(() => {
    if (cleanData.length > 0 && !selectedId) {
      setSelectedId(cleanData[0].id);
    }
  }, [cleanData, selectedId]);

  // Initialize and update ECharts 4D Scatter bubble chart with ScrollTrigger stagger entry
  useEffect(() => {
    if (loading || cleanData.length === 0 || !chartRef.current) return;

    if (chartInstance.current) {
      chartInstance.current.dispose();
    }

    const myChart = echarts.init(chartRef.current, "dark");
    chartInstance.current = myChart;

    // Build scatter dimensions array: [VacancyPct, NnnRent, ZScoreScaleVal, Intensity, CorridorIndex]
    const scatterDataset = cleanData.map((item, idx) => {
      const z = item.permits.headline_z;
      // Map headline_z to a friendly bubble sizing diameter scale (minimum size 14 to peak 50).
      // Typical z-score range is around -2 to +2.5. Linear translation:
      const bubbleSizeVal = Math.max(14, Math.min(52, ((z + 2) / 4) * 36 + 14));
      return [
        item.vacancy_pct,
        item.nnn_asking_rent_per_sqft,
        bubbleSizeVal,
        intensityFromZ(z), // derived per-row signal — NOT the pack's saturation_index
        idx, // custom index referencing cleanData
      ];
    });

    const option: echarts.EChartsOption = {
      backgroundColor: "transparent",
      grid: {
        top: "14%",
        left: "5%",
        right: "5%",
        bottom: "12%",
        containLabel: true,
      },
      tooltip: {
        trigger: "item",
        backgroundColor: "#0d1527",
        borderColor: "#1e293b",
        borderWidth: 1,
        textStyle: { color: "#f8fafc", fontFamily: "inherit" },
        padding: [10, 14],
        formatter: (params: any) => {
          const entryIdx = params.data[4];
          const entry = cleanData[entryIdx];
          return `
            <div style="display:flex;flex-direction:column;gap:4px;">
              <p style="font-weight:700;font-size:13px;color:rgb(212,179,112);margin:0;">${entry.name}</p>
              <p style="font-size:11px;color:#94a3b8;font-family:monospace;margin:0;">${entry.submarket}</p>
              <div style="height:1px;background:#1e293b;margin:2px 0;"></div>
              <p style="font-size:11px;font-family:monospace;margin:0;">Vacancy: <strong style="color:#fff;">${entry.vacancy_pct}%</strong></p>
              <p style="font-size:11px;font-family:monospace;margin:0;">Asking NNN Rent: <strong style="color:#2dd4bf;">$${entry.nnn_asking_rent_per_sqft.toFixed(2)}/sqft</strong></p>
              <p style="font-size:11px;font-family:monospace;margin:0;">Permit Z-Score: <strong style="color:#38bdf8;">${entry.permits.headline_z.toFixed(2)}</strong> <span style="color:#64748b;">(n=${entry.permits.n_current})</span></p>
            </div>
          `;
        },
      },
      xAxis: {
        name: "Vacancy Rate (%)",
        nameLocation: "middle",
        nameGap: 30,
        nameTextStyle: {
          color: "#94a3b8",
          fontFamily: "monospace",
          fontSize: 11,
          fontWeight: "bold",
        },
        splitLine: {
          lineStyle: { color: "#1e293b", type: "dashed" },
        },
        axisLabel: {
          formatter: "{value}%",
          color: "#94a3b8",
          fontFamily: "monospace",
        },
        axisLine: { lineStyle: { color: "#334155" } },
      },
      yAxis: {
        name: "NNN Rent ($/sqft)",
        nameLocation: "middle",
        nameGap: 38,
        nameTextStyle: {
          color: "#94a3b8",
          fontFamily: "monospace",
          fontSize: 11,
          fontWeight: "bold",
        },
        splitLine: {
          lineStyle: { color: "#1e293b", type: "dashed" },
        },
        axisLabel: {
          formatter: "${value}",
          color: "#94a3b8",
          fontFamily: "monospace",
        },
        axisLine: { lineStyle: { color: "#334155" } },
      },
      visualMap: [
        {
          show: false, // Don't show legend visualMap bar, we draw client pills instead
          dimension: 3, // Maps color directly to derived intensity-from-z signal
          min: 0,
          max: 1,
          inRange: {
            color: [
              "#14b8a6", // Emerald teal (low z → contracting flow)
              "#38bdf8", // Sky blue (baseline)
              "#d97706", // Amber-Orange (high z → saturated flow)
            ],
          },
        },
      ],
      series: [
        {
          name: "Corridors",
          type: "scatter",
          data: scatterDataset.map((d) => [d[0], d[1], 0, d[3], d[4]]), // Initialize with 0 scale bubble diameter for animation
          symbolSize: (data: any) => data[2], // Size based on zscore calculation
          itemStyle: {
            opacity: 0.85,
            shadowBlur: 14,
            shadowColor: "rgba(0, 0, 0, 0.6)",
            borderColor: "rgba(255,255,255,0.15)",
            borderWidth: 1,
          },
          emphasis: {
            itemStyle: {
              opacity: 1,
              borderColor: "#ffffff",
              borderWidth: 2,
            },
          },
        },
      ],
    };

    myChart.setOption(option);

    // Click behavior to open interactive custom side disclosures
    myChart.on("click", (params: any) => {
      if (params.componentType === "series") {
        const entryIdx = params.data[4];
        const entry = cleanData[entryIdx];
        if (entry) {
          setSelectedId(entry.id);
        }
      }
    });

    const shadowValues = scatterDataset.map((d) => [...d]);
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Trigger stagger animations on view enter via GSAP ScrollTrigger
    const trigger = ScrollTrigger.create({
      trigger: chartRef.current,
      start: "top 85%",
      onEnter: () => {
        if (prefersReducedMotion) {
          myChart.setOption({
            series: [{ data: shadowValues }],
          });
          return;
        }

        // Beautiful spring easing mock timeline to animate the bubble diameters left-to-right
        const progressObj = { progress: 0 };
        gsap.to(progressObj, {
          progress: 1,
          duration: 1.3,
          ease: "elastic.out(1, 0.75)",
          onUpdate: () => {
            const tempVal = shadowValues.map((d) => {
              // Interpolate sizes based on linear scale progress
              const animatedSize = Math.max(2, d[2] * progressObj.progress);
              return [d[0], d[1], animatedSize, d[3], d[4]];
            });
            myChart.setOption({
              series: [{ data: tempVal }],
            });
          },
        });
      },
      onLeaveBack: () => {
        if (!prefersReducedMotion) {
          myChart.setOption({
            series: [
              { data: scatterDataset.map((d) => [d[0], d[1], 0, d[3], d[4]]) },
            ],
          });
        }
      },
    });

    // ResizeObserver bound to avoid parent width breakout under scroll shifts
    const containerElem = containerRef.current;
    const resizeObserver = new ResizeObserver((entries) => {
      myChart.resize();
      for (const entry of entries) {
        const isMobile = entry.contentRect.width < 540;
        myChart.setOption({
          grid: {
            left: isMobile ? "2%" : "5%",
            right: isMobile ? "2%" : "5%",
            bottom: isMobile ? "14%" : "12%",
          },
        });
      }
    });

    if (containerElem) {
      resizeObserver.observe(containerElem);
    }

    return () => {
      trigger.kill();
      resizeObserver.disconnect();
      myChart.dispose();
    };
  }, [cleanData, loading]);

  if (loading) {
    return (
      <div
        className={`p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col gap-4 animate-pulse ${className}`}
      >
        <div className="h-6 w-52 bg-slate-800 rounded"></div>
        <div className="h-4 w-80 bg-slate-800 rounded"></div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-2">
          <div className="lg:col-span-2 h-[350px] sm:h-[450px] bg-slate-900 rounded border border-slate-800/40 animate-pulse"></div>
          <div className="h-[350px] sm:h-[450px] bg-slate-900 rounded border border-slate-800/40 animate-pulse"></div>
        </div>
      </div>
    );
  }

  if (cleanData.length === 0) {
    return (
      <div
        className={`p-12 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col items-center justify-center text-center gap-3 ${className}`}
      >
        <AlertCircle className="h-10 w-10 text-slate-500" />
        <h3 className="text-slate-200 font-medium text-lg">
          No Scatter Plot Data Available
        </h3>
        <p className="text-slate-400 text-sm max-w-sm">
          Provide a list of complete corridor items to render the bubble
          analysis model.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      id="corridor-scatter-root"
      className={`p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 shadow-xl ${className}`}
    >
      {/* Header Labeling */}
      <div className="mb-4">
        <div className="flex items-center gap-2 text-xs font-mono font-medium text-teal-400 uppercase tracking-wider">
          <Sparkles className="h-3 w-3 animate-pulse" />
          <span>Multidimensional Market Scatter</span>
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-white mt-1">
          Market Saturation & Appraisal Matrix
        </h2>
        <p className="text-sm text-slate-400 mt-0.5">
          Plotting Vacancy (%) vs. NNN Asking Rent ($) to map saturated hubs and
          active development zones.
        </p>
      </div>

      {/* Grid Layout of the Scatter and disclosure info cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
        {/* Scatter Canvas Grid */}
        <div className="lg:col-span-2 relative flex flex-col bg-slate-950/40 rounded-xl border border-slate-800/50 p-4 min-h-[360px] sm:min-h-[460px]">
          <div className="flex items-center justify-between text-xs text-slate-500 font-mono px-2 pt-1 border-b border-slate-900 pb-3">
            <span>AXES: VACANCY % vs RENT</span>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-teal-500" /> Active
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> Saturated
              </span>
            </div>
          </div>

          <div
            ref={chartRef}
            id="scatter-plot-canvas"
            className="w-full h-[300px] sm:h-[380px] flex-1"
          />

          <div className="text-[10px] text-slate-500 font-mono mt-2 flex items-start gap-1.5 px-1 bg-slate-900/30 py-2 rounded">
            <Info className="h-3 w-3 flex-shrink-0 text-slate-400 mt-0.5" />
            <span>
              Interactive Guide: Bubbles scales mirror building permit volumes
              (Z-Score). Bubble tone maps saturation level. Select circles to
              inspect deeper market analytics.
            </span>
          </div>
        </div>

        {/* Detailed Quadrant Audit Card */}
        <div className="flex flex-col gap-4">
          <div className="bg-slate-950/40 p-5 rounded-xl border border-slate-800/50 flex flex-col justify-between h-full">
            {selectedCorridor ? (
              <div
                className="space-y-4"
                id={`scatter-detail-card-${selectedCorridor.id}`}
              >
                {/* Visual Category indicators */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-mono tracking-widest text-[#d4b370] bg-[#d4b370]/10 px-2 py-0.5 rounded border border-[#d4b370]/20 uppercase">
                      Class A Matrix
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                    <Sliders className="h-3 w-3 text-sky-400" />
                    <span>Selected</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold tracking-tight text-white mb-0.5">
                    {selectedCorridor.name}
                  </h3>
                  <span className="text-xs font-mono text-slate-400">
                    Submarket: {selectedCorridor.submarket}
                  </span>
                </div>

                <div className="h-px bg-slate-800/60" />

                {/* Submarket quadrant metrics */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400 font-mono">
                      Quadrant classification
                    </span>
                    <span
                      className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${
                        selectedCorridor.vacancy_pct < 6 &&
                        selectedCorridor.nnn_asking_rent_per_sqft > 40
                          ? "bg-purple-500/15 text-purple-400 border border-purple-500/20"
                          : selectedCorridor.vacancy_pct >= 9
                            ? "bg-rose-500/15 text-rose-400 border border-rose-500/20"
                            : "bg-teal-500/15 text-teal-400 border border-teal-500/20"
                      }`}
                    >
                      {selectedCorridor.vacancy_pct < 6 &&
                      selectedCorridor.nnn_asking_rent_per_sqft > 40
                        ? "Premium Core"
                        : selectedCorridor.vacancy_pct >= 9
                          ? "Developing/High-Supply"
                          : "Balanced Value"}
                    </span>
                  </div>

                  {/* Quick-stats items */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/40">
                      <p className="text-[10px] text-slate-400 font-mono">
                        Asking NNN
                      </p>
                      <p className="text-base font-bold text-teal-400 mt-0.5">
                        ${selectedCorridor.nnn_asking_rent_per_sqft.toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/40">
                      <p className="text-[10px] text-slate-400 font-mono">
                        Vacancy
                      </p>
                      <p className="text-base font-bold text-sky-400 mt-0.5">
                        {selectedCorridor.vacancy_pct}%
                      </p>
                    </div>
                    <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/40">
                      <p className="text-[10px] text-slate-400 font-mono">
                        Permit Z-Score
                      </p>
                      <p className="text-base font-bold text-blue-400 mt-0.5">
                        {selectedCorridor.permits.headline_z > 0 ? "+" : ""}
                        {selectedCorridor.permits.headline_z.toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/40">
                      <p className="text-[10px] text-slate-400 font-mono font-medium">
                        Sample (n)
                      </p>
                      <p className="text-base font-bold text-amber-500 mt-0.5">
                        {selectedCorridor.permits.n_current.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="h-px bg-slate-800/60" />

                {/* Growth and absorption overview */}
                <div className="space-y-2">
                  <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1 uppercase tracking-wider">
                    <Activity className="h-3.5 w-3.5 text-orange-400" />{" "}
                    Absorption Profile
                  </span>
                  <p className="text-xs text-slate-300 leading-relaxed font-sans">
                    With an NNN rent of{" "}
                    <strong className="text-white">
                      ${selectedCorridor.nnn_asking_rent_per_sqft.toFixed(2)}
                      /sqft
                    </strong>{" "}
                    and vacancy at{" "}
                    <strong className="text-white">
                      {selectedCorridor.vacancy_pct}%
                    </strong>
                    , {selectedCorridor.name} exhibits a net absorption value of{" "}
                    {selectedCorridor.absorption_sqft
                      ? `+${selectedCorridor.absorption_sqft.toLocaleString()} sqft`
                      : "N/A"}
                    .
                  </p>
                  <p className="text-[10px] text-slate-500 font-sans leading-normal">
                    High Permit Z-Scores suggest incoming supply lines, while
                    Saturation Indices near 100% flag mature lease environments.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center h-full gap-2 text-slate-500 font-mono">
                <BarChart3 className="h-8 w-8 text-slate-600 animate-pulse" />
                <p className="text-xs">No analysis selection active.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
