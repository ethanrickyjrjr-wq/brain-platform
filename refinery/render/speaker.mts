/**
 * Speaker layer — Stage 6.
 *
 * Pure function. Parses a brain `.md` artifact and renders the conversational
 * reply appropriate for the requested tier (1/2/3). Runs AFTER Stage 4
 * output rendering; strips artifacts that don't belong in front of
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
 *   - No "corridor" in front of a human. Users speak in places, not road IDs;
 *     "corridor(s)" is swapped to "area(s)" in tier 1/2 prose, metric labels,
 *     and the scope header. Tier 3 (audit) keeps it — the receipt is internal.
 *   - No "siblings haven't shipped" / "sub-brain pointers" — protocol noise,
 *     stripped.
 *
 * Math-honest invariants:
 *
 *   - Numbers verbatim from `key_metrics[i].value`. Display formatting allowed;
 *     semantic compression is not.
 *   - `conclusion` rendered verbatim (or, in tier 1, with id-to-label swaps).
 *   - `caveats` always surfaced in tier 2 when non-empty.
 *   - Freshness token quoted on first response.
 */

import type { BrainOutput, BrainOutputMetric } from "../types/brain-output.mts";
import { hasFixtureSentinel } from "../lib/fixture-sentinels.mts";

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
  "traffic-swfl": "SWFL road traffic (FDOT)",
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
  md = md.replace(/\r\n/g, "\n");
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
 * Case-preserving swap of "corridor"/"corridors" → "area"/"areas". The word is
 * an internal road-ID frame; a human reader hears places. Capitalization of the
 * source token is preserved so a sentence-initial "Corridor" stays "Area".
 */
export function deCorridor(text: string): string {
  const cased = (orig: string, repl: string) =>
    orig[0] === orig[0].toUpperCase()
      ? repl[0].toUpperCase() + repl.slice(1)
      : repl;
  return text
    .replace(/\bcorridors\b/gi, (m) => cased(m, "areas"))
    .replace(/\bcorridor\b/gi, (m) => cased(m, "area"));
}

/**
 * Tier 1 / 2 prose sanitization: pack-id → label swap, banned-phrase strip,
 * corridor → area swap, `§` strip, whitespace normalization.
 */
export function sanitizeProse(text: string): string {
  let out = deCorridor(stripSectionMarker(text));
  for (const [pat, replacement] of BANNED_PROSE) {
    out = out.replace(pat, replacement);
  }
  for (const [id, label] of Object.entries(PACK_ID_LABELS)) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Negative lookahead spares paths / compound filenames — a following hyphen
    // or word char (e.g. "env-swfl-spike-findings.md") is NOT a bare pack id, so
    // it's left intact — while a sentence-final "env-swfl." still scrubs. Fixes
    // the mangled "docs/the SWFL flood + environmental read-spike-findings.md".
    const re = new RegExp(`\\b${escaped}\\b(?![-\\w]|\\s+brain)`, "g");
    out = out.replace(re, label);
  }
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/**
 * Max caveats rendered in a tier-2 reply. The full set stays in the tier-3
 * audit and in the BrainOutput (every downstream's input) — only the
 * human-facing chat reply is capped, with an explicit, non-silent "…and N more"
 * tail (CLAUDE.md: no silent caps — log what was dropped).
 */
const MAX_DISPLAY_CAVEATS = 8;

/** Format one degraded-input token: "_(Label · Jun 1, 2026)_". */
function formatDegradedToken(entry: { label: string; date: string }): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(entry.date + "T12:00:00Z"));
  return `_(${entry.label} · ${formatted})_`;
}

/**
 * Scrub internal technical tokens that `sanitizeProse` doesn't cover but that
 * leak through `caveats` — the only ungated prose channel (the facts-only and
 * smoothing linters guard the reference fence, not the OUTPUT caveats). Applied
 * to caveat lines ONLY. Conservative by construction: it must NEVER eat a
 * domain acronym (SOFR, NFIP, FEMA, FDOT, NAICS, AAL, WGS84) or a plain
 * number/date — those carry no underscore, no slash-path, and no lowercase-hex
 * run of 7+, so each rule is shaped to pass them through untouched.
 */
