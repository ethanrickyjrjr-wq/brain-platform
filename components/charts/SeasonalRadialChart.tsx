"use client";

import { RadialBarChart, RadialBar, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { SeasonalRadialEntry } from "@/types/viz";

export type { SeasonalRadialEntry };

export interface SeasonalRadialChartProps {
  data: SeasonalRadialEntry[];
  asOf?: string;
}

/** ISO YYYY-MM-DD → "Jun 1, 2026" (UTC-safe). Mirrors ChartBlockView.friendlyAsOf. */
function friendlyAsOf(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Teal → sky → amber gradient keyed on the seasonal index (0→1). */
function fillFor(idx: number): string {
  if (idx < 0.35) return "#14b8a6";
  if (idx < 0.65) return "#38bdf8";
  return "#d4b370";
}

/** Trim corridor names to ≤ 24 chars for label readability. */
function shortName(name: string): string {
  const trimmed = name.replace(/^[^-]+-\s*/, "");
  return trimmed.length > 24 ? trimmed.slice(0, 22) + "…" : trimmed;
}

export function SeasonalRadialChart({ data, asOf }: SeasonalRadialChartProps) {
  // Sort ascending so the highest-seasonality corridor renders as the outermost ring.
  const chartData = [...data]
    .sort((a, b) => a.seasonal_index - b.seasonal_index)
    .map((d) => ({
      name: shortName(d.corridor),
      fullName: d.corridor,
      value: Math.round(d.seasonal_index * 100),
      fill: fillFor(d.seasonal_index),
    }));

  if (chartData.length === 0) {
    return (
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 text-slate-500 text-xs font-mono">
        No seasonality data available.
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 text-slate-100 shadow-xl">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono tracking-widest text-[#d4b370] uppercase">
          Corridor Seasonality Index
        </span>
        {asOf && (
          <span className="text-[10px] font-mono text-slate-500">as of {friendlyAsOf(asOf)}</span>
        )}
      </div>

      <div style={{ height: 300 }}>
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 600, height: 300 }}
        >
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="10%"
            outerRadius="92%"
            barSize={11}
            data={chartData}
            startAngle={180}
            endAngle={-180}
          >
            <RadialBar
              background={{ fill: "#1e293b" }}
              dataKey="value"
              label={{ position: "insideStart", fill: "#64748b", fontSize: 9 }}
            >
              {chartData.map((entry, i) => (
                <Cell key={`${entry.fullName}-${i}`} fill={entry.fill} />
              ))}
            </RadialBar>
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                fontSize: 11,
                color: "#e2e8f0",
              }}
              formatter={(v) => [`${v}%`, "Seasonality"] as [string, string]}
              labelFormatter={(_, payload) =>
                (payload?.[0]?.payload?.fullName as string | undefined) ?? ""
              }
            />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[10px] font-mono text-slate-500 mt-1">
        Scale 0% (no seasonality) → 100% (extreme) · SWFL corridors
      </p>
    </div>
  );
}
