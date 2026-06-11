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

import type {
  BrainOutput,
  BrainOutputDirection,
  BrainOutputMetric,
} from "../types/brain-output.mts";
import { hasFixtureSentinel } from "../lib/fixture-sentinels.mts";
import { computeMetricChart } from "../lib/chart-from-metrics.mts";
import { methodHrefForSlug } from "../lib/methodology-registry.mts";
import type { ChartBlock, ChartCell } from "../validate/chart-block-lint.mts";

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
  master: "the Southwest Florida read",
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
  "permits-swfl": "SWFL building permits",
  "rentals-swfl": "SWFL rental market",
  "housing-swfl": "SWFL housing market",
  "safety-swfl": "SWFL public safety",
  "labor-demand-swfl": "SWFL labor demand",
  "econ-dev-swfl": "SWFL economic development",
  "city-pulse-swfl": "SWFL city pulse",
  "rsw-airport": "RSW airport activity",
  "news-swfl": "SWFL news signals",
  "flood-barrier-mode-1": "flood barrier",
};

const BANNED_PROSE: Array<[RegExp, string]> = [
  [/\bbifurcate(s|d|ing)?\b/gi, "split"],
  [/siblings?\s+haven'?t\s+shipped\.?/gi, ""],
  [/sub-brain\s+pointers?:?/gi, ""],
  // Brand: the lake's internal name never reaches a reader — it is SWFL Data Gulf.
  [/\bSWFL Intelligence Lake\b/gi, "SWFL Data Gulf"],
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
    throw new Error(`speaker: failed to parse OUTPUT JSON: ${(err as Error).message}`);
  }
  const required = ["brain_id", "version", "freshness_token", "scope", "refined_at"] as const;
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
  const re = new RegExp(`--- ${name} ---\\s*\\n([\\s\\S]*?)(?=\\n--- [A-Z]|\\n\`\`\`|$)`);
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
    orig[0] === orig[0].toUpperCase() ? repl[0].toUpperCase() + repl.slice(1) : repl;
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
    // `master` is the one id that also surfaces as a capitalized English word in
    // producer prose ("Master synthesizer…") — swap it case-insensitively so the
    // operator rule "nothing is master" holds even on sentence-initial uses.
    // Every other id is lowercase-kebab and only ever appears verbatim.
    const flags = id === "master" ? "gi" : "g";
    const re = new RegExp(`\\b${escaped}\\b(?![-\\w]|\\s+brain)`, flags);
    out = out.replace(re, label);
  }
  // Strip raw citation markers ([internal-3], [web-12]) — these ride inside
  // generator-authored corridor-character prose and a customer never sees a
  // footnote index. The `[INFERENCE]` tag is deliberately NOT matched: rule 7
  // requires it. The trace those markers carried is preserved upstream (the
  // report page links the phrase / cites the source) — here we just delete the
  // bracket so the chat answer reads clean if/when that voice is wired in.
  out = out.replace(/\s*\[(?:internal|web)-\d+\]/gi, "");
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/**
 * Post-process a master conclusion for user-facing display:
 * - Strip "Combined confidence … upstream brains." (shown in badges)
 * - Strip "Overrides: …." (internal cascade key, not a user concept)
 * - Trim "Driven by:" list to top 5 items + "and N more" tail
 */
