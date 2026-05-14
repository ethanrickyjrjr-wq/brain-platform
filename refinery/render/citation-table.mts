import type { CitationRow } from "../types/pack.mts";

const HEADERS = ["id", "source", "verified", "expires"] as const;

/**
 * Render the CITATION TABLE as pipe-delimited plain text (spec section 3c).
 * Columns are space-padded for human readability; the pipe is the real delimiter.
 */
export function renderCitationTable(rows: CitationRow[]): string {
  const matrix = [
    [...HEADERS],
    ...rows.map((r) => [r.id, r.source, r.verified, r.expires]),
  ];
  const widths = HEADERS.map((_, col) =>
    Math.max(...matrix.map((row) => row[col].length)),
  );
  return matrix
    .map((row) =>
      row
        .map((cell, col) => cell.padEnd(widths[col]))
        .join(" | ")
        .trimEnd(),
    )
    .join("\n");
}
