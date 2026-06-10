import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseBrainMarkdown,
  speak,
  toDisplayBrain,
  isGroundedConditional,
  type SpeakerTier,
  type DisplayBrain,
  type ParsedBrain,
} from "../refinery/render/speaker.mts";
import type {
  BrainOutput,
  BrainOutputDetailTable,
  BrainOutputDetailRow,
  BrainOutputMetricDisplayFormat,
} from "../refinery/types/brain-output.mts";
import type { ChartBlock } from "../refinery/validate/chart-block-lint.mts";
import { computeMetricChart } from "../refinery/lib/chart-from-metrics.mts";

/**
 * Shared brain-fetch pipeline used by `/api/b/[slug]` and (Step 2) the MCP
 * route. Pure I/O wrapper around `parseBrainMarkdown` + `speak`. Transport-
 * agnostic: throws typed errors; callers map to HTTP, MCP tool errors, etc.
 *
 * Reads from `brains/{slug}.md` on disk — Node runtime only.
 */

const BRAINS_DIR = path.join(process.cwd(), "brains");

// Lowercase alphanumerics + hyphens. Blocks path traversal (../, leading dot, etc.).
const VALID_SLUG = /^[a-z0-9-]+$/;

export class BrainNotFoundError extends Error {
  constructor(slug: string) {
    super(`brain not found: ${slug}`);
    this.name = "BrainNotFoundError";
  }
}

export class BrainBadTierError extends Error {
  constructor(raw: unknown) {
    super(`tier must be 1, 2, or 3 (got ${JSON.stringify(raw)})`);
    this.name = "BrainBadTierError";
  }
}

/**
 * Resolve the public origin used to build the per-report URL inside the
 * speaker output. The MCP route can't rely on the request URL (Vercel's
 * internal hostname leaks through), so we fall back through env vars.
 *
 *   explicit param → BRAIN_PLATFORM_URL → https://VERCEL_URL → hardcoded
 *
 * `VERCEL_URL` is a hostname only (no protocol), per Vercel's docs.
 */
export function resolveOrigin(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.BRAIN_PLATFORM_URL) return process.env.BRAIN_PLATFORM_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://www.swfldatagulf.com";
}

export interface FetchBrainOptions {
  tier: SpeakerTier;
  /**
   * Public origin override. `/api/b` passes `url.origin` so HTTP responses
   * keep their existing report-link behavior. Omit to use the env-derived
   * canonical origin (`resolveOrigin`).
   */
  origin?: string;
}

export interface FetchBrainResult {
  text: string;
  freshness_token: string;
  /**
   * Structured BrainOutput parsed from the `--- OUTPUT ---` block. The MCP
   * route needs this to build the App resource block (conclusion, key_metrics,
   * caveats). HTTP `/api/b` ignores it. Always present — `parseBrainMarkdown`
   * throws if the OUTPUT block is missing.
   */
  output: BrainOutput;
  /**
   * Customer-safe, scrub-guaranteed projection (the same chokepoint the web
   * report page uses). The MCP App widget renders from this so no internal
   * token (brain_id, "master", tier code, metric slug) can ever reach the card.
   * `/api/b` ignores it.
   */
  display: DisplayBrain;
}

export function parseTier(raw: unknown): SpeakerTier {
  if (raw === 1 || raw === "1") return 1;
  if (raw === 2 || raw === "2") return 2;
  if (raw === 3 || raw === "3") return 3;
  throw new BrainBadTierError(raw);
}

export async function fetchBrain(slug: string, opts: FetchBrainOptions): Promise<FetchBrainResult> {
  if (!VALID_SLUG.test(slug)) {
    throw new BrainNotFoundError(slug);
  }

  let content: string;
  try {
    content = await readFile(path.join(BRAINS_DIR, `${slug}.md`), "utf-8");
  } catch {
    throw new BrainNotFoundError(slug);
  }

  const brain = parseBrainMarkdown(content);
  const text = speak(brain, {
    tier: opts.tier,
    origin: resolveOrigin(opts.origin),
  });

  return {
    text,
    freshness_token: brain.freshness_token,
    output: brain.output,
    display: toDisplayBrain(brain),
  };
}

/**
 * Disk read without speaker rendering. Returns the raw `.md` content. Used
 * by `/api/b/[slug]` when `?view` is not `"speak"` so the brain `.md` ships
 * verbatim. Throws `BrainNotFoundError` on missing/invalid slug.
 */
