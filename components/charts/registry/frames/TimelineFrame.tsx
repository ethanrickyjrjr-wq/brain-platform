"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { ChartSpec } from "../chart-spec";

/**
 * Named-event timeline frame — discrete events plotted over time with magnitude.
 *
 * Designed for storm claims (UI-Kit #06) but parameterized via `spec.options` so
 * any event series (elections, openings, incidents, etc.) slots in without code
 * surgery.
 *
 * `spec.options` shape:
 *   events:       TimelineEvent[]   — the event series (required)
 *   baseline_usd: number            — optional horizontal reference line
 *   y_label:      string            — Y-axis label (default "Amount (USD)")
 *   accent:       string            — hex color for bars (default "#e05c2e")
 *
 * Live data binding: PARKED. env-swfl emits a combined storm-year total
 * (`swfl_storm_year_claims_usd`) but not per-storm breakdowns. Surface
 * per-storm amounts from `NfipCountyYear` fragments before wiring live.
 * Until then this frame is fixture-bound.
 */
export interface TimelineEvent {
  /** Human label — storm name, event name, etc. Shown on X-axis. */
  label: string;
  /** ISO date string (YYYY-MM-DD). Used for ordering and tooltip. */
  date: string;
  /** Numeric magnitude. For NFIP claims this is paid USD. */
  amount_usd: number;
}

function isoToYear(iso: string): number {
  return parseInt(iso.slice(0, 4), 10);
}

function friendlyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

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

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const captionStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 11,
  color: "#4a5a6a",
  marginTop: 6,
  letterSpacing: "0.02em",
};

export function TimelineFrame({ spec }: { spec: ChartSpec }) {
  const events = ((spec.options?.events ?? []) as TimelineEvent[])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const baseline =
    typeof spec.options?.baseline_usd === "number" ? (spec.options.baseline_usd as number) : null;

  const yLabel =
    typeof spec.options?.y_label === "string" ? (spec.options.y_label as string) : "Amount (USD)";

  const accent =
    typeof spec.options?.accent === "string"
      ? (spec.options.accent as string)
      : (spec.theme?.accent ?? "#e05c2e");

  if (events.length === 0) {
    return (
      <div
        style={{
          padding: "1.5rem",
          textAlign: "center",
          color: "#6b7280",
          fontSize: 13,
        }}
      >
        No events to display.
      </div>
    );
  }

  // X-axis tick: "Ian\n2022"
  const chartData = events.map((e) => ({
    name: `${e.label} ${isoToYear(e.date)}`,
    amount_usd: e.amount_usd,
    date: e.date,
    label: e.label,
  }));

  const maxVal = Math.max(...events.map((e) => e.amount_usd));

  return (
    <div>
      {spec.title && (
        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            marginBottom: 8,
            color: "#1a2636",
          }}
        >
          {spec.title}
        </div>
      )}
      <ResponsiveContainer width="100%" height={260} initialDimension={{ width: 800, height: 260 }}>
        <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 28, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5eaf0" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: "#4a5a6a" }}
            tickLine={false}
            axisLine={{ stroke: "#d1d8e0" }}
            interval={0}
            angle={-20}
            textAnchor="end"
            height={48}
          />
          <YAxis
            tickFormatter={fmtUsd}
            tick={{ fontSize: 10, fill: "#4a5a6a" }}
            tickLine={false}
            axisLine={false}
            label={{
              value: yLabel,
              angle: -90,
              position: "insideLeft",
              style: { fontSize: 10, fill: "#8898aa" },
            }}
            domain={[0, maxVal * 1.15]}
          />
          <Tooltip
            formatter={(value, _name, props) => [
              fmtUsd(Number(value ?? 0)),
              (props as { payload?: { label?: string } }).payload?.label ?? "Amount",
            ]}
            labelFormatter={(label, payload) => {
              const entry = (payload as unknown as Array<{ payload?: { date?: string } }>)?.[0];
              const date = entry?.payload?.date;
              return date ? friendlyDate(date) : String(label ?? "");
            }}
            contentStyle={{
              background: "#fff",
              border: "1px solid #e5eaf0",
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          {baseline !== null && (
            <ReferenceLine
              y={baseline}
              stroke="#60a5fa"
              strokeDasharray="6 3"
              label={{
                value: `Baseline ${fmtUsd(baseline)}`,
                position: "right",
                style: { fontSize: 10, fill: "#60a5fa" },
              }}
            />
          )}
          <Bar dataKey="amount_usd" radius={[3, 3, 0, 0]} maxBarSize={56}>
            {chartData.map((entry, i) => (
              <Cell key={`cell-${i}`} fill={entry.amount_usd === maxVal ? accent : `${accent}99`} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {spec.asOf && (
        <p style={captionStyle}>
          As of {friendlyAsOf(spec.asOf)}
          {spec.source?.citation ? ` · ${spec.source.citation}` : ""}
        </p>
      )}
    </div>
  );
}
