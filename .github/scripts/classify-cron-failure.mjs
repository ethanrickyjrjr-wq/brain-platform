// Shared classifier for cron-workflow failures.
//
//   classify(logTail) -> { klass, signal, suggestedAction }
//
// Pure + deterministic (regex only). UNKNOWN routes to the LLM narrative in the
// heal workflow; every other class carries a deterministic suggestedAction.
// Imported by BOTH log-cron-incident.mjs (fills the ledger Root Cause + issue body)
// and heal-cron-failure.mjs (routes to L0 retry / L2 diagnose).
//
// Spec: docs/superpowers/specs/2026-06-08-leveled-cron-self-healing-design.md

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// import-name -> PyPI package. Data, not code (widen breadth by editing the JSON).
const IMPORT_MAP = (() => {
  try {
    const raw = JSON.parse(readFileSync(resolve(HERE, "pypi-import-map.json"), "utf8"));
    delete raw._comment;
    return raw;
  } catch {
    return {};
  }
})();

// Common stdlib top-level names — a ModuleNotFoundError on one of these means a
// broken Python env / wrong version, NOT a missing pip package.
const STDLIB = new Set(
  "os sys json re math time datetime collections itertools functools pathlib typing subprocess logging csv io abc dataclasses enum hashlib base64 urllib http sqlite3 asyncio random string decimal uuid traceback warnings contextlib shutil tempfile glob argparse configparser unittest threading queue socket ssl gzip zipfile pickle copy inspect operator".split(
    " ",
  ),
);

/**
 * Classify a failed-run log tail into a deterministic failure class.
 * @param {string} logTail
 * @returns {{ klass: string, signal: string, suggestedAction: string }}
 */
