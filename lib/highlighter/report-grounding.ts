// The grounding resolver — turns a (possibly synthetic) `reportId` into the real
// grounding the assistant answers from. The single seam that makes the dock answer on
// EVERY /r/* surface instead of 404-ing.
//
// INVARIANT #11 — NEVER THROW TO THE ROUTE. Every miss (invalid ZIP, unknown kind, a
// missing underlying brain) degrades to the region-wide master read, which is always
// present, so the answer is real and cited at the nearest grain — never a user-facing
// 404, never a "we don't have that, want the weather?" dead-end. If even master can't
// load, it returns ungrounded (empty blocks) so the engine still answers honestly
// ("be Claude"). The harvested resolver only NARROWED the 404; this ELIMINATES it.
// (Phase 2 of the one-assistant unification.)
import { fetchBrain, buildDossier } from "@/lib/fetch-brain";
import { type GroundingBlock } from "@/lib/highlighter/grounding";
import { resolveMethod, type MethodologyEntry } from "@/refinery/lib/methodology-registry.mts";
import { displayNameFor } from "@/refinery/lib/corridor-display.mts";
import { parseReportId } from "@/lib/highlighter/report-surface";

export interface ResolvedGrounding {
  /** [0] = the primary report dossier; the report path appends reach targets after it.
   *  Empty ONLY in the rare case master itself can't load (the engine then answers
   *  ungrounded + honest, never a 404). */
  blocks: GroundingBlock[];
  /** Authored methodology for the surface's metric (method pages), else null. */
  method: MethodologyEntry | null;
  /** A one-line "the user is on the X report" pin, prepended to the system prompt so the
   *  model answers about that exact ZIP/corridor/metric, not the aggregate. */
  surfaceNote?: string;
  /** The primary report's freshness token (the as-of date is read off it for display). */
  freshnessToken: string;
}

const VALID_ZIP = /^\d{5}$/;

// Whenever a specific surface can't be resolved, the model is pinned to answer from what
// we DO hold and offer to pull the rest — the no-404, no-dead-end contract (#11).
const DEGRADE_NOTE =
  "Answer this question from our Southwest Florida market data at the nearest grain we hold, " +
  "and offer to pull anything not broken out — never reply only that you don't have it, and " +
  "never invent a figure.";

/** Build a primary grounding block from a brain slug. The single disk read every branch
 *  funnels through; a missing brain throws here and is caught + degraded by the caller. */
async function brainBlock(
  slug: string,
  label: string,
  origin: string,
): Promise<{ block: GroundingBlock; freshnessToken: string }> {
  const { output, freshness_token } = await fetchBrain(slug, { tier: 2, origin });
  return {
    block: { label, dossier: buildDossier(output, freshness_token) },
    freshnessToken: freshness_token,
  };
}

/**
 * Degrade target: the region-wide master read (always-present synthesis brain). A miss on
 * any specific surface still yields a real, cited answer at the nearest grain — never a
 * 404. If master itself can't load, returns ungrounded (empty blocks) so the engine
 * answers honestly rather than throwing.
 */
async function masterRegionFallback(
  origin: string,
  surfaceNote: string,
): Promise<ResolvedGrounding> {
  try {
    const { block, freshnessToken } = await brainBlock("master", "SWFL market data", origin);
    return { blocks: [block], method: null, surfaceNote, freshnessToken };
  } catch {
    return { blocks: [], method: null, surfaceNote, freshnessToken: "" };
  }
}

/**
 * Resolve a mounted `reportId` to its grounding. Pure I/O (reads `brains/*.md` via
 * fetchBrain); no model call. Node runtime only. NEVER throws — every failure path
 * degrades to the master region read (see #11).
 */
export async function resolveReportGrounding(
  reportId: string,
  opts: { origin: string },
): Promise<ResolvedGrounding> {
  const { kind, id } = parseReportId(reportId);
  const { origin } = opts;

  try {
    switch (kind) {
      case "brain": {
        const { block, freshnessToken } = await brainBlock(id, id, origin);
        return { blocks: [block], method: null, freshnessToken };
      }

      case "zip": {
        // Invalid ZIP → degrade to the region read rather than 404 (#11).
        if (!VALID_ZIP.test(id)) return masterRegionFallback(origin, DEGRADE_NOTE);
        // The ZIP report's housing detail lives in home-values-swfl, whose detail_tables
        // are keyed by ZIP — so the specific row is in-context. Reach (rentals/flood) is
        // still added by the report path when the question implies it.
        const { block, freshnessToken } = await brainBlock("home-values-swfl", `ZIP ${id}`, origin);
        return {
          blocks: [block],
          method: null,
          surfaceNote: `The user is on the report for ZIP ${id}. Answer about ZIP ${id} specifically, using its row in the data below; if a figure isn't broken out for this ZIP, say what we hold at the nearest grain and offer to pull the rest — never invent a ZIP-level number.`,
          freshnessToken,
        };
      }

      case "corridor": {
        // Per-corridor commercial reports are a view over the cre-swfl brain, whose
        // detail_tables carry the corridor rows.
        const name = displayNameFor(id);
        const { block, freshnessToken } = await brainBlock("cre-swfl", `${name} corridor`, origin);
        return {
          blocks: [block],
          method: null,
          surfaceNote: `The user is on the commercial corridor report for ${name}. Answer about that corridor specifically, using its row in the data below.`,
          freshnessToken,
        };
      }

      case "method": {
        // A methodology page explains ONE metric. Ground on master (always present, carries
        // the token) and inject the authored derivation so the model recites the real
        // equation/components instead of guessing.
        const method = resolveMethod(id);
        const { block, freshnessToken } = await brainBlock("master", "SWFL market data", origin);
        return {
          blocks: [block],
          method,
          surfaceNote: method
            ? `The user is on the methodology page for "${method.label}". Explain how that metric is measured using the authored method below.`
            : `The user is on a methodology page. Explain how the metric is measured from our data; if it isn't documented, say so plainly.`,
          freshnessToken,
        };
      }

      case "source": {
        // A source-provenance page documents one upstream table. Ground on master so the
        // dock can still answer SWFL questions; pin the table by name.
        const { block, freshnessToken } = await brainBlock("master", "SWFL market data", origin);
        return {
          blocks: [block],
          method: null,
          surfaceNote: `The user is on the data-source page for "${id}". Answer their question from our market data; if they ask what this source is, describe it plainly without internal identifiers.`,
          freshnessToken,
        };
      }

      default: {
        // Exhaustiveness: a new kind added to REPORT_SURFACE_KINDS without a branch here is
        // a compile error (kind: never). At runtime it degrades rather than throwing.
        const _exhaustive: never = kind;
        void _exhaustive;
        return masterRegionFallback(origin, DEGRADE_NOTE);
      }
    }
  } catch {
    // Any underlying brain miss (home-values-swfl / cre-swfl / the requested brain absent,
    // or a transient gap during a rebuild) degrades to the master region read. The
    // resolver NEVER throws to the route (#11).
    return masterRegionFallback(origin, DEGRADE_NOTE);
  }
}
