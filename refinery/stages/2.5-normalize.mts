import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TriagedFragment } from "../types/fragment.mts";
import type { PackDefinition } from "../types/pack.mts";
import { writeStage } from "../lib/raw-store.mts";
import { compilePatterns, matchSlugPattern } from "../vocab/patterns.mts";

/**
 * Stage 2.5 — Vocab Bridge.
 *
 * Sits between Triage (Stage 2) and Synthesis (Stage 3). Pure semantic layer:
 *   1. Maps every raw metric slug a brain emits to its canonical SKOS concept
 *      ID via refinery/vocab/brain-vocabulary.json.
 *   2. Enforces Talisman discipline: any slug claim a brain makes that is NOT
 *      registered in the vocabulary is reported as an "Orphan Concept" — in
 *      strict mode (the default) the run aborts with the orphan list; in
 *      non-strict mode the orphans pass through as a report on the result.
 *   3. Resolves the `direction` overload (Sentiment vs Trajectory) by field
 *      path, never by value — the vocab carries `raw_field_path` on each of
 *      the two qual_* concepts and the walker compares against the JSON path
 *      where each `direction` slug is observed.
 *
 * NON-GOAL: routing. The DAG (refinery/lib/dag.mts walkConsumers / resolveBuildOrder)
 * remains the single source of truth for which brain feeds which. This stage
 * is purely about meaning — what does THIS slug claim, and is the claim
 * registered in the vocabulary.
 */

// ---------------------------------------------------------------------------
// Vocab shape
// ---------------------------------------------------------------------------

export interface VocabConcept {
  id: string;
  prefLabel: string;
  altLabels?: string[];
  raw_slugs: string[];
  /**
   * Glob patterns for templated slug emissions (e.g.
   * `swfl_zip_*_flood_aal_usd_per_insured_property` for the per-ZIP NFIP
   * metrics env-swfl emits across the top-N AAL ZIPs). Walked as a LAST
   * resort by `resolveSlug` after the literal `slug_index` lookup and the
   * path-overload table miss — see `refinery/vocab/patterns.mts`.
   */
  raw_slug_patterns?: string[];
  category: string;
  domain?: string[];
  source_brains?: string[];
  value_type?: string;
  unit?: string | null;
  value_range?: [number, number];
  allowed_values?: (string | number)[];
  naics_code?: number;
  naics_title?: string;
  fred_series?: string;
  direction_concept?: string | null;
  status: "active" | "stub" | string;
  scope_note?: string;
  disambiguates?: string;
  /** "BrainOutput.direction" / "BrainOutputMetric.direction" / ... — used by Stage 2.5 to resolve overloads */
  raw_field_path?: string;
  ordered_collection?: string;
  /**
   * Optional per-slug grading config for the prediction grading loop (Goal 9).
   * Most slugs OMIT this and inherit: window_days from the concept's category,
   * epsilon/epsilon_mode/grade_basis from its value_type (see
   * refinery/vocab/loader.mts resolveGradeConfig). `direction_polarity` is the
   * ONE field that is never inherited — a slug without it is ungradeable by the
   * deterministic grader (within one category, opposite-polarity metrics coexist
   * e.g. survival-rate vs charge-off, so a category default would grade one
   * backwards).
   */
  grade?: {
    /** Which slug movement reads as bullish. NEVER inherited; required to be gradeable. */
    direction_polarity: "higher_is_bullish" | "lower_is_bullish" | "none";
    /** Override the category window default (days until a prediction is grade-ready). */
    window_days?: number;
    /** Override the value_type epsilon (deadband magnitude). */
    epsilon?: number;
    /** Override the value_type epsilon mode. */
    epsilon_mode?: "absolute" | "relative";
    /** Override the value_type grade basis. */
    grade_basis?: "delta" | "sign";
  };
}

