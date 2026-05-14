/**
 * Typed env loader. Loads .env.local if present, fails fast on missing
 * required keys. REFINERY_SOURCE=fixture runs the engine with zero creds.
 */

// Best-effort load of .env.local — absent in fixture mode, that's fine.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — fixture mode or CI; requireEnv() will catch real gaps
}

export type RefinerySource = "live" | "fixture";

export interface RefineryEnv {
  source: RefinerySource;
  supabaseUrl: string | undefined;
  supabaseKey: string | undefined;
  sanityProjectId: string;
  sanityDataset: string;
  sanityReadToken: string | undefined;
  sanityApiVersion: string;
  anthropicApiKey: string | undefined;
}

function readEnv(): RefineryEnv {
  const source: RefinerySource =
    process.env.REFINERY_SOURCE === "fixture" ? "fixture" : "live";
  return {
    source,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_READONLY_KEY,
    // Intelligence Lake = lpyl3q9w (all corridorProfile + promptRule docs live
    // there). go8u2esq was the original plan's assumed A1 project but is an
    // empty shell — 0 docs of any type under published/previewDrafts/drafts
    // (verified 2026-05-14). Settled; do not revisit.
    sanityProjectId: process.env.SANITY_PROJECT_ID ?? "lpyl3q9w",
    sanityDataset: process.env.SANITY_DATASET ?? "production",
    // Token var name is SANITY_READ_TOKEN everywhere (the /build spec's
    // SANITY_TOKEN was the outlier). Only needed to read drafts; published
    // docs in lpyl3q9w/production are public-read.
    sanityReadToken: process.env.SANITY_READ_TOKEN,
    sanityApiVersion: process.env.SANITY_API_VERSION ?? "2024-01-01",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  };
}

export const env: RefineryEnv = readEnv();

/** Assert required env keys are present; throw a clear, actionable error if not. */
export function requireEnv(keys: (keyof RefineryEnv)[]): void {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Refinery: missing required env var(s): ${missing.join(", ")}.\n` +
        `Set them in .env.local, or run with REFINERY_SOURCE=fixture for offline mode.`,
    );
  }
}
