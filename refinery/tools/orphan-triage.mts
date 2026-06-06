/**
 * P4a — SKOS Orphan Triage report generator.
 *
 * Scans every cached Stage 2.5 normalize artifact, collects raw_slugs
 * that failed to resolve to a SKOS concept, dedupes them, and for each
 * unique orphan suggests the top-K candidate concepts a human triager
 * would consider mapping it to. Writes docs/orphan-triage.md.
 *
 * Today's ranker is string-similarity (refinery/lib/embedder.mts
 * `stringSimilarityRanker`). When P4b lands a real embedder, this
 * generator gains an optional `--vector` flag that swaps the engine
 * to cosine similarity over pre-computed concept embeddings — the
 * report shape stays identical, only the score column changes meaning.
 *
 * Pure read-only. Inputs: .refinery-cache/&#x7B;pack_id&#x7D;/stage-2.5-normalize.json,
 * refinery/vocab/brain-vocabulary.json. Output: docs/orphan-triage.md.
 *
 * Usage:
 *
 *   bun refinery/tools/orphan-triage.mts
 *   npm run triage
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadVocabularySync } from "../vocab/loader.mts";
import {
  rankCandidates,
  stringSimilarityRanker,
  type RankCandidate,
  type RankedCandidate,
} from "../lib/embedder.mts";
import { embedBatch } from "../sources/voyage-embedder.mts";
import { getSupabase } from "../sources/supabase.mts";

const CACHE_DIR = path.join(process.cwd(), ".refinery-cache");
const OUTPUT_PATH = path.join(process.cwd(), "docs", "orphan-triage.md");

interface RawOrphan {
  fragment_id: string;
  path: string;
  raw_slug: string;
  context: string;
}

interface Stage25Artifact {
  pack_id: string;
  orphan_count: number;
  orphans: RawOrphan[];
}

interface OrphanObservation {
  pack_id: string;
  fragment_id: string;
  path: string;
}

interface DedupedOrphan {
  raw_slug: string;
  observations: OrphanObservation[];
  packs: Set<string>;
  paths: Set<string>;
}

function loadAllOrphans(): {
  artifacts: number;
  total: number;
  byPack: Map<string, number>;
  deduped: DedupedOrphan[];
} {
  const byPack = new Map<string, number>();
  const bySlug = new Map<string, DedupedOrphan>();
  let artifacts = 0;
  let total = 0;

  if (!existsSync(CACHE_DIR)) {
    return { artifacts: 0, total: 0, byPack, deduped: [] };
  }

  for (const pack of readdirSync(CACHE_DIR)) {
    const artifactPath = path.join(CACHE_DIR, pack, "stage-2.5-normalize.json");
    if (!existsSync(artifactPath)) continue;
    artifacts++;
    let artifact: Stage25Artifact;
    try {
      artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
    } catch {
      continue;
    }
    const orphans = artifact.orphans ?? [];
    if (orphans.length === 0) continue;
    byPack.set(pack, orphans.length);
    total += orphans.length;
    for (const o of orphans) {
      let bucket = bySlug.get(o.raw_slug);
      if (!bucket) {
        bucket = {
          raw_slug: o.raw_slug,
          observations: [],
          packs: new Set<string>(),
          paths: new Set<string>(),
        };
        bySlug.set(o.raw_slug, bucket);
      }
      bucket.observations.push({
        pack_id: pack,
        fragment_id: o.fragment_id,
        path: o.path,
      });
      bucket.packs.add(pack);
      bucket.paths.add(o.path);
    }
  }

  const deduped = [...bySlug.values()].sort((a, b) =>
    a.raw_slug.localeCompare(b.raw_slug),
  );
  return { artifacts, total, byPack, deduped };
}

function buildCandidates(): RankCandidate[] {
  const vocab = loadVocabularySync();
  const out: RankCandidate[] = [];
  for (const [id, concept] of Object.entries(vocab.concepts)) {
    const parts: string[] = [concept.prefLabel];
    if (concept.altLabels?.length) parts.push(...concept.altLabels);
    for (const slug of concept.raw_slugs ?? []) parts.push(slug);
    if (concept.scope_note) parts.push(concept.scope_note);
    out.push({ id, text: parts.join(" ") });
  }
  return out;
}

function renderReport(
  artifacts: number,
  total: number,
  byPack: Map<string, number>,
  deduped: DedupedOrphan[],
  scoredOrphans: Map<string, RankedCandidate[]>,
  engineId: string,
): string {
  const now = new Date().toISOString();
  const vocab = loadVocabularySync();

  const lines: string[] = [];
  lines.push("# SKOS Orphan Triage");
  lines.push("");
  lines.push(
    "_Auto-generated read-only report — raw slugs that Stage 2.5 normalize observed but could not map to a SKOS concept, ranked against candidate concepts via the active similarity engine._",
  );
  lines.push("");
  lines.push(`**Generated:** ${now}`);
  lines.push(
    `**Vocab schema:** ${vocab.meta.schema_version} (concepts: ${Object.keys(vocab.concepts).length})`,
  );
  lines.push(`**Ranker engine:** \`${engineId}\``);
  lines.push("");
  lines.push("---");
  lines.push("");

  // TL;DR
  lines.push("## TL;DR");
  lines.push("");
  lines.push(`- Stage 2.5 artifacts scanned: **${artifacts}**`);
  lines.push(`- Total orphan observations: **${total}**`);
  lines.push(`- Unique raw_slugs that are orphaned: **${deduped.length}**`);
  lines.push(
    `- Packs producing orphans: ${
      byPack.size === 0
        ? "none — full vocab coverage."
        : "**" +
          byPack.size +
          "** (" +
          [...byPack.entries()]
            .sort()
            .map(([p, n]) => `\`${p}\` (${n})`)
            .join(", ") +
          ")"
    }`,
  );
  lines.push("");

  if (deduped.length === 0) {
    lines.push("---");
    lines.push("");
    lines.push("## No orphans");
    lines.push("");
    lines.push(
      "Every raw_slug observed across all cached Stage 2.5 artifacts resolved to a SKOS concept. SKOS coverage is currently 100%. This report will gain content the moment a brain emits a slug not registered in `refinery/vocab/brain-vocabulary.json`.",
    );
    lines.push("");
    lines.push(footerNote(engineId));
    return lines.join("\n") + "\n";
  }

  // Per-orphan triage table
  lines.push("---");
  lines.push("");
  lines.push("## Orphans by raw_slug");
  lines.push("");
  lines.push(
    "Each row lists one unique orphan slug, the pack(s) and path(s) it was observed at, and the top-3 candidate SKOS concepts the ranker suggests as mappings. A human triager should pick one (or add a new concept to the vocab if none fit) and update `refinery/vocab/brain-vocabulary.json`.",
  );
  lines.push("");

  for (const orphan of deduped) {
    lines.push(`### \`${orphan.raw_slug}\``);
    lines.push("");
    lines.push(
      `- **Observations:** ${orphan.observations.length} (across ${orphan.packs.size} pack${orphan.packs.size === 1 ? "" : "s"})`,
    );
    lines.push(
      `- **Packs:** ${[...orphan.packs]
        .sort()
        .map((p) => `\`${p}\``)
        .join(", ")}`,
    );
    lines.push(
      `- **JSON paths:** ${[...orphan.paths]
        .sort()
        .map((p) => `\`${p}\``)
        .join(", ")}`,
    );
    lines.push("");

    const top = scoredOrphans.get(orphan.raw_slug) ?? [];
    lines.push("| Rank | Candidate concept | Score | prefLabel |");
    lines.push("| --- | --- | --- | --- |");
    if (top.length === 0) {
      lines.push("| — | _no candidates_ | — | — |");
    } else {
      top.forEach((c, i) => {
        const concept = vocab.concepts[c.id];
        const pref = concept?.prefLabel ?? "(unknown)";
        lines.push(
          `| ${i + 1} | \`${c.id}\` | ${c.score.toFixed(3)} | ${escapePipes(pref)} |`,
        );
      });
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(footerNote(engineId));
  return lines.join("\n") + "\n";
}

function footerNote(engineId: string): string {
  if (engineId.startsWith("vector-")) {
    const model = engineId.slice("vector-".length);
    return [
      "## Ranker engine — vector mode (P4b LIVE)",
      "",
      `This report scored orphans via cosine similarity over Voyage AI embeddings (model \`${model}\`, 1024-dim). Concept embeddings are stored in \`public.vocab_concept_embeddings\` on Brains Supabase; orphan queries are embedded on-the-fly with \`input_type=query\`.`,
      "",
      "**To re-embed concepts after a vocab edit:** `npm run embed-concepts` (idempotent — only re-embeds concepts whose source_text changed).",
      "",
      "**To fall back to string-similarity:** run without `--vector`. Useful when Voyage is unreachable or you want a token-overlap sanity check.",
      "",
    ].join("\n");
  }
  return [
    "## Ranker engine — string-similarity mode",
    "",
    "This report scored orphans via token Jaccard + Levenshtein. Catches obvious cases (slug renames, multi-word reorderings, minor spelling), misses semantic equivalence (e.g. `chargeoff` ↔ `loan_default_rate`).",
    "",
    "**To use Voyage AI embeddings instead:** `npm run triage -- --vector` (requires `VOYAGE_KEY` in `.env.local` and `npm run embed-concepts` to have populated `vocab_concept_embeddings`).",
    "",
  ].join("\n");
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Pull all (concept_id, embedding) pairs for the given model from
 * vocab_concept_embeddings via service_role. pgvector serializes to a
 * "[v1,v2,...]" string over PostgREST; parse defensively.
 */
