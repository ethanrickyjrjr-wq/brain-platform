import type { Vocabulary } from "../stages/2.5-normalize.mts";

/**
 * Pattern-based slug resolution for templated emissions.
 *
 * Companion to the literal `slug_index` lookup in
 * `refinery/stages/2.5-normalize.mts:resolveSlug`. Some concepts are emitted
 * by packs as ZIP- or parcel-templated slug strings — for example env-swfl
 * emits per-ZIP NFIP metrics as `swfl_zip_33931_flood_aal_usd_per_insured_property`
 * across the top-N highest-AAL ZIPs. The constitution layer
 * (`refinery/constitution/real-estate.mts`) already matches these via regex
 * inside the `flood-barrier-mode-1` predicate, but the SKOS slug_index does
 * literal-string lookup and orphans them. This module closes that gap.
 *
 * The matcher is the LAST resort: callers consult `slug_index` first and the
 * path-overload table second; only on miss do they walk compiled patterns.
 * Precedence is enforced by the call site, not this module.
 *
 * Pattern syntax: simple globs of the form `prefix_*_suffix`, where `*` stands
 * for ONE underscore-bounded segment. `**` stands for one-or-more segments
 * (i.e. matches across underscores) — use it when the templated tail is a
 * multi-word place slug, e.g. `vacancy_rate_marketbeat_**` covers both
 * `…_naples` and `…_bonita_springs`. Regex metacharacters in the literal
 * portions are escaped so a pattern like `aal_per_yr_*` matches the literal
 * underscore, not "any character." See unit tests for the exact contract.
 */

export interface CompiledPattern {
  /** Anchored `^…$` regex compiled from the source glob. */
  regex: RegExp;
  /** The concept id whose `raw_slug_patterns` produced this entry. */
  conceptId: string;
  /** Original glob string — kept for debugging / error messages only. */
  source: string;
}

// WeakMap is a hot-path optimization for the long-running CLI, where the
// vocabulary object is loaded once at startup (loadVocabularySync caches it)
// and the compiled pattern list can be reused across every Stage 2.5 call
// and every render-roles invocation. In unit tests that call
// `resetVocabularyCacheSync()` between runs, each load produces a fresh
// vocab object, so the WeakMap is cold every time — that is correct, not a
// perf bug; the cache simply has no work to amortize over in unit tests.
const cache = new WeakMap<Vocabulary, CompiledPattern[]>();

/**
 * Build (or return the cached) compiled pattern list for the given vocab.
 * Walks every concept and its `raw_slug_patterns`; concepts without the
 * field contribute zero entries.
 */
export function compilePatterns(vocab: Vocabulary): CompiledPattern[] {
  const hit = cache.get(vocab);
  if (hit) return hit;
  const out: CompiledPattern[] = [];
  for (const concept of Object.values(vocab.concepts)) {
    const patterns = concept.raw_slug_patterns;
    if (!patterns || patterns.length === 0) continue;
    for (const glob of patterns) {
      out.push({
        regex: globToRegex(glob),
        conceptId: concept.id,
        source: glob,
      });
    }
  }
  cache.set(vocab, out);
  return out;
}

/**
 * Walk the compiled pattern list and return the first matching concept id.
 * O(n) over the compiled list; n is small in practice (one or two patterns
 * per templated-slug concept) so a linear scan is faster than building a
 * trie. Returns null on no match — caller treats that as an orphan.
 */
export function matchSlugPattern(
  rawSlug: string,
  compiled: readonly CompiledPattern[],
): string | null {
  for (const entry of compiled) {
    if (entry.regex.test(rawSlug)) return entry.conceptId;
  }
  return null;
}

// Regex metacharacters that must be escaped when copied verbatim from a glob
// into a regex source. `*` is intentionally NOT in this set — it is the one
// glob metacharacter and is handled separately (after escaping, since `*`
// survives the escape pass untouched).
const REGEX_META = /[.+?^${}()|[\]\\]/g;

function globToRegex(glob: string): RegExp {
  // Escape the literal portions FIRST. `*` is not a REGEX_META char, so the
  // glob tokens survive escaping; we then expand them in a single pass:
  //   `**` → `.+`     one-or-more segments (matches across underscores), for
  //                   multi-word place tails like `…_marketbeat_bonita_springs`.
  //   `*`  → `[^_]+`  exactly one underscore-bounded segment — stops greedy
  //                   over-match across extra `_` (e.g. `swfl_zip_33931_extra…`).
  // `**` is listed first in the alternation so the longer token wins.
  const escaped = glob.replace(REGEX_META, "\\$&");
  const expanded = escaped.replace(/\*\*|\*/g, (tok) =>
    tok === "**" ? ".+" : "[^_]+",
  );
  return new RegExp(`^${expanded}$`);
}
