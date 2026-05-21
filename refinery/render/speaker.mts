/**
 * Speaker layer — Stage 6.
 *
 * Pure function. Parses a brain `.md` artifact and renders the conversational
 * reply appropriate for the requested tier (1/2/3). Runs AFTER Stage 5
 * role-rendering; strips the renderer artifacts that don't belong in front of
 * a human reader.
 *
 * Tier contract:
 *
 *   1  - Conversational. 2-5 sentences. Headline + conclusion + report link +
 *        freshness token. No metric table.
 *   2  - Structured. Scope opener + conclusion + capped key-metrics table +
 *        caveats + report link + freshness token. Tier-2 caps the table at 6
 *        rows so the chat reply stays scannable; the full set lives on the
 *        report page.
 *   3  - Audit. Raw `.md` passed through with a single artifact strip (§).
 *        Pack ids are PRESERVED — the audit IS the receipt, and you trace the
 *        chain by name.
 *
 * Hygiene rules (tier 1 / 2 only):
 *
 *   - No `§` symbol anywhere. Renderer artifact from the consumption protocol,
 *     not source content. Stripped in all tiers as a defensive measure.
 *   - No internal pack ids in prose. `env-swfl`, `properties-lee-value`, etc.
 *     are translated to human labels via PACK_ID_LABELS.
 *   - No "bifurcate" — style ban. Tokenized swap to "split".
 *   - No "siblings haven't shipped" / "sub-brain pointers" — protocol noise,
 *     stripped.
 *
 * Math-honest invariants (inherited from role-renderer):
 *
 *   - Numbers verbatim from `key_metrics[i].value`. Display formatting allowed;
 *     semantic compression is not.
 *   - `conclusion` rendered verbatim (or, in tier 1, with id-to-label swaps).
 *   - `caveats` always surfaced in tier 2 when non-empty.
 *   - Freshness token quoted on first response.
 */

import type { BrainOutput, BrainOutputMetric } from "../types/brain-output.mts";

export type SpeakerTier = 1 | 2 | 3;

export interface ParsedBrain {
  brain_id: string;
  version: number;
  freshness_token: string;
  scope: string;
  refined_at: string;
  output: BrainOutput;
  raw_md: string;
}

export interface SpeakOptions {
  tier: SpeakerTier;
  /**
   * Public origin used to build the report-page link, e.g.
   * "https://brain-platform-amber.vercel.app". When omitted, no link is
   * appended — useful for tests and for callers that want to assemble their
   * own link.
   */
  origin?: string;
}

/** Pack ids → human labels for prose substitution in tier 1/2 output. */
const PACK_ID_LABELS: Record<string, string> = {
  master: "the SWFL master read",
  "env-swfl": "the SWFL flood + environmental read",
  "properties-lee-value": "Lee County parcel velocity",
  "cre-swfl": "the SWFL commercial real-estate read",
  "franchise-outcomes": "franchise survival outcomes",
  "macro-us": "national macro",
  "macro-florida": "Florida macro",
  "macro-swfl": "regional SWFL macro",
  "sector-credit-swfl": "SWFL sector credit risk",
  "tourism-tdt": "Lee County tourism (TDT)",
  "logistics-swfl": "SWFL freight (FAF5)",
  "logistics-swfl-nowcast": "SWFL freight nowcast",
  "traffic-swfl": "SWFL corridor traffic (FDOT)",
  "storm-history-swfl": "SWFL storm history",
};

