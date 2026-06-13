#!/usr/bin/env node
// PreToolUse hook (matcher: Bash). Blocks `git push` when one of the known
// recurring nightly-rebuild / red-main breakers is about to ship. Each of these
// has reddened main or aborted the daily rebuild more than once; the prevention
// used to live only in prose (CLAUDE.md / docs/cron-rebuild-failures.md
// "Recurring Patterns"). This hook enforces it locally so the failure never
// reaches GHA.
//
//   1. LOCKFILE  — package.json dependency map changed but bun.lock did not
//                  → `bun install --frozen-lockfile` fails in CI in <1s.
//   2. VOCAB/ALIAS — a corridor rename or pack/vocab edit that orphans a slug on
//                  pack "master", or a corridor slug missing its alias.
//   3. SECRETS   — (advisory only) a new pipeline/workflow that may reference a
//                  secret not yet wired into the workflow `env:` block.
//   4. INGEST    — a destructive write (replace/truncate) with no non-null guard
//                  (BIBLE §0.2 rule 5); the one irreversible ingest failure.
//   5. PACK/CATALOG — a refinery/packs edit that drifts the leaf catalog from
//                  PER_PACK_REGISTRY (env-safe catalog.test mirror, hard block) or
//                  breaks a fast bun:test per-pack assertion (e.g. "sources wired").
//                  vitest/subprocess per-pack tests (zhvi/zori view parity) only
//                  resolve in CI, so they are skipped local-side, never blocked.
//
// NOTE — what this hook can and cannot catch: it stops DETERMINISTIC failures
// (drift, orphans, lockfile). It does NOT and cannot reliably stop a FLAKY test
// (non-deterministic, e.g. a crypto/Date/random-seeded assertion) — that passes
// locally most of the time and reddens CI at random regardless of the diff. The
// only fix for a flake is to make the test deterministic, not to gate harder.
// (Incident 2026-06-13: the proposal-nonce "tampered signature" test flaked ~6.5%
// per push and reddened main repeatedly until the test itself was fixed.)
//
// Design notes:
//   • Fail-CLOSED on a real gate violation (exit 2 blocks the push).
//   • Fail-OPEN on an internal error (missing bun, git quirk) — a broken hook
//     must never wedge every push. We warn and allow.
//   • Runs alongside check-session-log-on-push.mjs; both must pass.

import { execSync } from "node:child_process";

const BANNER = "=".repeat(72);