async function loadConceptEmbeddings(
  model: string,
): Promise<Map<string, number[]>> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("vocab_concept_embeddings")
    .select("concept_id, embedding")
    .eq("model", model);
  if (error) {
    throw new Error(`Failed to read concept embeddings: ${error.message}`);
  }
  const out = new Map<string, number[]>();
  for (const row of (data ?? []) as {
    concept_id: string;
    embedding: unknown;
  }[]) {
    const vec = parsePgVector(row.embedding);
    if (vec) out.set(row.concept_id, vec);
  }
  return out;
}

function parsePgVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw !== "string") return null;
  // pgvector format: "[0.1,0.2,...]" — same as JSON, but strip brackets defensively
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  try {
    return JSON.parse(trimmed) as number[];
  } catch {
    return null;
  }
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function scoreOrphansVector(
  deduped: readonly DedupedOrphan[],
  model: string,
): Promise<{ scored: Map<string, RankedCandidate[]>; engineId: string }> {
  const vocab = loadVocabularySync();
  console.log(
    `[orphan-triage] vector mode — loading concept embeddings for model=${model}…`,
  );
  const conceptEmbeddings = await loadConceptEmbeddings(model);
  if (conceptEmbeddings.size === 0) {
    throw new Error(
      `No concept embeddings found in vocab_concept_embeddings for model=${model}. ` +
        `Run \`npm run embed-concepts\` first.`,
    );
  }
  console.log(
    `[orphan-triage] loaded ${conceptEmbeddings.size} concept embeddings. Embedding ${deduped.length} orphan query(ies) via Voyage (input_type=query)…`,
  );

  const queries = deduped.map((d) => d.raw_slug);
  const queryEmbeddings =
    queries.length > 0 ? await embedBatch(queries, "query", model) : [];

  const scored = new Map<string, RankedCandidate[]>();
  for (let i = 0; i < deduped.length; i++) {
    const orphan = deduped[i];
    const qvec = queryEmbeddings[i];
    const ranked: RankedCandidate[] = [];
    for (const [conceptId, cvec] of conceptEmbeddings) {
      const concept = vocab.concepts[conceptId];
      if (!concept) continue;
      ranked.push({
        id: conceptId,
        text: concept.prefLabel,
        score: cosine(qvec, cvec),
      });
    }
    ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    scored.set(orphan.raw_slug, ranked.slice(0, 3));
  }
  return { scored, engineId: `vector-${model}` };
}

