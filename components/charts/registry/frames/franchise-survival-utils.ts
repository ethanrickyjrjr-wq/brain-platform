/**
 * Pure data functions for FranchiseSurvivalFrame.
 * No React imports — these are the testable adapter layer.
 *
 * All "resolved-loan only" calculations live here.  The component reads
 * `spec.options.data as FranchiseBrandRaw[]` and passes it to `prepareBrands`
 * before rendering — the frame stays dumb; the math stays here.
 */

export type SortKey = "survival" | "chargeoff" | "sample" | "approval";

/** One brand row as emitted by the franchise-outcomes source (fixture shape). */
export interface FranchiseBrandRaw {
  franchise_name: string;
  /** null means brand has only active loans and is not yet assessable. */
  survival_rate: number | null;
  n_paid_in_full: number | null;
  n_charged_off: number | null;
  n_loans: number;
  total_gross_approval: number;
}

/** A brand that has at least one resolved loan — assessable and renderable. */
export interface FranchiseBrandPrepared {
  franchise_name: string;
  survival_rate: number;
  chargeoff_rate: number;
  n_paid_in_full: number;
  n_charged_off: number;
  resolved: number;
  n_loans: number;
  total_gross_approval: number;
}

export interface FranchiseSurvivalKPIs {
  brandsAssessed: number;
  totalBrands: number;
  totalResolved: number;
  totalPaid: number;
  totalCharged: number;
  /** null when there are no resolved loans */
  overallSurvival: number | null;
  totalApproval: number;
}

/**
 * Filter to assessable brands only and derive `chargeoff_rate` + `resolved`.
 * A brand is assessable when it has at least one resolved loan (n_paid_in_full
 * + n_charged_off > 0 and both are non-null).
 */
export function prepareBrands(rows: FranchiseBrandRaw[]): FranchiseBrandPrepared[] {
  const out: FranchiseBrandPrepared[] = [];
  for (const r of rows) {
    if (r.survival_rate === null || r.n_paid_in_full === null || r.n_charged_off === null) continue;
    const resolved = r.n_paid_in_full + r.n_charged_off;
    if (resolved === 0) continue;
    out.push({
      franchise_name: r.franchise_name,
      survival_rate: r.survival_rate,
      chargeoff_rate: 1 - r.survival_rate,
      n_paid_in_full: r.n_paid_in_full,
      n_charged_off: r.n_charged_off,
      resolved,
      n_loans: r.n_loans,
      total_gross_approval: r.total_gross_approval,
    });
  }
  return out;
}

export function sortBrands(
  brands: FranchiseBrandPrepared[],
  key: SortKey,
): FranchiseBrandPrepared[] {
  return [...brands].sort((a, b) => {
    switch (key) {
      case "survival":
        return b.survival_rate - a.survival_rate;
      case "chargeoff":
        return b.chargeoff_rate - a.chargeoff_rate;
      case "sample":
        return b.resolved - a.resolved;
      case "approval":
        return b.total_gross_approval - a.total_gross_approval;
    }
  });
}

/** Median survival rate across all assessable brands. Returns 0 on empty input. */
export function computeMedian(brands: FranchiseBrandPrepared[]): number {
  if (brands.length === 0) return 0;
  const rates = [...brands].map((b) => b.survival_rate).sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  return rates.length % 2 === 0 ? (rates[mid - 1] + rates[mid]) / 2 : rates[mid];
}

/**
 * Bar color by survival vs pack median.
 *   ≥ median → mangrove green
 *   50%–median → neutral gold
 *   < 50%     → sunset coral
 */
export function barColor(survivalRate: number, median: number): string {
  if (survivalRate >= median) return "#5bc97a";
  if (survivalRate >= 0.5) return "#d4b370";
  return "#e08158";
}

export function computeKPIs(
  allRows: FranchiseBrandRaw[],
  assessed: FranchiseBrandPrepared[],
): FranchiseSurvivalKPIs {
  const totalResolved = assessed.reduce((s, b) => s + b.resolved, 0);
  const totalPaid = assessed.reduce((s, b) => s + b.n_paid_in_full, 0);
  const totalApproval = allRows.reduce((s, b) => s + b.total_gross_approval, 0);
  return {
    brandsAssessed: assessed.length,
    totalBrands: allRows.length,
    totalResolved,
    totalPaid,
    totalCharged: totalResolved - totalPaid,
    overallSurvival: totalResolved > 0 ? totalPaid / totalResolved : null,
    totalApproval,
  };
}

/** "$X.XM" or "$XXXK" — matches UI-Kit footer display. */
export function fmtApproval(v: number): string {
  if (v >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1) + "M";
  return "$" + Math.round(v / 1_000) + "K";
}

/** "91.9%" — one decimal, resolved-loan ratio read as written (data-protocol rule 4). */
export function fmtPct(v: number): string {
  return (v * 100).toFixed(1) + "%";
}