// Gate 4 (ingest hardening, BIBLE §0.2 rule 5) is LIVE (fail-closed). 2026-06-13:
// census_cbp + fdot carry a real non-null guard (assert_min_rows + a load-bearing
// non-null/non-zero floor); a clean re-run of the dry run confirmed they no longer
// trip the predicate. Both previously-HELD incidents are now RESOLVED:
//   • faf5 — RETIRED, not guarded. The dlt→Postgres replace pipeline was dead code
//     (faf_flows/faf_zone_lookup/faf_sctg_lookup never landed; the live freight path
//     is Tier-1 Parquet via faf5_to_parquet.py). pipeline.py/resources.py were deleted,
//     so the replace resource no longer exists to flag.
//   • fl_dbpr_applicants — FIXED + GUARDED. URL/layout/county corrected; the applicant
//     (replace) resource now carries assert_min_rows + per-county floors + city anchors.
// The block is PER-TOUCHED-FILE, so any future unguarded replace is caught the moment
// its file is edited. Operator override for a legitimate one-off:
// ALLOW_REPLACE_WITHOUT_GUARD=1 (reason is logged).
const BLOCK_REPLACE_WITHOUT_GUARD = true;

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    process.exit(0); // not our shape
  }
  const cmd = String(payload?.tool_input?.command ?? "");
  if (!isGitPush(cmd)) process.exit(0);

  // Comparison base: upstream if set, else origin/main. Mirrors the session-log hook.
  let base = "";
  try {
    base = sh("git rev-parse --abbrev-ref --symbolic-full-name @{u}");
  } catch {
    try {
      sh("git rev-parse --verify origin/main");
      base = "origin/main";
    } catch {
      process.exit(0); // can't enforce — allow
    }
  }

  let changed = [];
  try {
    const ahead = sh(`git rev-list --count ${base}..HEAD`);
    if (ahead === "0") process.exit(0); // nothing to push
    changed = sh(`git diff --name-only ${base}..HEAD`)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    process.exit(0); // git quirk — allow
  }

  // ---- Gate 1: lockfile drift ------------------------------------------------
  const pkgChanged = changed.includes("package.json");
  const lockChanged = changed.includes("bun.lock");
  if (pkgChanged && !lockChanged && depsChanged(base)) {
    block(
      "LOCKFILE — package.json dependencies changed but bun.lock did not",
      `A dependency add/remove/bump landed without regenerating the lockfile.\n` +
        `CI runs \`bun install --frozen-lockfile\`, detects the drift, and exits in\n` +
        `under 1s with \`error: lockfile had changes, but lockfile is frozen\` —\n` +
        `silently blocking the entire daily rebuild.\n\n` +
        `Fix:\n` +
        `  bun install && git add bun.lock && git commit -m "fix(lockfile): regenerate bun.lock"\n` +
        `(or \`--amend\` into the dep change), then retry the push.`,
    );
  }

  // ---- Gate 2: vocab orphans / corridor-alias desync ------------------------
  const vocabTouched = changed.some(
    (f) =>
      f.startsWith("refinery/packs/") ||
      f.startsWith("refinery/vocab/") ||
      f === "refinery/lib/corridor-aliases.mts" ||
      f.startsWith("fixtures/corridor-") ||
      f === "brains/master.md",
  );
  if (vocabTouched) {
    const alias = run("bun test refinery/lib/corridor-aliases.test.mts");
    if (alias.ran && alias.code !== 0) {
      block(
        "VOCAB/ALIAS — corridor-alias coverage test failed",
        `A corridor slug is missing its entry in refinery/lib/corridor-aliases.mts.\n` +
          `This is the corridor-rename breaker (CI goes red the moment master rebuilds).\n` +
          `Add the one-line alias per renamed corridor, then retry.\n\n` +
          truncate(alias.out),
      );
    }
    // --all, NOT the bare (master-only) default. The bare check only inspects
    // master.md's own key_metrics, so a slug emitted by a LEAF brain that orphans
    // master's normalize at stage 2.5 sails right through it — that exact hole
    // held the 2026-06-07 rebuild (econ-dev-swfl emitted econ_dev_announcements_90d
    // / _prior_90d, never registered). --all walks every brains/*.md through the
    // real Stage-2.5 resolver and exits 1 on the first orphan.
    const vocab = run("bun refinery/tools/check-vocab-coverage.mts --all");
    if (vocab.ran && vocab.code !== 0) {
      block(
        "VOCAB/ALIAS — a brain emits a metric slug not registered in the vocabulary",
        `A brain claims a metric slug that does not resolve in\n` +
          `refinery/vocab/brain-vocabulary.json — the orphan-concept error that\n` +
          `aborts the nightly rebuild the moment master re-synthesizes.\n\n` +
          `Fix: add a documented concept (prefLabel + scope_note) AND a slug_index\n` +
          `identity entry for each slug below, in THIS commit, then retry.\n\n` +
          truncate(vocab.out),
      );
    }
    // Conditional-slug guard: --all only sees slugs present in a RENDERED .md.
    // A slug emitted behind an `if` (e.g. econ_dev_investment_usd_90d, only when a
    // disclosure exists) is absent from the .md until data makes it computable —
    // then it orphans master with no warning. So read the touched pack SOURCE and
    // require every statically-emitted (double-quoted) metric literal to already be
    // registered in slug_index. Templated slugs use backticks → skipped (they
    // resolve via raw_slug_patterns, not slug_index).
    const unregistered = unregisteredLiteralSlugs(changed);
    if (unregistered.length > 0) {
      block(
        "VOCAB/ALIAS — a pack emits a metric slug literal not registered (conditional-orphan guard)",
        `These metric slugs are written as literals in pack source but are NOT in\n` +
          `refinery/vocab/brain-vocabulary.json slug_index. Even if a slug is emitted\n` +
          `only conditionally (behind an \`if\`), it MUST be registered now — otherwise\n` +
          `it orphans master the first day its data makes it computable.\n\n` +
          unregistered.map((u) => `  - ${u.slug}   (${u.file})`).join("\n") +
          `\n\nFix: add a documented concept + slug_index identity entry for each, in\n` +
          `THIS commit, then retry. (If a slug is genuinely templated, emit it via a\n` +
          `backtick template and register a raw_slug_patterns glob instead.)`,
      );
    }
  }

  // ---- Gate 5: pack ⇆ catalog mirror + fast per-pack assertions -------------
  // The redfin-lee parity build (d9aa670, 2026-06-13) shipped a refinery/packs edit
  // that drifted catalog.mts from PER_PACK_REGISTRY (domain/scope/ttl) AND broke a
  // per-pack "source connectors wired" assertion. Both are DETERMINISTIC failures
  // `bun test` catches in CI — but NO pre-push gate ran them, so red main sat ~2h
  // across 5 pushes before anyone noticed. catalog.test.mts is a pure mirror (imports
  // only catalog.mts + index.mts — no DB, no creds; verified 4-pass on an empty env),
  // so it is the env-SAFE hard block. Per-pack bun:test files are ADDITIVE and also
  // env-safe (fixture round-trips / static assertions). The vitest per-pack files
  // (zhvi/zori GATE A + *-view-equivalence) spawn a DuckDB/Postgres subprocess that
  // only resolves in CI; they are SKIPPED locally (advisory), never blocked, so
  // active §04/§06 view-parity work is never wedged.
  if (changed.some((f) => f.startsWith("refinery/packs/") && f.endsWith(".mts"))) {
    const catalog = run("bun test refinery/packs/catalog.test.mts");
    if (catalog.ran && catalog.code !== 0) {
      block(
        "PACK/CATALOG — leaf catalog drifted from PER_PACK_REGISTRY",
        `refinery/packs/catalog.mts (the MCP capability inventory) no longer mirrors\n` +
          `PER_PACK_REGISTRY: a missing/extra brain id, or a domain/scope/ttl_seconds\n` +
          `that drifted from the pack definition. CI's \`bun test\` goes red on this the\n` +
          `moment it lands; this gate stops it before main (incident 2026-06-13,\n` +
          `redfin-lee parity build).\n\n` +
          `Fix: reconcile refinery/packs/catalog.mts with the pack — add/remove the\n` +
          `BRAIN_CATALOG entry, or align domain/scope/ttl_seconds — then retry.\n\n` +
          truncate(catalog.out),
      );
    }
    const packFails = runTouchedPackTests(changed);
    if (packFails.length > 0) {
      block(
        "PACK — a fast per-pack assertion failed (real drift, not env)",
        `A touched pack's own bun:test failed on a fast, deterministic assertion —\n` +
          `not a subprocess timeout or network error. This is the per-pack breaker\n` +
          `class: e.g. "source connectors wired" drifting when a pack's sources change\n` +
          `(incident 2026-06-13, properties-lee-value), or key_metrics math.\n\n` +
          packFails.map((p) => `  • ${p.file}\n${truncate(p.out, 800)}`).join("\n\n") +
          `\n\nFix the pack (or the assertion), then retry. If this is genuinely an\n` +
          `environment/credentials failure that escaped the transient filter, set\n` +
          `ALLOW_PACK_TEST_ENV_FAIL=1 to push anyway (logged).`,
      );
    }
  }

  // ---- Gate 3: secret-wiring reminder (advisory, never blocks) --------------
  const touchedPipelineOrWorkflow = changed.some(
    (f) =>
      f.startsWith(".github/workflows/") ||
      (f.startsWith("ingest/") && (/pipeline.*\.py$/.test(f) || /source/.test(f))),
  );
  if (touchedPipelineOrWorkflow) {
    process.stdout.write(
      `\n[pre-push gate] NOTE: you touched a pipeline or workflow. If it reads a\n` +
        `new secret, confirm the secret is in EVERY workflow \`env:\` block that\n` +
        `invokes that pipeline — \`gh secret set\` alone does not expose it to the\n` +
        `job. (Recurring breaker: FRED/S3/Firecrawl keys, docs/cron-rebuild-failures.md.)\n`,
    );
  }

  // ---- Gate 4: ingest hardening (BIBLE §0.2) --------------------------------
  // Backstop against the ONE irreversible ingest failure: a destructive write
  // (write_disposition="replace"/truncate) shipped with NO non-null guard, so a
  // bad/empty pull or a silent vendor field-rename wipes good data. Detection is
  // EXACT-STRING on the one canonical guard (ingest/lib/guards.py) — no fuzzy
  // "looks like a null check" heuristics (that's where false-positive wedges
  // live). The other three §0.2 artifacts (narrow $select, ArcGIS outFields,
  // cadence registration) are wasteful-but-recoverable → advise only.
  ingestHardeningGate(changed);

  process.exit(0);
});