export async function readBrainMarkdown(slug: string): Promise<string> {
  if (!VALID_SLUG.test(slug)) {
    throw new BrainNotFoundError(slug);
  }
  try {
    return await readFile(path.join(BRAINS_DIR, `${slug}.md`), "utf-8");
  } catch {
    throw new BrainNotFoundError(slug);
  }
}

/**
 * Parse-on-read for the §C location fan-out. Returns the structured
 * `ParsedBrain` (frontmatter + OUTPUT block) instead of rendered prose, so
 * `assembleLocationDossier` can walk `detail_tables` / `key_metrics` per brain.
 *
 * Resilient by contract: a missing slug, an invalid slug, or a malformed
 * OUTPUT block returns `null` rather than throwing — one bad brain must never
 * 500 the whole dossier (the fan-out loop simply skips a `null`). Reads
 * `brains/{slug}.md` from disk — Node runtime only.
 */
export async function loadParsedBrain(slug: string): Promise<ParsedBrain | null> {
  try {
    const content = await readBrainMarkdown(slug);
    return parseBrainMarkdown(content);
  } catch {
    return null;
  }
}

/**
 * Dossier — the structured context bundle a downstream (Tier-3) Claude reasons
 * over without re-fetching (THE-GOAL). Carries the facts, the grounded
 * conditional thesis, the citable metrics, the explicit "what we do NOT have"
 * boundary, and the edge-typed drivers that answer "why?". Rides in the payload
 * envelope alongside the lean `rules` block.
 *
 * `key_metrics` are passed WHOLE — each entry keeps its `source` ({ url,
 * fetched_at, tier, citation }), which is what makes a conditional claim's
 * `basis_refs` citable, AND its precomputed `suggestions` (the Highlighter's
 * suggested follow-up questions, built at Stage-4 time), so the popup reads
 * them off the loaded dossier instead of re-deriving on the client. `drivers`
 * carry `edge_type` so the follow-up "why bearish?" is answered with "X vetoed
 * it, Y constrained it" from the loaded dossier, not invented.
 */
export interface Dossier {
  freshness_token: string;
  conclusion: string;
  direction: BrainOutput["direction"];
  magnitude: number;
  confidence: number;
  confidence_dispersion: number;
  joint_integrity: number;
  upstream_count: number;
  drivers: BrainOutput["drivers"];
  key_metrics: BrainOutput["key_metrics"];
  /**
   * Bulk per-row detail (e.g. housing-by-ZIP) the consumer looks up to answer a
   * specific-ZIP/area question instead of refusing because the headline only
   * broke out the extremes. Undefined on brains that hold no finer-grain rows.
   */
  detail_tables: BrainOutput["detail_tables"];
  conditional_claims: NonNullable<BrainOutput["conditional_claims"]>;
  grain_boundary: BrainOutput["grain_boundary"];
  contradicts: string[];
  caveats: string[];
  prediction_window?: string;
  /** Forward-proofs Track C MCP widget — embed charts go through corridor composer, not buildDossier. */
  chart?: ChartBlock;
}

/** Assemble the dossier from a parsed BrainOutput + its freshness token. */
export function buildDossier(output: BrainOutput, freshnessToken: string): Dossier {
  return {
    freshness_token: freshnessToken,
    conclusion: output.conclusion,
    direction: output.direction,
    magnitude: output.magnitude,
    confidence: output.confidence,
    confidence_dispersion: output.confidence_dispersion,
    joint_integrity: output.joint_integrity,
    upstream_count: output.upstream_count,
    drivers: output.drivers,
    key_metrics: output.key_metrics,
    detail_tables: output.detail_tables,
    // Drop the deterministic circular tie-breaker so no downstream client (one
    // that DOES forward _meta) ever sees "if the upstream split resolves → mixed"
    // as a real forecast. Only grounded, about-the-world claims survive.
    conditional_claims: (output.conditional_claims ?? []).filter(isGroundedConditional),
    grain_boundary: output.grain_boundary,
    contradicts: output.contradicts,
    caveats: output.caveats,
    prediction_window: output.prediction_window,
    // Tier-A "at a glance" bar, computed in code from the audited numbers. The
    // dossier the Highlighter already carries now includes a chart target.
    // Omitted (not null) when the brain has no chartable shape.
    ...(() => {
      const chart = computeMetricChart(output);
      return chart ? { chart } : {};
    })(),
  };
}