export function scrubCaveatTechnical(text: string): string {
  return (
    text
      // Source-code + doc file paths: refinery/… and any slash-path ending in a
      // code/doc extension (docs/…-spike-findings.md, refinery/sources/x.mts).
      .replace(/\brefinery\/\S+/g, "[internal]")
      .replace(
        /\b[\w.-]+(?:\/[\w.-]+)+\.(?:mts|ts|tsx|md|sql|json)\b/g,
        "[internal]",
      )
      // Commit hashes: a lowercase-hex run of 7–40 that contains BOTH a letter
      // (a–f) and a digit. Requiring both spares a pure-digit date (20260530),
      // an uppercase acronym (no /i flag), AND a lowercase all-letter English
      // word like "defaced"/"deedface" — real short commit hashes are mixed
      // alphanumeric, so this loses nothing while removing the false positives.
      .replace(
        /\b(?=[0-9a-f]{7,40}\b)(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{7,40}\b/g,
        "[ref]",
      )
      // Internal identifiers: a word with an internal underscore flanked by
      // alphanumerics (DFIRM_ID, REFINERY_SOURCE, chargeoff_pct,
      // MARKETBEAT_SUBMARKET_MAP). Acronyms have no underscore → untouched.
      .replace(/\b\w*[a-z0-9]_[a-z0-9]\w*\b/gi, "[config]")
  );
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
  const degradedToken =
    brain.output.degraded_inputs && brain.output.degraded_inputs.length > 0
      ? "\n\n" + brain.output.degraded_inputs.map(formatDegradedToken).join(" ")
      : "";
  const link = reportLink ? `\n\nFull breakdown → ${reportLink}` : "";
  return `${headline} ${conclusion}${degradedToken}${link}\n\n_Freshness:_ \`${brain.freshness_token}\``;
}

function renderTier2(brain: ParsedBrain, reportLink: string | null): string {
  const out = brain.output;
  const blocks: string[] = [];
  blocks.push(`**${sanitizeProse(humanScope(brain.scope))}**`);
  blocks.push(sanitizeProse(out.conclusion));
  if (out.degraded_inputs && out.degraded_inputs.length > 0) {
    const tokens = out.degraded_inputs.map(formatDegradedToken).join(" ");
    blocks.push(tokens);
  }
  if (out.conditional_claims && out.conditional_claims.length > 0) {
    const c = out.conditional_claims[0];
    blocks.push(
      `**If/then:** If ${sanitizeProse(c.condition)}, then expect ${c.then_direction}. ` +
        `_Falsifier:_ ${sanitizeProse(c.falsifier)}.`,
    );
  }
  if (out.key_metrics.length > 0) {
    blocks.push(renderMetricsTable(out.key_metrics));
  }
  if (out.caveats.length > 0) {
    // Backstop: the Stage-4 gate blocks a live artifact from ever carrying a
    // fixture sentinel, but if a bad artifact still slips through, strip the
    // raw sentinel caveats and replace them with one honest line.
    let caveats = out.caveats;
    if (caveats.some((c) => hasFixtureSentinel(c))) {
      caveats = [
        "One or more underlying datasets were running on cached sample data at build time.",
        ...caveats.filter((c) => !hasFixtureSentinel(c)),
      ];
    }
    const shown = caveats.slice(0, MAX_DISPLAY_CAVEATS);
    const lines = shown.map(
      (c) => `- ${scrubCaveatTechnical(sanitizeProse(c))}`,
    );
    const extra = caveats.length - shown.length;
    // No silent caps — name what was dropped (CLAUDE.md). Full set in tier 3.
    if (extra > 0) lines.push(`- …and ${extra} more in the full audit.`);
    blocks.push("**Caveats**\n" + lines.join("\n"));
  }
  if (out.grain_boundary && out.grain_boundary.not_available.length > 0) {
    blocks.push(
      "**What this can't tell you:** " +
        out.grain_boundary.not_available
          .slice(0, 2)
          .map((s) => sanitizeProse(s))
          .join(" "),
    );
  }
  // Finer-grain offers ride in their OWN block — never folded into the
  // can't-tell-you line above. These are grains we DO hold this run, surfaced
  // as plain user invitations (no internal ids, per the output-presentation
  // rule). Absent on every brain that holds no finer grain.
  if (out.grain_boundary?.routes && out.grain_boundary.routes.length > 0) {
    blocks.push(
      "**You can also ask:**\n" +
        out.grain_boundary.routes
          .map((s) => `- ${sanitizeProse(s)}`)
          .join("\n"),
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
    .map(
      (m) =>
        `| ${sanitizeProse(m.label)} | ${formatValue(m)} | ${m.direction} |`,
    )
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
