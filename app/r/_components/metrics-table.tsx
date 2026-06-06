import type { ReactNode } from "react";

/**
 * Shared metric rendering + the two-color rule for every /r/ report:
 *   • OUR computed figures  → data-blue (#4f9cf9), tabular/mono
 *   • OUTSIDE source links  → teal (#00d4aa), underlined
 * The ColorLegend at the bottom of each page explains the split. Keep both
 * colors here so a future hex swap is one place.
 */

export interface MetricRow {
  label: string;
  value: ReactNode;
  direction: string | null;
  /** Outside source the figure is verified against. */
  sourceUrl?: string | null;
  /** Link text (defaults to "Source"). */
  sourceLabel?: ReactNode;
}

const DIRECTION_CONFIG: Record<string, { label: string; className: string }> = {
  rising: { label: "↑ Rising", className: "text-[#5bc97a]" },
  falling: { label: "↓ Falling", className: "text-[#e08158]" },
  stable: { label: "→ Stable", className: "text-gray-400" },
};

/** Trend pill — same green/coral/gray everywhere. Unknown values fall back to
 *  the raw string so we never blank out a real trend. */
export function DirectionBadge({ direction }: { direction: string | null }) {
  if (!direction) return <span className="text-gray-600">—</span>;
  const cfg = DIRECTION_CONFIG[direction];
  if (!cfg) return <span className="text-gray-400">{direction}</span>;
  return (
    <span className={`text-xs font-medium ${cfg.className}`}>{cfg.label}</span>
  );
}

/** The one outside-source link style. */
export function SourceLink({
  url,
  label = "Source",
}: {
  url?: string | null;
  label?: ReactNode;
}) {
  if (!url) return <span className="text-gray-600">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#00d4aa] underline decoration-[#00d4aa]/40 underline-offset-2 hover:decoration-[#00d4aa]"
    >
      {label}
    </a>
  );
}

/** Metric · Value · Trend · Source table — used by the master and corridor
 *  reads. `trendLabel` lets a page call the column "Trend" instead of
 *  "Direction"; the cells are identical. */
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
              <td className="px-4 py-3 align-top font-medium text-white">
                {m.label}
              </td>
              <td className="px-4 py-3 text-right align-top font-mono text-[#4f9cf9]">
                {m.value}
              </td>
              <td className="px-4 py-3 align-top">
                <DirectionBadge direction={m.direction} />
              </td>
              <td className="px-4 py-3 align-top text-xs text-gray-500">
                <SourceLink
                  url={m.sourceUrl}
                  label={m.sourceLabel ?? "Source"}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Label / value row for compact stat lists (the per-ZIP report). Value renders
 *  in data-blue; an optional trailing `badge` node keeps its own color. */
export function DataRow({
  label,
  value,
  badge,
}: {
  label: string;
  value: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <dt className="text-gray-400">{label}</dt>
      <dd className="flex items-center gap-2 text-right font-mono">
        <span className="text-[#4f9cf9]">{value}</span>
        {badge}
      </dd>
    </div>
  );
}
