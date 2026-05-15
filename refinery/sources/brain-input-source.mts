import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import type { BrainOutput } from "../types/brain-output.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";
import { readBrainOutput } from "../lib/brain-output-reader.mts";

/**
 * Generic brain-input source connector — the thin-pipe consumer.
 *
 * When a downstream brain declares an upstream in its `input_brains`, this
 * factory wires up a SourceConnector that reads the upstream's already-rendered
 * `brains/{upstreamId}.md` from local disk and returns its `--- OUTPUT ---`
 * JSON block as a single normalized RawFragment. The downstream pack NEVER
 * sees the upstream's branches — only its distilled output.
 *
 * THIS FILE READS NO EXTERNAL APIs. The local file is the build-time truth;
 * the Vercel URL in citationMeta is the read-time pointer for downstream
 * agents that want to click through to the live upstream.
 *
 * OUTPUT-block parsing is delegated to `lib/brain-output-reader.mts` so the
 * exact same parser also drives Stage 4's upstream-confidence harvest.
 *
 * Coexists with `master-source.mts` (which reads SAVED FACTS for the bespoke
 * master-index aggregation). New packs should use this factory; master will
 * migrate once the OUTPUT block has been in place across one TTL cycle.
 */

const VERCEL_BASE = "https://brain-platform-amber.vercel.app/api/b";

/** Normalized brain-input fragment — one upstream's OUTPUT contributes one of these. */
export interface BrainInputNormalized {
  kind: "brain-input";
  upstream_id: string;
  output: BrainOutput;
}

/**
 * Build a SourceConnector that consumes another brain's `--- OUTPUT ---` block.
 * The downstream pack declares `input_brains: [upstreamId]` AND adds
 * `makeBrainInputSource(upstreamId)` to its `sources[]`. The DAG resolver
 * guarantees upstream is rebuilt before this connector's fetch() runs.
 */
export function makeBrainInputSource(upstreamId: string): SourceConnector {
  const sourceId = `brain-input:${upstreamId}`;
  const url = `${VERCEL_BASE}/${upstreamId}`;
  // Captured on fetch() so citationMeta() reports the upstream's own verified
  // date — surfacing real upstream staleness through to the consuming brain's
  // citation table. Fall back to "today" if fetch ran out of order.
  let upstreamRefinedDate: string | null = null;

  return {
    source_id: sourceId,
    trust_tier: 2, // already-verified, already-shipped brain output
    async fetch(): Promise<RawFragment[]> {
      const read = await readBrainOutput(upstreamId);
      if (read.kind === "missing") {
        throw new Error(
          `brain-input-source(${upstreamId}): ${read.reason}. ` +
            `Run \`npm run refinery ${upstreamId}\` first.`,
        );
      }
      const output = read.output;
      upstreamRefinedDate = output.refined_at.slice(0, 10);

      const normalized: BrainInputNormalized = {
        kind: "brain-input",
        upstream_id: upstreamId,
        output,
      };
      return [
        {
          fragment_id: fragmentId(sourceId, upstreamId),
          source_id: sourceId,
          source_trust_tier: 2,
          fetched_at: isoTimestamp(),
          raw: {
            upstream_id: upstreamId,
            brain_id: output.brain_id,
            version: output.version,
            confidence: output.confidence,
          },
          normalized,
        },
      ];
    },
    citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
      const verified = upstreamRefinedDate ?? verifiedDate;
      return {
        source: `${upstreamId} brain — ${url}`,
        verified,
        expires: expiresDate(verified, ttlSeconds),
      };
    },
  };
}
