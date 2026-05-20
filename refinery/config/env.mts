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
  /**
   * Live-evaluated via getter — re-reads `process.env.REFINERY_SOURCE` on
   * every access. Read-only at the type level so consumers cannot snapshot
   * a stale value back onto the object. Defaults to `"live"` when the env
   * var is unset or set to any non-`"fixture"` value.
   *
   * Why a getter and not a snapshot: a top-level `const env = readEnv()`
   * froze `source` at module-load time. Any test-loaded module that
   * transitively imported `env.mts` before test setup locked the process
   * to `"live"` — see anchor SHA `367d627` (Group C bisect, 2026-05-20).
   */
  readonly source: RefinerySource;
  /** Brains Supabase — primary database, owns all live data. */
  supabaseUrl: string | undefined;
  supabaseKey: string | undefined;
  /** Premise Engine Supabase — kept during transition; remove when migration is complete. */
  premiseSupabaseUrl: string | undefined;
  premiseSupabaseKey: string | undefined;
  sanityProjectId: string;
  sanityDataset: string;
  sanityReadToken: string | undefined;
  sanityApiVersion: string;
  anthropicApiKey: string | undefined;
  fredApiKey: string | undefined;
  /** Voyage AI embedding API key (P4b). Never logged. Used only as Bearer auth. */
  voyageKey: string | undefined;
  /**
   * Direct Postgres creds for DuckDB cross-tier ATTACH (makeDuckDBSource).
   * Distinct from supabaseUrl/supabaseKey: those go through PostgREST, these
   * speak the wire protocol. Host/user/password are required when ATTACH-ing;
   * port + database have safe Supabase defaults.
   */
  supabasePgHost: string | undefined;
  supabasePgPort: string;
  supabasePgUser: string | undefined;
  supabasePgPassword: string | undefined;
  supabasePgDatabase: string;
}

/** Resolved Postgres creds suitable for DuckDB CREATE SECRET. */
export interface PgCreds {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Resolve the active source mode from `process.env.REFINERY_SOURCE`. Called
 * by the `env.source` getter on every property access (not snapshotted), so
 * tests that mutate `REFINERY_SOURCE` after env.mts has loaded see the new
 * value. Defaults to `"live"` for safety: production callers without the
 * env var fall through to live data paths; fixture mode is always opt-in.
 */
function resolveSource(): RefinerySource {
  return process.env.REFINERY_SOURCE === "fixture" ? "fixture" : "live";
}

type EnvSnapshot = Omit<RefineryEnv, "source">;

function readEnvSnapshot(): EnvSnapshot {
  return {
    supabaseUrl: process.env.BRAINS_SUPABASE_URL,
    supabaseKey: process.env.BRAINS_SUPABASE_SERVICE_KEY,
    premiseSupabaseUrl: process.env.PREMISE_SUPABASE_URL,
    premiseSupabaseKey: process.env.PREMISE_SUPABASE_READONLY_KEY,
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
    fredApiKey: process.env.FRED_API_KEY,
    voyageKey: process.env.VOYAGE_KEY,
    supabasePgHost: process.env.SUPABASE_PG_HOST,
    supabasePgPort: process.env.SUPABASE_PG_PORT ?? "5432",
    supabasePgUser: process.env.SUPABASE_PG_USER,
    supabasePgPassword: process.env.SUPABASE_PG_PASSWORD,
    supabasePgDatabase: process.env.SUPABASE_PG_DATABASE ?? "postgres",
  };
}

export const env: RefineryEnv = {
  ...readEnvSnapshot(),
  get source(): RefinerySource {
    return resolveSource();
  },
};

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

/**
 * Resolve direct Postgres creds for DuckDB cross-tier ATTACH. Throws an
 * actionable error naming every missing required env var. Caller is responsible
 * for never logging the returned object (password is plain text by necessity —
 * DuckDB's CREATE SECRET needs the password literal).
 */
export function requirePgEnv(): PgCreds {
  const missing: string[] = [];
  if (!env.supabasePgHost) missing.push("SUPABASE_PG_HOST");
  if (!env.supabasePgUser) missing.push("SUPABASE_PG_USER");
  if (!env.supabasePgPassword) missing.push("SUPABASE_PG_PASSWORD");
  if (missing.length > 0) {
    throw new Error(
      `Refinery: missing required Postgres env var(s): ${missing.join(", ")}.\n` +
        `Set them in .env.local (port defaults to 5432, database defaults to "postgres"), ` +
        `or run with REFINERY_SOURCE=fixture for offline mode.`,
    );
  }
  const port = Number.parseInt(env.supabasePgPort, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(
      `Refinery: SUPABASE_PG_PORT must be a positive integer; got ${JSON.stringify(env.supabasePgPort)}.`,
    );
  }
  return {
    host: env.supabasePgHost!,
    port,
    user: env.supabasePgUser!,
    password: env.supabasePgPassword!,
    database: env.supabasePgDatabase,
  };
}
