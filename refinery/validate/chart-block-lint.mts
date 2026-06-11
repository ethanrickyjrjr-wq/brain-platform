/**
 * Chart-block lint — Step 3 of the corridor-character generator plan.
 *
 * Two layers of validation:
 *
 *   1. STRUCTURAL — the `chart_block` of a corridor-character synthesis
 *      output is either `null` (no chart was useful — fine) or
 *      `{ title: string, columns: string[], rows: cell[][] }` where every
 *      `rows[i].length === columns.length` and every cell is a string,
 *      number, or null.
 *
 *   2. PROVENANCE — every numeric cell value must be present in the fact
 *      pack (within tolerance, same as speculative-block-lint's anchors
 *      check). The chart-block prompt says "use only fact-pack values" —
 *      this lint enforces it. Web-cited peer numbers (Tampa office
 *      vacancy, national shopping-center averages, etc.) belong in the
 *      speculative block where hedging is allowed; the chart is for
 *      apples-to-apples comparisons against values the system can vouch
 *      for. Without this gate, the model leaks web context into the
 *      chart and the operator can't trust the table at a glance.
 *
 * String cells (labels like corridor names, units, etc.) are exempt —
 * they're not quantitative claims. Null cells are exempt — they're
 * explicit "no data" markers.
 *
 * Provenance check is opt-in: callers that haven't built a fact pack
 * (e.g. structural-only tests) pass `factPackNumbers: null` and only the
 * structural layer runs.
 */

export type ChartCell = string | number | null;

/**
 * How a renderer should format the numeric column of a chart. A semantic hint
 * the producer sets from its source `display_format`; the renderer
 * (`formatChartValue` in chart-adapter) maps it to a display string.
 *   currency → $X.XX (small per-unit money, e.g. $/sqft rent)
 *   usd      → $X,XXX (large dollar amounts, e.g. median price)
 *   aal      → $X,XXX/yr (annualized loss)
 *   percent  → X.X%
 *   count    → X,XXX (whole numbers)
 *   number   → X.XX (ratios / z-scores / unitless)
 */
export type ChartValueFormat = "currency" | "usd" | "aal" | "percent" | "count" | "number";

export interface ChartBlock {
  title: string;
  columns: string[];
  rows: ChartCell[][];
  chart_type?: "bar" | "area" | "scatter" | "table";
  /**
   * Optional render hint for the numeric column. Absent on legacy blocks
   * (e.g. corridor character_chart) — the renderer defaults to `currency` for
   * backward-compatibility. Not validated by the provenance/structural lint.
   */
  value_format?: ChartValueFormat;
  /**
   * KEYSTONE (Phase 1, presentation-deliverable-engine). ISO date `YYYY-MM-DD`
   * — the single-vintage as-of of every number in this block. Self-anchors the
   * chart so it travels honestly into a project/PDF without smuggling the date
   * into the title. PROVENANCE: validated for presence/shape only, never run
   * through prose content policing (FLAG-3). Legacy persisted blocks read back
   * without it are tolerated by the lint as a WARNING, not a hard error.
   */
  asOf: string;
  /**
   * Optional provenance for the caption — a short human citation + optional
   * URL. PROVENANCE like `asOf`: structure-checked only, content NEVER policed.
   */
  source?: { citation: string; url?: string };
}

export interface ChartLintResult {
  ok: boolean;
  errors: string[];
  /**
   * Non-fatal advisories. Missing `asOf` on a legacy (non-deliverable-bound)
   * block lands here instead of `errors` so the nightly render does not start
   * failing on pre-keystone persisted blocks.
   */
  warnings: string[];
}

/** Strict ISO calendar date `YYYY-MM-DD` (rejects rollovers like 2026-13-40). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Type-narrow cell values without leaking the renderer's tolerance to any. */
function isCell(v: unknown): v is ChartCell {
  return v === null || typeof v === "string" || typeof v === "number";
}

/** Is `value` within tolerance of any number in the anchor set?
 *  Mirrors speculative-block-lint.isAnchored — keep the two tolerances
 *  aligned so the chart and speculative blocks accept the same numbers. */