function cleanConclusionText(text: string): string {
  let out = text
    .replace(
      /\s*Combined confidence\s[\d.]+,\s*trust tier\s*T\d+,\s*based on\s*\d+\s*upstream brain[s]?\.\s*/g,
      " ",
    )
    .replace(/\s*Overrides:[^.]+\.\s*/g, " ");

  // Strip the "Driven by: …" upstream roll-call entirely — process noise to a
  // reader. Drivers still surface as badges on the report page, not in prose.
  // The useful "Note conflicts: …" tension is left intact (it fuels the read).
  out = out.replace(/\s*Driven by:[^.]*\.\s*/g, " ");

  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/**
 * A conditional claim is "grounded" only when it speaks about the world
 * (rates, prices, tourism, flood) rather than the synthesizer's own vote math.
 * The deterministic master fallback emits a circular tie-breaker — "if the
 * upstream split resolves → mixed; falsifier: one side clears 60% on the next
 * refine" — which is process-noise, not a forecast. This filter suppresses
 * those everywhere a human (or a downstream Claude) reads the output, so the
 * one ungrounded claim never masquerades as a real prediction. Shared by the
 * speaker, the MCP widget, and the dossier — filtered in exactly one place.
 */
export function isGroundedConditional(c: { condition: string; falsifier: string }): boolean {
  const internal =
    /\b(upstream|refines?|refined|agreement threshold|weights?\s+clear|breaks?\s+the\s+tie|the\s+tie|synthesis|the\s+vote|vote\s+weight)\b/i;
  return !internal.test(c.condition) && !internal.test(c.falsifier);
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
      // Internal data-host phrase: "Brains Supabase" names our storage vendor,
      // not a customer-facing source. Map it to the public lake name. Maximally
      // specific (two literal words) so it can never eat domain prose.
      .replace(/\bBrains\s+Supabase\b/gi, "SWFL Data Gulf")
      // Schema-qualified DB identifiers (data_lake.city_pulse_corridors,
      // public.corridor_profiles) — redact the whole schema.table as ONE unit.
      // The [config] rule below only catches a table name that happens to
      // contain an underscore; a name like `data_lake.permits` would leak the
      // table half straight through. Named schemas only, so it never eats prose.
      .replace(/\b(?:data_lake|public|information_schema)\.[a-z_][a-z0-9_]*\b/gi, "[internal]")
      // Source-code + doc file paths: refinery/… and any slash-path ending in a
      // code/doc extension (docs/…-spike-findings.md, refinery/sources/x.mts).
      .replace(/\brefinery\/\S+/g, "[internal]")
      .replace(/\b[\w.-]+(?:\/[\w.-]+)+\.(?:mts|ts|tsx|md|sql|json)\b/g, "[internal]")
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
      // Trust-tier codes never belong in a customer-facing caveat. Matches the
      // explicit phrasings ("trust tier 3", "tier T2") and a bare T-code
      // (T1–T4). A bare "T3" in real caveat prose is always a tier reference —
      // domain acronyms (SOFR, FEMA) and years (2024) never take that shape.
      .replace(/\b(?:trust\s+)?tiers?\s*[:-]?\s*T?[1-4]\b/gi, "[internal]")
      .replace(/\bT[1-4]\b/g, "[internal]")
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function speak(brain: ParsedBrain, opts: SpeakOptions): string {
  const reportLink = opts.origin ? `${opts.origin.replace(/\/$/, "")}/r/${brain.brain_id}` : null;
  if (opts.tier === 1) return renderTier1(brain, reportLink);
  if (opts.tier === 2) return renderTier2(brain, reportLink);
  return renderTier3(brain);
}

function renderTier1(brain: ParsedBrain, reportLink: string | null): string {
  const headline = oneLineHeadline(brain.output);
  const conclusion = cleanConclusionText(sanitizeProse(brain.output.conclusion));
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
  blocks.push(cleanConclusionText(sanitizeProse(out.conclusion)));
  if (out.degraded_inputs && out.degraded_inputs.length > 0) {
    const tokens = out.degraded_inputs.map(formatDegradedToken).join(" ");
    blocks.push(tokens);
  }
  // Show the FIRST grounded conditional — not just [0]. If the primary claim is
  // the deterministic circular tie-breaker ("if the upstream split resolves →
  // mixed"), a later world-facing claim should still surface. One only, so the
  // initial answer stays tight (operator: "don't ramble").
  const groundedClaim = out.conditional_claims?.find(isGroundedConditional);
  if (groundedClaim) {
    blocks.push(
      `**What would move this:** If ${sanitizeProse(groundedClaim.condition)}, expect ${groundedClaim.then_direction}. ` +
        `_What would flip it:_ ${sanitizeProse(groundedClaim.falsifier)}.`,
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
    // Scrub + drop machine-internal QA noise ([config] dumps, D-mapped-area and
    // verified-corpus notes) — the SAME filter the web report page uses, so the
    // connector text no longer shows the "[config], [config], …" wall.
    const cleaned = caveats
      .map((c) => scrubCaveatTechnical(sanitizeProse(c)))
      .filter(isDisplayableCaveat);
    if (cleaned.length > 0) {
      const shown = cleaned.slice(0, MAX_DISPLAY_CAVEATS);
      const lines = shown.map((c) => `- ${c}`);
      const extra = cleaned.length - shown.length;
      // No silent caps — name what was dropped (CLAUDE.md). Full set in tier 3.
      if (extra > 0) lines.push(`- …and ${extra} more in the full audit.`);
      blocks.push("**Caveats**\n" + lines.join("\n"));
    }
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
        out.grain_boundary.routes.map((s) => `- ${sanitizeProse(s)}`).join("\n"),
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
    .map((m) => `| ${sanitizeProse(m.label)} | ${formatValue(m)} | ${m.direction} |`)
    .join("\n");
  return `| Metric | Value | Direction |\n| --- | --- | --- |\n${rows}`;
}

function formatValue(m: BrainOutputMetric): string {
  if (typeof m.value === "string") return m.value;
  const v = m.value;
  switch (m.display_format) {
    case "currency":
      return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    case "percent": {
      // Percentage-points by DEFAULT (vacancy 3.2 → "3.20%", cap rate 6.7 →
      // "6.70%"). Only a genuine 0–1 *share* — signalled by `units`
      // ("share"/"ratio"/"fraction"/"proportion", e.g. the permit saturation
      // index) — is scaled up by 100. The old magnitude heuristic (|v| ≤ 1 →
      // ×100) misfired on legitimately small percentages: a 0.4% vacancy rate
      // rendered as "40.00%" (the Naples/Estero bug).
      const u = (m.units ?? "").toLowerCase();
      const isShare = u === "share" || u === "ratio" || u === "fraction" || u === "proportion";
      return isShare ? `${(v * 100).toFixed(2)}%` : `${v.toFixed(2)}%`;
    }
    case "count":
      return v.toLocaleString("en-US");
    case "ratio":
      return v.toFixed(2);
    default:
      return String(v);
  }
}

// ---------------------------------------------------------------------------
// Display normalizer — the ONE chokepoint every CUSTOMER surface consumes
// ---------------------------------------------------------------------------
//
// `toDisplayBrain` is the single door a raw BrainOutput passes through before a
// human ever sees it. The returned `DisplayBrain` TYPE deliberately carries no
// `brain_id`, no `trust_tier`, no per-metric `source.tier`, no metric slug, and
// no drivers/overrides/contradicts — so a renderer literally CANNOT print them
// (it's a compile error, not a code-review catch). Both the web report page
// (`app/r/[slug]/page.tsx`) and the chat speaker path source their display
// strings from here, so the two can never drift back apart. The build-failing
// guard lives in `display-leak.test.mts`.

/**
 * Pack ids → page-title display names. Distinct from `PACK_ID_LABELS` (which is
 * mid-sentence phrasing like "the SWFL master read"); these are title-cased for
 * an <h1> / chat heading. Unknown ids fall back to `humanizeBrainId` so a
 * brand-new brain never crashes and never leaks a raw slug.
 */
const PACK_DISPLAY_NAMES: Record<string, string> = {
  master: "Southwest Florida — Market Read",
  "env-swfl": "Southwest Florida — Flood & Environmental Read",
  "properties-lee-value": "Lee County — Parcel Velocity",
  "cre-swfl": "Southwest Florida — Commercial Real Estate",
  "franchise-outcomes": "Franchise Survival Outcomes",
  "macro-us": "National Macro",
  "macro-florida": "Florida Macro",
  "macro-swfl": "Southwest Florida — Regional Macro",
  "sector-credit-swfl": "Southwest Florida — Sector Credit Risk",
  "tourism-tdt": "Lee County — Tourism (TDT)",
  "logistics-swfl": "Southwest Florida — Freight",
  "logistics-swfl-nowcast": "Southwest Florida — Freight Nowcast",
  "traffic-swfl": "Southwest Florida — Road Traffic",
  "storm-history-swfl": "Southwest Florida — Storm History",
  "labor-demand-swfl": "Southwest Florida — Labor Demand",
  "permits-swfl": "Southwest Florida — Building Permits",
  "rentals-swfl": "Southwest Florida — Rental Market",
  "housing-swfl": "Southwest Florida — Housing Market",
  "safety-swfl": "Southwest Florida — Public Safety",
  "econ-dev-swfl": "Southwest Florida — Economic Development",
  "city-pulse-swfl": "Southwest Florida — City Pulse",
  "rsw-airport": "RSW Airport Activity",
  "news-swfl": "Southwest Florida — News Signals",
};

/** Kebab id → Title Case, e.g. "new-brain-swfl" → "New Brain Swfl". */
function humanizeBrainId(id: string): string {
  return id
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** The customer-facing title for a brain id. Never returns a raw slug. */
export function displayName(brainId: string): string {
  return PACK_DISPLAY_NAMES[brainId] ?? humanizeBrainId(brainId);
}

/**
 * Collapse a (possibly long, possibly internal-laden) citation into a short,
 * clean source label for the metrics table. Cuts at the first natural break
 * (em/en-dash, " via ", colon, or " ("), scrubs internal identifiers, and caps
 * length so one cell can never become the unreadable wall.
 */
function shortSourceLabel(citation: string): string {
  const head = citation.split(/\s+[—–]\s+|\s+via\s+|:\s|\s+\(/)[0].trim();
  const cleaned = scrubCaveatTechnical(head)
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned.length > 72 ? cleaned.slice(0, 71).trimEnd() + "…" : cleaned;
}

/** One metric, customer-safe. No slug, no tier — those aren't fields here. */
export interface DisplayMetric {
  label: string;
  value: string;
  direction: string;
  /** Short clean label for the main table. */
  sourceLabel: string;
  sourceUrl: string;
  /** Scrubbed full citation, for the collapsed detail block only. */
  sourceFull: string;
  /** ISO fetch date, for the detail block only. */
  fetchedAt: string;
  /**
   * Highlighter Reach — the metric's precomputed suggested follow-up questions,
   * carried from the dossier (`BrainOutputMetric.suggestions`) so the popup
   * reads them off the rendered page instead of re-deriving on the client.
   * Each string runs through the same prose sanitizer as every other display
   * string. Empty array when the brain predates the type-lift / a producer
   * opted out — the client keeps its `suggestionsForMetric` fallback then.
   */
  suggestions: string[];
  /**
   * Public `/r/method/<slug>` URL when this metric's slug is documented in the
   * methodology registry, else absent. The raw slug NEVER enters this type — only
   * a finished, allowlist-vetted URL (same shape as `sourceUrl`), so the
   * display-leak invariant holds.
   */
  methodHref?: string;
}

/**
 * Customer-safe projection of a brain. The TYPE is the guard: it has no
 * `brain_id`, `trust_tier`, `source.tier`, metric slug, drivers, overrides, or
 * contradicts — printing any of those is impossible because they don't exist
 * here. Caveats are split summary/detail so the main view stays readable.
 */
export interface DisplayBrain {
  /** Title-cased display name — never a raw brain_id. */
  title: string;
  scope: string;
  freshnessToken: string;
  refinedAt: string;
  direction: BrainOutputDirection;
  magnitudePct: number;
  confidencePct: number;
  conclusion: string;
  metrics: DisplayMetric[];
  /** First MAX_DISPLAY_CAVEATS, scrubbed — shown on the main view. */
  summaryCaveats: string[];
  /** The rest, scrubbed — for the collapsed "full detail" block. */
  detailCaveats: string[];
  /**
   * Tier-A "at a glance" bar chart computed in code from this brain's audited
   * numbers (`computeMetricChart`), or `null` when the brain has no chartable
   * shape. Carries ONLY human labels + already-public values (the comparable
   * numeric column of a detail_table, or a same-format key_metrics group) —
   * no slug / brain_id / tier / internal cell — so it rides this customer
   * projection safely. The display-leak guard enforces that (see
   * `display-leak.test.mts`).
   */
  chart: ChartBlock | null;
}

/**
 * Scrub a chart's string cells/columns/title through the same prose sanitizer
 * every other display string passes, so a label can never carry a pack-id,
 * "corridor", `§`, or a citation marker onto the customer surface. Numbers and
 * nulls pass through untouched.
 */
function sanitizeChart(block: ChartBlock | null): ChartBlock | null {
  if (block === null) return null;
  const cleanCell = (c: ChartCell): ChartCell => (typeof c === "string" ? sanitizeProse(c) : c);
  return {
    title: sanitizeProse(block.title),
    columns: block.columns.map((c) => sanitizeProse(c)),
    rows: block.rows.map((row) => row.map(cleanCell)),
    ...(block.chart_type ? { chart_type: block.chart_type } : {}),
    ...(block.value_format ? { value_format: block.value_format } : {}),
    // FLAG-3: asOf + source are PROVENANCE — copied verbatim, never run through
    // sanitizeProse. The display-leak guard concerns slugs/ids in labels, not
    // the as-of date or citation.
    asOf: block.asOf,
    ...(block.source ? { source: block.source } : {}),
  };
}

/**
 * THE chokepoint. Raw brain in, customer-safe `DisplayBrain` out. Every string
 * runs through the existing sanitizers; every internal field is dropped at the
 * type level. Degrades gracefully on missing/empty fields (new brains, no
 * metrics, no caveats) — never throws.
 */
/** Drop technical QA caveats that are noise on a user-facing page. */
function isDisplayableCaveat(scrubbed: string): boolean {
  // Sub-market corpus QA notes (cre-swfl corridor mapping quality)
  if (/D-mapped areas/i.test(scrubbed)) return false;
  if (/verified corpus this run/i.test(scrubbed)) return false;
  // Anything that still contains a [config] token after scrubbing is
  // machine-internal — suppress it from the summary view.
  if (scrubbed.includes("[config]")) return false;
  return true;
}

export function toDisplayBrain(brain: ParsedBrain): DisplayBrain {
  const out = brain.output;
  const cleanCaveats = (out.caveats ?? [])
    .map((c) => scrubCaveatTechnical(sanitizeProse(c)))
    .filter(isDisplayableCaveat);
  return {
    title: displayName(brain.brain_id),
    scope: sanitizeProse(humanScope(brain.scope)),
    freshnessToken: brain.freshness_token,
    refinedAt: brain.refined_at,
    direction: out.direction,
    magnitudePct: Math.round(out.magnitude * 100),
    confidencePct: Math.round(out.confidence * 100),
    conclusion: cleanConclusionText(sanitizeProse(out.conclusion)),
    metrics: (out.key_metrics ?? []).map((m) => ({
      label: sanitizeProse(m.label),
      value: formatValue(m),
      direction: m.direction,
      sourceLabel: shortSourceLabel(m.source.citation),
      sourceUrl: m.source.url,
      sourceFull: scrubCaveatTechnical(sanitizeProse(m.source.citation)),
      fetchedAt: m.source.fetched_at,
      // Highlighter Reach — carry the dossier's precomputed suggestions, each
      // sanitized like every other display string. Absent on pre-lift brains.
      suggestions: (m.suggestions ?? []).map((s) => sanitizeProse(s)),
      methodHref: methodHrefForSlug(m.metric),
    })),
    summaryCaveats: cleanCaveats.slice(0, MAX_DISPLAY_CAVEATS),
    detailCaveats: cleanCaveats.slice(MAX_DISPLAY_CAVEATS),
    chart: sanitizeChart(computeMetricChart(out)),
  };
}
