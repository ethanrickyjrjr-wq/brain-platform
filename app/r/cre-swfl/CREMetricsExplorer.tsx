"use client";

import { useState } from "react";
import {
  type CountyNode,
  type CorridorNode,
  type MBCityMetric,
  type MetricBox,
  METRIC_TYPES,
} from "./cre-metrics";

// ---------------------------------------------------------------------------
// Direction color system (mirrors metrics-table.tsx DIRECTION_CONFIG)
// ---------------------------------------------------------------------------

const DIRECTION_CONFIG: Record<string, { label: string; className: string }> = {
  rising: { label: "↑ Rising", className: "text-[#5bc97a]" },
  bullish: { label: "↑ Bullish", className: "text-[#5bc97a]" },
  falling: { label: "↓ Falling", className: "text-[#e08158]" },
  bearish: { label: "↓ Bearish", className: "text-[#e08158]" },
  mixed: { label: "→ Mixed", className: "text-[#d4b370]" },
  stable: { label: "→ Stable", className: "text-[#b8b4a8]" },
  neutral: { label: "→ Neutral", className: "text-[#b8b4a8]" },
};

function directionClass(direction: string | null): string {
  if (!direction) return "text-[#00d4aa]";
  return DIRECTION_CONFIG[direction]?.className ?? "text-[#00d4aa]";
}

function DirectionBadge({ direction }: { direction: string | null }) {
  if (!direction) return null;
  const cfg = DIRECTION_CONFIG[direction];
  if (!cfg) return <span className="text-[#b8b4a8] text-xs">{direction}</span>;
  return <span className={`text-xs font-medium ${cfg.className}`}>{cfg.label}</span>;
}

// ---------------------------------------------------------------------------
// Stat box
// ---------------------------------------------------------------------------

function StatBox({ box }: { box: MetricBox }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
      <dt className="text-xs uppercase leading-tight tracking-wider text-gray-400">{box.label}</dt>
      <dd className={`font-mono text-lg font-semibold tabular-nums ${directionClass(box.direction)}`}>
        {box.value}
      </dd>
      {box.direction && (
        <div className="mt-0.5">
          <DirectionBadge direction={box.direction} />
        </div>
      )}
    </div>
  );
}