function isAnchored(value: number, anchors: ReadonlySet<number>, tolerance = 0.05): boolean {
  for (const a of anchors) {
    if (a === 0) {
      if (Math.abs(value) <= tolerance) return true;
    } else if (Math.abs((value - a) / a) <= tolerance) {
      return true;
    }
    if (Math.abs(value - a) <= tolerance) return true;
  }
  return false;
}

export function lintChartBlock(
  block: unknown,
  factPackNumbers: ReadonlySet<number> | null = null,
  opts: { requireAsOf?: boolean } = {},
): ChartLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // null is a legal value — the prompt is allowed to emit no chart.
  if (block === null) return { ok: true, errors, warnings };

  if (typeof block !== "object" || Array.isArray(block)) {
    errors.push("chart_block must be null or an object {title, columns, rows}.");
    return { ok: false, errors, warnings };
  }

  const b = block as Record<string, unknown>;

  if (typeof b.title !== "string" || b.title.length === 0) {
    errors.push("chart_block.title must be a non-empty string.");
  }

  if (!Array.isArray(b.columns)) {
    errors.push("chart_block.columns must be an array of strings.");
  } else {
    b.columns.forEach((c, i) => {
      if (typeof c !== "string" || c.length === 0) {
        errors.push(
          `chart_block.columns[${i}] must be a non-empty string, got ${JSON.stringify(c)}.`,
        );
      }
    });
  }

  if (!Array.isArray(b.rows)) {
    errors.push("chart_block.rows must be an array of cell arrays.");
  } else {
    const colsArr = Array.isArray(b.columns) ? b.columns : [];
    b.rows.forEach((row, ri) => {
      if (!Array.isArray(row)) {
        errors.push(`chart_block.rows[${ri}] must be an array.`);
        return;
      }
      if (colsArr.length > 0 && row.length !== colsArr.length) {
        errors.push(
          `chart_block.rows[${ri}] has ${row.length} cell(s); expected ${colsArr.length} to match columns.`,
        );
      }
      row.forEach((cell, ci) => {
        if (!isCell(cell)) {
          errors.push(
            `chart_block.rows[${ri}][${ci}] must be string|number|null, got ${typeof cell}.`,
          );
          return;
        }
        // Provenance check — numeric cells must trace to the fact pack.
        // Strings (labels, units, "—") and nulls bypass.
        if (factPackNumbers !== null && typeof cell === "number") {
          if (!isAnchored(cell, factPackNumbers)) {
            errors.push(
              `chart-provenance: chart_block.rows[${ri}][${ci}] = ${cell} is not in the fact pack. Web-cited peer values belong in the speculative block, not the chart. (See "use only fact-pack values" in the chart-block prompt fragment.)`,
            );
          }
        }
      });
    });
  }

  // --- KEYSTONE: as-of provenance (presence + ISO shape only) --------------
  // FLAG-3: asOf and source.* are PROVENANCE — structure-checked here, never
  // run through facts-only / smoothing / sanitizeProse content policing.
  const asOf = b.asOf;
  if (asOf === undefined || asOf === null || asOf === "") {
    const msg =
      "chart_block.asOf is missing — every chart must carry an ISO (YYYY-MM-DD) as-of date so the vintage travels into the deliverable.";
    if (opts.requireAsOf) errors.push(msg);
    else warnings.push(msg);
  } else if (typeof asOf !== "string" || !isValidIsoDate(asOf)) {
    errors.push(`chart_block.asOf must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(asOf)}.`);
  }

  if (b.source !== undefined && b.source !== null) {
    if (typeof b.source !== "object" || Array.isArray(b.source)) {
      errors.push("chart_block.source must be an object { citation, url? }.");
    } else {
      const s = b.source as Record<string, unknown>;
      if (typeof s.citation !== "string" || s.citation.length === 0) {
        errors.push("chart_block.source.citation must be a non-empty string.");
      }
      if (s.url !== undefined && typeof s.url !== "string") {
        errors.push("chart_block.source.url, when present, must be a string.");
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