function scoreOrphansString(
  deduped: readonly DedupedOrphan[],
  candidates: readonly RankCandidate[],
): { scored: Map<string, RankedCandidate[]>; engineId: string } {
  const scored = new Map<string, RankedCandidate[]>();
  for (const orphan of deduped) {
    const top = rankCandidates(
      orphan.raw_slug,
      candidates,
      stringSimilarityRanker,
      {
        topK: 3,
      },
    );
    scored.set(orphan.raw_slug, top);
  }
  return { scored, engineId: stringSimilarityRanker.id };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const useVector = argv.includes("--vector");
  const model = "voyage-3";

  const { artifacts, total, byPack, deduped } = loadAllOrphans();
  const candidates = buildCandidates();
  const { scored, engineId } = useVector
    ? await scoreOrphansVector(deduped, model)
    : scoreOrphansString(deduped, candidates);
  const md = renderReport(artifacts, total, byPack, deduped, scored, engineId);
  writeFileSync(OUTPUT_PATH, md, "utf-8");
  console.log(
    `[orphan-triage] wrote ${OUTPUT_PATH} (${md.length} bytes) — ` +
      `${artifacts} artifact${artifacts === 1 ? "" : "s"} scanned, ` +
      `${deduped.length} unique orphan${deduped.length === 1 ? "" : "s"} ` +
      `across ${total} observation${total === 1 ? "" : "s"}.`,
  );
}

main().catch((err) => {
  console.error(
    "[orphan-triage] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