// Match both the raw `git push` and the mandated `node scripts/safe-push.mjs`
// wrapper. safe-push runs `git push` in a child process the Bash PreToolUse hook
// can't intercept, so matching the wrapper command here is the only way the gate
// fires on the path operators are actually told to use.
function isGitPush(cmd) {
  return /(^|\s|&&|;|\|\|)\s*git\s+push(\s|$)/.test(cmd) || /safe-push(\.mjs)?\b/.test(cmd);
}

function sh(c) {
  return execSync(c, { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

// Run a command, capturing combined output and exit code. `ran:false` means the
// command could not be spawned at all (e.g. bun not on PATH) — caller fails open.
function run(c) {
  try {
    const out = execSync(c, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { ran: true, code: 0, out };
  } catch (err) {
    if (typeof err?.status !== "number") {
      // Spawn failure, not a test failure — fail open with a warning.
      process.stdout.write(
        `\n[pre-push gate] WARN: could not run \`${c}\` (${err?.code ?? "unknown"}); ` +
          `skipping this check.\n`,
      );
      return { ran: false, code: 0, out: "" };
    }
    return {
      ran: true,
      code: err.status,
      out: `${err.stdout ?? ""}${err.stderr ?? ""}`,
    };
  }
}

function truncate(s, max = 2000) {
  const t = String(s || "").trim();
  return t.length > max ? `${t.slice(0, max)}\n… (truncated)` : t;
}

function block(title, body) {
  const msg = `\n${BANNER}\nPUSH BLOCKED — ${title}\n${BANNER}\n${body}\n${BANNER}\n`;
  process.stdout.write(msg);
  process.stderr.write(msg);
  process.exit(2);
}

// True if any of package.json's dependency maps differ between base and HEAD.
// A scripts-only / metadata-only edit returns false → no false lockfile block.
function depsChanged(base) {
  const keys = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  let basePkg, headPkg;
  try {
    basePkg = JSON.parse(sh(`git show ${base}:package.json`));
    headPkg = JSON.parse(sh(`git show HEAD:package.json`));
  } catch {
    // Can't read one side (new file, parse error) — be conservative and treat
    // a package.json change as dep-affecting so the lockfile rule still fires.
    return true;
  }
  for (const k of keys) {
    if (JSON.stringify(basePkg?.[k] ?? {}) !== JSON.stringify(headPkg?.[k] ?? {})) {
      return true;
    }
  }
  return false;
}

// Scan touched pack source for statically-emitted (double-quoted) metric slug
// literals and return any not present in the committed vocab's slug_index. The
// conditional-slug companion to `--all`: `--all` only sees slugs in a rendered
// .md, so a slug emitted behind an `if` is invisible until its data lands and
// orphans master with no warning. Reading the source catches it at push time.
// Both sides read HEAD so a slug registered in the SAME commit counts as covered.
// Fails OPEN (returns []) on any internal error — a broken guard must never wedge
// every push (mirrors the hook-wide fail-open design).
function unregisteredLiteralSlugs(changed) {
  try {
    const packs = changed.filter(
      (f) => f.startsWith("refinery/packs/") && f.endsWith(".mts") && !f.endsWith(".test.mts"),
    );
    if (packs.length === 0) return [];
    let vocabRaw;
    try {
      vocabRaw = sh("git show HEAD:refinery/vocab/brain-vocabulary.json");
    } catch {
      return []; // can't read vocab at HEAD — fail open
    }
    const slugIndex = JSON.parse(vocabRaw)?.slug_index ?? {};
    const registered = new Set(Object.keys(slugIndex));
    const found = [];
    const seen = new Set();
    for (const file of packs) {
      let src;
      try {
        src = sh(`git show HEAD:${file}`);
      } catch {
        continue; // file gone at HEAD (rename/delete) — skip
      }
      // `metric: "slug"` — double-quoted literal only. Backtick templates
      // (per-ZIP / per-corridor emissions) are intentionally skipped; they
      // resolve via raw_slug_patterns, not slug_index.
      const re = /\bmetric:\s*"([a-z0-9_]+)"/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        const slug = m[1];
        const key = `${file}::${slug}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!registered.has(slug)) found.push({ slug, file });
      }
    }
    return found;
  } catch {
    return []; // never wedge a push on a guard bug
  }
}

// Run the sibling <name>.test.mts of each touched non-test pack source and return
// only FAST, deterministic assertion failures (real drift). Skips:
//   • catalog.mts / index.mts (the catalog mirror is gated separately above),
//   • brand-new packs with no sibling test yet (the catalog mirror still gates them),
//   • vitest per-pack files — the zhvi/zori GATE A + *-view-equivalence tests spawn a
//     DuckDB/Postgres subprocess that only resolves in CI; running them in the local
//     pre-push context just times out, so they are advised + skipped (this is what
//     keeps active §04/§06 view-parity work from ever being wedged).
// A bun:test file that still fails in an env-looking way (timeout / subprocess /
// network / creds) is classified transient and ADVISED, never returned as a block
// (mirrors resilient-build.isTransientError). Fails OPEN ([]) on any internal error.
function runTouchedPackTests(changed) {
  try {
    if (process.env.ALLOW_PACK_TEST_ENV_FAIL === "1") return []; // operator escape
    const srcs = changed.filter(
      (f) =>
        f.startsWith("refinery/packs/") &&
        f.endsWith(".mts") &&
        !f.endsWith(".test.mts") &&
        f !== "refinery/packs/catalog.mts" &&
        f !== "refinery/packs/index.mts",
    );
    if (srcs.length === 0) return [];
    const failures = [];
    const seen = new Set();
    for (const src of srcs) {
      const testFile = src.replace(/\.mts$/, ".test.mts");
      if (seen.has(testFile)) continue;
      seen.add(testFile);
      let testSrc;
      try {
        testSrc = sh(`git show HEAD:${testFile}`);
      } catch {
        continue; // no sibling test (brand-new pack) — catalog mirror still gates it
      }
      // vitest files = the heavy subprocess / view-parity tests; CI-only, skip local.
      if (/from\s+["']vitest["']/.test(testSrc)) {
        process.stdout.write(
          `\n[pre-push gate] NOTE: skipped CI-only per-pack test ${testFile}\n` +
            `  (vitest + DuckDB/Postgres subprocess — does not resolve in the local\n` +
            `  pre-push context). The env-safe catalog mirror still gated this change.\n`,
        );
        continue;
      }
      const res = run(`bun test ${testFile}`);
      if (!res.ran || res.code === 0) continue;
      if (isPackTestEnvFailure(res.out)) {
        process.stdout.write(
          `\n[pre-push gate] ADVISE: ${testFile} failed in an environment-looking way\n` +
            `  (not real drift) — not blocking:\n` +
            truncate(res.out, 600) +
            `\n`,
        );
        continue;
      }
      failures.push({ file: testFile, out: res.out });
    }
    return failures;
  } catch {
    return []; // never wedge a push on a guard bug
  }
}

// Same transient/deterministic split resilient-build uses: a failure whose output
// names a subprocess, network, or credentials problem is environmental — not a real
// assertion drift — and must NOT block a local push.
function isPackTestEnvFailure(out) {
  return /timed out|subprocess failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|getaddrinfo|socket hang up|SUPABASE|credential|missing[_ ]secret|connect ECONN|password authentication|could not connect/i.test(
    String(out || ""),
  );
}

// Gate 4 body. Reads each touched ingest/pipelines/**.py at HEAD and checks the
// four BIBLE §0.2 artifacts. Blocks ONLY on the irreversible one (destructive
// write without a guard) and ONLY when BLOCK_REPLACE_WITHOUT_GUARD is true;
// everything else advises. Fails OPEN on any internal error.
function ingestHardeningGate(changed) {
  try {
    const files = changed.filter(
      (f) =>
        f.startsWith("ingest/pipelines/") &&
        f.endsWith(".py") &&
        !/(^|\/)test_|_test\.py$|\/tests?\//.test(f),
    );
    if (files.length === 0) return;

    const replaceNoGuard = [];
    const wideArcgis = [];
    const odataNoSelect = [];
    for (const file of files) {
      let src;
      try {
        src = sh(`git show HEAD:${file}`);
      } catch {
        continue; // gone at HEAD (rename/delete) — skip
      }
      const destructiveWrite =
        /write_disposition\s*=\s*["']replace["']/.test(src) || /\btruncate\b/i.test(src);
      // EXACT-STRING: the one canonical guard surface, no heuristics.
      const hasGuard =
        /ingest\.lib\.guards/.test(src) ||
        /\bassert_min_rows\s*\(/.test(src) ||
        /\bassert_vs_canonical\s*\(/.test(src) ||
        /\bassert_vs_baseline\s*\(/.test(src);
      if (destructiveWrite && !hasGuard) replaceNoGuard.push(file);

      // ArcGIS: bare paginate_arcgis( with no out_fields= → pulls "*" + geometry.
      // paginate_arcgis_tabular(...) and any call passing out_fields= are clean.
      if (/\bpaginate_arcgis\s*\(/.test(src) && !/out_fields\s*=/.test(src)) wideArcgis.push(file);

      // OData: a $top present with no $select → wide pull.
      if (/\$top/.test(src) && !/\$select/.test(src)) odataNoSelect.push(file);
    }

    const unregistered = unregisteredPipelineDirs(files);

    // --- the block (or advise) on the irreversible one: §0.2 rule 5 ----------
    if (replaceNoGuard.length > 0) {
      const body =
        `Destructive write (write_disposition="replace"/truncate) with NO non-null\n` +
        `guard — a bad/empty pull or a silent vendor field-rename will WIPE good data,\n` +
        `the one irreversible ingest failure. BIBLE §0.2 rule 5.\n\n` +
        replaceNoGuard.map((f) => `  - ${f}`).join("\n") +
        `\n\nFix: before the replace, compute each load-bearing column's non-null rate\n` +
        `via ingest.lib.guards (assert_min_rows / assert_vs_canonical + a non-null\n` +
        `floor) and abort below floor. Model: ingest/pipelines/fema/resources.py\n` +
        `_promote_nfip_to_tier2.`;
      const override = process.env.ALLOW_REPLACE_WITHOUT_GUARD === "1";
      if (BLOCK_REPLACE_WITHOUT_GUARD && override) {
        process.stdout.write(
          `\n[pre-push gate] OVERRIDE: ALLOW_REPLACE_WITHOUT_GUARD=1 — pushing a guardless\n` +
            `destructive write anyway (logged). Files:\n` +
            replaceNoGuard.map((f) => `  - ${f}`).join("\n") +
            `\n`,
        );
      } else if (BLOCK_REPLACE_WITHOUT_GUARD) {
        block("INGEST — destructive write without a non-null guard (BIBLE §0.2 rule 5)", body);
      } else {
        process.stdout.write(
          `\n[pre-push gate] ADVISE (Gate 4 — will BLOCK once the 4 legacy replace\n` +
            `pipelines are guarded; set BLOCK_REPLACE_WITHOUT_GUARD=true then):\n` +
            body +
            `\n`,
        );
      }
    }

    // --- advise on the recoverable ones --------------------------------------
    if (wideArcgis.length > 0)
      process.stdout.write(
        `\n[pre-push gate] ADVISE — ArcGIS pull with no outFields projection (BIBLE §0.2 rule 6):\n` +
          wideArcgis.map((f) => `  - ${f}`).join("\n") +
          `\n  paginate_arcgis() defaults out_fields="*" + geometry. Use\n` +
          `  paginate_arcgis_tabular(out_fields=…) with only the columns the normalizer reads.\n`,
      );
    if (odataNoSelect.length > 0)
      process.stdout.write(
        `\n[pre-push gate] ADVISE — OData $top with no $select (BIBLE §0.2 rule 2):\n` +
          odataNoSelect.map((f) => `  - ${f}`).join("\n") +
          `\n  $select only the fields the normalizer reads (also validates the field names).\n`,
      );
    if (unregistered.length > 0)
      process.stdout.write(
        `\n[pre-push gate] ADVISE — pipeline dir not found in cadence_registry.yaml (BIBLE §0.2 rule 7):\n` +
          unregistered.map((d) => `  - ${d}`).join("\n") +
          `\n  Register it (name/lane/cadence_days) so the freshness probe covers it, and\n` +
          `  confirm the cron is no more frequent than the source publishes.\n`,
      );
  } catch {
    // Gate 4 must never wedge a push on its own bug — fail open.
  }
}

// Dir-PRESENCE only. Returns touched ingest/pipelines/<dir>/ whose <dir> token
// does not appear anywhere in cadence_registry.yaml. It intentionally does NOT
// parse the registry or require any per-entry field — change_signal /
// vintage_policy / repro_pointer stay warn-only/additive (Row Layer decision);
// this check must NEVER hard-fail on a missing field. Reads HEAD so a dir
// registered in the same commit counts as present. Fails OPEN (returns []).
function unregisteredPipelineDirs(files) {
  try {
    let registry;
    try {
      registry = sh("git show HEAD:ingest/cadence_registry.yaml");
    } catch {
      return []; // no registry at HEAD — fail open
    }
    const dirs = new Set();
    for (const f of files) {
      const m = f.match(/^ingest\/pipelines\/([^/]+)\//);
      if (m) dirs.add(m[1]);
    }
    const missing = [];
    for (const d of dirs) if (!registry.includes(d)) missing.push(d);
    return missing;
  } catch {
    return [];
  }
}