export function classify(logTail) {
  const text = logTail || "";
  let m;

  // 1. LOCKFILE — repo-specific recurring breaker (bun.lock drift vs frozen CI install).
  if (/lockfile had changes, but lockfile is frozen/i.test(text)) {
    return {
      klass: "LOCKFILE",
      signal: "bun.lock drift",
      suggestedAction:
        "Run `bun install` locally and commit the updated `bun.lock` in the same push (CI runs `bun install --frozen-lockfile`). See CLAUDE.md RULE 1 breaker #1.",
    };
  }

  // 2. ACTION_VERSION — a pinned GitHub Action version that doesn't exist.
  m = text.match(/(actions\/[\w.-]+@v?[\w.-]+)/i);
  if (
    m &&
    /(?:not\s*(?:found|exist)|nonexistent|Unable to resolve action|Can't find|unable to find version)/i.test(
      text,
    )
  ) {
    return {
      klass: "ACTION_VERSION",
      signal: m[1],
      suggestedAction: `Workflow pins \`${m[1]}\`, which doesn't exist. Bump it to a real released version of that action.`,
    };
  }

  // 3. MISSING_DEP — a Python import of a package that isn't installed.
  m = text.match(/ModuleNotFoundError: No module named ['"]([\w][\w.]*)['"]/);
  if (m) {
    const mod = m[1];
    return { klass: "MISSING_DEP", signal: mod, suggestedAction: depFix(mod) };
  }

  // 4. MISSING_SECRET — env var / credential absent. Must look like an ENV name (UPPER_SNAKE).
  m =
    text.match(
      /missing required env var\(s\)[^:]*:\s*([A-Z][A-Z0-9_]+(?:\s*,\s*[A-Z][A-Z0-9_]+)*)/,
    ) ||
    text.match(/KeyError:\s*['"]([A-Z][A-Z0-9_]{2,})['"]/) ||
    text.match(/\b([A-Z][A-Z0-9_]{2,})\s+not set\b/) ||
    text.match(/\bmissing[:,]?\s+([A-Z][A-Z0-9_]{2,})\b/);
  if (m) {
    const first = m[1].split(",")[0].replace(/\s+/g, "");
    const all = m[1].replace(/\s+/g, " ").trim();
    return {
      klass: "MISSING_SECRET",
      signal: all,
      suggestedAction: `Secret \`${first}\` is not reaching the pipeline. Confirm it's set (\`gh secret set ${first}\`) AND wired into this workflow's \`env:\` block — both steps are required (CLAUDE.md RULE 1 breaker #3 / "Secret wired in repo but not passed to workflow").`,
    };
  }

  // 5. SCHEMA_DRIFT — vocab orphan / missing relation or column / failed render validation / stale alias.
  m = text.match(
    /(Orphan Concept[^\n]*|relation ["'][\w.]+["'] does not exist|column ["'][\w.]+["'] does not exist|[^\n]*failed validation[^\n]*|CORRIDOR_ALIASES[^\n]*)/i,
  );
  if (m) {
    return {
      klass: "SCHEMA_DRIFT",
      signal: m[1].slice(0, 120).trim(),
      suggestedAction:
        "Schema/vocab drift — a slug, relation, or column the pipeline expects no longer matches the lake or the vocab. Needs a human: register the slug in `refinery/vocab/brain-vocabulary.json`, add the versioned DDL, or sync the alias map. Run `bun refinery/tools/check-vocab-coverage.mts --all` if vocab-related.",
    };
  }

  // 6. DATA_EMPTY — source returned nothing (dead/changed URL, WAF, async job not polled).
  m = text.match(
    /\b(0 rows|0 permits?|0 decisions|0 URLs?|0 records|no rows|returned 0|empty (?:HTML|response|result)|0 \w+ (?:discovered|returned|loaded))\b/i,
  );
  if (m) {
    return {
      klass: "DATA_EMPTY",
      signal: m[1].trim(),
      suggestedAction:
        "Source returned no data — likely a dead/changed URL, a new WAF block, or an async job whose result wasn't polled. Needs a human to re-point or re-scrape the source. If un-scrapable, consider the Operation Dumbo Drop scaffold.",
    };
  }

  // 7. TRANSIENT — network / timeout / rate-limit; usually self-resolves on retry.
  if (
    /ReadTimeout|TimeoutError|ConnectTimeout|Connection error|socket connection was closed|UNEXPECTED_EOF_WHILE_READING|SSL[: ][^\n]*EOF|HTTP 429|\b429\b|rate.?limit|Temporary failure in name resolution|Connection reset|ECONNRESET|ETIMEDOUT|EAI_AGAIN|Max retries exceeded/i.test(
      text,
    )
  ) {
    const t = text.match(
      /ReadTimeout|TimeoutError|Connection error|socket connection was closed|UNEXPECTED_EOF_WHILE_READING|429|Connection reset|ECONNRESET|ETIMEDOUT/i,
    );
    return {
      klass: "TRANSIENT",
      signal: t ? t[0] : "network",
      suggestedAction:
        "Transient network/timeout/rate-limit — usually self-resolves. Auto-retried once; if it recurs the upstream API may be down or throttling (space dispatches out).",
    };
  }

  // 8. UNKNOWN — unrecognised shape; route to the LLM narrative.
  return {
    klass: "UNKNOWN",
    signal: "",
    suggestedAction: "Unrecognised failure shape — needs diagnosis.",
  };
}

function depFix(mod) {
  const top = mod.split(".")[0];
  if (STDLIB.has(top)) {
    return `\`${mod}\` is a Python standard-library module — a bare ModuleNotFoundError here usually means a wrong Python version or a corrupted env, NOT a missing package. Check this workflow's Python setup.`;
  }
  const pypi = IMPORT_MAP[top] || IMPORT_MAP[mod];
  if (pypi) {
    return `Add \`${pypi}\` to \`ingest/requirements.txt\` (import name \`${top}\` → PyPI package \`${pypi}\`), then commit. Confirm it isn't a local-module import bug first.`;
  }
  return `\`${mod}\` is missing. If third-party, add it to \`ingest/requirements.txt\` (verify the exact PyPI name — it can differ from the import name). If it's a local module, this is an import-path bug, not a missing dependency.`;
}

/**
 * fs-backed guard (NOT pure): does this import name correspond to a local module
 * in the repo? If so, a MISSING_DEP is really an import-path bug, and we must not
 * suggest adding it to requirements.txt (dependency-confusion-safe).
 */
export function isLocalModule(mod, repoRoot = process.cwd()) {
  const top = mod.split(".")[0];
  return [
    `ingest/pipelines/${top}`,
    `ingest/lib/${top}`,
    `ingest/${top}.py`,
    `ingest/lib/${top}.py`,
    `ingest/pipelines/${top}.py`,
  ].some((c) => existsSync(resolve(repoRoot, c)));
}

// A freshness probe going red is a real stale-data signal — never auto-retry it.
export function isFreshnessProbe(workflowName) {
  return workflowName === "freshness-probe-daily";
}

// L0 retry applies only to transient failures.
export function shouldRetry(klass) {
  return klass === "TRANSIENT";
}

// L2 LLM narrative applies to the fuzzy classes (deterministic ones are handled by the logger).
export function needsLlm(klass) {
  return klass === "DATA_EMPTY" || klass === "SCHEMA_DRIFT" || klass === "UNKNOWN";
}
