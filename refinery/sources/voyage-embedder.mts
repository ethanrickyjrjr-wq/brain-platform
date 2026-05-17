/**
 * P4b — Voyage AI embedder. Implements the `Embedder` interface defined
 * in refinery/lib/embedder.mts.
 *
 * Voyage is Anthropic's documented embedding partner. Default model:
 * `voyage-3` (1024-dim) — matches the receiver schema
 * (`docs/sql/20260517_vocab_concept_embeddings.sql` declares
 * `embedding vector(1024)`). If a different model is chosen, the
 * receiver schema dim must change with it.
 *
 * Auth: Bearer token from `env.voyageKey` (env var `VOYAGE_KEY`). The
 * key value is **never logged or echoed** — only sent in the HTTP
 * Authorization header. Errors reference the env var NAME, not the
 * value.
 *
 * Batch behavior: Voyage accepts up to 128 inputs per request. The
 * `embed()` helper here only sends ONE input at a time (for the
 * single-query case at orphan triage time). The batched
 * concept-embedding path lives in `refinery/tools/embed-all-concepts.mts`
 * which uses `embedBatch()` directly.
 *
 * input_type:
 *   - "document" for stored concept embeddings (vocab_concept_embeddings)
 *   - "query"    for ad-hoc query embeddings at triage time
 * Voyage uses different internal prompts for each, which materially
 * improves retrieval quality. Always match the call to its purpose.
 */

import type { Embedder } from "../lib/embedder.mts";
import { env, requireEnv } from "../config/env.mts";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const DEFAULT_MODEL = "voyage-3";
const DEFAULT_DIM = 1024;

export type VoyageInputType = "document" | "query";

interface VoyageResponse {
  object: "list";
  data: { object: "embedding"; embedding: number[]; index: number }[];
  model: string;
  usage: { total_tokens: number };
}

/**
 * Batched Voyage call. `inputs.length` <= 128. Returns embeddings in
 * the same order as inputs. Throws on non-2xx response. The key is
 * never included in thrown errors.
 */
export async function embedBatch(
  inputs: readonly string[],
  inputType: VoyageInputType,
  model: string = DEFAULT_MODEL,
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  if (inputs.length > 128) {
    throw new Error(
      `embedBatch: Voyage accepts <=128 inputs per call; got ${inputs.length}. Chunk before calling.`,
    );
  }
  requireEnv(["voyageKey"]);
  const key = env.voyageKey as string;

  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      input: inputs,
      model,
      input_type: inputType,
    }),
  });

  if (!res.ok) {
    // Read body for debugging, but truncate aggressively to avoid
    // accidentally surfacing anything sensitive Voyage echoes back.
    const text = await res.text().catch(() => "(no body)");
    const safe = text.length > 300 ? text.slice(0, 300) + "…" : text;
    throw new Error(
      `Voyage API ${res.status} ${res.statusText} (model=${model}, ` +
        `input_type=${inputType}, n=${inputs.length}). Body: ${safe}`,
    );
  }

  const body = (await res.json()) as VoyageResponse;
  if (!body.data || body.data.length !== inputs.length) {
    throw new Error(
      `Voyage API returned ${body.data?.length ?? 0} embeddings for ${inputs.length} inputs.`,
    );
  }
  // Voyage data is returned with `index` matching the request order;
  // sort defensively so callers can trust positional lookup.
  return [...body.data]
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/**
 * Cosine similarity of two equal-length vectors. Pure function; safe to
 * call without network. Returns 0..1 (Voyage embeddings are not strictly
 * non-negative but the cosine is bounded -1..1; for any reasonable
 * concept-vs-concept query this is positive and treating it as 0..1 is
 * fine for ranking).
 */
function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Single-input `Embedder` convenience. For batched concept embedding
 * use `embedBatch` directly. Default `input_type` is "query" since the
 * single-input call site is orphan triage.
 */
export function makeVoyageEmbedder(
  opts: {
    model?: string;
    inputType?: VoyageInputType;
  } = {},
): Embedder {
  const model = opts.model ?? DEFAULT_MODEL;
  const inputType = opts.inputType ?? "query";
  return {
    model,
    dim: DEFAULT_DIM,
    async embed(text: string): Promise<number[]> {
      const out = await embedBatch([text], inputType, model);
      return out[0];
    },
    similarity(a, b) {
      return cosine(a, b);
    },
  };
}
