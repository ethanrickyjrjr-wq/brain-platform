import type { Dossier } from "../fetch-brain";

export interface GroundingBlock {
  /** Human label the model uses to attribute a number ("Naples housing", "Naples flood (env-swfl)"). */
  label: string;
  dossier: Dossier;
}

export interface GroundingInput {
  rules: string; // RULES_OF_ENGAGEMENT, verbatim
  gazetteer: string; // GEOGRAPHY_GAZETTEER, verbatim
  blocks: GroundingBlock[]; // [0] = current report; [1..] = reach targets
}

/** Inline a dossier's detail_tables as compact rows so cross-area lookups are in-context (R0). */
function renderDetailTables(d: Dossier): string {
  if (!d.detail_tables || d.detail_tables.length === 0) return "";
  const out: string[] = [];
  for (const t of d.detail_tables) {
    out.push(
      `  Table "${t.title}" (grain: ${t.grain}; source: ${t.source.citation}):`,
    );
    for (const r of t.rows) {
      const cells = Object.entries(r.cells)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      out.push(`    - ${r.key} (${r.label}): ${cells}`);
    }
  }
  return out.join("\n");
}

function renderKeyMetrics(d: Dossier): string {
  return d.key_metrics
    .map(
      (m: any) =>
        `  - ${m.metric}: ${m.value}${m.source?.citation ? ` [${m.source.citation}]` : ""}`,
    )
    .join("\n");
}

function renderBlock(b: GroundingBlock): string {
  const d = b.dossier;
  const parts = [
    `### ${b.label}`,
    `Conclusion: ${d.conclusion}`,
    `Key metrics:\n${renderKeyMetrics(d)}`,
  ];
  const tables = renderDetailTables(d);
  if (tables)
    parts.push(
      `Detail rows (every covered area — use these to compare):\n${tables}`,
    );
  if (d.caveats.length) parts.push(`Caveats: ${d.caveats.join("; ")}`);
  if (d.grain_boundary)
    parts.push(`What we do NOT hold: ${JSON.stringify(d.grain_boundary)}`);
  return parts.join("\n");
}

export function buildGroundingContext(input: GroundingInput): string {
  const primary = input.blocks[0];
  const token = primary?.dossier.freshness_token ?? "";
  return [
    "You are the SWFL Data Gulf in-page analyst. Answer ONLY from the grounded blocks below.",
    "Cite the block label for every number. If the data needed is not in any block, DECLINE and say what we do not hold — never invent a SWFL number finer than a block provides.",
    "Tag any projection beyond the cited numbers inline with [INFERENCE] and give one falsifying condition.",
    `Quote this freshness token exactly once in your answer: ${token}`,
    "",
    "=== RULES OF ENGAGEMENT ===",
    input.rules,
    "",
    "=== GEOGRAPHY ===",
    input.gazetteer,
    "",
    "=== GROUNDED DATA ===",
    input.blocks.map(renderBlock).join("\n\n"),
  ].join("\n");
}
