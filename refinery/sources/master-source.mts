import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * Master Index source connectors — aggregate the already-published vertical
 * packs into a "brain of brains".
 *
 * THIS FILE READS NO EXTERNAL APIs AND NEEDS NO CREDENTIALS. It parses the
 * committed `brains/*.md` files — the verified, shipped packs — and lifts their
 * deterministic corpus facts verbatim. Honest aggregation only: zero synthesis,
 * zero fabricated cross-vertical links. Indexing only what has already been
 * verified and shipped is the whole point.
 *
 * One SourceConnector per sub-pack — Stage 4 assigns each a citation id
 * (s01, s02, ...) in `pack.sources` order.
 */

const VERCEL_BASE = "https://brain-platform-amber.vercel.app/api/b";
const BRAINS_DIR = path.join(process.cwd(), "brains");

/** A SAVED FACTS entry as it appears in a rendered brain file. */
export interface BrainFact {
  id: string;
  topic: string;
  fact: string;
  value: string;
  src: string;
  date: string;
}

/** Normalized sub-pack fragment — what one published pack contributes to the master index. */
export interface MasterNormalized {
  kind: "sub-pack";
  brain_id: string;
  scope: string;
  url: string;
  /** the sub-pack's deterministic corpus facts, lifted verbatim */
  corpus_facts: BrainFact[];
}

/** Strip CRLF so the regexes below behave on Windows-checked-out files. */
function normalizeEol(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

/** Pull a single frontmatter scalar (brain_id, scope, ...) from a brain file. */
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

/** Extract the SAVED FACTS JSON array from a brain file's ```reference block. */
function extractSavedFacts(md: string): BrainFact[] {
  const block = md.match(/```reference\n([\s\S]*?)\n```/);
  if (!block) throw new Error("master-source: no ```reference block found");
  const lines = block[1].split("\n");
  const start = lines.indexOf("--- SAVED FACTS ---");
  if (start === -1) throw new Error("master-source: no SAVED FACTS section");
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^--- .* ---$/.test(lines[i])) break;
    body.push(lines[i]);
  }
  const parsed = JSON.parse(body.join("\n").trim()) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("master-source: SAVED FACTS is not a JSON array");
  }
  return parsed as BrainFact[];
}

interface SubPackConfig {
  /** the sub-pack's brain_id, and its brains/{brain_id}.md filename */
  brain_id: string;
  /** stable source_id — Stage 4 maps it to a citation id (s01, s02, ...) */
  source_id: string;
  /**
   * How many leading SAVED FACTS are the deterministic corpus summary. Both
   * current packs prepend exactly 5 (the `corpusSummary` output renders as
   * f001-f005, composite-forced to the top). If a sub-pack's corpusSummary
   * changes its count, update it here — this file is the single point of
   * that knowledge for the master index.
   */
  corpus_fact_count: number;
}

function makeIndexSource(cfg: SubPackConfig): SourceConnector {
  const url = `${VERCEL_BASE}/${cfg.brain_id}`;
  return {
    source_id: cfg.source_id,
    async fetch(): Promise<RawFragment[]> {
      const filePath = path.join(BRAINS_DIR, `${cfg.brain_id}.md`);
      let md: string;
      try {
        md = normalizeEol(await readFile(filePath, "utf-8"));
      } catch {
        throw new Error(
          `master-source: cannot read ${filePath} — build the "${cfg.brain_id}" pack first.`,
        );
      }
      const brain_id = frontmatterValue(md, "brain_id");
      const scope = frontmatterValue(md, "scope");
      if (!brain_id || !scope) {
        throw new Error(
          `master-source: ${filePath} is missing brain_id/scope frontmatter`,
        );
      }
      const allFacts = extractSavedFacts(md);
      const corpus_facts = allFacts.slice(0, cfg.corpus_fact_count);
      if (corpus_facts.length < cfg.corpus_fact_count) {
        throw new Error(
          `master-source: ${cfg.brain_id} has ${allFacts.length} fact(s), ` +
            `expected at least ${cfg.corpus_fact_count} corpus facts`,
        );
      }
      const normalized: MasterNormalized = {
        kind: "sub-pack",
        brain_id,
        scope,
        url,
        corpus_facts,
      };
      return [
        {
          fragment_id: fragmentId(cfg.source_id, brain_id),
          source_id: cfg.source_id,
          source_trust_tier: 2, // derived from already-verified packs
          fetched_at: isoTimestamp(),
          raw: { brain_id, scope, url, fact_count: allFacts.length },
          normalized,
        },
      ];
    },
    citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
      return {
        source: `${cfg.brain_id} pack — ${url}`,
        verified: verifiedDate,
        expires: expiresDate(verifiedDate, ttlSeconds),
      };
    },
  };
}

export const franchiseIndexSource = makeIndexSource({
  brain_id: "franchise-outcomes",
  source_id: "franchise-outcomes-index",
  corpus_fact_count: 5,
});

export const creIndexSource = makeIndexSource({
  brain_id: "cre-swfl",
  source_id: "cre-swfl-index",
  corpus_fact_count: 5,
});