function StatGrid({ boxes }: { boxes: MetricBox[] }) {
  if (boxes.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {boxes.map((b, i) => (
        <StatBox key={`${b.label}-${i}`} box={b} />
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// City MarketBeat boxes (retail headline figures for the expanded city)
// ---------------------------------------------------------------------------

function cityRetailBoxes(city: string, mbMetrics: MBCityMetric[]): MetricBox[] {
  const boxes: MetricBox[] = [];
  for (const mt of METRIC_TYPES) {
    const hit = mbMetrics.find(
      (m) => m.city === city && m.sector === "retail" && m.metricType === mt.key,
    );
    if (hit) boxes.push({ label: mt.label, value: hit.value, direction: hit.direction });
  }
  return boxes;
}

// ---------------------------------------------------------------------------
// Corridor leaf — click to open its metric boxes; X to close
// ---------------------------------------------------------------------------

function CorridorRow({
  corridor,
  isOpen,
  onToggle,
}: {
  corridor: CorridorNode;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        onClick={onToggle}
        className={[
          "flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-left transition-colors",
          isOpen
            ? "border-[#00d4aa] bg-[#00d4aa]/[0.08]"
            : "border-white/10 bg-white/[0.02] hover:border-[#00d4aa]/50 hover:bg-[#00d4aa]/[0.04]",
        ].join(" ")}
      >
        <span className="flex flex-col">
          {/* Corridor name — bigger; the SEO anchor below keeps the real URL
              crawlable while the visible affordance is the inline drill-down. */}
          <span className="text-sm font-semibold text-gray-100">{corridor.name}</span>
          {corridor.subtitle && (
            <span className="text-[11px] uppercase tracking-wide text-gray-500">
              {corridor.subtitle}
            </span>
          )}
          <a href={`/r/cre-swfl/${corridor.slug}`} className="sr-only">
            {corridor.name} commercial real estate report
          </a>
        </span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {isOpen && (
        <div className="relative mt-2 rounded-xl border border-[#00d4aa]/25 bg-[#00d4aa]/[0.03] p-4">
          <button
            onClick={onToggle}
            aria-label="Close corridor detail"
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
          {corridor.metrics.length > 0 ? (
            <StatGrid boxes={corridor.metrics} />
          ) : (
            <p className="py-3 text-center text-sm text-gray-500">
              No reported metrics for this corridor this period.
            </p>
          )}
          <a
            href={`/r/cre-swfl/${corridor.slug}`}
            className="mt-3 inline-block text-xs font-medium text-[#00d4aa]/80 transition-colors hover:text-[#00d4aa]"
          >
            Full {corridor.name} report →
          </a>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// City briefcase — collapsible card holding MB boxes + corridors
// ---------------------------------------------------------------------------

function CityBriefcase({
  city,
  corridors,
  mbMetrics,
  isOpen,
  onToggle,
}: {
  city: string;
  corridors: CorridorNode[];
  mbMetrics: MBCityMetric[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [openCorridor, setOpenCorridor] = useState<string | null>(null);
  const boxes = cityRetailBoxes(city, mbMetrics);

  return (
    <div>
      <button
        onClick={onToggle}
        className={[
          "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors",
          isOpen
            ? "border-[#00d4aa] bg-[#00d4aa]/[0.08] text-[#00d4aa]"
            : "border-[#00d4aa]/30 bg-[#00d4aa]/[0.04] text-gray-200 hover:border-[#00d4aa]/60 hover:text-[#00d4aa]",
        ].join(" ")}
      >
        <span className="flex items-center gap-2.5">
          {/* briefcase glyph — cities are filed like the corridor explorer */}
          <svg className="h-4 w-4 shrink-0 opacity-80" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="2" y="5" width="12" height="8" rx="1.5" />
            <path d="M6 5V3.5A1.5 1.5 0 017.5 2h1A1.5 1.5 0 0110 3.5V5" />
          </svg>
          <span className="text-sm font-semibold">{city}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className={`text-xs ${isOpen ? "text-[#00d4aa]/70" : "text-gray-500"}`}>
            {corridors.length} corridor{corridors.length !== 1 ? "s" : ""}
          </span>
          <svg
            className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="ml-1 mt-3 space-y-4 border-l border-white/10 pl-4">
          {boxes.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wider text-gray-500">
                {city} retail · MarketBeat
              </p>
              <StatGrid boxes={boxes} />
            </div>
          )}
          {corridors.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wider text-gray-500">Corridors</p>
              <ul className="space-y-2">
                {corridors.map((c) => (
                  <CorridorRow
                    key={c.slug}
                    corridor={c}
                    isOpen={openCorridor === c.slug}
                    onToggle={() =>
                      setOpenCorridor((prev) => (prev === c.slug ? null : c.slug))
                    }
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main explorer
// ---------------------------------------------------------------------------

export interface CREMetricsExplorerProps {
  /** Combined Lee + Collier SWFL boxes — visible on page load. */
  summaryMetrics: MetricBox[];
  /** Per-city MarketBeat datapoints for the expanded-city boxes. */
  mbMetrics: MBCityMetric[];
  /** County → City → Corridor hierarchy. */
  counties: CountyNode[];
}

export function CREMetricsExplorer({
  summaryMetrics,
  mbMetrics,
  counties,
}: CREMetricsExplorerProps) {
  const [showCities, setShowCities] = useState(false);
  const [openCity, setOpenCity] = useState<string | null>(null);

  const hasCities = counties.some((c) => c.cities.length > 0);

  return (
    <div className="mt-6 space-y-6">
      {/* Combined Lee + Collier boxes — two rows, on load. */}
      {summaryMetrics.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Southwest Florida · Lee + Collier combined
          </h3>
          <StatGrid boxes={summaryMetrics} />
        </section>
      )}

      {/* See-by-city drill-down toggle. */}
      {hasCities && (
        <div>
          <button
            onClick={() => setShowCities((v) => !v)}
            aria-expanded={showCities}
            className={[
              "inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors",
              showCities
                ? "border-[#00d4aa] bg-[#00d4aa]/10 text-[#00d4aa]"
                : "border-[#00d4aa]/40 bg-[#00d4aa]/[0.06] text-[#00d4aa] hover:bg-[#00d4aa]/10",
            ].join(" ")}
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform ${showCities ? "rotate-180" : ""}`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
            {showCities ? "Hide city breakdown" : "See by city"}
          </button>

          {showCities && (
            <div className="mt-5 space-y-8">
              {counties
                .filter((c) => c.cities.length > 0)
                .map(({ county, cities }) => (
                  <div key={county}>
                    <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                      {county === "Unknown" ? "Other SWFL" : `${county} County`}
                    </h4>
                    <div className="space-y-2">
                      {cities.map((cityNode) => {
                        const key = `${county}::${cityNode.city}`;
                        return (
                          <CityBriefcase
                            key={key}
                            city={cityNode.city}
                            corridors={cityNode.corridors}
                            mbMetrics={mbMetrics}
                            isOpen={openCity === key}
                            onToggle={() =>
                              setOpenCity((prev) => (prev === key ? null : key))
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CREMetricsExplorer;
