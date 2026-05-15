import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import type { BrainOutput } from "../types/brain-output.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

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
 * Coexists with `master-source.mts` (which reads SAVED FACTS for the bespoke
 * master-index aggregation). New packs should use this factory; master will
 * migrate once the OUTPUT block has been in place across one TTL cycle.
 */

const VERCEL_BASE = "https://brain-platform-amber.vercel.app/api/b";
const BRAINS_DIR = path.join(process.cwd(), "brains");

/** Normalized brain-input fragment — one upstream's OUTPUT contributes one of these. */
export interface BrainInputNormalized {
  kind: "brain-input";
  upstream_id: string;
  output: BrainOutput;
}

/** Strip CRLF so the regexes below behave on Windows-checked-out files. */
function normalizeEol(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

/** Pull a single frontmatter scalar from a rendered brain file. */
function frontmatterValue(md: string, key: string): string | null {
  // Tolerate one leading `<!-- FRESHNESS ... -->` HTML comment before the `---`.
  const fm = md.match(/^(?:<!--[\s\S]*?-->\s*)?---\n([\s\S]*?)\n---\n/);
  if (!fm) return null;
  for (const line of fm[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    if (line.slice(0, idx).trim() === key) return line.slice(idx + 1).trim();
  }
  return null;
}

/** Extract the `--- OUTPUT ---` JSON block from a brain file's ```reference fence. */
function extractOutputBlock(md: string, upstreamId: string): BrainOutput {
  const block = md.match(/```reference\n([\s\S]*?)\n```/);
  if (!block) {
    throw new Error(
      `brain-input-source(${upstreamId}): no \`\`\`reference fenced block found`,
    );
  }
  const lines = block[1].split("\n");
  const start = lines.indexOf("--- OUTPUT ---");
  if (start === -1) {
    throw new Error(
      `brain-input-source(${upstreamId}): no --- OUTPUT --- section — ` +
        `the upstream is rendered with a pre-Phase-B refinery. Rebuild with: ` +
        `npm run refinery ${upstreamId}`,
    );
  }
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^--- .* ---$/.test(lines[i])) break;
    body.push(lines[i]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.join("\n").trim());
  } catch (e) {
    throw new Error(
      `brain-input-source(${upstreamId}): --- OUTPUT --- is not valid JSON: ${(e as Error).message}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `brain-input-source(${upstreamId}): --- OUTPUT --- must be a JSON object`,
    );
  }
  return parsed as BrainOutput;
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
      const filePath = path.join(BRAINS_DIR, `${upstreamId}.md`);
      let md: string;
      try {
        md = normalizeEol(await readFile(filePath, "utf-8"));
      } catch {
        throw new Error(
          `brain-input-source: cannot read ${filePath} — ` +
            `run \`npm run refinery ${upstreamId}\` first.`,
        );
      }
      const upstreamBrainId = frontmatterValue(md, "brain_id");
      if (upstreamBrainId !== upstreamId) {
        throw new Error(
          `brain-input-source: ${filePath} brain_id "${upstreamBrainId}" ` +
            `does not match expected upstream id "${upstreamId}"`,
        );
      }
      const output = extractOutputBlock(md, upstreamId);
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