const BANNED_PROSE: Array<[RegExp, string]> = [
  [/\bbifurcate(s|d|ing)?\b/gi, "split"],
  [/siblings?\s+haven'?t\s+shipped\.?/gi, ""],
  [/sub-brain\s+pointers?:?/gi, ""],
];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a brain `.md` artifact into the structured payload the speaker consumes.
 * Throws on malformed input — callers decide how to surface to the user.
 */
export function parseBrainMarkdown(md: string): ParsedBrain {
  const frontmatter = extractFrontmatter(md);
  const outputJson = extractDelimitedSection(md, "OUTPUT");
  if (!outputJson) {
    throw new Error("speaker: no `--- OUTPUT ---` section in brain markdown");
  }
  let output: BrainOutput;
  try {
    output = JSON.parse(outputJson) as BrainOutput;
  } catch (err) {
    throw new Error(
      `speaker: failed to parse OUTPUT JSON: ${(err as Error).message}`,
    );
  }
  const required = [
    "brain_id",
    "version",
    "freshness_token",
    "scope",
    "refined_at",
  ] as const;
  for (const key of required) {
    if (!frontmatter[key]) {
      throw new Error(`speaker: frontmatter missing required key "${key}"`);
    }
  }
  return {
    brain_id: frontmatter.brain_id,
    version: Number(frontmatter.version),
    freshness_token: frontmatter.freshness_token,
    scope: frontmatter.scope,
    refined_at: frontmatter.refined_at,
    output,
    raw_md: md,
  };
}

/** Pulls the first `---`-delimited YAML block, tolerating a leading HTML comment. */
function extractFrontmatter(md: string): Record<string, string> {
  const m = md.match(/^(?:<!--[^>]*-->\s*\n)?---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error("speaker: no frontmatter in brain markdown");
  const obj: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    obj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return obj;
}

/**
 * Pulls the body of a `--- NAME ---` ... block. Body runs until the next
 * `--- ` header line, the closing reference-fence backticks, or end of file —
 * whichever comes first.
 */
function extractDelimitedSection(md: string, name: string): string | null {
  const re = new RegExp(
    `--- ${name} ---\\s*\\n([\\s\\S]*?)(?=\\n--- [A-Z]|\\n\`\`\`|$)`,
  );
  const m = md.match(re);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/** Strip the `§` artifact in every tier — it never belongs in source content. */
export function stripSectionMarker(text: string): string {
  return text.replace(/§/g, "");
}

/**
 * Tier 1 / 2 prose sanitization: pack-id → label swap, banned-phrase strip,
 * `§` strip, whitespace normalization.
 */
export function sanitizeProse(text: string): string {
  let out = stripSectionMarker(text);
  for (const [pat, replacement] of BANNED_PROSE) {
    out = out.replace(pat, replacement);
  }
  for (const [id, label] of Object.entries(PACK_ID_LABELS)) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b(?!\\s+brain)`, "g");
    out = out.replace(re, label);
  }
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function speak(brain: ParsedBrain, opts: SpeakOptions): string {
  const reportLink = opts.origin
    ? `${opts.origin.replace(/\/$/, "")}/r/${brain.brain_id}`
    : null;
  if (opts.tier === 1) return renderTier1(brain, reportLink);
  if (opts.tier === 2) return renderTier2(brain, reportLink);
  return renderTier3(brain);
}

function renderTier1(brain: ParsedBrain, reportLink: string | null): string {
  const headline = oneLineHeadline(brain.output);
  const conclusion = sanitizeProse(brain.output.conclusion);
  const link = reportLink ? `\n\nFull breakdown → ${reportLink}` : "";
  return `${headline} ${conclusion}${link}\n\n_Freshness:_ \`${brain.freshness_token}\``;
}

function renderTier2(brain: ParsedBrain, reportLink: string | null): string {
  const out = brain.output;
  const blocks: string[] = [];
  blocks.push(`**${humanScope(brain.scope)}**`);
  blocks.push(sanitizeProse(out.conclusion));
  if (out.key_metrics.length > 0) {
    blocks.push(renderMetricsTable(out.key_metrics));
  }
  if (out.caveats.length > 0) {
    blocks.push(
      "**Caveats**\n" +
        out.caveats.map((c) => `- ${sanitizeProse(c)}`).join("\n"),
    );
  }
  if (reportLink) blocks.push(`Full audit → ${reportLink}`);
  blocks.push(`_Freshness:_ \`${brain.freshness_token}\``);
  return blocks.join("\n\n");
}

function renderTier3(brain: ParsedBrain): string {
  return stripSectionMarker(brain.raw_md);
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function oneLineHeadline(out: BrainOutput): string {
  const dirWord =
    out.direction === "bullish"
      ? "Bullish"
      : out.direction === "bearish"
        ? "Bearish"
        : out.direction === "mixed"
          ? "Mixed"
          : "Neutral";
  const mag = Math.round(out.magnitude * 100);
  const conf = Math.round(out.confidence * 100);
  return `${dirWord} read (magnitude ${mag}%, confidence ${conf}%).`;
}

function humanScope(scope: string): string {
  // First clause before "—" reads like a title; the trailing detail is on the
  // report page already.
  return scope.split("—")[0].trim();
}

function renderMetricsTable(metrics: BrainOutputMetric[]): string {
  const rows = metrics
    .slice(0, 6)
    .map((m) => `| ${m.label} | ${formatValue(m)} | ${m.direction} |`)
    .join("\n");
  return `| Metric | Value | Direction |\n| --- | --- | --- |\n${rows}`;
}

function formatValue(m: BrainOutputMetric): string {
  if (typeof m.value === "string") return m.value;
  const v = m.value;
  switch (m.display_format) {
    case "currency":
      return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    case "percent":
      return v <= 1 && v >= -1
        ? `${(v * 100).toFixed(2)}%`
        : `${v.toFixed(2)}%`;
    case "count":
      return v.toLocaleString("en-US");
    case "ratio":
      return v.toFixed(2);
    default:
      return String(v);
  }
}
