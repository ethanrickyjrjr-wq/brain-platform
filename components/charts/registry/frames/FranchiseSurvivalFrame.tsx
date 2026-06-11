"use client";
/**
 * REGISTRY ENTRY — add to registry.ts once 2a + 2b branches are integrated:
 *
 *   import { FranchiseSurvivalFrame } from "./frames/FranchiseSurvivalFrame";
 *
 *   "franchise-survival": {
 *     component: FranchiseSurvivalFrame,
 *     accepts: ["ranked-categories"],
 *     label: "Franchise Survival (SBA)",
 *   },
 *
 * DATA CONTRACT — spec.options.data: FranchiseBrandRaw[]
 *   Fields: franchise_name, survival_rate (null = not assessable),
 *   n_paid_in_full, n_charged_off, n_loans, total_gross_approval.
 *   Shape mirrors the franchise-outcomes source fixture
 *   (refinery/__fixtures__/franchise-outcomes.sample.json).
 */

import { useState, useMemo } from "react";
import type { ChartSpec } from "../chart-spec";
import {
  prepareBrands,
  sortBrands,
  computeMedian,
  computeKPIs,
  barColor,
  fmtApproval,
  fmtPct,
  type SortKey,
  type FranchiseBrandRaw,
  type FranchiseBrandPrepared,
} from "./franchise-survival-utils";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "survival", label: "Survival" },
  { key: "chargeoff", label: "Charge-off" },
  { key: "sample", label: "Sample size" },
  { key: "approval", label: "Gross approval" },
];

