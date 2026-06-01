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
    // Canonical bare names per the 2026-05-25 normalization (see .env.example
    // lines 9-10). Fall back to legacy BRAINS_-prefixed names so any deploy
    // env still carrying the old keys keeps working.
    supabaseUrl: process.env.SUPABASE_URL ?? process.env.BRAINS_SUPABASE_URL,
    supabaseKey:
      process.env.SUPABASE_SERVICE_KEY ??
      process.env.BRAINS_SUPABASE_SERVICE_KEY,
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
