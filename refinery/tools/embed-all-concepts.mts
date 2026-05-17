/**
 * P4b — Embed all SKOS concepts via Voyage AI and upsert into
 * public.vocab_concept_embeddings on Brains Supabase.
 *
 * Idempotent: skips concepts whose `source_text` is already stored
 * unchanged for the same model. Re-running after a vocab edit only
 * re-embeds the concepts whose source_text actually changed (saves
 * tokens AND keeps embedded_at stable for untouched concepts).
 *
 * Usage:
 *
 *   npm run embed-concepts
 *   bun refinery/tools/embed-all-concepts.mts
 *
 * Requires:
 *   - VOYAGE_KEY in .env.local
 *   - BRAINS_SUPABASE_URL + BRAINS_SUPABASE_SERVICE_KEY in .env.local
 *   - docs/sql/20260517_vocab_concept_embeddings.sql already applied
 *     (run `npm run pgvector:verify` to confirm)
 */

import { loadVocabularySync } from "../vocab/loader.mts";
import { embedBatch } from "../sources/voyage-embedder.mts";
import { getSupabase } from "../sources/supabase.mts";
import { requireEnv } from "../config/env.mts";

const MODEL = "voyage-3";
const BATCH_SIZE = 128;

interface ConceptForEmbedding {
  concept_id: string;
  source_text: string;
}

interface ExistingEmbedding {
  concept_id: string;
  source_text: string;
}

function buildSourceText(
  conceptId: string,
  concept: {
    prefLabel: string;
    altLabels?: string[];
    raw_slugs: string[];
    scope_note?: string;
  },
): string {
  const parts: string[] = [];
  parts.push(concept.prefLabel);
  if (concept.altLabels?.length) {
    parts.push("Aliases: " + concept.altLabels.join("; "));
  }
  if (concept.raw_slugs?.length) {
    parts.push("Raw slugs: " + concept.raw_slugs.join(", "));
  }
  if (concept.scope_note) {
    parts.push("Scope: " + concept.scope_note);
  }
  return parts.join(". ");
}

function vectorToPgString(v: readonly number[]): string {
  // pgvector accepts "[v1,v2,v3]" — no spaces required, JSON-like.
  return "[" + v.join(",") + "]";
}

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function loadExistingEmbeddings(): Promise<Map<string, string>> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("vocab_concept_embeddings")
    .select("concept_id, source_text")
    .eq("model", MODEL);
  if (error) {
    throw new Error(`Failed to read existing embeddings: ${error.message}`);
  }
  const existing = new Map<string, string>();
  for (const row of (data ?? []) as ExistingEmbedding[]) {
    existing.set(row.concept_id, row.source_text);
  }
  return existing;
}

async function upsertEmbeddings(
  rows: readonly {
    concept_id: string;
    model: string;
    embedding: string;
    source_text: string;
    vocab_schema_version: string;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  const supabase = getSupabase();
  const { error } = await supabase
    .from("vocab_concept_embeddings")
    .upsert([...rows], { onConflict: "concept_id,model" });
  if (error) {
    throw new Error(`Upsert failed: ${error.message}`);
  }
}

async function main(): Promise<void> {
  requireEnv(["voyageKey", "supabaseUrl", "supabaseKey"]);

  const vocab = loadVocabularySync();
  const schemaVersion = vocab.meta.schema_version;

  // Build the desired (concept_id, source_text) set
  const desired: ConceptForEmbedding[] = [];
  for (const [conceptId, concept] of Object.entries(vocab.concepts)) {
    desired.push({
      concept_id: conceptId,
      source_text: buildSourceText(conceptId, concept),
    });
  }
  desired.sort((a, b) => a.concept_id.localeCompare(b.concept_id));

  console.log(
    `[embed-concepts] Vocab has ${desired.length} concepts (schema ${schemaVersion}). Reading existing embeddings…`,
  );

  const existing = await loadExistingEmbeddings();
  const toEmbed = desired.filter(
    (d) => existing.get(d.concept_id) !== d.source_text,
  );

  if (toEmbed.length === 0) {
    console.log(
      `[embed-concepts] All ${desired.length} concept embeddings are up to date for model=${MODEL}. No Voyage calls made.`,
    );
    return;
  }

  console.log(
    `[embed-concepts] ${toEmbed.length} of ${desired.length} concepts need (re)embedding (model=${MODEL}). ` +
      `${desired.length - toEmbed.length} already current.`,
  );

  let totalTokens = 0;
  const batches = chunk(toEmbed, BATCH_SIZE);
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const texts = batch.map((b) => b.source_text);
    console.log(
      `[embed-concepts] Voyage batch ${bi + 1}/${batches.length} — embedding ${batch.length} concepts (input_type=document, model=${MODEL})…`,
    );
    const vectors = await embedBatch(texts, "document", MODEL);
    if (vectors.length !== batch.length) {
      throw new Error(
        `Voyage returned ${vectors.length} vectors for ${batch.length} inputs.`,
      );
    }
    const rows = batch.map((b, i) => ({
      concept_id: b.concept_id,
      model: MODEL,
      embedding: vectorToPgString(vectors[i]),
      source_text: b.source_text,
      vocab_schema_version: schemaVersion,
    }));
    totalTokens += texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0); // approx
    await upsertEmbeddings(rows);
    console.log(
      `[embed-concepts]   ↳ upserted ${rows.length} rows into vocab_concept_embeddings.`,
    );
  }

  console.log(
    `[embed-concepts] Done. ${toEmbed.length} concepts embedded · ~${totalTokens} tokens (approx) · model=${MODEL}.`,
  );
}

main().catch((err) => {
  console.error(
    "[embed-concepts] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