// ---------------------------------------------------------------------------
// ZIP / row drill — return ONE detail-table row in the TEXT block
// ---------------------------------------------------------------------------
//
// Fix B. The per-row detail (housing-by-ZIP) rides in `_meta.dossier`, which a
// well-behaved MCP client forwards to the model — but not every client does. A
// `zip` drill returns the specific row IN THE TEXT CONTENT BLOCK, so a question
// like "Gateway housing" (ZIP 33913) is answerable regardless of whether the
// client surfaces `_meta`, and without re-querying the lake (it reads the
// already-rendered detail_tables baked into brains/{slug}.md).

/** Format one detail cell for prose, honoring the column's display hint. */
function formatDetailCell(
  v: number | string | boolean,
  fmt?: BrainOutputMetricDisplayFormat,
): string {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v;
  switch (fmt) {
    case "currency":
      return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    case "percent":
      return `${v}%`;
    case "count":
      return v.toLocaleString("en-US");
    default:
      return String(v);
  }
}

/**
 * Render one detail-table row as a clean, customer-facing text block. Pure —
 * no I/O. The `metro` and `low_sample` columns are handled specially (a
 * parenthetical and a thin-sample caveat); every other non-empty cell becomes a
 * "Label: value" clause. Exported for unit testing.
 */
export function renderDetailRowText(
  table: BrainOutputDetailTable,
  row: BrainOutputDetailRow,
  ctx: { slug: string; freshnessToken: string; origin?: string },
): string {
  const heading = table.grain === "zip" ? `ZIP ${row.key}` : row.label || row.key;
  const metro = typeof row.cells.metro === "string" ? row.cells.metro : null;

  const clauses: string[] = [];
  for (const col of table.columns) {
    if (col.id === "metro" || col.id === "low_sample") continue;
    const v = row.cells[col.id];
    if (v === null || v === undefined || v === "") continue;
    clauses.push(`${col.label}: ${formatDetailCell(v, col.display_format)}`);
  }

  const blocks: string[] = [];
  blocks.push(`**${heading}${metro ? ` (${metro})` : ""}** — ${clauses.join("; ")}.`);

  if (row.cells.low_sample === true) {
    const n = typeof row.cells.homes_sold === "number" ? row.cells.homes_sold : null;
    blocks.push(
      `_Thin sample${n !== null ? ` — ${n} sale${n === 1 ? "" : "s"} this period` : ""}: treat the figure as indicative, not a stable median._`,
    );
  }

  blocks.push(`Source: ${table.source.citation}`);
  if (ctx.origin) {
    blocks.push(`Full report → ${ctx.origin.replace(/\/$/, "")}/r/${ctx.slug}`);
  }
  blocks.push(`_Freshness:_ \`${ctx.freshnessToken}\``);
  return blocks.join("\n\n");
}

export interface DetailRowResult {
  text: string;
  freshness_token: string;
  found: boolean;
}

/**
 * Look up a single row (by ZIP / key) across a brain's `detail_tables` and
 * render it as a text block. Reads `brains/{slug}.md` from disk — Node runtime
 * only. Throws `BrainNotFoundError` on a missing/invalid slug. When no row
 * matches, returns `found: false` with a short "what we hold" message so the
 * consumer offers the grain instead of inventing a number.
 */
export async function fetchDetailRow(
  slug: string,
  key: string,
  opts: { origin?: string } = {},
): Promise<DetailRowResult> {
  if (!VALID_SLUG.test(slug)) throw new BrainNotFoundError(slug);
  let content: string;
  try {
    content = await readFile(path.join(BRAINS_DIR, `${slug}.md`), "utf-8");
  } catch {
    throw new BrainNotFoundError(slug);
  }

  const brain = parseBrainMarkdown(content);
  const origin = resolveOrigin(opts.origin);
  const wantRaw = key.trim();
  // Pull a 5-digit ZIP if the caller passed something like "Zip Code: 33913".
  const want5 = wantRaw.match(/\d{5}/)?.[0] ?? wantRaw;

  for (const table of brain.output.detail_tables ?? []) {
    const matchRow = table.rows.find((r) => r.key === wantRaw || r.key === want5);
    if (matchRow) {
      return {
        text: renderDetailRowText(table, matchRow, {
          slug,
          freshnessToken: brain.freshness_token,
          origin,
        }),
        freshness_token: brain.freshness_token,
        found: true,
      };
    }
  }

  const link = `${origin.replace(/\/$/, "")}/r/${slug}`;
  return {
    text:
      `No specific row for "${wantRaw}" in this report — it may be outside the covered set. ` +
      `See the full report for what is covered → ${link}\n\n_Freshness:_ \`${brain.freshness_token}\``,
    freshness_token: brain.freshness_token,
    found: false,
  };
}