export interface Vocabulary {
  meta: {
    schema_version: string;
    created_at: string;
    description: string;
    next_review?: string;
    audit_doc?: string;
  };
  concepts: Record<string, VocabConcept>;
  ordered_collections: Record<string, unknown>;
  slug_index: Record<string, string | { _note: string }>;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One canonicalized slug claim observed in a triaged fragment. */
export interface NormalizedTag {
  /** Path inside the fragment where the slug was observed (e.g. "classification.topic" or "normalized.metric"). */
  path: string;
  /** Original raw slug string as the brain wrote it. */
  raw_slug: string;
  /** Resolved canonical concept ID (e.g. "cre_cap_rate_median"). */
  concept_id: string;
  /** SKOS prefLabel from the vocabulary — convenient for downstream prompts. */
  prefLabel: string;
  /** Vocab category — "credit-risk", "real-estate", "macro", "qualitative", ... */
  category: string;
  /** Marks the disambiguation that was applied for `direction` slugs. */
  disambiguation?: "sentiment" | "trajectory" | null;
}

/** A slug claim the brain made that does not resolve to any registered concept. */
export interface OrphanReport {
  fragment_id: string;
  path: string;
  raw_slug: string;
  /** Why this counts as an orphan — narrative aid for error messages. */
  context: string;
}

/** A triaged fragment plus its Stage 2.5 vocab tags. Strict superset; safe to feed Stage 3. */
export interface NormalizedFragment<N = unknown> extends TriagedFragment<N> {
  /** Stage 2.5 — every raw metric slug found in the fragment, mapped to its canonical concept. */
  concept_tags: NormalizedTag[];
}

export interface NormalizeResult {
  normalized: NormalizedFragment[];
  /** Orphan slugs — empty if every claim resolved. Populated even in strict mode before the throw. */
  orphans: OrphanReport[];
}

export interface NormalizeOptions {
  /**
   * When true (default) the stage throws if any fragment carries an orphan
   * slug. Set to false to collect the orphan report without aborting — useful
   * during a migration window when a new brain has not yet been registered in
   * the vocab.
   */
  strict?: boolean;
  /**
   * Optional injected vocabulary — primarily for tests. Production callers
   * leave this unset and the bridge loads refinery/vocab/brain-vocabulary.json
   * (cached per process).
   */
  vocab?: Vocabulary;
}

// ---------------------------------------------------------------------------
// Vocab loading (cached)
// ---------------------------------------------------------------------------

const VOCAB_PATH = path.join(
  process.cwd(),
  "refinery",
  "vocab",
  "brain-vocabulary.json",
);

let vocabPromise: Promise<Vocabulary> | null = null;

export async function loadVocabulary(): Promise<Vocabulary> {
  if (!vocabPromise) {
    vocabPromise = readFile(VOCAB_PATH, "utf-8").then(
      (raw) => JSON.parse(raw) as Vocabulary,
    );
  }
  return vocabPromise;
}

/** Test hook — clear the cached promise so a fresh vocab read happens next call. */
export function resetVocabularyCache(): void {
  vocabPromise = null;
}

// ---------------------------------------------------------------------------
// Slug resolution
// ---------------------------------------------------------------------------

/** Slug strings whose canonical resolution depends on field path, not value. */
const PATH_AMBIGUOUS_SLUGS = new Set<string>(["direction"]);

/** A slug index entry is either a concept id (string) or a `_note` marker (ambiguous family). */
function looksLikeConceptId(entry: unknown): entry is string {
  return typeof entry === "string";
}

/**
 * Resolve a raw slug + the JSON path it was observed at to a canonical concept.
 *
 * For unambiguous slugs the slug_index lookup is final.
 *
 * For path-ambiguous slugs (`direction`) the resolver consults every concept's
 * `raw_field_path` and picks the one that matches. Tie-break rule when no
 * `raw_field_path` matches: nested-in-an-object → trajectory; top-level →
 * sentiment. (The Talisman default favors trajectory because Stage 2.5 only
 * ever sees fragment-level data; brain-level sentiment lives downstream in
 * Stage 4 BrainOutput.)
 *
 * If both lookups miss, the resolver consults `compilePatterns(vocab)` for
 * templated-slug concepts (e.g. env-swfl's `swfl_zip_*_<metric>` emissions)
 * via `matchSlugPattern`. Pattern matching is the LAST resort — literal
 * `slug_index` hits and path-ambiguous resolution both take precedence.
 */
export function resolveSlug(
  rawSlug: string,
  fieldPath: string,
  vocab: Vocabulary,
): {
  concept: VocabConcept;
  disambiguation: "sentiment" | "trajectory" | null;
} | null {
  // 1. Path-ambiguous family — resolve by field path.
  if (PATH_AMBIGUOUS_SLUGS.has(rawSlug)) {
    const direct = findConceptByFieldPath(rawSlug, fieldPath, vocab);
    if (direct) return direct;
    // Heuristic fallback: any direction nested inside a metric-like object
    // resolves to trajectory; a bare top-level direction resolves to sentiment.
    const isNestedMetric =
      fieldPath.includes("key_metrics") ||
      fieldPath.includes("metric") ||
      // any path that isn't a single segment is "nested"
      /[.\[]/.test(
        fieldPath.split(/^(?:normalized|classification)\./).pop() ?? fieldPath,
      );
    const targetId = isNestedMetric
      ? "qual_metric_trajectory"
      : "qual_sentiment_direction";
    const concept = vocab.concepts[targetId];
    if (!concept) return null;
    return {
      concept,
      disambiguation: isNestedMetric ? "trajectory" : "sentiment",
    };
  }

  // 2. Unambiguous slugs — direct index lookup.
  const entry = vocab.slug_index[rawSlug];
  if (looksLikeConceptId(entry)) {
    const concept = vocab.concepts[entry];
    if (concept) return { concept, disambiguation: null };
  }

  // 3. Pattern fallback — templated slug emissions (e.g. swfl_zip_<ZIP>_*).
  //    Last resort, only reached on literal-index miss.
  const matchedId = matchSlugPattern(rawSlug, compilePatterns(vocab));
  if (matchedId) {
    const concept = vocab.concepts[matchedId];
    if (concept) return { concept, disambiguation: null };
  }
  return null;
}

function findConceptByFieldPath(
  rawSlug: string,
  fieldPath: string,
  vocab: Vocabulary,
): {
  concept: VocabConcept;
  disambiguation: "sentiment" | "trajectory" | null;
} | null {
  for (const concept of Object.values(vocab.concepts)) {
    // Pattern-only concepts (raw_slug_patterns, no raw_slugs) carry no by-value
    // claims — guard so they never crash this by-value lookup.
    if (!concept.raw_slugs?.includes(rawSlug)) continue;
    if (!concept.raw_field_path) continue;
    if (fieldPath.endsWith(concept.raw_field_path)) {
      const disambiguation =
        concept.id === "qual_sentiment_direction"
          ? "sentiment"
          : concept.id === "qual_metric_trajectory"
            ? "trajectory"
            : null;
      return { concept, disambiguation };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fragment walker
// ---------------------------------------------------------------------------

/**
 * Collect explicit slug claims from a single triaged fragment.
 *
 * "Explicit claim" is defined narrowly so the walker does not invent slugs
 * out of every key it sees:
 *
 *   - classification.topic with the form "metric:<slug>" → claim of <slug>
 *   - normalized object property keyed "metric" with a string value → that
 *     string is a slug claim (this matches BrainOutputMetric shape)
 *   - normalized object property keyed "direction" with a string value AND
 *     where a sibling "metric" or "value" is present → that key is itself
 *     a slug claim (the value is the trajectory enum, not a slug)
 *   - any object key that itself appears in slug_index → that key is a claim
 *     (e.g. a normalized payload of `{ cap_rate_median: 6.4 }`)
 *
 * Claim collection is intentionally conservative — only structural patterns
 * that read as "this brain is asserting <slug>" get tagged.
 */
function collectClaims(
  fragment: TriagedFragment,
  vocab: Vocabulary,
): { claims: { path: string; raw_slug: string }[] } {
  const claims: { path: string; raw_slug: string }[] = [];
  const slugSet = new Set(Object.keys(vocab.slug_index));

  // 1. classification.topic
  const topic = fragment.classification.topic ?? "";
  const metricMatch = /^metric:(.+)$/.exec(topic);
  if (metricMatch) {
    claims.push({
      path: "classification.topic",
      raw_slug: metricMatch[1].trim(),
    });
  }

  // 2. recursive walk of `normalized`
  walk(fragment.normalized, "normalized", (path, key, value, siblings) => {
    // 2a. key itself is a registered slug → claim
    if (slugSet.has(key) && key !== "_direction_ambiguous") {
      claims.push({ path, raw_slug: key });
      return;
    }
    // 2b. { metric: "<slug>" } pattern
    if (key === "metric" && typeof value === "string") {
      claims.push({ path, raw_slug: value });
      return;
    }
    // 2c. { direction: "rising"|... } with sibling metric/value → claim of "direction"
    if (
      key === "direction" &&
      typeof value === "string" &&
      (siblings.has("metric") || siblings.has("value"))
    ) {
      claims.push({ path, raw_slug: "direction" });
      return;
    }
  });

  return { claims };
}

type VisitFn = (
  path: string,
  key: string,
  value: unknown,
  siblings: Set<string>,
) => void;

function walk(node: unknown, path: string, visit: VisitFn): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => walk(child, `${path}[${i}]`, visit));
    return;
  }
  if (node === null || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const siblings = new Set(Object.keys(obj));
  for (const [key, value] of Object.entries(obj)) {
    const childPath = `${path}.${key}`;
    visit(childPath, key, value, siblings);
    if (value && (typeof value === "object" || Array.isArray(value))) {
      walk(value, childPath, visit);
    }
  }
}

// ---------------------------------------------------------------------------
// Stage entry point
// ---------------------------------------------------------------------------

/**
 * Stage 2.5 — Vocab Bridge.
 *
 * Tag every triaged fragment with its canonical concept IDs and return both
 * the enriched fragments (drop-in for Stage 3) and an orphan report. In
 * strict mode (default), a non-empty orphan report aborts the run; the
 * cached Stage 2 artifact is the last good state on disk.
 */
export async function normalizeStage(
  fragments: TriagedFragment[],
  pack: PackDefinition,
  opts: NormalizeOptions = {},
): Promise<NormalizeResult> {
  const strict = opts.strict ?? true;
  const vocab = opts.vocab ?? (await loadVocabulary());

  const normalized: NormalizedFragment[] = [];
  const orphans: OrphanReport[] = [];

  for (const fragment of fragments) {
    const { claims } = collectClaims(fragment, vocab);
    const concept_tags: NormalizedTag[] = [];
    const seen = new Set<string>(); // de-dupe (path, raw_slug) tuples

    for (const claim of claims) {
      const key = `${claim.path}::${claim.raw_slug}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const resolved = resolveSlug(claim.raw_slug, claim.path, vocab);
      if (!resolved) {
        orphans.push({
          fragment_id: fragment.fragment_id,
          path: claim.path,
          raw_slug: claim.raw_slug,
          context:
            `Brain "${pack.id}" emitted slug "${claim.raw_slug}" at ${claim.path}, ` +
            `but no concept in refinery/vocab/brain-vocabulary.json registers it. ` +
            `Either add the concept to the vocab or remove the claim from the brain.`,
        });
        continue;
      }
      concept_tags.push({
        path: claim.path,
        raw_slug: claim.raw_slug,
        concept_id: resolved.concept.id,
        prefLabel: resolved.concept.prefLabel,
        category: resolved.concept.category,
        disambiguation: resolved.disambiguation,
      });
    }

    normalized.push({ ...fragment, concept_tags });
  }

  await writeStage(pack.id, "stage-2.5-normalize", {
    pack_id: pack.id,
    vocab_schema_version: vocab.meta.schema_version,
    fragment_count: normalized.length,
    tag_count: normalized.reduce((n, f) => n + f.concept_tags.length, 0),
    orphan_count: orphans.length,
    normalized,
    orphans,
  });

  if (strict && orphans.length > 0) {
    const sample = orphans
      .slice(0, 5)
      .map((o) => `  - ${o.fragment_id} :: ${o.path} :: "${o.raw_slug}"`)
      .join("\n");
    const more =
      orphans.length > 5 ? `\n  ... and ${orphans.length - 5} more` : "";
    throw new Error(
      `[normalize] Orphan Concept error: ${orphans.length} slug claim(s) in pack "${pack.id}" ` +
        `are not registered in refinery/vocab/brain-vocabulary.json:\n${sample}${more}\n` +
        `Add the missing concept(s) to the vocabulary or fix the brain. ` +
        `Pass { strict: false } to collect orphans without aborting.`,
    );
  }

  return { normalized, orphans };
}
