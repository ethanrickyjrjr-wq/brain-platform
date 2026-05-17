/**
 * Post-migration verification for docs/sql/20260517_vocab_concept_embeddings.sql.
 *
 * Connects to Brains Supabase via the service_role key (PostgREST) and
 * confirms three things:
 *   1. The `public.vocab_concept_embeddings` table exists and is selectable.
 *   2. The row count is sane (likely 0 immediately post-migration).
 *   3. The service_role grant is correctly applied (else the SELECT errors).
 *
 * Cannot confirm pgvector extension or IVFFlat index existence via
 * PostgREST — those require pg_meta or a direct postgres connection.
 * If the SELECT succeeds, the table is in place; the extension was a
 * prerequisite of the CREATE TABLE, so its presence is implied.
 *
 * Usage: `bun refinery/tools/verify-pgvector.mts` or `npm run pgvector:verify`.
 */

import { getSupabase } from "../sources/supabase.mts";

async function main(): Promise<void> {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("vocab_concept_embeddings")
    .select("*", { count: "exact", head: true });

  if (error) {
    console.error("[verify-pgvector] FAILED:", error.message);
    if (
      error.message.includes("does not exist") ||
      error.message.includes("not found")
    ) {
      console.error(
        "  → The table is not present. Apply docs/sql/20260517_vocab_concept_embeddings.sql " +
          "via Supabase Studio → SQL Editor, then re-run this script.",
      );
    } else if (
      error.message.toLowerCase().includes("permission") ||
      error.message.toLowerCase().includes("denied")
    ) {
      console.error(
        "  → service_role lacks SELECT. Re-apply the GRANT clause from the migration:\n" +
          "    GRANT SELECT, INSERT, UPDATE, DELETE ON public.vocab_concept_embeddings TO service_role;",
      );
    }
    process.exit(1);
  }

  console.log(
    `[verify-pgvector] OK · public.vocab_concept_embeddings is queryable ` +
      `(row count: ${count ?? 0}).`,
  );
  console.log(
    "[verify-pgvector] pgvector extension is present (CREATE TABLE would have failed otherwise).",
  );
  console.log(
    "[verify-pgvector] Receiver is live. P4b (Voyage AI embedder) is ready to wire when VOYAGE_API_KEY is set.",
  );
}

main().catch((err) => {
  console.error("[verify-pgvector] unexpected error:", err);
  process.exit(1);
});