export function FranchiseSurvivalFrame({ spec }: { spec: ChartSpec }) {
  const [sortKey, setSortKey] = useState<SortKey>("survival");
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const rawData = useMemo(
    () => (spec.options?.data as FranchiseBrandRaw[] | undefined) ?? [],
    [spec.options],
  );
  const assessed = useMemo(() => prepareBrands(rawData), [rawData]);
  const sorted = useMemo(() => sortBrands(assessed, sortKey), [assessed, sortKey]);
  const median = useMemo(() => computeMedian(assessed), [assessed]);
  const kpis = useMemo(() => computeKPIs(rawData, assessed), [rawData, assessed]);
  const selected = selectedName
    ? (assessed.find((b) => b.franchise_name === selectedName) ?? null)
    : null;

  if (assessed.length === 0) {
    return (
      <div className="p-6 text-center font-mono text-[11px] uppercase tracking-widest text-[var(--text-tertiary)]">
        No resolved-loan data available
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-[var(--gulf-deep)] border border-[var(--gulf-haze)] p-6 space-y-5">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPITile
          label="Brands assessed"
          value={String(kpis.brandsAssessed)}
          sub={`of ${kpis.totalBrands} in corpus`}
        />
        <KPITile
          label="Resolved loans"
          value={String(kpis.totalResolved)}
          sub={`${kpis.totalPaid} paid · ${kpis.totalCharged} charged off`}
        />
        <KPITile
          label="Overall survival"
          value={kpis.overallSurvival !== null ? fmtPct(kpis.overallSurvival) : "—"}
          sub="loan-count weighted"
        />
        <KPITile
          label="Total gross approval"
          value={fmtApproval(kpis.totalApproval)}
          sub="across all brands"
        />
      </div>

      {/* Sort controls */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest font-medium text-[var(--text-tertiary)]">
          Sort
        </span>
        {SORT_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSortKey(key)}
            className={[
              "font-mono text-[11px] font-medium tracking-wide px-2.5 py-1.5 rounded border transition-all duration-100",
              sortKey === key
                ? "bg-[var(--gulf-slate-hi)] text-[var(--text-primary)] border-[var(--gulf-teal-dim)]"
                : "bg-[var(--gulf-slate)] text-[var(--text-secondary)] border-[var(--gulf-haze)] hover:text-[var(--text-primary)]",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Ranked list */}
      <div className="border-t border-[var(--gulf-haze)]">
        {sorted.map((brand, i) => {
          const color = barColor(brand.survival_rate, median);
          const barWidthPct = (brand.survival_rate * 100).toFixed(2);
          const isActive = selectedName === brand.franchise_name;

          return (
            <div
              key={brand.franchise_name}
              onClick={() =>
                setSelectedName((prev) =>
                  prev === brand.franchise_name ? null : brand.franchise_name,
                )
              }
              className={[
                "grid items-center gap-4 py-3.5 border-b border-[var(--gulf-haze)] cursor-pointer transition-colors duration-100",
                isActive
                  ? "bg-[var(--gulf-slate)] shadow-[inset_3px_0_0_var(--gulf-teal)]"
                  : "hover:bg-[var(--gulf-slate)]/50",
              ].join(" ")}
              style={{ gridTemplateColumns: "28px minmax(0,160px) 1fr 72px 72px" }}
            >
              {/* Rank */}
              <span className="pl-1 font-mono text-[11px] font-medium text-[var(--text-tertiary)]">
                {String(i + 1).padStart(2, "0")}
              </span>

              {/* Brand name + resolved summary */}
              <div>
                <div className="text-sm font-medium text-[var(--text-primary)] leading-snug">
                  {brand.franchise_name}
                </div>
                <span className="mt-0.5 block font-mono text-[11px] text-[var(--text-tertiary)]">
                  {brand.resolved} resolved · {brand.n_paid_in_full} paid · {brand.n_charged_off} co
                </span>
              </div>

              {/* Bar */}
              <div
                className="relative h-[18px] overflow-hidden rounded-sm"
                style={{ background: "color-mix(in srgb, var(--gulf-slate-hi) 60%, transparent)" }}
              >
                <div
                  className="h-full rounded-sm transition-[width] duration-700"
                  style={{ width: `${barWidthPct}%`, background: color }}
                />
              </div>

              {/* Survival % */}
              <span
                className="text-right font-mono text-[13px] font-medium tabular-nums"
                style={{ color }}
              >
                {fmtPct(brand.survival_rate)}
              </span>

              {/* Charge-off % */}
              <span className="text-right font-mono text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">
                {fmtPct(brand.chargeoff_rate)} co
              </span>
            </div>
          );
        })}
      </div>

      {/* Median marker */}
      <div
        className="py-2 font-mono text-[10px] font-medium uppercase tracking-widest text-[var(--gulf-teal)]"
        style={{ textShadow: "0 0 10px color-mix(in srgb, var(--gulf-teal) 45%, transparent)" }}
      >
        ↑ above pack median · {fmtPct(median)} ↓ below
      </div>

      {/* Detail panel */}
      <div className="min-h-[100px] rounded-lg border border-[var(--gulf-haze)] bg-[var(--gulf-slate)] p-5">
        {selected ? (
          <DetailPanel brand={selected} median={median} />
        ) : (
          <p className="py-5 text-center font-mono text-[11px] uppercase tracking-widest text-[var(--text-tertiary)]">
            Click any row to inspect the brand →
          </p>
        )}
      </div>

      {/* Footer — as-of + source */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--gulf-haze)] pt-3 font-mono text-[11px] text-[var(--text-tertiary)]">
        <span>SBA 7(a)/504 franchise loan outcomes · Lee &amp; Collier counties</span>
        {spec.asOf && <span>As of {spec.asOf}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KPITile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-[var(--gulf-haze)] bg-[var(--gulf-slate)] p-3.5">
      <span className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-widest text-[var(--text-secondary)]">
        {label}
      </span>
      <span className="block text-2xl font-semibold leading-none tabular-nums text-[var(--text-primary)]">
        {value}
      </span>
      <span className="mt-1.5 block font-mono text-[11px] text-[var(--text-tertiary)]">{sub}</span>
    </div>
  );
}

function DetailPanel({ brand, median }: { brand: FranchiseBrandPrepared; median: number }) {
  const color = barColor(brand.survival_rate, median);
  const abovePack = brand.survival_rate >= median;
  const diffPpts = ((brand.survival_rate - median) * 100).toFixed(1);
  const diffPrefix = Number(diffPpts) >= 0 ? "+" : "";

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-4 border-b border-[var(--gulf-haze)] pb-3">
        <h3 className="text-xl font-semibold leading-tight text-[var(--text-primary)]">
          {brand.franchise_name}
        </h3>
        <span
          className="whitespace-nowrap font-mono text-[11px] font-medium uppercase tracking-wider"
          style={{
            color,
            textShadow: `0 0 10px color-mix(in srgb, ${color} 45%, transparent)`,
          }}
        >
          {abovePack ? "Above pack" : "Below pack"} · {diffPrefix}
          {diffPpts} ppts
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(
          [
            { label: "Survival rate", val: fmtPct(brand.survival_rate), accent: color },
            { label: "Charge-off rate", val: fmtPct(brand.chargeoff_rate), accent: undefined },
            { label: "Resolved loans", val: String(brand.resolved), accent: undefined },
            {
              label: "Gross approval",
              val: fmtApproval(brand.total_gross_approval),
              accent: undefined,
            },
          ] as { label: string; val: string; accent?: string }[]
        ).map(({ label, val, accent }) => (
          <div key={label} className="flex flex-col gap-0.5">
            <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-[var(--text-secondary)]">
              {label}
            </span>
            <span
              className="text-xl font-semibold tabular-nums text-[var(--text-primary)]"
              style={accent ? { color: accent } : undefined}
            >
              {val}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
